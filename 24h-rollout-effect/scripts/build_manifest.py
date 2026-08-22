#!/usr/bin/env python3
"""Build a download manifest of Binance UM-futures kline archives.

Enumerates every USDT-quoted perpetual that has ever had data published under
data.binance.vision (including delisted contracts, so the universe is free of
survivorship bias), excludes stablecoin-quoted bases, and lists all monthly
zip archives for the requested interval plus current-month daily archives.

Usage:
    python scripts/build_manifest.py --interval 1h --start 2020-01
    python scripts/build_manifest.py --interval 1m --start 2026-01
"""
import argparse
import os
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from _paths import DATA_DIR

BUCKET = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"

STABLE_BASES = {"USDC", "BUSD", "TUSD", "DAI", "FDUSD", "USDP", "USD1", "AEUR",
                "EUR", "EURI", "USDE", "XUSD", "BFUSD", "USTC", "UST"}


def list_keys(prefix, delimiter=None):
    out, marker = [], None
    while True:
        url = f"{BUCKET}?prefix={urllib.parse.quote(prefix)}"
        if delimiter:
            url += f"&delimiter={delimiter}"
        if marker:
            url += f"&marker={urllib.parse.quote(marker)}"
        for attempt in range(5):
            try:
                xml = urllib.request.urlopen(url, timeout=30).read()
                break
            except Exception:
                if attempt == 4:
                    raise
        root = ET.fromstring(xml)
        if delimiter:
            out += [p.find(NS + "Prefix").text
                    for p in root.findall(NS + "CommonPrefixes")]
            last = out[-1] if out else None
        else:
            keys = [c.find(NS + "Key").text for c in root.findall(NS + "Contents")]
            out += keys
            last = keys[-1] if keys else None
        if root.find(NS + "IsTruncated").text == "true":
            nm = root.find(NS + "NextMarker")
            marker = nm.text if nm is not None else last
        else:
            return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", default="1h")
    ap.add_argument("--start", default="2020-01", help="first monthly archive (YYYY-MM)")
    ap.add_argument("--end", default=None,
                    help="freeze the snapshot: last monthly archive (YYYY-MM); "
                         "daily archives are taken for the following month")
    ap.add_argument("--out", default=None, help="manifest path (default: DATA_DIR/manifest_<interval>.txt)")
    args = ap.parse_args()

    # union of both archive trees so contracts having only daily archives
    # (e.g. listed in the current month) are not missed
    symbols = set()
    for tree in ("monthly", "daily"):
        prefix = f"data/futures/um/{tree}/klines/"
        symbols |= {p[len(prefix):].strip("/")
                    for p in list_keys(prefix, delimiter="/")}
    symbols = sorted(s for s in symbols
                     if s.endswith("USDT") and s[:-4] not in STABLE_BASES)
    print(f"{len(symbols)} non-stablecoin USDT perpetuals")

    last_month = args.end or date.today().strftime("%Y-%m")
    if args.end:
        y, m = map(int, args.end.split("-"))
        daily_month = f"{y + m // 12}-{m % 12 + 1:02d}"
    else:
        daily_month = last_month

    def per_symbol(sym):
        monthly = list_keys(f"data/futures/um/monthly/klines/{sym}/{args.interval}/")
        monthly = [k for k in monthly if k.endswith(".zip")
                   and args.start <= k[-11:-4] <= last_month]
        daily = list_keys(
            f"data/futures/um/daily/klines/{sym}/{args.interval}/{sym}-{args.interval}-{daily_month}-")
        return monthly + [k for k in daily if k.endswith(".zip")]

    with ThreadPoolExecutor(32) as ex:
        results = list(ex.map(per_symbol, symbols))

    out = args.out or os.path.join(DATA_DIR, f"manifest_{args.interval}.txt")
    with open(out, "w") as f:
        for keys in results:
            f.writelines(k + "\n" for k in keys)
    print(f"{sum(map(len, results))} archives -> {out}")


if __name__ == "__main__":
    main()
