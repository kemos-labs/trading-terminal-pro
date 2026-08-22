#!/usr/bin/env python3
"""Stream kline archives straight into parquet, storing no zip on disk.

Downloads each archive into memory, decompresses and parses it there, and
writes one parquet per symbol. Peak storage is the parquet output alone
(the alternative download.py + parse_klines.py path keeps the raw archives
as a local cache, which roughly doubles the footprint but makes re-parsing
free).

Usage:
    python scripts/stream_ingest.py data/manifest_1h.txt 1h [--workers 8]
"""
import argparse
import io
import os
import re
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

from _paths import parquet_dir

BASE = "https://data.binance.vision/"
COLS = ["open_time", "open", "high", "low", "close", "volume", "close_time",
        "quote_volume", "count", "taker_buy_volume", "taker_buy_quote_volume", "ignore"]
KEEP = ["open_time", "open", "high", "low", "close", "volume", "quote_volume"]


def fetch(key):
    url = BASE + urllib.parse.quote(key)
    err = None
    for _ in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read()
        except Exception as e:
            err = e
    raise RuntimeError(f"{key}: {err}")


def parse_zip_bytes(raw):
    frames = []
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        for name in z.namelist():
            data = z.read(name)
            skip = 1 if data[:200].split(b"\n", 1)[0].startswith(b"open_time") else 0
            frames.append(pd.read_csv(io.BytesIO(data), header=None, skiprows=skip,
                                      names=COLS, usecols=KEEP))
    return frames


def process_symbol(args):
    sym, keys, out_dir = args
    # monthly archives first so consolidated rows win on any overlap
    keys = sorted(keys, key=lambda k: ("/daily/" in k, k))
    frames = []
    for key in keys:
        try:
            frames += parse_zip_bytes(fetch(key))
        except Exception as e:
            print(f"FAILED {key}: {e}", flush=True)
    if not frames:
        return sym, 0
    df = pd.concat(frames, ignore_index=True)
    us = df["open_time"] > 10**14
    df.loc[us, "open_time"] //= 1000
    df = (df.drop_duplicates("open_time", keep="first")
            .sort_values("open_time").reset_index(drop=True))
    df.to_parquet(os.path.join(out_dir, f"{sym}.parquet"), index=False)
    return sym, len(df)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest")
    ap.add_argument("interval")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    out_dir = parquet_dir(args.interval)
    os.makedirs(out_dir, exist_ok=True)

    pat = re.compile(r"/klines/([^/]+)/" + re.escape(args.interval) + "/")
    by_symbol = defaultdict(list)
    for line in open(args.manifest):
        key = line.strip()
        if not key:
            continue
        m = pat.search(key)
        if m:
            by_symbol[m.group(1)].append(key)
    print(f"{len(by_symbol)} symbols, {sum(map(len, by_symbol.values()))} archives")

    total = 0
    done = 0
    with ThreadPoolExecutor(args.workers) as ex:
        jobs = [(s, k, out_dir) for s, k in sorted(by_symbol.items())]
        for sym, n in ex.map(process_symbol, jobs):
            total += n
            done += 1
            if done % 100 == 0:
                print(f"{done}/{len(jobs)} symbols", flush=True)
    print(f"done: {total} rows -> {out_dir}")


if __name__ == "__main__":
    main()
