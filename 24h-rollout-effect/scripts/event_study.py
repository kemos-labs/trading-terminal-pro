#!/usr/bin/env python3
"""Minute-resolution event study around the roll-out signal.

For every 1h signal inside the study window, tracks the side-adjusted
cumulative return path from entry (the 1-minute open at the signal hour) over
minutes -60..+180, bucketed by trigger-candle magnitude. Requires 1m parquet
data covering the window (see build_manifest.py / parse_klines.py with the
1m interval).

Output: RESULTS_DIR/event_study_1m.csv
"""
import argparse
import os

import numpy as np
import pandas as pd

from _paths import RESULTS_DIR, parquet_dir

PRE, POST = 60, 180
REL = np.arange(-PRE, POST + 1)
BUCKETS = ["<2%", "2-5%", "5-10%", ">10%"]

ap = argparse.ArgumentParser()
ap.add_argument("--start", default="2026-01-02")
ap.add_argument("--end", default="2026-07-22 23:00:00+00:00")
args = ap.parse_args()

PARQ1M = parquet_dir("1m")
tr = pd.read_parquet(os.path.join(RESULTS_DIR, "trades.parquet"))
tr = tr[(tr.time >= args.start) & (tr.time <= args.end)].copy()
tr["mag"] = pd.cut(tr.trigger_ret.abs(), [0, 0.02, 0.05, 0.10, np.inf],
                   labels=BUCKETS)
print(f"{len(tr)} candidate signals, {tr.symbol.nunique()} symbols")

groups = {(b, s): [np.zeros(len(REL)), np.zeros(len(REL))]
          for b in BUCKETS for s in (1, -1)}
included = 0

for sym, tsym in tr.groupby("symbol", observed=True):
    f = os.path.join(PARQ1M, sym + ".parquet")
    if not os.path.exists(f):
        continue
    px = pd.read_parquet(f, columns=["open_time", "open", "close"])
    mins = (px.open_time.values // 60000).astype(np.int64)
    lo, n = mins[0], mins[-1] - mins[0] + 1
    close = np.full(n, np.nan)
    open_ = np.full(n, np.nan)
    close[mins - lo] = px.close.values
    open_[mins - lo] = px.open.values

    t_min = tsym.time.values.astype("datetime64[m]").astype(np.int64)
    for tm, side, mag in zip(t_min, tsym.side.values, tsym.mag.values):
        p = tm - lo
        if pd.isna(mag) or p - PRE < 0 or p + POST >= n or np.isnan(open_[p]):
            continue
        included += 1
        path = side * (close[p - PRE:p + POST + 1] / open_[p] - 1.0)
        ok = ~np.isnan(path)
        g = groups[(mag, side)]
        g[0][ok] += path[ok]
        g[1] += ok

print(f"paths included: {included} of {len(tr)} candidates")

rows = []
for (b, s), (tot, cnt) in groups.items():
    mean = np.divide(tot, cnt, out=np.full_like(tot, np.nan), where=cnt > 0)
    rows += [(b, "long" if s == 1 else "short", int(k), m * 1e4, int(c))
             for k, m, c in zip(REL, mean, cnt)]
prof = pd.DataFrame(rows, columns=["bucket", "side", "min", "cum_bps", "n"])
prof.to_csv(os.path.join(RESULTS_DIR, "event_study_1m.csv"), index=False)

show = [-60, -30, -10, 0, 10, 30, 59, 120, 180]
print(prof[prof["min"].isin(show)]
      .pivot_table(index=["bucket", "side"], columns="min", values="cum_bps",
                   observed=True).round(1).to_string())
