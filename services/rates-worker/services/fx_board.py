"""
Live multi-pair FX board via Frankfurter (ECB reference rates, no API key).

Fail-closed: empty pairs / errors → no synthetic levels.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest"
# Quotes we request from a USD base (Frankfurter returns units of quote per 1 USD).
USD_QUOTES = ("JPY", "EUR", "GBP", "AUD", "CHF", "CAD")


def _pair_rate(base_usd_rates: dict[str, float], pair: str) -> float | None:
    """
    Convert Frankfurter USD-base quotes into common FX conventions.

    Frankfurter `from=USD` → rates[CCY] = units of CCY per 1 USD.
    - USDJPY / USDCHF / USDCAD: use rate as-is
    - EURUSD / GBPUSD / AUDUSD: invert (USD per 1 foreign)
    """
    if pair == "USDJPY":
        v = base_usd_rates.get("JPY")
        return float(v) if v is not None else None
    if pair == "USDCHF":
        v = base_usd_rates.get("CHF")
        return float(v) if v is not None else None
    if pair == "USDCAD":
        v = base_usd_rates.get("CAD")
        return float(v) if v is not None else None
    if pair == "EURUSD":
        v = base_usd_rates.get("EUR")
        return (1.0 / float(v)) if v else None
    if pair == "GBPUSD":
        v = base_usd_rates.get("GBP")
        return (1.0 / float(v)) if v else None
    if pair == "AUDUSD":
        v = base_usd_rates.get("AUD")
        return (1.0 / float(v)) if v else None
    return None


PAIR_SPECS = (
    ("USDJPY", "1 USD in JPY", 2),
    ("EURUSD", "1 EUR in USD", 4),
    ("GBPUSD", "1 GBP in USD", 4),
    ("AUDUSD", "1 AUD in USD", 4),
    ("USDCHF", "1 USD in CHF", 4),
    ("USDCAD", "1 USD in CAD", 4),
)


async def build_fx_board() -> dict[str, Any]:
    """Fetch latest ECB-based FX board. No demo levels on failure."""
    url = f"{FRANKFURTER_URL}?from=USD&to={','.join(USD_QUOTES)}"
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            res = await client.get(url, headers={"Accept": "application/json"})
            res.raise_for_status()
            payload = res.json()
    except Exception as e:
        return {
            "pairs": [],
            "error": f"{type(e).__name__}: {e}",
            "as_of": datetime.now(timezone.utc).isoformat(),
            "source": "Frankfurter",
            "note": "Failed to fetch Frankfurter rates. No synthetic FX levels.",
        }

    raw_rates = payload.get("rates") or {}
    rates: dict[str, float] = {}
    for k, v in raw_rates.items():
        try:
            rates[str(k).upper()] = float(v)
        except (TypeError, ValueError):
            continue

    if not rates:
        return {
            "pairs": [],
            "error": "empty_rates",
            "as_of": datetime.now(timezone.utc).isoformat(),
            "source": "Frankfurter",
            "note": "Frankfurter returned no rates. No synthetic FX levels.",
        }

    pairs: list[dict[str, Any]] = []
    for pair, note, decimals in PAIR_SPECS:
        mid = _pair_rate(rates, pair)
        if mid is None:
            pairs.append({
                "pair": pair,
                "rate": None,
                "decimals": decimals,
                "note": note,
            })
            continue
        pairs.append({
            "pair": pair,
            "rate": round(mid, decimals),
            "decimals": decimals,
            "note": note,
        })

    live_n = sum(1 for p in pairs if p.get("rate") is not None)
    ref_date = payload.get("date")  # ECB working day YYYY-MM-DD
    as_of = (
        f"{ref_date}T16:00:00+00:00"
        if isinstance(ref_date, str) and len(ref_date) >= 10
        else datetime.now(timezone.utc).isoformat()
    )

    return {
        "base": "USD",
        "pairs": pairs,
        "raw_usd_quotes": {k: rates[k] for k in USD_QUOTES if k in rates},
        "ecb_date": ref_date,
        "as_of": as_of,
        "source": f"Frankfurter / ECB ({live_n}/{len(PAIR_SPECS)} pairs)",
        "note": (
            "Daily ECB reference rates via Frankfurter (updated ~16:00 CET). "
            "Not a live spot tape — use for macro context / Japan carry."
        ),
    }
