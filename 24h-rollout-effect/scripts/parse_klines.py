#!/usr/bin/env python3
"""Parse downloaded kline zip archives into one parquet file per symbol.

Monthly (consolidated) archives take precedence over daily (preliminary)
archives wherever both cover the same candle. Timestamps are normalised to
milliseconds (newer Binance archives use microseconds).

Usage:
    python scripts/parse_klines.py [interval]     # default 1h
"""
import io
import os
import sys
import zipfile
from concurrent.futures import ProcessPoolExecutor

import pandas as pd

from _paths import DATA_DIR, parquet_dir

INTERVAL = sys.argv[1] if len(sys.argv) > 1 else "1h"
MONTHLY = os.path.join(DATA_DIR, "data/futures/um/monthly/klines")
DAILY = os.path.join(DATA_DIR, "data/futures/um/daily/klines")
OUT = parquet_dir(INTERVAL)
os.makedirs(OUT, exist_ok=True)

COLS = ["open_time", "open", "high", "low", "close", "volume", "close_time",
        "quote_volume", "count", "taker_buy_volume", "taker_buy_quote_volume", "ignore"]
KEEP = ["open_time", "open", "high", "low", "close", "volume", "quote_volume"]


def read_zip(path):
    frames = []
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            raw = z.read(name)
            skip = 1 if raw[:200].split(b"\n", 1)[0].startswith(b"open_time") else 0
            frames.append(pd.read_csv(io.BytesIO(raw), header=None, skiprows=skip,
                                      names=COLS, usecols=KEEP))
    return frames


def process_symbol(sym):
    files = []
    for base in (MONTHLY, DAILY):  # monthly first: consolidated rows win below
        d = os.path.join(base, sym, INTERVAL)
        if os.path.isdir(d):
            files += [os.path.join(d, f) for f in sorted(os.listdir(d))
                      if f.endswith(".zip")]
    frames = []
    for f in files:
        try:
            frames += read_zip(f)
        except Exception as e:
            print(f"BAD ZIP {f}: {e}", flush=True)
    if not frames:
        return sym, 0
    df = pd.concat(frames, ignore_index=True)
    us = df["open_time"] > 10**14
    df.loc[us, "open_time"] //= 1000
    df = (df.drop_duplicates("open_time", keep="first")
            .sort_values("open_time").reset_index(drop=True))
    df.to_parquet(os.path.join(OUT, f"{sym}.parquet"), index=False)
    return sym, len(df)


if __name__ == "__main__":
    syms = set()
    for base in (MONTHLY, DAILY):
        if os.path.isdir(base):
            syms |= {s for s in os.listdir(base)
                     if os.path.isdir(os.path.join(base, s, INTERVAL))}
    print(f"{len(syms)} symbols with {INTERVAL} data")
    total = 0
    with ProcessPoolExecutor(max_workers=8) as ex:
        for _, n in ex.map(process_symbol, sorted(syms)):
            total += n
    print(f"done, {total} rows -> {OUT}")
