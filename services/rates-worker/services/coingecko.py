"""
CoinGecko simple spot for BTC/ETH — free/keyless backup when Deribit lags.

Fail-closed: missing coins stay null; no synthetic prices.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

COINGECKO_SIMPLE = "https://api.coingecko.com/api/v3/simple/price"
# CoinGecko IDs
IDS = ("bitcoin", "ethereum")
ID_TO_SYMBOL = {"bitcoin": "BTC", "ethereum": "ETH"}


async def build_crypto_spot() -> dict[str, Any]:
    """Fetch BTC/ETH USD spot + 24h change / market cap from CoinGecko."""
    params = {
        "ids": ",".join(IDS),
        "vs_currencies": "usd",
        "include_24hr_change": "true",
        "include_24hr_vol": "true",
        "include_market_cap": "true",
        "include_last_updated_at": "true",
    }
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            res = await client.get(
                COINGECKO_SIMPLE,
                params=params,
                headers={"Accept": "application/json"},
            )
            res.raise_for_status()
            payload = res.json()
    except Exception as e:
        return {
            "assets": [],
            "error": f"{type(e).__name__}: {e}",
            "as_of": datetime.now(timezone.utc).isoformat(),
            "source": "CoinGecko",
            "note": "Failed to fetch CoinGecko spot. No synthetic crypto levels.",
        }

    if not isinstance(payload, dict) or not payload:
        return {
            "assets": [],
            "error": "empty_payload",
            "as_of": datetime.now(timezone.utc).isoformat(),
            "source": "CoinGecko",
            "note": "CoinGecko returned no data. No synthetic crypto levels.",
        }

    assets: list[dict[str, Any]] = []
    as_of_ms: int | None = None
    for cid in IDS:
        row = payload.get(cid) or {}
        if not isinstance(row, dict):
            continue
        usd = row.get("usd")
        try:
            spot = float(usd) if usd is not None else None
        except (TypeError, ValueError):
            spot = None
        if spot is None:
            continue

        def _num(key: str) -> float | None:
            v = row.get(key)
            try:
                return float(v) if v is not None else None
            except (TypeError, ValueError):
                return None

        lu = row.get("last_updated_at")
        try:
            lu_i = int(lu) if lu is not None else None
        except (TypeError, ValueError):
            lu_i = None
        if lu_i is not None:
            as_of_ms = max(as_of_ms or 0, lu_i * 1000)

        assets.append({
            "id": cid,
            "symbol": ID_TO_SYMBOL.get(cid, cid.upper()),
            "spot_usd": spot,
            "change_24h_pct": _num("usd_24h_change"),
            "volume_24h_usd": _num("usd_24h_vol"),
            "market_cap_usd": _num("usd_market_cap"),
            "last_updated_at": lu_i,
        })

    if not assets:
        return {
            "assets": [],
            "error": "no_assets",
            "as_of": datetime.now(timezone.utc).isoformat(),
            "source": "CoinGecko",
            "note": "No BTC/ETH prices parsed. No synthetic crypto levels.",
        }

    as_of = (
        datetime.fromtimestamp(as_of_ms / 1000, tz=timezone.utc).isoformat()
        if as_of_ms
        else datetime.now(timezone.utc).isoformat()
    )

    by_symbol = {a["symbol"]: a for a in assets}
    return {
        "assets": assets,
        "btc": by_symbol.get("BTC"),
        "eth": by_symbol.get("ETH"),
        "as_of": as_of,
        "as_of_ms": as_of_ms,
        "source": f"CoinGecko ({len(assets)}/{len(IDS)} assets)",
        "note": (
            "Funding-agnostic spot backup. Prefer Deribit index for options mark; "
            "use CoinGecko when Deribit index is down."
        ),
    }
