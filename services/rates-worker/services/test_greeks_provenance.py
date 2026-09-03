"""Structural provenance stamps for Greeks model grids.

Covers services/greeks_provenance.py: every interpolated grid carries a
machine-readable provenance object (kind/method/derived source/observed
quote fields + snapshot timestamp/units/nullability), and the validator
rejects grids without one.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.greeks_provenance import (
    attach_surface_provenance,
    surface_grid_provenance,
    validate_surface_provenance,
)


def test_provenance_stamp_carries_all_structural_fields():
    prov = surface_grid_provenance("delta", quote_time="2026-09-03T00:00:00+00:00")
    assert prov["kind"] == "interpolated-model"
    assert prov["method"] == "linear+nearest"
    assert "price_source" in prov["derived_source"]
    assert prov["observed_fields"] == ["bid", "ask", "last", "openInterest"]
    assert prov["quote_time"] == "2026-09-03T00:00:00+00:00"
    assert "per-quote event times" in prov["quote_time_note"]
    assert prov["side"] == "otm"
    assert prov["unit"] == "dimensionless"
    assert "null" in prov["nullability"]


def test_provenance_units_per_greek_and_exposure_grids():
    assert surface_grid_provenance("gamma", quote_time=None)["unit"] == "per_dollar"
    assert surface_grid_provenance("theta", quote_time=None)["unit"] == "per_calendar_day"
    assert surface_grid_provenance("vega", quote_time=None)["unit"] == "per_1_vol_point"
    assert surface_grid_provenance("vanna", quote_time=None)["unit"] == "raw_dV_dS_dsigma"
    assert surface_grid_provenance("charm", quote_time=None)["unit"] == "per_calendar_day"
    assert surface_grid_provenance("gex", quote_time=None)["unit"] == "usd_per_1pct_spot_move"


def test_attach_stamps_every_grid():
    grids = {
        "delta": {"T_vals": [], "K_vals": [], "grid": []},
        "gex": {"T_vals": [], "K_vals": [], "grid": []},
    }
    out = attach_surface_provenance(grids, quote_time="t")
    assert out is grids
    for grid in grids.values():
        assert validate_surface_provenance(grid) == []


def test_validator_flags_missing_or_wrong_provenance():
    assert validate_surface_provenance(None) == ["grid is not an object"]
    assert validate_surface_provenance({"T_vals": []}) == [
        "provenance missing: grid carries no structural provenance"
    ]
    bad = {"provenance": {"kind": "observed", "method": "linear+nearest"}}
    violations = validate_surface_provenance(bad)
    assert any("kind" in v for v in violations)
    assert any("derived_source" in v for v in violations)
    # A grid mislabeled as observed quotes must never validate.
    assert bad["provenance"]["kind"] != "interpolated-model"
