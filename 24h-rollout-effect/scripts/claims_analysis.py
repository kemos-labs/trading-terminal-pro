#!/usr/bin/env python3
"""Baseline effect statistics and cost analysis.

Produces the headline verification numbers: per-trade edge by period and year,
per-symbol daily return with listed-day denominators, sensitivity to
round-trip costs, liquidity splits (entry-time information only), edge by
trigger magnitude, and edge by holding period.

Output: printed report, also written to RESULTS_DIR/claims_analysis.txt
"""
import os

import numpy as np
import pandas as pd

from _paths import RESULTS_DIR

LAST4Y = ("2022-07-23", "2026-07-23")

tr = pd.read_parquet(os.path.join(RESULTS_DIR, "trades.parquet"))
meta = pd.read_parquet(os.path.join(RESULTS_DIR, "symbol_meta.parquet"))
tr["date"] = tr.time.dt.floor("D")

lines = []
def say(s=""):
    print(s)
    lines.append(s)


def listed_days(lo, hi):
    f = pd.to_datetime(meta.first_hour).clip(lower=pd.Timestamp(lo, tz="UTC"))
    l = pd.to_datetime(meta.last_hour).clip(upper=pd.Timestamp(hi, tz="UTC"))
    d = (l - f).dt.total_seconds() / 86400
    return d[d > 0].sum()


def block(t, label, lo, hi):
    n = len(t)
    say(f"\n== {label} ==")
    say(f"signals: {n}  symbols: {t.symbol.nunique()}")
    say(f"per-trade (1h hold): {t.ret_1h.mean()*1e4:+.2f} bps, "
        f"win {(t.ret_1h > 0).mean():.1%}")
    say(f"  longs {t[t.side==1].ret_1h.mean()*1e4:+.2f} bps ({(t.side==1).sum()}), "
        f"shorts {t[t.side==-1].ret_1h.mean()*1e4:+.2f} bps ({(t.side==-1).sum()})")
    hourly = t.groupby("time").ret_1h.mean()
    say(f"portfolio hourly-series t-stat: "
        f"{hourly.mean()/(hourly.std()/np.sqrt(len(hourly))):.1f}")
    daily = t.groupby(["symbol", "date"]).ret_1h.sum()
    ld = listed_days(lo, hi)
    say(f"per-symbol daily return: {daily.mean()*100:.4f}%/active day, "
        f"{daily.sum()/ld*100:.4f}%/listed day ({ld:,.0f} listed symbol-days)")


say("BASELINE EFFECT: 24h ROLL-OUT SIGNAL")
block(tr, "full sample", str(tr.time.min()), str(tr.time.max()))
t4 = tr[(tr.time >= LAST4Y[0]) & (tr.time < LAST4Y[1])]
block(t4, f"trailing four years ({LAST4Y[0]} .. {LAST4Y[1]})", *LAST4Y)

say("\n== per-trade edge by calendar year (1h hold, bps) ==")
g = tr.groupby(tr.time.dt.year).ret_1h
say(pd.DataFrame({"n": g.size(), "avg_bps": g.mean() * 1e4,
                  "win": g.apply(lambda x: (x > 0).mean())}).round(3).to_string())

say("\n== round-trip cost sensitivity (trailing 4y, bps net per trade) ==")
for rt in [2, 4, 5, 10]:
    say(f"  {rt:>2} bps round trip: {(t4.ret_1h.mean() - rt/1e4)*1e4:+.2f}")

say("\n== liquidity split (trailing-24h hourly quote volume, lagged; trailing 4y) ==")
for minqv in [0, 1e5, 1e6, 1e7]:
    s = t4[t4.qv_lag >= minqv]
    say(f"  vol >= ${minqv:>12,.0f}: {len(s):>7} trades, "
        f"{s.ret_1h.mean()*1e4:+.2f} bps, win {(s.ret_1h > 0).mean():.1%}")

say("\n== edge by trigger-candle magnitude (trailing 4y) ==")
bins = [0, 0.01, 0.02, 0.03, 0.05, 0.10, 0.20, np.inf]
g = t4.groupby(pd.cut(t4.trigger_ret.abs(), bins), observed=True).ret_1h
say(pd.DataFrame({"n": g.size(), "avg_bps": (g.mean() * 1e4).round(2),
                  "win": g.apply(lambda x: (x > 0).mean()).round(3)}).to_string())

say("\n== edge by holding period (trailing 4y, bps per trade) ==")
for h in [1, 4, 8, 24]:
    c = t4[f"ret_{h}h"]
    say(f"  {h:>2}h hold: {c.mean()*1e4:+.2f} bps, win {(c > 0).mean():.1%}")

with open(os.path.join(RESULTS_DIR, "claims_analysis.txt"), "w") as f:
    f.write("\n".join(lines) + "\n")
