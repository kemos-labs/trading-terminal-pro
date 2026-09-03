"""Structural provenance for Greeks model grids.

Only bid/ask/last provider quotes may be called observed. Everything the
worker publishes beyond raw quotes is either *derived* (per-contract BSM
values solved from a quote) or *model* (interpolated grids). This module is
the single authority that stamps interpolated grids with their provenance so
the contract is structural (emitted, validated, and rendered) rather than a
narrative note.
"""

from __future__ import annotations

MODEL_KIND = "interpolated-model"
MODEL_METHOD = "linear+nearest"

GREEK_UNITS: dict[str, str] = {
    "delta": "dimensionless",
    "gamma": "per_dollar",
    "theta": "per_calendar_day",
    "vega": "per_1_vol_point",
    "charm": "per_calendar_day",
    "vanna": "raw_dV_dS_dsigma",
}

EXPOSURE_UNITS: dict[str, str] = {
    "gex": "usd_per_1pct_spot_move",
    "charm": "usd_per_calendar_day",
}

OBSERVED_QUOTE_FIELDS: list[str] = ["bid", "ask", "last", "openInterest"]

QUOTE_TIME_NOTE = (
    "chain snapshot time; yfinance exposes no per-quote event times, "
    "so one snapshot time covers all quotes in the chain"
)


def surface_grid_provenance(greek_key: str, *, quote_time: str | None) -> dict:
    """Build the provenance stamp for one interpolated model grid."""
    unit = GREEK_UNITS.get(greek_key, EXPOSURE_UNITS.get(greek_key, "unknown"))
    return {
        "kind": MODEL_KIND,
        "method": MODEL_METHOD,
        "derived_source": "per-contract BSM Greeks (price_source midpoint|last)",
        "observed_fields": list(OBSERVED_QUOTE_FIELDS),
        "quote_time": quote_time,
        "quote_time_note": QUOTE_TIME_NOTE,
        "side": "otm",
        "unit": unit,
        "nullability": "unavailable cells are null; model-grid holes filled via nearest",
    }


def attach_surface_provenance(grids: dict, *, quote_time: str | None) -> dict:
    """Stamp every grid in a {name: grid} mapping with its provenance.

    Mutates each grid dict in place (adding ``provenance``) and returns the
    mapping for chaining. Unknown grid names still get a stamp with unit
    ``unknown`` rather than no stamp.
    """
    for name, grid in grids.items():
        if isinstance(grid, dict):
            grid["provenance"] = surface_grid_provenance(name, quote_time=quote_time)
    return grids


def validate_surface_provenance(grid: dict | None) -> list[str]:
    """Return violation strings when a grid lacks valid structural provenance."""
    if not isinstance(grid, dict):
        return ["grid is not an object"]
    prov = grid.get("provenance")
    if not isinstance(prov, dict):
        return ["provenance missing: grid carries no structural provenance"]
    violations: list[str] = []
    if prov.get("kind") != MODEL_KIND:
        violations.append(f"provenance.kind must be {MODEL_KIND!r}")
    if prov.get("method") != MODEL_METHOD:
        violations.append(f"provenance.method must be {MODEL_METHOD!r}")
    for field in ("derived_source", "side", "unit", "quote_time_note", "nullability"):
        if not prov.get(field):
            violations.append(f"provenance.{field} missing")
    if not isinstance(prov.get("observed_fields"), list) or not prov["observed_fields"]:
        violations.append("provenance.observed_fields must be a non-empty list")
    # Note: price_source/iv_source live on per-contract points, not grids.
    return violations
