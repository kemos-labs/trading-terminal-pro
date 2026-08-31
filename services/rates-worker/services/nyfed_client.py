"""
New York Fed Markets Data API — free, no API key.

Official reference rates with percentiles, volume, and Fed target range.
Docs: https://markets.newyorkfed.org/static/docs/markets-api.html

Endpoints used:
  /api/rates/all/latest.json  — SOFR, EFFR, OBFR, TGCR, BGCR, SOFRAI
"""
from __future__ import annotations

import time
from typing import Any

import httpx

NYFED_ALL_LATEST = "https://markets.newyorkfed.org/api/rates/all/latest.json"
_CACHE: dict[str, Any] = {"ts": 0.0, "data": None}
_CACHE_TTL = 300  # 5 min — NY Fed prints once/day ~8am ET


def _parse_rate_row(r: dict) -> dict[str, Any]:
    t = r.get("type") or ""
    if t == "SOFRAI":
        return {
            "type": "SOFRAI",
            "effective_date": r.get("effectiveDate"),
            "avg_30d": r.get("average30day"),
            "avg_90d": r.get("average90day"),
            "avg_180d": r.get("average180day"),
            "index": r.get("index"),
            "revision": r.get("revisionIndicator") or "",
        }
    out: dict[str, Any] = {
        "type": t,
        "effective_date": r.get("effectiveDate"),
        "rate": r.get("percentRate"),
        "p1": r.get("percentPercentile1"),
        "p25": r.get("percentPercentile25"),
        "p75": r.get("percentPercentile75"),
        "p99": r.get("percentPercentile99"),
        "volume_bn": r.get("volumeInBillions"),
        "revision": r.get("revisionIndicator") or "",
    }
    if r.get("targetRateFrom") is not None:
        out["target_from"] = r.get("targetRateFrom")
        out["target_to"] = r.get("targetRateTo")
    return out


async def fetch_reference_rates(force: bool = False) -> dict[str, Any]:
    """
    Latest NY Fed overnight reference rates + SOFR averages.

    Returns structured dict used by STIR strip and Rates desk:
      rates: {SOFR, EFFR, OBFR, TGCR, BGCR, ...}
      sofr_avg: 30/90/180d + index
      target: EFFR target range
      as_of, source, note
    """
    now = time.time()
    if not force and _CACHE["data"] is not None and (now - _CACHE["ts"]) < _CACHE_TTL:
        return _CACHE["data"]

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(NYFED_ALL_LATEST)
            resp.raise_for_status()
            payload = resp.json()
    except Exception as e:
        if _CACHE["data"] is not None:
            stale = dict(_CACHE["data"])
            stale["stale"] = True
            stale["error"] = str(e)
            return stale
        return {
            "rates": {},
            "sofr_avg": None,
            "target": None,
            "as_of": None,
            "source": "NYFed Markets API",
            "error": str(e),
            "note": "NY Fed fetch failed",
        }

    rows = payload.get("refRates") or []
    rates: dict[str, dict] = {}
    sofr_avg = None
    target = None
    as_of = None

    for r in rows:
        parsed = _parse_rate_row(r)
        t = parsed.get("type")
        if t == "SOFRAI":
            sofr_avg = parsed
            as_of = as_of or parsed.get("effective_date")
            continue
        if not t:
            continue
        rates[t] = parsed
        as_of = as_of or parsed.get("effective_date")
        if t == "EFFR" and parsed.get("target_from") is not None:
            target = {
                "from": parsed.get("target_from"),
                "to": parsed.get("target_to"),
                "mid": (
                    round((float(parsed["target_from"]) + float(parsed["target_to"])) / 2, 4)
                    if parsed.get("target_from") is not None and parsed.get("target_to") is not None
                    else None
                ),
            }

    # Cash corridor bps from official prints
    corridor: dict[str, float | None] = {}
    sofr = rates.get("SOFR", {}).get("rate")
    effr = rates.get("EFFR", {}).get("rate")
    if sofr is not None and effr is not None:
        corridor["sofr_effr_bps"] = round((float(sofr) - float(effr)) * 100, 2)

    result = {
        "rates": rates,
        "sofr_avg": sofr_avg,
        "target": target,
        "corridor": corridor,
        "as_of": as_of,
        "source": "NYFed Markets API",
        "stale": False,
        "note": (
            "Official NY Fed prints: rate, 1/25/75/99th percentiles, volume $bn. "
            "EFFR includes FOMC target range. SOFRAI = 30/90/180d averages + index."
        ),
    }
    _CACHE["ts"] = now
    _CACHE["data"] = result
    return result
