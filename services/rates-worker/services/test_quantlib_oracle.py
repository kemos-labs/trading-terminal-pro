"""
Optional QuantLib golden oracle for BS price / greeks.

Install: pip install QuantLib  (or QuantLib-Python)
Skip when unavailable — core suite must not depend on native libs.

Run:
  python3 -m pytest services/test_quantlib_oracle.py -q
  # or
  python3 services/test_quantlib_oracle.py
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

# Allow `python3 services/test_quantlib_oracle.py` from macrovol-api/
_HERE = Path(__file__).resolve().parent
_API_ROOT = _HERE.parent
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))

from services.greeks_calculator import bs_price, compute_greeks  # noqa: E402

try:
    import QuantLib as ql  # type: ignore
except ImportError:  # pragma: no cover
    ql = None


def _ql_bs_greeks(S, K, T, r, q, sigma, opt_type: str):
    """European option via QuantLib AnalyticEuropeanEngine (BSM)."""
    assert ql is not None
    today = ql.Date.todaysDate()
    ql.Settings.instance().evaluationDate = today
    day_count = ql.Actual365Fixed()
    calendar = ql.NullCalendar()
    # Expiry = today + T years via day count (continuous-ish)
    expiry = today + int(round(T * 365.25))
    if expiry <= today:
        expiry = today + 1

    spot = ql.QuoteHandle(ql.SimpleQuote(S))
    flat_ts = ql.YieldTermStructureHandle(ql.FlatForward(today, r, day_count))
    div_ts = ql.YieldTermStructureHandle(ql.FlatForward(today, q, day_count))
    vol_ts = ql.BlackVolTermStructureHandle(
        ql.BlackConstantVol(today, calendar, sigma, day_count)
    )
    process = ql.BlackScholesMertonProcess(spot, div_ts, flat_ts, vol_ts)
    payoff = ql.PlainVanillaPayoff(
        ql.Option.Call if opt_type == "call" else ql.Option.Put, K
    )
    exercise = ql.EuropeanExercise(expiry)
    option = ql.VanillaOption(payoff, exercise)
    option.setPricingEngine(ql.AnalyticEuropeanEngine(process))

    return {
        "price": option.NPV(),
        "delta": option.delta(),
        "gamma": option.gamma(),
        "vega": option.vega() / 100.0,  # QuantLib vega is per 1% → per vol point
        "theta": option.theta() / 365.0,  # annual θ → per calendar day (desk)
    }


CASES = [
    ("call", 100.0, 100.0, 0.25, 0.05, 0.01, 0.20),
    ("put", 100.0, 95.0, 0.5, 0.04, 0.02, 0.25),
    ("call", 450.0, 460.0, 30 / 365.0, 0.045, 0.012, 0.18),
]


def test_quantlib_available_or_skip():
    if ql is None:
        import pytest

        pytest.skip("QuantLib not installed")


def test_price_and_greeks_vs_quantlib():
    if ql is None:
        import pytest

        pytest.skip("QuantLib not installed")

    for opt_type, S, K, T, r, q, sigma in CASES:
        ours_price = bs_price(S, K, T, r, q, sigma, opt_type)
        ours = compute_greeks(S, K, T, r, q, sigma, opt_type)
        assert ours is not None
        ref = _ql_bs_greeks(S, K, T, r, q, sigma, opt_type)
        # Price within a few cents (day-count / expiry date discretization)
        assert abs(ours_price - ref["price"]) < 0.05, (opt_type, ours_price, ref["price"])
        assert abs(ours["delta"] - ref["delta"]) < 0.01
        assert abs(ours["gamma"] - ref["gamma"]) < 5e-4
        assert abs(ours["vega"] - ref["vega"]) < 0.02
        # Theta day-count can differ slightly
        assert abs(ours["theta"] - ref["theta"]) < 0.05


def test_our_greeks_finite_without_quantlib():
    """Always runs — no QuantLib required."""
    g = compute_greeks(100, 100, 0.25, 0.05, 0.01, 0.2, "call")
    assert g is not None
    assert math.isfinite(g["delta"]) and 0 < g["delta"] < 1


if __name__ == "__main__":
    test_our_greeks_finite_without_quantlib()
    print("core greeks ok")
    if ql is None:
        print("QuantLib not installed — oracle skipped (pip install QuantLib)")
    else:
        test_price_and_greeks_vs_quantlib()
        print("QuantLib oracle ok")
