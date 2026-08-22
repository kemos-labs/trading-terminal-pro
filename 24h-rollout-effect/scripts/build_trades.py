#!/usr/bin/env python3
"""Generate the signal-level trade table for the 24h roll-out strategy.

Signal definition (evaluated on completed 1h candles, executed at the next
candle's open, no look-ahead):

  * SHORT for one hour when the candle exactly 24 hours ago was the largest
    positive candle of the trailing 24 (it is about to roll out of the
    exchange-displayed 24h-change window, mechanically depressing that number);
  * LONG for one hour when it was the largest negative candle.

For every signal the table records forward returns over 1/4/8/24-hour holds,
the trigger candle's return, and the trailing-24h mean hourly quote volume
lagged one hour (a liquidity measure available at entry).

Output: RESULTS_DIR/trades.parquet, RESULTS_DIR/symbol_meta.parquet
"""
import os
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd

from _paths import RESULTS_DIR, parquet_dir

PARQ = parquet_dir("1h")
HOLDS = [1, 4, 8, 24]


def symbol_trades(sym):
    df = pd.read_parquet(os.path.join(PARQ, sym))
    if len(df) < 100:
        return None, None
    dt = pd.to_datetime(df["open_time"], unit="ms", utc=True)
    df = df.set_index(dt)
    idx = pd.date_range(df.index.min(), df.index.max(), freq="1h", tz="UTC")
    df = df.reindex(idx)
    r = df["close"] / df["open"] - 1.0

    roll_max = r.rolling(24, min_periods=24).max().shift(1)
    roll_min = r.rolling(24, min_periods=24).min().shift(1)
    r24 = r.shift(24)
    pos = (((r24 < 0) & (r24 <= roll_min)).astype(np.int8)
           - ((r24 > 0) & (r24 >= roll_max)).astype(np.int8))

    qv_lag = df["quote_volume"].rolling(24, min_periods=24).mean().shift(1)
    fwd = {h: df["close"].shift(-(h - 1)) / df["open"] - 1.0 for h in HOLDS}

    active = (pos != 0) & r.notna()
    name = sym.replace(".parquet", "")
    meta = (name, str(idx[0]), str(idx[-1]), len(idx))
    if not active.any():
        return None, meta
    return pd.DataFrame({
        "time": idx[active],
        "symbol": name,
        "side": pos[active].values,
        "trigger_ret": r24[active].values,
        "qv_lag": qv_lag[active].values,
        **{f"ret_{h}h": (pos * fwd[h])[active].values for h in HOLDS},
    }), meta


if __name__ == "__main__":
    syms = sorted(os.listdir(PARQ))
    frames, metas = [], []
    with ProcessPoolExecutor(max_workers=8) as ex:
        for t, m in ex.map(symbol_trades, syms, chunksize=8):
            if t is not None:
                frames.append(t)
            if m is not None:
                metas.append(m)
    trades = pd.concat(frames, ignore_index=True)
    trades.to_parquet(os.path.join(RESULTS_DIR, "trades.parquet"), index=False)
    pd.DataFrame(metas, columns=["symbol", "first_hour", "last_hour", "listed_hours"]) \
        .to_parquet(os.path.join(RESULTS_DIR, "symbol_meta.parquet"), index=False)
    print(f"{len(trades)} signals from {trades.symbol.nunique()} symbols "
          f"({trades.time.min()} .. {trades.time.max()})")
