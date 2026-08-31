import httpx
import os
import time
from pathlib import Path
from dotenv import load_dotenv

# Load .env from this package dir first (services/rates-worker/.env), then cwd.
_PKG_ENV = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_PKG_ENV, override=False)
load_dotenv(override=False)

FRED_API_KEY = os.getenv("FRED_API_KEY")
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"

# Public /api/macro/series/{id} and fetch_series only accept this allowlist.
# Prevents unauthenticated FRED key hammering via arbitrary series_id.
FRED_SERIES_ALLOWLIST = frozenset({
    # Money markets / corridor
    "SOFR", "DFF", "IORB", "OBFR",
    "TSFR1M", "TSFR3M", "TSFR6M",
    "RRPONTSYD", "WRESBAL", "WALCL",
    # UST CMT + T-bill secondary market
    "DGS1MO", "DGS3MO", "DGS6MO", "DGS1", "DGS2", "DGS5", "DGS10", "DGS20", "DGS30",
    "DTB3", "DTB6", "DTB1YR",
    "T10Y2Y", "T10Y3M",
    # Macro summary
    "CPIAUCSL", "CPILFESL", "PCEPILFE", "PAYEMS", "UNRATE", "RSAFS", "HOUST",
    # Stress pack
    "VIXCLS", "BAMLH0A0HYM2", "BAMLC0A0CM", "T5YIE", "T10YIE", "DFII10",
    "DTWEXBGS", "NFCI",
})


def is_fred_series_allowed(series_id: str) -> bool:
    return (series_id or "").upper() in FRED_SERIES_ALLOWLIST


# Stale emergency only — never mix silently with live. Keys must match real FRED IDs.
# Short Tsy bills: DGS1MO / DGS3MO / DGS6MO (NOT DGS1M — that series does not exist).
FALLBACK_DATA = {
    "SOFR": 3.62,
    "DFF": 3.63,
    "DGS2": 4.19,
    "DGS5": 4.27,
    "DGS10": 4.55,
    "DGS30": 5.05,
    "DGS1MO": 3.69,
    "DGS3MO": 3.86,
    "DGS6MO": 3.99,
    "DGS1": 4.06,
    "DGS20": 5.05,
    "T10Y2Y": 0.35,
    "T10Y3M": 0.69,
    "TSFR1M": 4.31,
    "TSFR3M": 4.28,
    "TSFR6M": 4.19,
    "BAMLH0A0HYM2": 312.0,
    "BAMLC0A0CM": 98.0,
    "IORB": 3.65,
}

_cache = {}
CACHE_TTL = 900

# Per-series provenance from last successful get_latest call
_last_meta: dict[str, dict] = {}


async def fetch_series(series_id: str, limit: int = 500) -> list:
    series_id = (series_id or "").upper().strip()
    if not is_fred_series_allowed(series_id):
        print(f"FRED fetch blocked (not allowlisted): {series_id}")
        return []

    cache_key = f"{series_id}_{limit}"
    now = time.time()
    if cache_key in _cache and now - _cache[cache_key]["time"] < CACHE_TTL:
        return _cache[cache_key]["data"]

    if not FRED_API_KEY:
        print(f"FRED fetch skipped for {series_id}: no FRED_API_KEY")
        return []

    params = {
        "series_id": series_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "sort_order": "desc",
        "limit": limit,
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(FRED_BASE, params=params)
            data = response.json()
    except Exception as e:
        print(f"FRED fetch error for {series_id}: {e}")
        return []

    if data.get("error_code") or data.get("error_message"):
        print(f"FRED error for {series_id}: {data.get('error_message') or data.get('error_code')}")
        return []

    observations = data.get("observations", [])
    result = [
        {"date": o["date"], "value": float(o["value"])}
        for o in observations
        if o.get("value") not in (".", "", None)
        and o.get("value", ".") != "."
    ]

    print(f"fetch_series({series_id}, {limit}) -> {len(result)} results, latest: {result[0] if result else 'NONE'}")

    # Only cache successful, non-empty results.
    if result:
        _cache[cache_key] = {"data": result, "time": now}
    return result


async def get_latest(series_id: str, allow_fallback: bool = False) -> float | None:
    """
    Return latest FRED observation value. Records provenance in _last_meta.

    Fail-closed by default: never inject hardcoded FALLBACK_DATA unless the
    caller explicitly passes allow_fallback=True (debug/emergency only).
    """
    data = await fetch_series(series_id, limit=500)
    if data:
        _last_meta[series_id] = {
            "source": "FRED",
            "obs_date": data[0]["date"],
            "value": data[0]["value"],
            "fallback": False,
        }
        print(f"{series_id} -> {data[0]['value']} ({data[0]['date']})")
        return data[0]["value"]

    if allow_fallback:
        fallback = FALLBACK_DATA.get(series_id)
        if fallback is not None:
            _last_meta[series_id] = {
                "source": "fallback",
                "obs_date": None,
                "value": fallback,
                "fallback": True,
            }
            print(f"{series_id} -> FALLBACK {fallback}")
            return fallback

    _last_meta[series_id] = {
        "source": "unavailable",
        "obs_date": None,
        "value": None,
        "fallback": False,
    }
    print(f"{series_id} -> NULL (no fallback)")
    return None


def get_meta(series_id: str) -> dict:
    return _last_meta.get(series_id, {"source": "unknown", "obs_date": None, "fallback": False})


def any_fallback(series_ids: list[str]) -> bool:
    return any(get_meta(s).get("fallback") for s in series_ids)


def source_label(series_ids: list[str]) -> str:
    if not series_ids:
        return "unknown"
    if any_fallback(series_ids):
        live = sum(1 for s in series_ids if get_meta(s).get("source") == "FRED")
        return f"FRED+fallback ({live}/{len(series_ids)} live)"
    if all(get_meta(s).get("source") == "FRED" for s in series_ids):
        return "FRED"
    return "mixed"
