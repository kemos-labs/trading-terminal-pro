#!/usr/bin/env python3
"""Sequential full-capital reconstruction sweep.

Tests whether a concentrated variant of the roll-out signal (only the largest
trigger candles, optional liquidity floor, one non-overlapping position at a
time compounded on full capital) supports the outsized multi-year returns
sometimes attributed to strategies of this family.

Design constraints for a clean test:
  * liquidity filter uses only entry-time information (lagged volume);
  * simultaneous signals are tie-broken deterministically (largest trigger);
  * a maker-fee round trip is charged on every trade, matching the fee basis
    used everywhere else in the report;
  * single-trade losses are floored at -100% (liquidation) and the path stops
    at ruin instead of continuing to count trades on a dead account.

Output: printed sweep table (RESULTS_DIR/reconstruction.txt) and a heatmap
of all cells (FIGURES_DIR/fig8_sweep_heatmap.png).
"""
import os

import numpy as np
import pandas as pd
from matplotlib.colors import LinearSegmentedColormap, TwoSlopeNorm

from _paths import FIGURES_DIR, RESULTS_DIR
from _style import plt, INK, INK2, SURF

WINDOW = ("2022-07-23", "2026-07-23")

tr = pd.read_parquet(os.path.join(RESULTS_DIR, "trades.parquet"))
t4 = tr[(tr.time >= WINDOW[0]) & (tr.time < WINDOW[1])].copy()
t4["absmag"] = t4.trigger_ret.abs()

lines = []
def say(s=""):
    print(s)
    lines.append(s)


FEE = 4e-4  # maker round trip, same basis as the rest of the report


def run_path(t, hold, frac=1.0):
    """Sequential non-overlapping path betting `frac` of capital per trade.

    frac=1.0 reproduces the source claim's construction (full stack per
    bet); smaller fractions show the same trade sequence under sane sizing.
    """
    t = t.sort_values(["time", "absmag"], ascending=[True, False], kind="mergesort")
    eq, n, wins, last_end, ruined = 1.0, 0, 0, None, False
    for time, ret in zip(t.time.values, t[f"ret_{hold}h"].values):
        if np.isnan(ret) or (last_end is not None and time < last_end):
            continue
        net = max(ret - FEE, -1.0)
        eq *= 1 + frac * net
        n += 1
        wins += net > 0
        last_end = time + pd.Timedelta(hours=hold)
        if eq <= 0:
            ruined = True
            break
    return eq, n, wins, ruined


say(f"SEQUENTIAL FULL-CAPITAL SWEEP  {WINDOW[0]} .. {WINDOW[1]}")
say(f"non-overlapping positions, deterministic tie-break, maker fees "
    f"({FEE*1e4:.0f} bps round trip), losses floored at -100%, path stops at ruin")
say("ruin-elig counts eligible trades returning -100% or worse: whether the")
say("path hits one is decided by hold-collision luck, so any config with")
say("ruin-elig > 0 has a total return that is an artifact of path timing")
say(f"{'trigger':>8} {'min vol':>14} {'hold':>5} {'sides':>6} "
    f"{'trades':>7} {'win':>6} {'full-stack':>13} {'quarter':>10} "
    f"{'5pct':>9} {'ruin-elig':>10} {'worst-elig':>11}")
records = []
for sides, mask in [("both", t4.side != 0), ("long", t4.side == 1),
                    ("short", t4.side == -1)]:
    for thr in [0.10, 0.15, 0.20, 0.25, 0.30]:
        for qv in [0, 1e6, 1e7]:
            t = t4[mask & (t4.absmag >= thr) & (t4.qv_lag >= qv)]
            if len(t) < 30:
                continue
            for hold in [1, 4, 24]:
                eq, n, wins, ruined = run_path(t, hold, 1.0)
                rets = t[f"ret_{hold}h"] - FEE
                n_ruin = int((rets <= -1).sum())
                tot = "RUINED" if ruined else f"{(eq-1)*100:,.0f}%"
                eq25, _, _, _ = run_path(t, hold, 0.25)
                eq05, _, _, _ = run_path(t, hold, 0.05)
                say(f"{thr:>7.0%} {qv:>14,.0f} {hold:>4}h {sides:>6} "
                    f"{n:>7} {wins/max(n,1):>6.1%} {tot:>13} "
                    f"{(eq25-1)*100:>9,.0f}% {(eq05-1)*100:>8,.0f}% "
                    f"{n_ruin:>10} {rets.min()*100:>10.0f}%")
                records.append((sides, thr, qv, hold, eq, ruined, n_ruin,
                                eq25, eq05))

