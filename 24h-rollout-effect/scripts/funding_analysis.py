#!/usr/bin/env python3
"""Funding-rate contribution to the fee-viable short subset.

A short position collects funding when the rate is positive and a funding
timestamp falls inside the hold. For every subset trade, funding events
captured during the 1-hour hold are summed, with sign, per unit of
notional.

Funding archives are published monthly only, so the window here ends at the
last complete month. Missing archives (a handful of symbols) are reported.

Output: RESULTS_DIR/funding_analysis.txt
"""
import io
import json
import os
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd

from _paths import DATA_DIR, RESULTS_DIR

params = json.load(open(os.path.join(RESULTS_DIR, "capital_params.json")))
NET_MAKER_BPS = params["net_maker_bps"]
TRIG, MINQV = params["trig"], params["min_qv"]
WIN_LO, WIN_HI = "2026-01-02", "2026-06-30 23:00:00+00:00"
MONTHS = [f"2026-{m:02d}" for m in range(1, 7)]
BASE = "https://data.binance.vision/"
FR_DIR = os.path.join(DATA_DIR, "data/futures/um/monthly/fundingRate")

tr = pd.read_parquet(os.path.join(RESULTS_DIR, "trades.parquet"))
t = tr[(tr.time >= WIN_LO) & (tr.time <= WIN_HI)]
sub = t[(t.side == -1) & (t.trigger_ret.abs() >= TRIG) & (t.qv_lag >= MINQV)].copy()
symbols = sorted(sub.symbol.unique())
print(f"{len(sub)} subset trades, {len(symbols)} symbols, {WIN_LO}..{WIN_HI}")


def fetch(sym):
    got = 0
    for m in MONTHS:
        key = f"data/futures/um/monthly/fundingRate/{sym}/{sym}-fundingRate-{m}.zip"
        dest = os.path.join(DATA_DIR, key)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            got += 1
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        try:
            with urllib.request.urlopen(BASE + urllib.parse.quote(key),
                                        timeout=60) as r, open(dest, "wb") as f:
                f.write(r.read())
            got += 1
        except Exception:
            pass
    return sym, got


with ThreadPoolExecutor(32) as ex:
    fetched = dict(ex.map(fetch, symbols))
missing = [s for s, g in fetched.items() if g == 0]

def load_rates(sym):
    d = os.path.join(FR_DIR, sym)
    if not os.path.isdir(d):
        return None
    frames = []
    for f in sorted(os.listdir(d)):
        if not f.endswith(".zip"):
            continue
        try:
            with zipfile.ZipFile(os.path.join(d, f)) as z:
                for name in z.namelist():
                    frames.append(pd.read_csv(io.BytesIO(z.read(name))))
        except Exception:
            pass
    if not frames:
        return None
    df = pd.concat(frames, ignore_index=True)
    df.columns = [c.strip() for c in df.columns]
    tcol = next(c for c in df.columns if "time" in c.lower())
    rcol = next(c for c in df.columns if "rate" in c.lower())
    return df[[tcol, rcol]].rename(columns={tcol: "ms", rcol: "rate"})


rows = []
covered = 0
for sym, tsym in sub.groupby("symbol", observed=True):
    fr = load_rates(sym)
    if fr is None:
        continue
    ev = fr.ms.values.astype(np.int64)
    rate = fr.rate.values.astype(float)
    t0 = tsym.time.values.astype("datetime64[ms]").astype(np.int64)
    for start in t0:
        covered += 1
        in_hold = (ev >= start) & (ev < start + 3_600_000)
        # positive rate: longs pay shorts, so a short collects +rate
        rows.append((in_hold.sum(), rate[in_hold].sum()))
ev_counts = pd.DataFrame(rows, columns=["events", "funding"])

lines = []
def say(s=""):
    print(s)
    lines.append(s)

say("FUNDING CONTRIBUTION: fee-viable short subset")
say(f"window {WIN_LO}..{WIN_HI} (funding archives are monthly, so the window "
    f"ends at the last complete month)")
say(f"trades with funding coverage: {covered} of {len(sub)}; "
    f"symbols with no archive: {len(missing)}")
cap = ev_counts[ev_counts.events > 0]
say(f"holds capturing at least one funding event: {len(cap)} "
    f"({len(cap)/len(ev_counts):.1%} of covered trades)")
say(f"mean funding collected per captured hold: "
    f"{cap.funding.mean()*1e4:+.2f} bps of notional")
say(f"share of captured events with positive rate (short collects): "
    f"{(cap.funding > 0).mean():.1%}")
mean_all = ev_counts.funding.mean()
say(f"\nmean funding contribution across ALL covered trades: "
    f"{mean_all*1e4:+.2f} bps per trade")
say(f"for reference, the subset's price edge net of maker fees is "
    f"{NET_MAKER_BPS:+.1f} bps per trade (capital_params.json); funding moves "
    f"the net to about {NET_MAKER_BPS + mean_all*1e4:+.1f} bps")

with open(os.path.join(RESULTS_DIR, "funding_analysis.txt"), "w") as f:
    f.write("\n".join(lines) + "\n")
