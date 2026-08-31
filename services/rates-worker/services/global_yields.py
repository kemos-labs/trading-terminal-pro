"""
Global sovereign 10Y yields (US / DE / UK / FR / JP) via FRED long-term series.

Fail-closed: missing observations stay null; no synthetic yields.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from services.fred_client import get_latest, get_meta

# FRED long-term government bond yields (%). JP also available via MoF JGB board.
SERIES = (
    ("US", "DGS10", "U.S. 10Y CMT"),
    ("DE", "IRLTLT01DEM156N", "Germany 10Y"),
    ("UK", "IRLTLT01GBM156N", "U.K. 10Y"),
    ("FR", "IRLTLT01FRM156N", "France 10Y"),
    ("JP", "IRLTLT01JPM156N", "Japan 10Y"),
)


async def build_global_yields() -> dict[str, Any]:
    """Latest 10Y sovereign yields for multi-curve context board."""
    rows: list[dict[str, Any]] = []
    field_src: dict[str, str] = {}
    obs_dates: dict[str, str | None] = {}

    for code, series_id, label in SERIES:
        try:
            val = await get_latest(series_id, allow_fallback=False)
        except Exception:
            val = None
        y = None
        if val is not None:
            try:
                y = float(val)
            except (TypeError, ValueError):
                y = None
        meta = get_meta(series_id) or {}
        src = meta.get("source") or "FRED"
        obs = meta.get("obs_date")
        rows.append(
            {
                "code": code,
                "label": label,
                "series_id": series_id,
                "yield_pct": round(y, 4) if y is not None else None,
                "obs_date": obs,
                "source": src,
            }
        )
        field_src[code] = src
        obs_dates[code] = obs if isinstance(obs, str) else None

    live = [r for r in rows if r.get("yield_pct") is not None]
    us = next((r for r in rows if r["code"] == "US"), None)
    us_y = us.get("yield_pct") if us else None
    spreads: list[dict[str, Any]] = []
    if us_y is not None:
        for r in rows:
            if r["code"] == "US" or r.get("yield_pct") is None:
                continue
            spreads.append(
                {
                    "pair": f"{r['code']}-US",
                    "bps": round((float(r["yield_pct"]) - float(us_y)) * 100, 1),
                    "foreign": r["code"],
                }
            )

    return {
        "points": rows,
        "spreads_vs_us_bps": spreads,
        "count_live": len(live),
        "field_source": field_src,
        "obs_dates": obs_dates,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": "FRED",
        "note": "Long-term government bond yields (monthly for DE/UK/FR/JP; daily DGS10). Fail-closed.",
        "error": None if live else "no_live_yields",
    }