with open(os.path.join(RESULTS_DIR, "reconstruction.txt"), "w") as f:
    f.write("\n".join(lines) + "\n")

# ---------------------------------------------------------------- heatmap
# rows: side x trigger; columns: volume floor x hold
# color: log10 of final equity multiple, diverging around breakeven
# fractional sizing only: full-stack totals stay in the text table, since
# their extremes are properties of the sizing rule, not the signal
SIDES = ["long", "short", "both"]
THRS = [0.10, 0.15, 0.20, 0.25, 0.30]
QVS = [0, 1e6, 1e7]
HOLDS = [1, 4, 24]
QLBL = {0: "any vol", 1e6: ">=$1M/h", 1e7: ">=$10M/h"}
FLOOR = -2.0

shape = (len(SIDES) * len(THRS), len(QVS) * len(HOLDS))
grids = {k: np.full(shape, np.nan) for k in ("5pct", "quarter")}
labels = {k: np.empty(shape, dtype=object) for k in ("5pct", "quarter")}


def cell_label(eq):
    if eq >= 10:
        return f"{eq:,.0f}x"
    return f"{(eq-1)*100:+,.0f}%"


for sides, thr, qv, hold, eq, ruined, n_ruin, eq25, eq05 in records:
    r = SIDES.index(sides) * len(THRS) + THRS.index(thr)
    c = QVS.index(qv) * len(HOLDS) + HOLDS.index(hold)
    for key, e in (("5pct", eq05), ("quarter", eq25)):
        grids[key][r, c] = FLOOR if e <= 10**FLOOR else np.log10(e)
        labels[key][r, c] = cell_label(e)

cmap = LinearSegmentedColormap.from_list(
    "div", ["#e34948", "#f0efec", "#2a78d6"])
vmax = max(np.nanmax(g) for g in grids.values())
norm = TwoSlopeNorm(vmin=min(np.nanmin(g) for g in grids.values()) - 1e-9,
                    vcenter=0.0, vmax=vmax)

fig, axes = plt.subplots(1, 2, figsize=(15.2, 7.2),
                         gridspec_kw={"wspace": 0.06})
nr, nc = shape
PANEL = {"5pct": "5% of capital per bet", "quarter": "25% of capital per bet"}
for ax, key in zip(axes, ("5pct", "quarter")):
    ax.grid(False)
    mesh = ax.pcolormesh(grids[key][::-1], cmap=cmap, norm=norm,
                         edgecolors=SURF, linewidth=2)
    for r in range(nr):
        for c in range(nc):
            lab = labels[key][r, c]
            if lab is None:
                continue
            strong = abs(grids[key][r, c]) > 1.2
            ax.text(c + 0.5, nr - r - 0.5, lab, ha="center", va="center",
                    fontsize=6.6, color="#ffffff" if strong else INK)
    ax.set_xticks([c + 0.5 for c in range(nc)],
                  [f"{QLBL[q]}\n{h}h" for q in QVS for h in HOLDS], fontsize=7)
    for x in range(len(HOLDS), nc, len(HOLDS)):
        ax.axvline(x, color=INK2, lw=0.8)
    for y in range(len(THRS), nr, len(THRS)):
        ax.axhline(y, color=INK2, lw=0.8)
    ax.set_title(PANEL[key], fontsize=8.5, color=INK2, loc="left", pad=6)
axes[0].set_yticks([nr - r - 0.5 for r in range(nr)],
                   [f"{s} {t:.0%}" for s in SIDES for t in THRS], fontsize=7.5)
axes[1].set_yticks([])
TICK_LBL = {-2: "-99%", -1: "-90%", 0: "0%", 1: "10x", 2: "100x"}
ticks = [t for t in TICK_LBL if norm.vmin <= t <= vmax]
cb = fig.colorbar(mesh, ax=axes, shrink=0.75, pad=0.015, ticks=ticks)
cb.ax.set_yticklabels([TICK_LBL[t] for t in ticks], fontsize=7.5)
cb.set_label("total return (log scale)", fontsize=8)
fig.suptitle("Sequential sweep, 135 configurations at fractional sizing, "
             "net of maker fees. Rows: side and trigger; columns: volume "
             "floor and hold. Full-stack totals: see results table.",
             fontsize=9, color=INK, x=0.125, ha="left")
fig.savefig(os.path.join(FIGURES_DIR, "fig8_sweep_heatmap.png"),
            dpi=200, bbox_inches="tight")
plt.close(fig)
print("heatmap written")
