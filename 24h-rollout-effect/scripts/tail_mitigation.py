#!/usr/bin/env python3
"""Tail-risk mitigation tests for the short-side subset, on minute data.

Compares exit rules on the same entries: the baseline 60-minute time exit,
earlier time exits (the event-study drift peaks near minute 30), and hard
adverse-excursion stops. Stops are filled pessimistically at the trigger
level plus slippage, since stop-market orders into a squeeze fill badly.

Output: RESULTS_DIR/tail_mitigation.txt
"""
import json
import os

import numpy as np
import pandas as pd

from _paths import RESULTS_DIR, parquet_dir

params = json.load(open(os.path.join(RESULTS_DIR, "capital_params.json")))
WIN_LO, WIN_HI = params["win_lo"], params["win_hi"]
TRIG, MINQV = params["trig"], params["min_qv"]
FEE = params["fee_maker"]
SLIP = 0.01  # stop fills 1% through the trigger level

PARQ1M = parquet_dir("1m")

tr = pd.read_parquet(os.path.join(RESULTS_DIR, "trades.parquet"))
t = tr[(tr.time >= WIN_LO) & (tr.time <= WIN_HI)]
sub = t[(t.side == -1) & (t.trigger_ret.abs() >= TRIG) & (t.qv_lag >= MINQV)]

paths = []  # (entry, highs[60], closes[60]) per trade with minute coverage
for sym, tsym in sub.groupby("symbol", observed=True):
    f = os.path.join(PARQ1M, sym + ".parquet")
    if not os.path.exists(f):
        continue
    px = pd.read_parquet(f, columns=["open_time", "open", "high", "close"])
    mins = (px.open_time.values // 60000).astype(np.int64)
    lo, n = mins[0], mins[-1] - mins[0] + 1
    high = np.full(n, np.nan); close = np.full(n, np.nan); op = np.full(n, np.nan)
    high[mins - lo] = px.high.values
    close[mins - lo] = px.close.values
    op[mins - lo] = px.open.values
    for tm in tsym.time.values.astype("datetime64[m]").astype(np.int64):
        p = tm - lo
        if p < 0 or p + 60 > n or np.isnan(op[p]):
            continue
        paths.append((op[p], high[p:p + 60].copy(), close[p:p + 60].copy()))
print(f"{len(paths)} of {len(sub)} trades with minute coverage")


def evaluate(hold_min, stop=None):
    rets = []
    stopped = 0
    for entry, high, close in paths:
        h = high[:hold_min]
        if stop is not None:
            hit = np.where(h >= entry * (1 + stop))[0]
            if len(hit):
                stopped += 1
                rets.append(-(stop + SLIP) - FEE)
                continue
        c = close[hold_min - 1]
        if np.isnan(c):
            valid = close[:hold_min][~np.isnan(close[:hold_min])]
            if len(valid) == 0:
                continue
            c = valid[-1]
        rets.append(-(c / entry - 1.0) - FEE)
    r = np.array(rets)
    return (r.mean() * 1e4, np.percentile(r, 1) * 100, r.min() * 100,
            stopped / len(paths), r.std() * 100)


lines = ["TAIL MITIGATION: short subset, minute-resolution exits",
         f"stops filled at trigger + {SLIP:.0%} slippage; net of maker fees",
         f"{'rule':<28} {'mean bps':>9} {'p1':>8} {'worst':>8} "
         f"{'stopped':>8} {'per-trade sd':>13}"]
for hold, stop in [(60, None), (45, None), (30, None),
                   (60, 0.20), (60, 0.15), (60, 0.10),
                   (30, 0.15), (30, 0.10)]:
    m, p1, worst, srate, sd = evaluate(hold, stop)
    name = f"hold {hold}m" + (f" + stop {stop:.0%}" if stop else "")
    lines.append(f"{name:<28} {m:>+9.1f} {p1:>7.1f}% {worst:>7.1f}% "
                 f"{srate:>8.1%} {sd:>12.2f}%")

txt = "\n".join(lines)
print(txt)
with open(os.path.join(RESULTS_DIR, "tail_mitigation.txt"), "w") as f:
    f.write(txt + "\n")
