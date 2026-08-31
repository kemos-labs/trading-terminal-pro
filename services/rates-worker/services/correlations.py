import asyncio
import time
import pandas as pd

from services.fred_client import fetch_series


INSTRUMENTS = [
    {"id": "SOFR", "source": "fred", "label": "SOFR"},
    {"id": "DFF", "source": "fred", "label": "EFFR"},
    {"id": "DTB3", "source": "fred", "label": "3M Bill"},
    {"id": "DGS1MO", "source": "fred", "label": "1M Tsy"},
    {"id": "DGS2", "source": "fred", "label": "2Y Tsy"},
    {"id": "DGS10", "source": "fred", "label": "10Y Tsy"},
]

PERIOD_DAYS = {"1m": 30, "3m": 90, "6m": 180, "1y": 365, "2y": 730}

_cache = {}
CACHE_TTL = 3600


def _yf_fetch_history(symbol: str, period: str) -> list:
    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period=period, interval="1d")
        if hist is None or hist.empty:
            return []
        return [{"date": idx.strftime("%Y-%m-%d"), "close": float(row["Close"])}
                for idx, row in hist.iterrows()]
    except Exception:
        return []


async def _fetch_returns(source: str, series_id: str, period_days: int) -> pd.Series:
    if source == "fred":
        raw = await fetch_series(series_id, limit=period_days + 30)
        if not raw:
            return pd.Series(dtype=float)
        s = pd.Series(
            [r["value"] for r in raw],
            index=pd.to_datetime([r["date"] for r in raw]),
        )
    else:
        period_str = f"{max(period_days, 60)}d"
        history = await asyncio.to_thread(_yf_fetch_history, series_id, period_str)
        if not history:
            return pd.Series(dtype=float)
        s = pd.Series(
            [r["close"] for r in history],
            index=pd.to_datetime([r["date"] for r in history]),
        )
    s = s.sort_index()
    returns = s.pct_change().dropna()
    return returns


def _pearson(x: pd.Series, y: pd.Series) -> float:
    if len(x) < 2 or len(y) < 2:
        return 0.0
    if x.std() == 0 or y.std() == 0:
        return 0.0
    return float(x.corr(y))


async def compute_correlation_matrix(window: int = 30, period: str = "1y") -> dict:
    period_days = PERIOD_DAYS.get(period, 365)
    cache_key = f"{window}_{period}"
    now = time.time()
    if cache_key in _cache and now - _cache[cache_key]["time"] < CACHE_TTL:
        return _cache[cache_key]["data"]

    returns_list = await asyncio.gather(
        *[_fetch_returns(inst["source"], inst["id"], period_days) for inst in INSTRUMENTS]
    )

    if not returns_list or all(r.empty for r in returns_list):
        return {
            "instruments": [inst["label"] for inst in INSTRUMENTS],
            "matrix": [[0.0] * len(INSTRUMENTS) for _ in INSTRUMENTS],
            "window": window,
            "period": period,
            "as_of": None,
            "source": "FRED",
            "note": "No return data available for any instrument.",
        }

    aligned_index = returns_list[0].index
    for r in returns_list[1:]:
        aligned_index = aligned_index.intersection(r.index)
    aligned_index = aligned_index.sort_values()

    if len(aligned_index) < 5:
        return {
            "instruments": [inst["label"] for inst in INSTRUMENTS],
            "matrix": [[0.0] * len(INSTRUMENTS) for _ in INSTRUMENTS],
            "window": window,
            "period": period,
            "as_of": None,
            "source": "FRED",
            "note": f"Only {len(aligned_index)} common trading days after alignment.",
        }

    recent_index = aligned_index[-window:] if len(aligned_index) >= window else aligned_index
    recent_returns = [r.reindex(recent_index).fillna(0.0) for r in returns_list]

    n = len(INSTRUMENTS)
    matrix = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            matrix[i][j] = round(_pearson(recent_returns[i], recent_returns[j]), 4)

    as_of = recent_index[-1].strftime("%Y-%m-%d") if len(recent_index) > 0 else None

    result = {
        "instruments": [inst["label"] for inst in INSTRUMENTS],
        "matrix": matrix,
        "window": window,
        "period": period,
        "as_of": as_of,
        "source": "FRED",
    }
    _cache[cache_key] = {"data": result, "time": now}
    return result
