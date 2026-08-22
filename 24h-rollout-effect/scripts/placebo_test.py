#!/usr/bin/env python3
"""Placebo test: is the 24-hour mark special, or is this generic reversal?

For every hour t and every age k in 1..24, condition on the largest
positive (negative) candle of the trailing 24 having age exactly k, and
measure the side-adjusted return of candle t. The roll-out mechanism makes a
sharp prediction: the displayed 24h statistic only moves mechanically while
the extreme candle is leaving the window, which happens at k = 24 and at no
other age. Generic short-term reversal would instead show edge spread across
ages, strongest right after the extreme candle (k = 1).

Inference is clustered by hour: returns of same-hour signals across symbols
are averaged into one observation per hour before computing means and
confidence intervals, because simultaneous crypto returns are strongly
correlated and pooled per-trade errors would overstate precision.

Output: RESULTS_DIR/placebo_test.txt, FIGURES_DIR/fig6_placebo.png
"""
import os
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd

from _paths import FIGURES_DIR, RESULTS_DIR, parquet_dir
from _style import plt, INK, INK2, MUTED, AXIS, C1

WIN_LO, WIN_HI = "2022-07-23", "2026-07-23"
AGES = list(range(1, 25))
PARQ = parquet_dir("1h")

BASE_H = int(pd.Timestamp(WIN_LO, tz="UTC").timestamp()) // 3600
END_H = int(pd.Timestamp(WIN_HI, tz="UTC").timestamp()) // 3600
NH = END_H - BASE_H


def chunk_profile(syms):
    """Accumulate per-(age, hour) sums and counts over a chunk of symbols."""
    sums = np.zeros((len(AGES), NH))
    cnts = np.zeros((len(AGES), NH))
    for sym in syms:
        df = pd.read_parquet(os.path.join(PARQ, sym))
        if len(df) < 100:
            continue
        dt = pd.to_datetime(df["open_time"], unit="ms", utc=True)
        df = df.set_index(dt)
        df = df[df.index >= WIN_LO]
        if len(df) < 100:
            continue
        idx = pd.date_range(df.index.min(), df.index.max(), freq="1h", tz="UTC")
        df = df.reindex(idx)
        r = df["close"] / df["open"] - 1.0
        roll_max = r.rolling(24, min_periods=24).max().shift(1).values
        roll_min = r.rolling(24, min_periods=24).min().shift(1).values
        rv = r.values
        hours = (idx.as_unit("ns").asi8 // 3_600_000_000_000).astype(np.int64) - BASE_H
        for i, k in enumerate(AGES):
            rk = r.shift(k).values
            for sign in (1, -1):
                if sign == 1:
                    sig = (rk > 0) & (rk >= roll_max)
                    pnl = -rv
                else:
                    sig = (rk < 0) & (rk <= roll_min)
                    pnl = rv
                sig &= ~np.isnan(pnl) & (hours >= 0) & (hours < NH)
                np.add.at(sums[i], hours[sig], pnl[sig])
                np.add.at(cnts[i], hours[sig], 1)
    return sums, cnts


if __name__ == "__main__":
    syms = sorted(os.listdir(PARQ))
    chunks = [syms[i::8] for i in range(8)]
    sums = np.zeros((len(AGES), NH))
    cnts = np.zeros((len(AGES), NH))
    with ProcessPoolExecutor(max_workers=8) as ex:
        for s, c in ex.map(chunk_profile, chunks):
            sums += s
            cnts += c

    lines = ["PLACEBO TEST: side-adjusted next-hour return by age of the "
             "trailing-24h extreme candle",
             f"window {WIN_LO}..{WIN_HI}; k = 24 is the roll-out hour, "
             "k < 24 are placebo ages",
             "hour-clustered inference: one observation per hour (equal-weight "
             "mean of that hour's signals)",
             f"{'age k':>6} {'trades':>9} {'hours':>7} {'mean bps':>9} {'95% CI':>12}"]
    means, cis = [], []
    for i, k in enumerate(AGES):
        live = cnts[i] > 0
        hm = sums[i][live] / cnts[i][live]
        m = hm.mean()
        se = hm.std() / np.sqrt(live.sum())
        means.append(m * 1e4)
        cis.append(1.96 * se * 1e4)
        lines.append(f"{k:>6} {int(cnts[i].sum()):>9} {int(live.sum()):>7} "
                     f"{m*1e4:>9.2f} {'+/- ' + format(1.96*se*1e4, '.2f'):>12}")
    placebo_mean = float(np.mean(means[:-1]))
    t24 = means[-1] / (cis[-1] / 1.96)
    lines.append(f"\nmean over placebo ages 1-23: {placebo_mean:+.2f} bps; "
                 f"age 24: {means[-1]:+.2f} bps (clustered t = {t24:.1f})")
    txt = "\n".join(lines)
    print(txt)
    with open(os.path.join(RESULTS_DIR, "placebo_test.txt"), "w") as f:
        f.write(txt + "\n")

    fig, ax = plt.subplots(figsize=(6.4, 3.6))
    ax.errorbar(AGES, means, yerr=cis, fmt="o", ms=4.5, color=C1,
                elinewidth=1.2, capsize=2.5)
    ax.axhline(0, color=AXIS, lw=0.8)
    ax.axvline(24, color=MUTED, lw=0.9, ls=(0, (4, 3)))
    ax.annotate("roll-out hour", (24, max(means) * 0.9), xytext=(-6, 0),
                textcoords="offset points", ha="right", fontsize=8, color=INK2)
    ax.set_xticks([1, 4, 8, 12, 16, 20, 24])
    ax.set_xlabel("age of trailing-24h extreme candle at entry (hours)")
    ax.set_ylabel("next-hour return (bps, hour-clustered 95% CI)")
    ax.set_title("The edge appears when the candle leaves the window",
                 fontsize=9.5, color=INK, loc="left", pad=8)
    fig.savefig(os.path.join(FIGURES_DIR, "fig6_placebo.png"),
                dpi=200, bbox_inches="tight")
    plt.close(fig)
    print("figure written")
