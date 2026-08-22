#!/usr/bin/env python3
"""Download all archives listed in a manifest from data.binance.vision.

Idempotent: existing non-empty files are skipped, so interrupted runs can be
resumed by re-invoking. Failures are retried and logged to
DATA_DIR/failed_<manifest name>.txt.

Usage:
    python scripts/download.py data/manifest_1h.txt [--workers 64]
"""
import argparse
import os
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from _paths import DATA_DIR

BASE = "https://data.binance.vision/"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest")
    ap.add_argument("--workers", type=int, default=64)
    args = ap.parse_args()

    keys = [l.strip() for l in open(args.manifest) if l.strip()]
    failed = []

    def fetch(key):
        dest = os.path.join(DATA_DIR, key)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            return
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        tmp = dest + ".part"
        err = None
        for _ in range(4):
            try:
                with urllib.request.urlopen(BASE + urllib.parse.quote(key), timeout=60) as r, \
                        open(tmp, "wb") as f:
                    while chunk := r.read(1 << 18):
                        f.write(chunk)
                os.replace(tmp, dest)
                return
            except Exception as e:
                err = e
        failed.append((key, str(err)))

    with ThreadPoolExecutor(args.workers) as ex:
        for i, _ in enumerate(ex.map(fetch, keys), 1):
            if i % 2000 == 0:
                print(f"{i}/{len(keys)} processed, {len(failed)} failed", flush=True)

    print(f"finished: {len(keys)} archives, {len(failed)} failed")
    log = os.path.join(DATA_DIR, "failed_" + os.path.basename(args.manifest))
    with open(log, "w") as f:
        f.writelines(f"{k}\t{e}\n" for k, e in failed)


if __name__ == "__main__":
    main()
