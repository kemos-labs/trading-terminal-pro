#!/usr/bin/env python3
"""Capital limits of the fee-viable subset, with report figures.

Subset: short side only, trigger candle >= 10%, trailing lagged hourly quote
volume >= $1M. Sizing model: per-trade notional = min(f x B, participation x
lagged typical hourly volume), f = half-Kelly of the net edge, B = capital;
positions open in the same hour are then scaled down pro rata so that total
notional never exceeds B (portfolio exposure constraint, no leverage). Net
returns are gross 1h returns minus a maker round trip.

Outputs: RESULTS_DIR/capital_report.txt and four figures in FIGURES_DIR.
"""
import json
import os

import numpy as np
import pandas as pd

from _paths import FIGURES_DIR, RESULTS_DIR
from _style import plt, INK, INK2, MUTED, GRID, AXIS, C1, C2, C3, C4

WIN_LO, WIN_HI = "2026-01-02", "2026-07-22 23:00:00+00:00"
DAYS = (pd.Timestamp(WIN_HI).tz_localize(None).floor("D")
        - pd.Timestamp(WIN_LO)).days + 1
TRIG, MINQV = 0.10, 1e6
FEE_MAKER, FEE_TAKER = 4e-4, 10e-4
PARTS = [0.005, 0.01, 0.02]

tr = pd.read_parquet(os.path.join(RESULTS_DIR, "trades.parquet"))
t = tr[(tr.time >= WIN_LO) & (tr.time <= WIN_HI)].copy()
sub = t[(t.side == -1) & (t.trigger_ret.abs() >= TRIG) & (t.qv_lag >= MINQV)].copy()
sub["date"] = sub.time.dt.floor("D")
# floor at -100% of notional: a position cannot lose more than its margin
sub["net"] = (sub.ret_1h - FEE_MAKER).clip(lower=-1.0)

mu, sd = sub.net.mean(), sub.net.std()
kelly = mu / sd**2
f_half = min(max(kelly / 2, 0.0), 1.0)
if f_half == 0.0:
    raise SystemExit("net edge is non-positive on this data; "
                     "the capital model below is not meaningful")

lines = []
def say(s=""):
    print(s)
    lines.append(s)

say("CAPITAL LIMITS: fee-viable subset of the 24h roll-out signal")
say(f"window {WIN_LO}..2026-07-22 ({DAYS} days); short side, "
    f"trigger >= {TRIG:.0%}, lagged hourly volume >= ${MINQV:,.0f}")
say(f"trades: {len(sub)} ({len(sub)/DAYS:.1f}/day), symbols: {sub.symbol.nunique()}")
say(f"gross {sub.ret_1h.mean()*1e4:+.1f} bps/trade | "
    f"net of maker round trip ({FEE_MAKER*1e4:.0f} bps) {mu*1e4:+.1f} | "
    f"net of taker round trip ({FEE_TAKER*1e4:.0f} bps) "
    f"{(sub.ret_1h.mean()-FEE_TAKER)*1e4:+.1f}")
say(f"per-trade sd {sd*100:.2f}%, win {(sub.net > 0).mean():.1%}, "
    f"Kelly f*={kelly:.2f}, half-Kelly f={f_half:.2f}")
conc = sub.groupby("time").size()
say(f"signals per active hour: mean {conc.mean():.2f}, "
    f"p95 {conc.quantile(0.95):.0f}, max {conc.max()}")

caps1 = 0.01 * sub.qv_lag
say(f"per-trade participation ceiling at 1% of typical (trailing-24h mean) "
    f"hourly volume: p25 ${caps1.quantile(.25):,.0f}, "
    f"median ${caps1.quantile(.5):,.0f}, p75 ${caps1.quantile(.75):,.0f}")
say("note: the ceiling is a participation-cap assumption, not a fitted "
    "price-impact model; all figures below are in-sample for this window")

Bgrid = np.logspace(3, 7, 41)
hour_key = sub.time.values
idx = pd.DatetimeIndex(sub.date.dt.tz_localize(None)).as_unit("ns")
sweep = {}
for part in PARTS:
    cap = part * sub.qv_lag.values
    rows = []
    for B in Bgrid:
        alloc = np.minimum(f_half * B, cap)
        hour_sum = pd.Series(alloc).groupby(hour_key).transform("sum").values
        posn = alloc * np.minimum(1.0, B / hour_sum)  # exposure <= B per hour
        pnl = pd.Series(posn * sub.net.values, index=idx).groupby(level=0).sum()
        daily_usd = pnl.sum() / DAYS
        sh = pnl.reindex(pd.date_range(WIN_LO, "2026-07-22").as_unit("ns"),
                         fill_value=0.0)
        sharpe = sh.mean() / sh.std() * np.sqrt(365) if sh.std() > 0 else np.nan
        rows.append((B, daily_usd / B, daily_usd, sharpe))
    sweep[part] = pd.DataFrame(rows, columns=["B", "daily_ret", "daily_usd", "sharpe"])

