"""Unit matrix for compute_greeks — aligns with TS src/lib/options/greeks.units.test.ts."""
import math
import sys
from pathlib import Path

# Allow `python -m pytest services/test_greeks_calculator.py` from macrovol-api/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from datetime import datetime, timezone

from services.greeks_calculator import (
    build_gex_grid,
    build_gex_strikes,
    compute_greeks,
    compute_gex_flip,
    otm_points,
    year_fraction_to_expiry,
    _parse_oi_nullable,
    _point_from_row,
    _positive_price_or_none,
    _POST_CLOSE_T,
)


def test_theta_charm_per_day_vega_per_vol_point():
    g = compute_greeks(100, 100, 0.25, 0.05, 0.01, 0.2, "call")
    assert g is not None
    assert abs(g["theta"]) < 1
    assert abs(g["charm"]) < 0.01
    assert g["theta"] < 0
    assert 0.05 < g["vega"] < 2


def test_otm_points_convention():
    pts = [
        {"K": 90, "type": "put"},
        {"K": 100, "type": "put"},
        {"K": 100, "type": "call"},
        {"K": 110, "type": "call"},
    ]
    out = otm_points(pts, 100)
    keys = {(p["type"], p["K"]) for p in out}
    assert ("put", 90) in keys
    assert ("call", 100) in keys
    assert ("call", 110) in keys
    assert ("put", 100) not in keys


def test_golden_atm_call():
    g = compute_greeks(100, 100, 0.25, 0.05, 0.01, 0.2, "call")
    assert g is not None
    assert abs(g["delta"] - 0.5582) < 1e-3
    assert abs(g["vega"] - 0.1967) < 1e-3
    assert abs(g["theta"] - (-0.0271)) < 1e-3
    assert abs(g["charm"] - (-0.000308)) < 1e-5
    assert abs(g["vanna"] - (-0.0984)) < 1e-3


# Shared golden fixture with TS analytics.test.ts (flipFromSeries).
# Cumulative: -100 → -150 → -140 → +60 → +110 → first −→≥0 cross at 105.
_FLIP_GOLDEN = [
    {"strike": 90, "gex": -100},
    {"strike": 95, "gex": -50},
    {"strike": 100, "gex": 10},
    {"strike": 105, "gex": 200},
    {"strike": 110, "gex": 50},
]


def test_gex_flip_cumulative_golden():
    flip = compute_gex_flip(_FLIP_GOLDEN, spot=100)
    assert flip is not None
    assert flip["strike"] == 105
    assert flip["method"] == "cumulative"
    assert flip["spot_vs_flip"] == "below"  # spot 100 < flip 105
    assert flip["net_gex"] == 110


def test_gex_flip_all_positive_fallback_min_abs_run():
    # No negative→positive cross; min |run| at first strike.
    pts = [
        {"strike": 90, "gex": 50},
        {"strike": 100, "gex": 80},
        {"strike": 110, "gex": 20},
    ]
    flip = compute_gex_flip(pts, spot=100)
    assert flip is not None
    assert flip["strike"] == 90


def test_gex_flip_empty():
    assert compute_gex_flip([], spot=100) is None


def test_year_fraction_to_expiry_future_day():
    # Far future close → T roughly days/365.25
    now = datetime(2026, 1, 1, 15, 0, 0, tzinfo=timezone.utc)
    T = year_fraction_to_expiry("2026-02-01", now=now)
    assert T > 20 / 365.25
    assert T < 40 / 365.25


def test_year_fraction_to_expiry_expired_is_residual():
    now = datetime(2026, 6, 1, 20, 0, 0, tzinfo=timezone.utc)
    T = year_fraction_to_expiry("2020-01-01", now=now)
    assert T <= _POST_CLOSE_T * 2


# ── P0: missing OI nullability (never coerced to observed zero) ─────────────

