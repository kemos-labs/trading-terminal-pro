"""
Crypto linear perp mark vs index basis via Bybit public v5 API (no key).

Fail-closed: empty rows on error; no synthetic prices.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

BYBIT_TICKERS = "https://api.bybit.com/v5/market/tickers"
SYMBOLS = (
    ("BTCUSDT", "BTC"),
    ("ETHUSDT", "ETH"),
)


def _f(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        x = float(v)
        return x if x == x else None  # NaN check
    except (TypeError, ValueError):
        return None


async def build_perp_basis() -> dict[str, Any]:
    """Fetch BTC/ETH USDT linear ticker: mark, index, funding, basis bps."""
    rows: list[dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            for symbol, ccy in SYMBOLS:
                res = await client.get(
                    BYBIT_TICKERS,
                    params={"category": "linear", "symbol": symbol},
                    headers={"Accept": "application/json"},
                )
                res.raise_for_status()
                payload = res.json()
                lst = ((payload or {}).get("result") or {}).get("list") or []
                if not lst:
                    rows.append(
                        {
                            "symbol": symbol,
                            "ccy": ccy,
                            "mark": None,
                            "index": None,
                            "last": None,
                            "funding_rate": None,
                            "basis_bps": None,
                            "error": "empty_ticker",
                        }
                    )
                    continue
                t = lst[0]
                mark = _f(t.get("markPrice"))
                index = _f(t.get("indexPrice"))
                last = _f(t.get("lastPrice"))
                funding = _f(t.get("fundingRate"))
                basis_bps = None
                if mark is not None and index is not None and index > 0:
                    basis_bps = round((mark - index) / index * 10_000, 2)
                rows.append(
                    {
                        "symbol": symbol,
                        "ccy": ccy,
                        "mark": mark,
                        "index": index,
                        "last": last,
                        "funding_rate": funding,
                        "funding_ann_approx": round(funding * 3 * 365, 6) if funding is not None else None,
                        "basis_bps": basis_bps,
                        "next_funding_time": t.get("nextFundingTime"),
                        "open_interest": _f(t.get("openInterest")),
                        "turnover_24h": _f(t.get("turnover24h")),
                    }
                )
    except Exception as e:
        return {
            "rows": [],
            "error": f"{type(e).__name__}: {e}",
            "as_of": datetime.now(timezone.utc).isoformat(),
            "source": "Bybit",
            "note": "Failed to fetch Bybit linear tickers. No synthetic perp basis.",
        }

    live = [r for r in rows if r.get("mark") is not None]
    return {
        "rows": rows,
        "btc": next((r for r in rows if r.get("ccy") == "BTC"), None),
        "eth": next((r for r in rows if r.get("ccy") == "ETH"), None),
        "count_live": len(live),
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": "Bybit",
        "note": "Linear USDT perps · basis = (mark − index) / index in bps. Public, no key.",
        "error": None if live else "no_live_tickers",
    }
