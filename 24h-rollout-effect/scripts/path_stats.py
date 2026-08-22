#!/usr/bin/env python3
"""Equity-path statistics for the fee-viable subset at knee capital.

Reuses the capital model (half-Kelly per trade, 1% participation ceiling,
same-hour positions scaled so exposure never exceeds capital) at the knee
capital computed by capital_report.py, and reports what the mean and Sharpe
hide: drawdowns, losing streaks, time under water and the monthly profile.

The model sizes positions against FIXED capital B (the participation caps
are fixed dollar amounts), so the path is accounted arithmetically: equity
is B plus cumulative dollar P&L, and all percentages are of initial capital.
Compounding daily returns would mix a fixed-sizing model with a reinvesting
path and overstate the result.

Output: RESULTS_DIR/path_stats.txt, FIGURES_DIR/fig7_equity_path.png
"""
import json
import os

import numpy as np
import pandas as pd

from _paths import FIGURES_DIR, RESULTS_DIR
from _style import plt, INK, C1, C8

params = json.load(open(os.path.join(RESULTS_DIR, "capital_params.json")))
WIN_LO, WIN_HI = params["win_lo"], params["win_hi"]
TRIG, MINQV = params["trig"], params["min_qv"]
FEE_MAKER = params["fee_maker"]
B = float(params["knee"])
F_HALF = params["f_half"]
PART = 0.01

tr = pd.read_parquet(os.path.join(RESULTS_DIR, "trades.parquet"))
t = tr[(tr.time >= WIN_LO) & (tr.time <= WIN_HI)].copy()
sub = t[(t.side == -1) & (t.trigger_ret.abs() >= TRIG) & (t.qv_lag >= MINQV)].copy()
sub["net"] = (sub.ret_1h - FEE_MAKER).clip(lower=-1.0)

alloc = np.minimum(F_HALF * B, PART * sub.qv_lag.values)
hour_sum = pd.Series(alloc).groupby(sub.time.values).transform("sum").values
posn = alloc * np.minimum(1.0, B / hour_sum)

idx = pd.DatetimeIndex(sub.time.dt.floor("D").dt.tz_localize(None)).as_unit("ns")
last_day = pd.Timestamp(WIN_HI).floor("D").tz_localize(None)
pnl = (pd.Series(posn * sub.net.values, index=idx).groupby(level=0).sum()
       .reindex(pd.date_range(WIN_LO, last_day).as_unit("ns"), fill_value=0.0))
ret = pnl / B                     # daily P&L as fraction of initial capital
equity = 1.0 + ret.cumsum()       # arithmetic: fixed-B sizing, no reinvestment
peak = equity.cummax()
dd = equity - peak                # in units of initial capital
days = len(ret)

lines = []
def say(s=""):
    print(s)
    lines.append(s)

say(f"EQUITY PATH: fee-viable subset at ${B:,.0f} (the knee), half-Kelly, "
    f"{PART:.0%} participation, net of maker fees")
say("fixed-capital accounting: percentages are of initial capital, "
    "no reinvestment")
say(f"window {WIN_LO}..{last_day.date()} ({days} days, "
    f"{(ret != 0).sum()} with at least one trade)")
say(f"total return: {(equity.iloc[-1]-1)*100:+.1f}% of initial capital")
say(f"mean daily {ret.mean()*100:+.3f}%   daily vol {ret.std()*100:.2f}%   "
    f"annualized Sharpe {ret.mean()/ret.std()*np.sqrt(365):.2f}")
say(f"best day {ret.max()*100:+.2f}%   worst day {ret.min()*100:+.2f}%   "
    f"positive days {(ret > 0).mean():.1%}")

say(f"\nmax drawdown: {dd.min()*100:.2f}% of initial capital "
    f"({(dd/peak).min()*100:.2f}% of running peak equity; "
    f"trough {dd.idxmin().date()})")
under = dd < 0
runs = (under != under.shift()).cumsum()[under]
say(f"longest time under water: {runs.value_counts().max() if len(runs) else 0} days")
streak = (ret < 0).astype(int)
sgrp = (streak != streak.shift()).cumsum()[streak == 1]
say(f"longest daily losing streak: "
    f"{sgrp.value_counts().max() if len(sgrp) else 0} days")

say("\nmonthly P&L (% of initial capital):")
monthly = ret.groupby(ret.index.to_period("M")).sum()
for m, v in monthly.items():
    say(f"  {m}: {v*100:+.2f}%")

with open(os.path.join(RESULTS_DIR, "path_stats.txt"), "w") as f:
    f.write("\n".join(lines) + "\n")

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(6.4, 4.6), sharex=True,
                               gridspec_kw={"hspace": 0.1,
                                            "height_ratios": [2.2, 1]})
ax1.plot(equity.index, equity.values, color=C1, lw=1.6)
ax1.set_ylabel("equity (multiples of initial capital)")
ax1.set_title(f"Equity path at ${B/1e3:,.0f}k fixed capital, net of maker fees",
              fontsize=9.5, color=INK, loc="left", pad=8)
ax2.fill_between(dd.index, dd.values * 100, 0, color=C8, alpha=0.35, lw=0)
ax2.plot(dd.index, dd.values * 100, color=C8, lw=1.0)
ax2.set_ylabel("drawdown (% of initial)")
ax2.tick_params(axis="x", rotation=30)
fig.savefig(os.path.join(FIGURES_DIR, "fig7_equity_path.png"),
            dpi=200, bbox_inches="tight")
plt.close(fig)
print("figure written")
