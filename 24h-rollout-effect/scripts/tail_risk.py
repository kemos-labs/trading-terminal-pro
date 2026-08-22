#!/usr/bin/env python3
"""Blow-up risk report for the short-side subset.

The fee-viable subset is short contracts that have just printed an extreme
hourly candle, precisely the population in which further parabolic moves
occur. This script quantifies that tail:

  1. extreme-move climate: monthly frequency of hourly candles >= +30% / +50%
     across all listed USDT perpetuals, normalized per 10,000 symbol-hours so
     the trend is not confounded by universe growth;
  2. max adverse excursion (MAE) within the 1-hour hold, measured from the
     hold candle's high, covering every subset trade;
  3. per-trade and annualized liquidation probabilities by leverage
     (liquidation approximated at adverse move >= 1/L, ignoring maintenance
     margin, so figures are slightly optimistic);
  4. P&L concentration: dependence of total subset profit on the worst trades.

Outputs: RESULTS_DIR/tail_risk.txt, FIGURES_DIR/fig5_tail_risk.png
"""
import os
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd

from _paths import FIGURES_DIR, RESULTS_DIR, parquet_dir
from _style import plt, INK, INK2, MUTED, C1, C2

WIN_LO, WIN_HI = "2026-01-02", "2026-07-22 23:00:00+00:00"
DAYS = (pd.Timestamp(WIN_HI).tz_localize(None).floor("D")
        - pd.Timestamp(WIN_LO)).days + 1
PARTIAL_MONTH = pd.Timestamp(WIN_HI).strftime("%Y-%m")
TRIG, MINQV = 0.10, 1e6
FEE_MAKER = 4e-4
LEVERAGE = [1, 2, 3, 5, 10]

PARQ1H = parquet_dir("1h")

lines = []
def say(s=""):
    print(s)
    lines.append(s)


def climate(sym):
    df = pd.read_parquet(os.path.join(PARQ1H, sym),
                         columns=["open_time", "open", "close"])
    r = df["close"] / df["open"] - 1.0
    month = (pd.to_datetime(df["open_time"], unit="ms")
             .dt.to_period("M").astype(str))
    return (pd.DataFrame({"month": month, "r30": r >= 0.30, "r50": r >= 0.50})
            .groupby("month").agg(r30=("r30", "sum"), r50=("r50", "sum"),
                                  hours=("r30", "size")))


