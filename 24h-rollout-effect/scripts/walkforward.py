#!/usr/bin/env python3
"""Walk-forward validation of the concentrated subset.

The capital and risk sections study a subset (short side, trigger >= 10%,
lagged volume >= $1M) that was identified on the same 2026 window it is
evaluated on. This script asks whether that subset survives honest
selection discipline:

  training    2022-07-23 .. 2024-12-31   rule selection happens here only
  validation  2025-01-01 .. 2025-12-31   untouched during selection
  test        2026-01-01 .. 2026-07-22   untouched during selection

The selection grid covers side, trigger threshold and volume floor at a 1h
hold with maker fees. The champion is the training configuration with the
highest hour-clustered t-statistic of net-of-fee return (same-hour signals
are averaged into one observation per hour first, since simultaneous crypto
returns are strongly correlated), subject to a minimum trade count. The
champion and the full top five are then evaluated, unchanged, on validation
and test.

Output: RESULTS_DIR/walkforward.txt
"""
import os

import numpy as np
import pandas as pd

from _paths import RESULTS_DIR

FEE = 4e-4
MIN_TRADES = 200
PERIODS = {
    "training": ("2022-07-23", "2025-01-01"),
    "validation": ("2025-01-01", "2026-01-01"),
    "test": ("2026-01-01", "2026-07-23"),
}
GRID_SIDE = [("short", -1), ("long", 1), ("both", 0)]
GRID_TRIG = [0.05, 0.10, 0.15, 0.20]
GRID_QV = [0, 1e5, 1e6, 1e7]

tr = pd.read_parquet(os.path.join(RESULTS_DIR, "trades.parquet"))
tr["net"] = tr.ret_1h - FEE
frames = {k: tr[(tr.time >= lo) & (tr.time < hi)]
          for k, (lo, hi) in PERIODS.items()}

lines = []
def say(s=""):
    print(s)
    lines.append(s)


def subset(df, side, trig, qv):
    m = (df.trigger_ret.abs() >= trig) & (df.qv_lag >= qv)
    if side:
        m &= df.side == side
    return df[m]


def stats(df):
    n = len(df)
    if n == 0:
        return n, np.nan, np.nan
    m = df.net.mean()
    hourly = df.groupby("time").net.mean()
    t = (hourly.mean() / (hourly.std() / np.sqrt(len(hourly)))
         if len(hourly) > 1 else np.nan)
    return n, m * 1e4, t


rows = []
for sname, sval in GRID_SIDE:
    for trig in GRID_TRIG:
        for qv in GRID_QV:
            n, m, t = stats(subset(frames["training"], sval, trig, qv))
            if n >= MIN_TRADES:
                rows.append((sname, sval, trig, qv, n, m, t))
grid = pd.DataFrame(rows, columns=["side", "sval", "trig", "qv",
                                   "n_train", "bps_train", "t_train"])
grid = grid.sort_values("t_train", ascending=False).reset_index(drop=True)

say("WALK-FORWARD VALIDATION")
say("selection on training only; validation and test untouched")
say(f"grid: {len(GRID_SIDE)} sides x {len(GRID_TRIG)} triggers x "
    f"{len(GRID_QV)} volume floors, 1h hold, net of {FEE*1e4:.0f} bps; "
    f"champion = max hour-clustered training t-stat, n >= {MIN_TRADES}")

say("\ntop five training configurations, carried unchanged through 2025 and 2026:")
say(f"{'rank':>4} {'side':>6} {'trig':>5} {'min vol':>12} "
    f"{'train n/bps/t':>20} {'valid n/bps/t':>20} {'test n/bps/t':>20}")
for i, row in grid.head(5).iterrows():
    cells = [f"{i+1:>4} {row.side:>6} {row.trig:>4.0%} {row.qv:>12,.0f}"]
    for period in ("training", "validation", "test"):
        n, m, t = stats(subset(frames[period], row.sval, row.trig, row.qv))
        cells.append(f"{n:>7}/{m:>+6.1f}/{t:>4.1f}")
    say(" ".join(cells))

champ = grid.iloc[0]
say(f"\nchampion (chosen ex ante): {champ.side}, trigger >= {champ.trig:.0%}, "
    f"volume >= ${champ.qv:,.0f}")
for period in ("training", "validation", "test"):
    n, m, t = stats(subset(frames[period], champ.sval, champ.trig, champ.qv))
    say(f"  {period:>10}: {n} trades, {m:+.1f} bps net, t = {t:.1f}")

say("\nthe subset studied in the capital and risk sections "
    "(short, >= 10%, >= $1M):")
for period in ("training", "validation", "test"):
    n, m, t = stats(subset(frames[period], -1, 0.10, 1e6))
    say(f"  {period:>10}: {n} trades, {m:+.1f} bps net, t = {t:.1f}")

with open(os.path.join(RESULTS_DIR, "walkforward.txt"), "w") as f:
    f.write("\n".join(lines) + "\n")
