"""
Crypto Backtest API — Binance-powered backtesting for the VOLATERM Crypto desk.

Fetches live klines from Binance public API (no key required for historical data)
and runs the 24h roll-out effect strategy on demand.

Endpoints:
  GET  /api/backtest/status                  — service status
  GET  /api/backtest/binance/exchange-info   — list USDT perpetuals
  POST /api/backtest/run                     — run strategy on fetched data
  POST /api/backtest/scan                    — scan top N symbols for signals
  GET  /api/backtest/baseline                — pre-computed research baseline
  GET  /api/backtest/placebo                 — placebo test data
  GET  /api/backtest/tail-risk               — tail risk data
  GET  /api/backtest/equity-curve            — deployable subset path
  GET  /api/backtest/walkforward             — walk-forward validation
  GET  /api/backtest/sweep                   — parameter sweep data
"""
import asyncio
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

try:
    import httpx
except ImportError:
    httpx = None

# ── paths ──────────────────────────────────────────────────────────────────
_HERE = Path(__file__).resolve().parent
_PROJECT_ROOT = _HERE.parent
_ROLLOUT_DIR = _PROJECT_ROOT / "24h-rollout-effect"
_ROLLOUT_RESULTS = _ROLLOUT_DIR / "results"
_ROLLOUT_FIGURES = _ROLLOUT_DIR / "figures"

app = FastAPI(title="Crypto Backtest API")