if __name__ == "__main__":
    syms = sorted(os.listdir(PARQ1H))
    with ProcessPoolExecutor(max_workers=8) as ex:
        parts = list(ex.map(climate, syms, chunksize=16))
    clim = pd.concat(parts).groupby(level=0).sum()
    clim = clim[clim.index >= "2022-01"]
    clim["rate30"] = clim.r30 / clim.hours * 1e4     # per 10k symbol-hours
    clim["rate50"] = clim.r50 / clim.hours * 1e4

    say("BLOW-UP RISK: short-side subset")
    say("\n== extreme-move climate: hourly candles >= +30% / +50%, all USDT perps ==")
    say("(counts and rate per 10,000 symbol-hours; rate controls for universe growth)")
    say(clim.tail(12).round(3).to_string())
    say(f"(events/month averages exclude the partial month {PARTIAL_MONTH}; "
        f"per-hour rates include it)")
    for label, m in [("2022-2024", clim.index < "2025-01"),
                     ("2025", (clim.index >= "2025-01") & (clim.index < "2026-01")),
                     ("2026", clim.index >= "2026-01")]:
        c = clim[m]
        cf = c[c.index != PARTIAL_MONTH]  # only complete months for /month averages
        say(f"{label}: {cf.r30.sum()/len(cf):.1f} x >=30% and "
            f"{cf.r50.sum()/len(cf):.1f} x >=50% events/month; "
            f"rate {c.r30.sum()/c.hours.sum()*1e4:.3f} / "
            f"{c.r50.sum()/c.hours.sum()*1e4:.3f} per 10k symbol-hours")

    # ------------------------------------------------- MAE from hourly highs
    tr = pd.read_parquet(os.path.join(RESULTS_DIR, "trades.parquet"))
    t = tr[(tr.time >= WIN_LO) & (tr.time <= WIN_HI)]
    sub = t[(t.side == -1) & (t.trigger_ret.abs() >= TRIG) & (t.qv_lag >= MINQV)].copy()

    maes = []
    for sym, tsym in sub.groupby("symbol", observed=True):
        px = pd.read_parquet(os.path.join(PARQ1H, sym + ".parquet"),
                             columns=["open_time", "open", "high"]) \
               .set_index("open_time")
        t_ms = tsym.time.values.astype("datetime64[ms]").astype(np.int64)
        high = px.high.reindex(t_ms).values
        open_ = px.open.reindex(t_ms).values
        for h, o, net in zip(high, open_, tsym.ret_1h.values - FEE_MAKER):
            if not (np.isnan(h) or np.isnan(o)):
                maes.append((h / o - 1.0, net))
    mae = pd.DataFrame(maes, columns=["mae", "net"])

    say(f"\n== max adverse excursion within the 1h hold "
        f"(hold-candle highs; {len(mae)} of {len(sub)} trades) ==")
    q = mae.mae.quantile([0.5, 0.9, 0.99, 0.999])
    say(f"p50 {q[0.5]*100:.1f}%  p90 {q[0.9]*100:.1f}%  p99 {q[0.99]*100:.1f}%  "
        f"p99.9 {q[0.999]*100:.1f}%  max {mae.mae.max()*100:.1f}%")

    trades_per_day = len(mae) / DAYS
    say("\n== liquidation probability by leverage (adverse move >= 1/L) ==")
    say(f"{'leverage':>9} {'per-trade':>10} "
        f"{'per-year at ' + format(trades_per_day, '.1f') + ' trades/day':>32}")
    for L in LEVERAGE:
        p = (mae.mae >= 1.0 / L).mean()
        say(f"{L:>8}x {p:>9.3%} {p * trades_per_day * 365:>31.1f}")

    say("\n== P&L concentration (equal notional per trade, net of maker fees) ==")
    total = mae.net.sum()
    w = mae.net.sort_values()
    say(f"sum of net returns: {total*100:+.1f} percentage points across {len(mae)} trades")
    say(f"worst trade: {w.iloc[0]*100:+.1f}%; "
        f"worst 5: {w.iloc[:5].sum()*100:+.1f}pp; "
        f"worst 1% of trades erase {abs(w.iloc[:len(w)//100].sum())/total:.0%} "
        f"of total profit")
    say(f"a single worst-trade loss equals "
        f"{abs(w.iloc[0]) / (total / DAYS):.0f} average days of profit")

    with open(os.path.join(RESULTS_DIR, "tail_risk.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")

    # ------------------------------------------------- figure
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.2, 3.6),
                                   gridspec_kw={"wspace": 0.25})
    x = pd.PeriodIndex(clim.index, freq="M").to_timestamp()
    ax1.plot(x, clim.rate30.values, color=C1, lw=1.8, label="hourly move >= +30%")
    ax1.plot(x, clim.rate50.values, color=C2, lw=1.8, label="hourly move >= +50%")
    ax1.legend(loc="upper left")
    ax1.set_ylabel("events per 10,000 symbol-hours")
    ax1.set_title("Extreme upside moves, universe-growth adjusted",
                  fontsize=9.5, color=INK, loc="left", pad=8)
    ax1.tick_params(axis="x", rotation=45)

    s = np.sort(mae.mae.values)
    surv = 1.0 - np.arange(1, len(s) + 1) / len(s)
    ax2.plot(s * 100, np.maximum(surv, 1 / len(s)), color=C1, lw=1.8)
    ax2.set_yscale("log")
    for L, xx in [(5, 20), (3, 33.3), (2, 50)]:
        ax2.axvline(xx, color=MUTED, lw=0.9, ls=(0, (4, 3)))
        ax2.annotate(f"{L}x liq.", (xx, ax2.get_ylim()[1] * 0.5), xytext=(3, 0),
                     textcoords="offset points", fontsize=7.5, color=INK2)
    ax2.set_xlabel("max adverse excursion within 1h hold (%)")
    ax2.set_ylabel("fraction of trades exceeding (log)")
    ax2.set_title("Adverse-excursion survival curve, short subset",
                  fontsize=9.5, color=INK, loc="left", pad=8)
    fig.savefig(os.path.join(FIGURES_DIR, "fig5_tail_risk.png"),
                dpi=200, bbox_inches="tight")
    plt.close(fig)
    print("figure written")