s1 = sweep[0.01]
plateau = s1.daily_ret.iloc[0]
b_full = s1[s1.daily_ret >= 0.99 * plateau].B.max()
knee = s1[s1.daily_ret >= 0.90 * plateau].B.max()
usd_max = s1.daily_usd.max()
cap_dollar = s1[s1.daily_usd >= 0.95 * usd_max].B.min()
say("\nOPTIMAL VIABLE CAPITAL (1% participation, half-Kelly sizing)")
say(f"  return efficiency is flat at {plateau*100:.2f}%/day up to about "
    f"${b_full:,.0f} (99% of plateau)")
say(f"  90% of plateau efficiency is retained up to the knee at ${knee:,.0f} "
    f"(annualized Sharpe there {s1.iloc[(s1.B-knee).abs().argmin()].sharpe:.1f})")
say(f"  dollar profit saturates near ${usd_max:,.0f}/day; 95% of that is "
    f"reached by ${cap_dollar:,.0f}, past which added capital only dilutes returns")
say(f"  optimal deployment band: about ${b_full:,.0f} to ${knee:,.0f}; "
    f"below it capital is under-used only in rare high-concurrency hours, "
    f"above it the participation ceiling increasingly caps each trade")

with open(os.path.join(RESULTS_DIR, "capital_report.txt"), "w") as fh:
    fh.write("\n".join(lines) + "\n")

# downstream scripts (funding_analysis, path_stats) read these instead of
# hardcoding numbers that would go stale on a data refresh
with open(os.path.join(RESULTS_DIR, "capital_params.json"), "w") as fh:
    json.dump({"win_lo": WIN_LO, "win_hi": WIN_HI, "days": DAYS,
               "trig": TRIG, "min_qv": MINQV, "fee_maker": FEE_MAKER,
               "net_maker_bps": round(mu * 1e4, 2), "f_half": round(f_half, 4),
               "knee": round(knee), "plateau_pct_day": round(plateau * 100, 3)},
              fh, indent=1)

# ---------------------------------------------------------------- figures
LBL = {0.005: "0.5% participation", 0.01: "1% participation",
       0.02: "2% participation"}
COL = {0.005: C3, 0.01: C1, 0.02: C2}

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(6.0, 5.6), sharex=True,
                               gridspec_kw={"hspace": 0.12})
for part in PARTS:
    s = sweep[part]
    ax1.plot(s.B, s.daily_ret * 100, color=COL[part], lw=1.8, label=LBL[part])
    ax2.plot(s.B, s.daily_usd, color=COL[part], lw=1.8)
ax1.legend(loc="lower left")
for ax in (ax1, ax2):
    ax.axvline(knee, color=MUTED, lw=0.9, ls=(0, (4, 3)))
ax1.annotate(f"knee ~ ${knee/1e3:,.0f}k", (knee, ax1.get_ylim()[1] * 0.92),
             xytext=(6, 0), textcoords="offset points", fontsize=8, color=INK2)
ax1.set_xscale("log")
ax1.set_ylabel("expected return (% of capital / day)")
ax2.set_ylabel("expected profit ($ / day)")
ax2.set_xlabel("capital deployed, B ($, log scale)")
ax1.set_title("Capital efficiency of the fee-viable subset\n"
              "short side, trigger >=10%, volume >=$1M/h; half-Kelly,\n"
              "hourly exposure <= capital, net of maker fees",
              fontsize=9.5, color=INK, loc="left", pad=10)
fig.savefig(os.path.join(FIGURES_DIR, "fig1_capital_efficiency.png"),
            dpi=200, bbox_inches="tight")
plt.close(fig)

fig, ax = plt.subplots(figsize=(5.6, 3.4))
x = np.sort(caps1.values)
ax.plot(x, np.arange(1, len(x) + 1) / len(x), color=C1, lw=1.8)
for q in (0.25, 0.5, 0.75):
    v = caps1.quantile(q)
    ax.plot([v], [q], "o", ms=4.5, color=C1)
    ax.annotate(f"p{int(q*100)}: ${v/1e3:,.0f}k", (v, q), xytext=(8, -3),
                textcoords="offset points", fontsize=8, color=INK2)