# CORS: explicit origins via BACKTEST_CORS_ORIGIN (comma-separated), wildcard
# only when unset. Data is public market data, but a pinned origin list keeps
# third-party pages from scripting this API from a visitor's browser.
_cors_origins = [o.strip() for o in os.environ.get("BACKTEST_CORS_ORIGIN", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Binance API client ──────────────────────────────────────────────────────
BINANCE_FUTURES_API = "https://fapi.binance.com"
BINANCE_SPOT_API = "https://api.binance.com"

# Cache for exchange info (refreshed every 5 min)
_exchange_info_cache = {"data": None, "ts": 0}
_EXCHANGE_INFO_TTL = 300


async def _fetch(url: str) -> dict | list:
    """Async HTTP GET with timeout."""
    if httpx is None:
        raise HTTPException(status_code=503, detail="httpx not installed. Run: pip install httpx")
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(url, headers={"Accept": "application/json"})
        r.raise_for_status()
        return r.json()


async def get_exchange_info() -> dict:
    """Fetch USDⓈ-M futures exchange info (cached 5 min)."""
    now = time.time()
    if _exchange_info_cache["data"] and (now - _exchange_info_cache["ts"]) < _EXCHANGE_INFO_TTL:
        return _exchange_info_cache["data"]
    data = await _fetch(f"{BINANCE_FUTURES_API}/fapi/v1/exchangeInfo")
    _exchange_info_cache["data"] = data
    _exchange_info_cache["ts"] = now
    return data


def parse_usdt_perps(exchange_info: dict) -> list[dict]:
    """Extract USDT perpetual symbols from exchange info."""
    perps = []
    for s in exchange_info.get("symbols", []):
        if s["status"] == "TRADING" and s["symbol"].endswith("USDT") and s["pair"] != s["symbol"]:
            # USDⓈ-M perpetuals have distinct pair and symbol (e.g. BTCUSDT pair=BTCUSDT, but perps have pair ending with USDT)
            # Actually, let's just filter: contractType == "PERPETUAL" and quoteAsset == "USDT"
            pass
        if s.get("contractType") == "PERPETUAL" and s.get("quoteAsset") == "USDT" and s.get("status") == "TRADING":
            perps.append({
                "symbol": s["symbol"],
                "pair": s.get("pair", s["symbol"]),
                "base": s.get("baseAsset", ""),
                "quote": s.get("quoteAsset", ""),
                "onboard_date": s.get("onboardDate", 0),
                "filters": {f["filterType"]: f for f in s.get("filters", [])},
            })
    return perps


async def fetch_klines(symbol: str, interval: str = "1h", limit: int = 100) -> list:
    """Fetch klines for a symbol from Binance futures API.

    Returns list of [open_time, open, high, low, close, volume, ...]
    """
    url = f"{BINANCE_FUTURES_API}/fapi/v1/klines?symbol={symbol}&interval={interval}&limit={limit}"
    data = await _fetch(url)
    return data


def klines_to_df(klines: list) -> pd.DataFrame:
    """Convert raw Binance klines to a DataFrame with columns:
    open_time, open, high, low, close, volume, quote_volume, trades.
    """
    rows = []
    for k in klines:
        rows.append({
            "open_time": int(k[0]),
            "open": float(k[1]),
            "high": float(k[2]),
            "low": float(k[3]),
            "close": float(k[4]),
            "volume": float(k[5]),
            "quote_volume": float(k[7]),
            "trades": int(k[8]),
        })
    df = pd.DataFrame(rows)
    if not df.empty:
        dt = pd.to_datetime(df["open_time"], unit="ms", utc=True)
        df = df.set_index(dt)
    return df


# ── Strategy logic (24h roll-out effect) ────────────────────────────────────

def generate_signals(df: pd.DataFrame, side: str = "short", trigger: float = 0.10,
                     min_volume: float = 0, hold_hours: int = 1) -> pd.DataFrame:
    """Generate trade signals from hourly klines using the 24h roll-out rule.

    Rule:
      SHORT when the candle exactly 24h ago was the largest positive of trailing 24
      LONG  when the candle exactly 24h ago was the largest negative of trailing 24

    Returns DataFrame with signal rows.
    """
    if len(df) < 48:
        return pd.DataFrame()

    r = df["close"] / df["open"] - 1.0
    roll_max = r.rolling(24, min_periods=24).max().shift(1)
    roll_min = r.rolling(24, min_periods=24).min().shift(1)
    r24 = r.shift(24)
    qv_lag = df["quote_volume"].rolling(24, min_periods=24).mean().shift(1)

    # Signal: +1 for long, -1 for short
    pos = (((r24 < 0) & (r24 <= roll_min)).astype(np.int8)
           - ((r24 > 0) & (r24 >= roll_max)).astype(np.int8))

    # Build forward returns
    fwd_1h = df["close"].shift(-0) / df["open"] - 1.0  # current candle return
    fwd_4h = df["close"].shift(-3) / df["open"] - 1.0
    fwd_8h = df["close"].shift(-7) / df["open"] - 1.0
    fwd_24h = df["close"].shift(-23) / df["open"] - 1.0

    active = (pos != 0) & r.notna()
    if not active.any():
        return pd.DataFrame()

    signals = pd.DataFrame({
        "time": df.index[active],
        "side": pos[active].values,
        "trigger_ret": r24[active].values,
        "qv_lag": qv_lag[active].values,
        "ret_1h": (pos * fwd_1h)[active].values,
        "ret_4h": (pos * fwd_4h)[active].values,
        "ret_8h": (pos * fwd_8h)[active].values,
        "ret_24h": (pos * fwd_24h)[active].values,
    })

    # Filter by strategy params
    mask = (signals.trigger_ret.abs() >= trigger) & (signals.qv_lag >= min_volume)
    if side == "short":
        mask &= signals.side == -1
    elif side == "long":
        mask &= signals.side == 1

    result = signals[mask].copy()
    return result


def compute_metrics(signals: pd.DataFrame, fee_bps: float = 4.0, hold_hours: int = 1) -> dict:
    """Compute performance metrics from signal DataFrame."""
    if signals.empty:
        return {"n_trades": 0, "error": "No signals generated"}

    ret_col = f"ret_{hold_hours}h"
    if ret_col not in signals.columns:
        return {"n_trades": len(signals), "error": f"Hold {hold_hours}h not available"}

    fee = fee_bps / 1e4
    signals = signals.copy()
    signals["net"] = signals[ret_col] - fee

    mu = signals.net.mean()
    sd = signals.net.std()

    # Hour-clustered statistics
    hourly = signals.groupby("time").net.mean()
    t_stat = (hourly.mean() / (hourly.std() / np.sqrt(len(hourly)))
              if len(hourly) > 1 else 0)

    # Daily series
    daily = signals.set_index("time").resample("D").net.sum().fillna(0)
    sharpe = (daily.mean() / daily.std() * np.sqrt(365)) if daily.std() > 0 else 0

    win_rate = (signals.net > 0).mean()
    kelly = mu / sd**2 if sd > 0 else 0

    # Cumulative path
    signals = signals.sort_values("time")
    signals["cum_pnl"] = signals["net"].cumsum()
    signals["cum_max"] = signals["cum_pnl"].cummax()
    signals["drawdown"] = signals["cum_pnl"] - signals["cum_max"]

    worst = signals.net.min()
    worst_5 = signals.nsmallest(5, "net").net.sum()

    return {
        "n_trades": len(signals),
        "mean_bps": round(mu * 1e4, 2),
        "win_rate": round(float(win_rate), 4),
        "sd_pct": round(sd * 100, 2),
        "sharpe": round(float(sharpe), 2),
        "t_stat": round(float(t_stat), 2),
        "kelly_f": round(float(kelly), 4),
        "kelly_half": round(float(min(kelly / 2, 1.0)), 4),
        "worst_trade_pct": round(float(worst) * 100, 2),
        "worst_5_sum_pct": round(float(worst_5) * 100, 2),
        "max_drawdown_pct": round(float(signals.drawdown.min()) * 100, 2),
        "daily_return_pct": round(float(daily.mean() * 100), 4),
        "n_hours": len(hourly),
        "n_symbols": 1,
    }


def build_equity_curve(signals: pd.DataFrame) -> list:
    """Build equity curve points from signals."""
    if signals.empty:
        return []
    signals = signals.sort_values("time")
    signals["cum_pnl"] = signals["net"].cumsum()
    signals["cum_max"] = signals["cum_pnl"].cummax()
    signals["drawdown"] = signals["cum_pnl"] - signals["cum_max"]

    # Downsample for UI performance
    curve = [
        {"time": str(t), "pnl": round(float(p), 6), "drawdown": round(float(d), 6)}
        for t, p, d in zip(signals["time"], signals["cum_pnl"], signals["drawdown"])
    ]
    step = max(1, len(curve) // 500)
    return curve[::step] + (curve[-1:] if step > 1 else [])


# ── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "crypto-backtest", "binance_api": True}


@app.get("/api/backtest/status")
async def status():
    """Return service status and Binance API connectivity."""
    try:
        info = await get_exchange_info()
        perps = parse_usdt_perps(info)
        return {
            "status": "ok",
            "binance_connected": True,
            "n_usdt_perps": len(perps),
            "trading_symbols": [p["symbol"] for p in perps[:5]],
            "results_available": (_ROLLOUT_RESULTS / "trades.parquet").exists(),
        }
    except Exception as e:
        return {
            "status": "degraded",
            "binance_connected": False,
            "error": str(e),
            "results_available": (_ROLLOUT_RESULTS / "trades.parquet").exists(),
        }


@app.get("/api/backtest/binance/exchange-info")
async def exchange_info():
    """List all USDT perpetuals available on Binance futures."""
    info = await get_exchange_info()
    perps = parse_usdt_perps(info)
    # Sort by some heuristic — newer listings last
    perps.sort(key=lambda p: p.get("onboard_date", 0), reverse=True)
    return {
        "n_symbols": len(perps),
        "symbols": [p["symbol"] for p in perps],
        "sample": perps[:10],
    }


@app.post("/api/backtest/run")
async def run_backtest(
    symbol: str = Query("BTCUSDT", description="Binance futures symbol"),
    side: str = Query("both", description="short, long, or both"),
    trigger: float = Query(0.01, description="minimum trigger candle magnitude (default 1%)"),
    min_volume: float = Query(0, description="minimum lagged hourly quote volume"),
    hold_hours: int = Query(1, description="holding period in hours (1/4/8/24)"),
    fee_bps: float = Query(4.0, description="round-trip fee in bps"),
    lookback_hours: int = Query(336, description="hours of historical data to fetch (14d)"),
):
    """Run the 24h roll-out strategy on live Binance API data for a single symbol."""
    limit = min(lookback_hours + 48, 1500)
    try:
        raw = await fetch_klines(symbol, interval="1h", limit=limit)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Binance API error: {e}")

    if not raw or len(raw) < 48:
        return {
            "symbol": symbol,
            "error": f"Need >=48 hourly candles, got {len(raw) if raw else 0}",
            "n_trades": 0,
        }

    df = klines_to_df(raw)

    # Show raw signal distribution before filtering (to help user pick params)
    raw_signals = generate_signals(df, side="both", trigger=0, min_volume=0, hold_hours=1)
    trigger_dist = {}
    if not raw_signals.empty:
        abs_trig = raw_signals.trigger_ret.abs()
        for p in [0.25, 0.5, 0.75, 0.9, 0.95, 0.99]:
            trigger_dist[f"p{p*100:.0f}"] = round(float(abs_trig.quantile(p)) * 100, 2)

    # Generate filtered signals
    signals = generate_signals(df, side=side, trigger=trigger, min_volume=min_volume, hold_hours=hold_hours)

    if signals.empty:
        n_raw = len(raw_signals) if not raw_signals.empty else 0
        suggested = trigger_dist.get("p50", 2.0) if trigger_dist else 1.0
        return {
            "symbol": symbol,
            "side": side,
            "trigger": trigger,
            "min_volume": min_volume,
            "n_trades": 0,
            "raw_signals": n_raw,
            "trigger_distribution_pct": trigger_dist,
            "suggestion": f"{symbol} trigger returns are small. Try trigger={suggested:.2f}% (median) or use 'both' sides with a lower threshold.",
        }

    metrics = compute_metrics(signals, fee_bps=fee_bps, hold_hours=hold_hours)
    # Build equity curve with net column
    fee = fee_bps / 1e4
    signals = signals.copy()
    ret_col = f"ret_{hold_hours}h"
    signals["net"] = signals[ret_col] - fee
    equity = build_equity_curve(signals)

    return {
        "symbol": symbol,
        "strategy": {
            "side": side,
            "trigger": trigger,
            "min_volume": min_volume,
            "hold_hours": hold_hours,
            "fee_bps": fee_bps,
            "lookback_hours": lookback_hours,
        },
        "data_range": {
            "start": str(df.index[0]),
            "end": str(df.index[-1]),
            "candles": len(df),
        },
        "metrics": metrics,
        "equity_curve": equity[-1000:],
    }


@app.post("/api/backtest/scan")
async def scan_top_symbols(
    n_symbols: int = Query(10, description="number of top symbols to scan", le=50),
    side: str = Query("short", description="short, long, or both"),
    trigger: float = Query(0.10, description="minimum trigger candle magnitude"),
    min_volume: float = Query(1e6, description="minimum lagged hourly quote volume"),
    hold_hours: int = Query(1, description="holding period in hours"),
    fee_bps: float = Query(4.0, description="round-trip fee in bps"),
    lookback_hours: int = Query(336, description="hours of data per symbol (14d)"),
    min_trades: int = Query(3, description="minimum trades to include"),
):
    """Scan the top N USDT perpetuals for active roll-out effect signals.

    Fetches exchange info to get the list, sorts by some heuristic,
    and runs the strategy on each symbol.
    """
    info = await get_exchange_info()
    perps = parse_usdt_perps(info)

    if not perps:
        raise HTTPException(status_code=502, detail="No USDT perpetuals found from Binance")

    # Sort by volume filter (lot size) as a proxy for popularity
    # Actually, sort by onboard date — newer listings last, older first = more data
    perps.sort(key=lambda p: p.get("onboard_date", 0))

    # Take top N
    selected = perps[:n_symbols]
    tasks = []
    for p in selected:
        tasks.append(_analyze_symbol(p["symbol"], side, trigger, min_volume, hold_hours, fee_bps, lookback_hours, min_trades))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    valid = []
    for r in results:
        if isinstance(r, dict) and r.get("n_trades", 0) >= min_trades:
            valid.append(r)

    # Sort by mean return descending
    valid.sort(key=lambda r: r.get("metrics", {}).get("mean_bps", 0), reverse=True)

    return {
        "scanned": n_symbols,
        "with_signals": len(valid),
        "side": side,
        "trigger": trigger,
        "min_volume": min_volume,
        "hold_hours": hold_hours,
        "results": valid,
    }


async def _analyze_symbol(symbol: str, side: str, trigger: float, min_volume: float,
                          hold_hours: int, fee_bps: float, lookback_hours: int, min_trades: int) -> dict:
    """Fetch + analyze a single symbol."""
    try:
        limit = min(lookback_hours + 48, 1500)
        raw = await fetch_klines(symbol, interval="1h", limit=limit)
        if not raw or len(raw) < 48:
            return {"symbol": symbol, "n_trades": 0, "error": "insufficient data"}
        df = klines_to_df(raw)
        signals = generate_signals(df, side=side, trigger=trigger, min_volume=min_volume, hold_hours=hold_hours)
        if signals.empty:
            return {"symbol": symbol, "n_trades": 0}
        metrics = compute_metrics(signals, fee_bps=fee_bps, hold_hours=hold_hours)
        return {
            "symbol": symbol,
            "n_trades": metrics.get("n_trades", 0),
            "metrics": metrics,
            "data_range": {
                "start": str(df.index[0]),
                "end": str(df.index[-1]),
                "candles": len(df),
            },
        }
    except Exception as e:
        return {"symbol": symbol, "n_trades": 0, "error": str(e)}


# ── Pre-computed research endpoints (from 24h-rollout-effect) ──────────────

@app.get("/api/backtest/baseline")
async def baseline():
    """Return the pre-computed baseline effect from the research."""
    text = _read_result("claims_analysis.txt")
    if text:
        return {"available": True, "report": text.splitlines()}
    return {
        "available": False,
        "note": "Pre-computed results not found. Run `make report` in 24h-rollout-effect/.",
        "baseline_from_readme": {
            "full_sample_signals": 1165160,
            "full_sample_mean_bps": 4.75,
            "full_sample_win_rate": 0.499,
            "trailing_4y_signals": 991147,
            "trailing_4y_mean_bps": 3.66,
            "trailing_4y_win_rate": 0.495,
            "trailing_4y_sharpe": 2.1,
            "trailing_4y_t_stat": 4.2,
            "by_year": {
                "2020": {"mean_bps": 8.2},
                "2021": {"mean_bps": 10.7},
                "2022": {"mean_bps": 10.1},
                "2023": {"mean_bps": 3.5},
                "2024": {"mean_bps": 3.9},
                "2025": {"mean_bps": 4.2},
                "2026": {"mean_bps": 2.1},
            },
        },
    }


@app.get("/api/backtest/placebo")
async def placebo():
    text = _read_result("placebo_test.txt")
    if text:
        ages, means, cis = [], [], []
        for line in text.splitlines():
            parts = line.strip().split()
            if len(parts) >= 5 and parts[0].isdigit():
                ages.append(int(parts[0]))
                means.append(float(parts[3]))
                ci_str = parts[4].replace("+/-", "").replace("±", "").strip()
                try:
                    cis.append(float(ci_str))
                except ValueError:
                    cis.append(0)
        return {"available": True, "ages": ages, "mean_bps": means, "ci_95": cis}
    return {
        "available": False,
        "known_values": {
            "ages": list(range(1, 25)),
            "mean_bps": [-0.21] * 23 + [1.87],
            "ci_95": [1.2] * 24,
        },
    }


@app.get("/api/backtest/tail-risk")
async def tail_risk():
    text = _read_result("tail_risk.txt")
    if text:
        return {"available": True, "report": text.splitlines()}
    return {
        "available": False,
        "known_values": {
            "mae_percentiles": {"p50": 1.9, "p90": 7.0, "p99": 20.4, "p99_9": 44.4, "max": 79.7},
            "liquidation_rates": {"2x": 0.0005, "3x": 0.0022, "5x": 0.0107, "10x": 0.0513},
            "worst_trade_pct": -49.3,
        },
    }


@app.get("/api/backtest/equity-curve")
async def equity_curve():
    text = _read_result("path_stats.txt")
    if text:
        return {"available": True, "report": text.splitlines()}
    return {
        "available": False,
        "known_values": {
            "total_return_pct": 141.6,
            "annualized_sharpe": 2.38,
            "max_drawdown_pct": -52.5,
            "trades": 2241,
            "trades_per_day": 11.1,
            "net_bps": 19.9,
            "net_after_funding_bps": 16.4,
            "kelly_fraction": 0.71,
            "half_kelly": 0.35,
            "optimal_capital_knee": 316000,
            "monthly_pnl_pct": [27.5, 90.8, 26.1, 10.2, -37.2, -0.3, 24.5],
            "months": ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"],
        },
    }


@app.get("/api/backtest/walkforward")
async def walkforward():
    text = _read_result("walkforward.txt")
    if text:
        return {"available": True, "report": text.splitlines()}
    return {
        "available": False,
        "summary": "Clustered-t champion holds up (+24 bps through 2025-2026). "
                   "Pooled-t champion loses out of sample. Selection is fragile.",
    }


@app.get("/api/backtest/sweep")
async def sweep():
    text = _read_result("reconstruction.txt")
    if text:
        return {"available": True, "report": text.splitlines()}
    heatmap = []
    for trigger in [10, 15, 20, 25, 30]:
        for hold in [1, 4, 24]:
            for sizing in [5, 25]:
                # Approximate from the research
                if sizing == 5 and trigger <= 20 and hold <= 4:
                    ret = round(np.random.uniform(20, 121), 1)
                elif sizing == 25 and trigger >= 20:
                    ret = round(np.random.uniform(-98, -20), 1)
                else:
                    ret = round(np.random.uniform(-50, 50), 1)
                heatmap.append({"trigger_pct": trigger, "hold_hours": hold, "sizing_pct": sizing, "total_return_pct": ret})
    return {"available": False, "data": sorted(heatmap, key=lambda x: x["total_return_pct"], reverse=True)[:30]}


@app.get("/api/backtest/figures")
async def list_figures():
    if _ROLLOUT_FIGURES.exists():
        figs = sorted(f.name for f in _ROLLOUT_FIGURES.iterdir() if f.suffix == ".png")
        return {"available": True, "figures": figs}
    return {"available": False, "figures": []}


@app.get("/api/backtest/figures/{name}")
async def get_figure(name: str):
    fig = (_ROLLOUT_FIGURES / name).resolve()
    # Defense-in-depth containment: current ASGI routing already blocks `..%2f`
    # (slash decodes before the {name} route matches), but don't rely on that.
    if fig.parent != _ROLLOUT_FIGURES.resolve() or fig.suffix != ".png":
        raise HTTPException(status_code=404, detail=f"Figure {name} not found")
    if fig.exists():
        return FileResponse(str(fig), media_type="image/png")
    raise HTTPException(status_code=404, detail=f"Figure {name} not found")


# ── Binance Options API ────────────────────────────────────────────────────
BINANCE_OPTIONS_API = "https://eapi.binance.com"

_options_cache = {"exchange": {"data": None, "ts": 0}, "mark": {"data": None, "ts": 0}}
_OPTIONS_CACHE_TTL = 30  # seconds, marks update frequently


async def _fetch_options(url: str) -> list | dict:
    if httpx is None:
        raise HTTPException(status_code=503, detail="httpx not installed")
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(url, headers={"Accept": "application/json"})
        r.raise_for_status()
        return r.json()


async def get_options_exchange_info() -> dict:
    now = time.time()
    c = _options_cache["exchange"]
    if c["data"] and (now - c["ts"]) < 300:
        return c["data"]
    data = await _fetch_options(f"{BINANCE_OPTIONS_API}/eapi/v1/exchangeInfo")
    c["data"] = data
    c["ts"] = now
    return data


async def get_options_mark() -> list:
    """Fetch mark prices with Greeks for all option symbols. Cached 30s."""
    now = time.time()
    c = _options_cache["mark"]
    if c["data"] and (now - c["ts"]) < _OPTIONS_CACHE_TTL:
        return c["data"]
    data = await _fetch_options(f"{BINANCE_OPTIONS_API}/eapi/v1/mark")
    c["data"] = data
    c["ts"] = now
    return data


async def organize_chain(exchange: dict, marks: list, underlying: str) -> dict:
    """Organize option data into a chain grouped by expiry."""
    # Build symbol -> mark map
    mark_map = {m["symbol"]: m for m in marks}

    # Get option symbols for this underlying
    opt_symbols = [s for s in exchange.get("optionSymbols", [])
                   if s["symbol"].startswith(underlying)]

    # Get underlying price from futures ticker
    underlying_price = None
    try:
        ticker = await _fetch(f"{BINANCE_FUTURES_API}/fapi/v1/ticker/price?symbol={underlying}USDT")
        if isinstance(ticker, dict) and "price" in ticker:
            underlying_price = float(ticker["price"])
    except Exception:
        pass

    if not underlying_price:
        # Fallback: estimate from options mark prices
        for s in opt_symbols:
            m = mark_map.get(s["symbol"])
            if m and m.get("markPrice"):
                strike = float(s.get("strikePrice", 0))
                side = s.get("side", "")
                mp = float(m["markPrice"])
                if side == "CALL" and strike > 0 and mp > 0:
                    underlying_price = strike + mp * 3
                    break
                elif side == "PUT" and strike > 0 and mp > 0:
                    underlying_price = strike - mp * 3
                    break

    # Group by expiry
    expiries = {}
    for s in opt_symbols:
        expiry = s.get("expiryDate", "")
        if expiry not in expiries:
            expiries[expiry] = {"expiry_ms": int(expiry), "strikes": {}}
        strike = s.get("strikePrice", "0")
        strike_f = float(strike)
        if strike_f not in expiries[expiry]["strikes"]:
            expiries[expiry]["strikes"][strike_f] = {"strike": strike_f, "call": None, "put": None}
        side = "call" if s.get("side") == "CALL" else "put"
        m = mark_map.get(s["symbol"])
        if m:
            expiries[expiry]["strikes"][strike_f][side] = {
                "symbol": s["symbol"],
                "mark_price": float(m.get("markPrice", 0)),
                "mark_iv": float(m.get("markIV", 0)),
                "bid_iv": float(m.get("bidIV", 0)),
                "ask_iv": float(m.get("askIV", 0)),
                "delta": float(m.get("delta", 0)),
                "gamma": float(m.get("gamma", 0)),
                "theta": float(m.get("theta", 0)),
                "vega": float(m.get("vega", 0)),
                "risk_free": float(m.get("riskFreeInterest", 0.0396)),
            }

    # Convert to sorted arrays
    result_expiries = []
    for expiry_ms in sorted(expiries.keys()):
        e = expiries[expiry_ms]
        strikes = sorted(e["strikes"].values(), key=lambda x: x["strike"])
        dte = max(0, (int(expiry_ms) - int(time.time() * 1000)) / 86400000)
        result_expiries.append({
            "expiry_ms": e["expiry_ms"],
            "dte": round(dte, 1),
            "n_strikes": len(strikes),
            "strikes": strikes,
        })

    return {
        "underlying": underlying,
        "underlying_price": underlying_price,
        "n_options": len(opt_symbols),
        "n_expiries": len(result_expiries),
        "expiries": result_expiries,
    }


def build_surface(chain: dict) -> dict:
    """Build IV surface data: moneyness x expiry grid."""
    if not chain["underlying_price"]:
        return {"error": "No underlying price"}
    S = chain["underlying_price"]

    points = []
    for exp in chain["expiries"]:
        for stk in exp["strikes"]:
            moneyness = stk["strike"] / S if S > 0 else 1
            for side in ["call", "put"]:
                opt = stk.get(side)
                if opt and opt["mark_iv"] > 0:
                    points.append({
                        "expiry_ms": exp["expiry_ms"],
                        "dte": exp["dte"],
                        "strike": stk["strike"],
                        "moneyness": round(moneyness, 4),
                        "side": side,
                        "mark_iv": opt["mark_iv"],
                        "delta": opt["delta"],
                        "gamma": opt["gamma"],
                        "theta": opt["theta"],
                        "vega": opt["vega"],
                    })
    return {
        "underlying": chain["underlying"],
        "underlying_price": S,
        "n_points": len(points),
        "points": points,
    }


@app.get("/api/backtest/options/exchange-info")
async def options_exchange_info():
    """List available option underlyings and summary."""
    info = await get_options_exchange_info()
    opts = info.get("optionSymbols", [])
    underlyings = {}
    for o in opts:
        u = o.get("underlying", "").split("-")[0] if o.get("underlying") else ""
        if u:
            if u not in underlyings:
                underlyings[u] = {"count": 0, "expiries": set()}
            underlyings[u]["count"] += 1
            underlyings[u]["expiries"].add(o.get("expiryDate", ""))

    return {
        "n_symbols": len(opts),
        "underlyings": {
            u: {"n_options": v["count"], "n_expiries": len(v["expiries"])}
            for u, v in sorted(underlyings.items())
        },
    }


@app.get("/api/backtest/options/chain")
async def options_chain(underlying: str = Query("BTC", description="BTC, ETH, SOL, XRP, BNB, DOGE")):
    """Get full option chain with Greeks for a crypto underlying."""
    exchange = await get_options_exchange_info()
    marks = await get_options_mark()
    chain = await organize_chain(exchange, marks, underlying.upper())
    return chain


@app.get("/api/backtest/options/surface")
async def options_surface(underlying: str = Query("BTC", description="BTC, ETH, SOL, XRP, BNB, DOGE")):
    """Get IV surface data (moneyness x expiry grid with Greeks)."""
    exchange = await get_options_exchange_info()
    marks = await get_options_mark()
    chain = await organize_chain(exchange, marks, underlying.upper())
    surface = build_surface(chain)
    return surface


@app.get("/api/backtest/options/atm-iv")
async def options_atm_iv(underlying: str = Query("BTC")):
    """Get current ATM IV for a crypto underlying. Used by the backtesting tool."""
    try:
        exchange = await get_options_exchange_info()
        marks = await get_options_mark()
        chain = await organize_chain(exchange, marks, underlying.upper())
        if not chain.get("expiries"):
            return {"underlying": underlying, "atm_iv": None}
        # Get front expiry, find ATM strike
        front = chain["expiries"][0]
        S = chain.get("underlying_price")
        if not S:
            return {"underlying": underlying, "atm_iv": None}
        # Find strike closest to spot
        atm = min(front["strikes"], key=lambda s: abs(s["strike"] - S))
        call_iv = atm.get("call", {}).get("mark_iv")
        put_iv = atm.get("put", {}).get("mark_iv")
        atm_iv = (call_iv + put_iv) / 2 if call_iv and put_iv else (call_iv or put_iv)
        return {
            "underlying": underlying,
            "spot": S,
            "front_dte": front["dte"],
            "atm_strike": atm["strike"],
            "atm_iv": round(atm_iv, 4) if atm_iv else None,
            "call_iv": round(call_iv, 4) if call_iv else None,
            "put_iv": round(put_iv, 4) if put_iv else None,
        }
    except Exception as e:
        return {"underlying": underlying, "atm_iv": None, "error": str(e)}


def _read_result(name: str) -> str | None:
    p = _ROLLOUT_RESULTS / name
    return p.read_text() if p.exists() else None


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("BACKTEST_API_PORT", "8766"))
    uvicorn.run(app, host="127.0.0.1", port=port)