def test_parse_oi_nullable_missing_stays_none():
    assert _parse_oi_nullable(None) is None
    assert _parse_oi_nullable("") is None
    assert _parse_oi_nullable("   ") is None
    assert _parse_oi_nullable(float("nan")) is None
    assert _parse_oi_nullable(float("inf")) is None
    assert _parse_oi_nullable(True) is None
    assert _parse_oi_nullable(-5) is None
    assert _parse_oi_nullable("abc") is None


def test_parse_oi_nullable_observed_zero_stays_zero():
    assert _parse_oi_nullable(0) == 0.0
    assert _parse_oi_nullable(0.0) == 0.0
    assert _parse_oi_nullable("0") == 0.0
    assert _parse_oi_nullable(1234) == 1234.0


def test_point_missing_oi_stays_null_not_zero():
    row = {"strike": 100, "bid": 2.0, "ask": 2.4, "lastPrice": 2.2, "openInterest": None}
    pt = _point_from_row(row, spot=100, T=0.25, r=0.04, q=0.0, option_type="call")
    assert pt is not None
    assert pt["oi"] is None
    assert pt["price_source"] == "midpoint"
    # Missing OI must not leak into GEX aggregates as zero.
    assert build_gex_strikes([pt], spot=100) == []
    assert build_gex_grid([pt] * 12, spot=100) == {"T_vals": [], "K_vals": [], "grid": []}


def test_point_observed_zero_oi_preserved():
    row = {"strike": 100, "bid": 2.0, "ask": 2.4, "lastPrice": 2.2, "openInterest": 0}
    pt = _point_from_row(row, spot=100, T=0.25, r=0.04, q=0.0, option_type="call")
    assert pt is not None
    assert pt["oi"] == 0.0


# ── P0: last-versus-midpoint provenance ─────────────────────────────────────

def test_point_midpoint_provenance():
    row = {"strike": 100, "bid": 2.0, "ask": 2.4, "lastPrice": 9.9, "openInterest": 10}
    pt = _point_from_row(row, spot=100, T=0.25, r=0.04, q=0.0, option_type="call")
    assert pt is not None
    assert pt["price_source"] == "midpoint"
    assert pt["iv_source"] == "midpoint"
    assert pt["bid"] == 2.0
    assert pt["ask"] == 2.4
    assert abs(pt["price"] - 2.2) < 1e-9


def test_point_last_fallback_provenance_not_midpoint():
    # No two-sided market: bid missing, ask missing -> last-derived, never midpoint.
    row = {"strike": 100, "bid": 0, "ask": 0, "lastPrice": 2.2, "openInterest": 10}
    pt = _point_from_row(row, spot=100, T=0.25, r=0.04, q=0.0, option_type="call")
    assert pt is not None
    assert pt["price_source"] == "last"
    assert pt["iv_source"] == "last"
    assert pt["bid"] is None
    assert pt["ask"] is None
    assert pt["last"] == 2.2


def test_point_one_sided_quote_falls_back_to_last():
    # One-sided (bid only) is not executable two-sided: must not claim midpoint.
    row = {"strike": 100, "bid": 2.0, "ask": 0, "lastPrice": 2.2, "openInterest": 10}
    pt = _point_from_row(row, spot=100, T=0.25, r=0.04, q=0.0, option_type="call")
    assert pt is not None
    assert pt["price_source"] == "last"


def test_point_no_price_unavailable():
    row = {"strike": 100, "bid": 0, "ask": 0, "lastPrice": 0, "openInterest": 10}
    assert _point_from_row(row, spot=100, T=0.25, r=0.04, q=0.0, option_type="call") is None


def test_positive_price_rejects_non_executable():
    assert _positive_price_or_none(0) is None
    assert _positive_price_or_none(-1) is None
    assert _positive_price_or_none(float("nan")) is None
    assert _positive_price_or_none(None) is None
    assert _positive_price_or_none(2.5) == 2.5