ax.set_xscale("log")
ax.set_xlabel("max position per trade at 1% of typical hourly volume ($, log scale)")
ax.set_ylabel("cumulative fraction of trades")
ax.set_title("Distribution of the per-trade impact ceiling", fontsize=9.5,
             color=INK, loc="left", pad=8)
fig.savefig(os.path.join(FIGURES_DIR, "fig2_position_cap_cdf.png"),
            dpi=200, bbox_inches="tight")
plt.close(fig)

prof = pd.read_csv(os.path.join(RESULTS_DIR, "event_study_1m.csv"))
ps = prof[prof.side == "short"]
fig, ax = plt.subplots(figsize=(6.0, 3.8))
order = [">10%", "5-10%", "2-5%", "<2%"]
cols = {">10%": C1, "5-10%": C2, "2-5%": C3, "<2%": C4}
ends = []
for b in order:
    d = ps[ps.bucket == b].sort_values("min")
    ax.plot(d["min"], d.cum_bps, color=cols[b], lw=1.8, label=f"trigger {b}")
    ends.append((b, d.cum_bps.iloc[-1]))
ends.sort(key=lambda e: e[1], reverse=True)
slot = max(e[1] for e in ends)
for b, y in ends:
    slot = min(slot, y)
    ax.annotate(f"trigger {b}", (181, y), xytext=(196, slot), fontsize=8,
                color=INK2, va="center",
                arrowprops=dict(arrowstyle="-", lw=0.6, color=AXIS,
                                shrinkA=0, shrinkB=1))
    slot -= 7.5
ax.legend(loc="upper right", ncols=2)
ax.axvline(0, color=MUTED, lw=0.9, ls=(0, (4, 3)))
ax.axvspan(0, 60, color=GRID, alpha=0.35, zorder=0)
ax.annotate("trigger candle rolls\nout of 24h window", (30, ax.get_ylim()[0]),
            xytext=(0, 8), textcoords="offset points", ha="center",
            fontsize=7.5, color=MUTED)
ax.axhline(0, color=AXIS, lw=0.8)
ax.set_xlim(-60, 215)
ax.set_xlabel("minutes from signal (candle roll-out begins at 0)")
ax.set_ylabel("mean cumulative short return (bps)")
ax.set_title("Minute-resolution event study, short side", fontsize=9.5,
             color=INK, loc="left", pad=8)
fig.savefig(os.path.join(FIGURES_DIR, "fig3_event_study.png"),
            dpi=200, bbox_inches="tight")
plt.close(fig)

bins = [0, 0.01, 0.02, 0.03, 0.05, 0.10, 0.20, np.inf]
blab = ["0-1", "1-2", "2-3", "3-5", "5-10", "10-20", ">20"]
fig, ax = plt.subplots(figsize=(6.0, 3.6))
for side, col, name, dx in [(-1, C1, "short", -0.09), (1, C2, "long", 0.09)]:
    d = t[t.side == side]
    g = d.groupby(pd.cut(d.trigger_ret.abs(), bins, labels=blab),
                  observed=True).ret_1h
    m, s, n = g.mean() * 1e4, g.std() * 1e4, g.size()
    ax.errorbar(np.arange(len(m)) + dx, m.values,
                yerr=(1.96 * s / np.sqrt(n)).values, fmt="o", ms=4.5,
                color=col, elinewidth=1.2, capsize=2.5, label=name)
ax.axhline(0, color=AXIS, lw=0.8)
ax.axhline(FEE_MAKER * 1e4, color=MUTED, lw=0.9, ls=(0, (4, 3)))
ax.annotate("maker round-trip fee (4 bps)", (0.02, FEE_MAKER * 1e4),
            xytext=(0, 4), textcoords="offset points", fontsize=7.5, color=MUTED)
ax.set_xticks(range(len(blab)), blab)
ax.set_xlabel("trigger-candle magnitude (%)")
ax.set_ylabel("mean 1h return (bps, 95% CI)")
ax.legend(loc="upper left")
ax.set_title("Edge by trigger size and side, recent window", fontsize=9.5,
             color=INK, loc="left", pad=8)
fig.savefig(os.path.join(FIGURES_DIR, "fig4_edge_by_trigger.png"),
            dpi=200, bbox_inches="tight")
plt.close(fig)

print("\nfigures written to", FIGURES_DIR)
