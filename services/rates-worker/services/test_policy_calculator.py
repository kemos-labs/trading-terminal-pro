"""Focused tests for the REF-08/N3c policy-scenario calculator.

Golden vectors use independent inline arithmetic (never the module under
test) except where explicitly noted as wiring checks against
compound_sofr_rate. Weekend/holiday/leap semantics are inherited from
stir.py and verified here through reuse, not reimplementation.
"""
import math

import pytest

from services.policy_calculator import (
    PolicyScenarioError,
    calculate_policy_scenario,
)


def _payload(**overrides):
    base = {
        "fixings": [
            {"date": "2026-01-02", "value": 5.0},
            {"date": "2026-01-05", "value": 5.2},
        ],
        "meetings": [],
    }
    base.update(overrides)
    return base


def test_no_meetings_short_window_exact():
    # Single business day Mon 2026-01-05 fixing 5.0 over [Mon, Tue): R == 5.0.
    result = calculate_policy_scenario(_payload(
        fixings=[{"date": "2026-01-05", "value": 5.0}],
        sr3={"windowStart": "2026-01-05", "windowEnd": "2026-01-06"},
    ))
    assert result["sr3"]["predictedRate"] == pytest.approx(5.0, abs=1e-9)
    assert result["sr3"]["status"] == "ok"
    assert result["sr3"]["currentRate"] is None
    assert result["sr3"]["differenceBps"] is None
    assert result["policySpreadBps"] is None
    assert result["policySpreadProvenance"] == "unavailable-not-supplied"


def test_weekend_carry_reuse_vector():
    # Reuse of the stir.py weekend vector: Fri 5.0 (n=3) + Mon 5.2 (n=1),
    # D=4 → 5.0505 (wrong daily form would give 5.0511).
    result = calculate_policy_scenario(_payload(
        sr3={"windowStart": "2026-01-02", "windowEnd": "2026-01-06"},
    ))
    predicted = result["sr3"]["predictedRate"]
    assert predicted == pytest.approx(5.0505, abs=5e-4)
    assert abs(predicted - 5.0511) > 2e-4


def test_holiday_carry_reuse_vector():
    # Tue 2026-01-06 5.1 covers Tue+Wed holiday (n=2); Thu 5.3 (n=1); D=3.
    result = calculate_policy_scenario(_payload(
        fixings=[
            {"date": "2026-01-06", "value": 5.1},
            {"date": "2026-01-08", "value": 5.3},
        ],
        sr3={"windowStart": "2026-01-06", "windowEnd": "2026-01-09"},
    ))
    assert result["sr3"]["predictedRate"] == pytest.approx(5.1672, abs=5e-4)


def test_scenario_tail_step_independent_arithmetic():
    # Window Mon 01-05 → Fri 01-09. Business days Mon, Tue, Thu (Wed holiday).
    # Observed Mon 5.0, Tue 5.0; meeting Thu 01-08 +10bp makes Thu scenario 5.1.
    # Independent expected: Π = (1+.05/360)(1+.05·2/360)(1+.051/360), D=4.
    result = calculate_policy_scenario(_payload(
        fixings=[
            {"date": "2026-01-05", "value": 5.0},
            {"date": "2026-01-06", "value": 5.0},
        ],
        meetings=[{"date": "2026-01-08", "stepBps": 10}],
        sr3={"windowStart": "2026-01-05", "windowEnd": "2026-01-09"},
    ))
    product = (1 + 0.05 / 360.0) * (1 + 0.05 * 2 / 360.0) * (1 + 0.051 / 360.0)
    expected = (product - 1.0) * 360.0 / 4 * 100.0
    assert result["sr3"]["predictedRate"] == pytest.approx(expected, abs=1e-4)
    line = {row["date"]: row for row in result["fixingLine"]}
    assert line["2026-01-06"]["provenance"] == "observed"
    assert line["2026-01-08"]["provenance"] == "scenario"
    assert line["2026-01-08"]["observedValue"] is None
    assert line["2026-01-08"]["scenarioValue"] == pytest.approx(5.1, abs=1e-9)
    assert line["2026-01-08"]["cumulativeStepBps"] == pytest.approx(10.0)


def test_scenario_tail_weekend_publication_interval_law():
    # F1 regression: Fri 2026-01-02 observed 5.0, meeting same Fri +10bp,
    # window Fri -> Tue (2026-01-02 -> 2026-01-06). Only Fri and Mon are
    # publications; the Fri fixing carries the 3-day weekend interval.
    # Law-consistent expected: Π = (1+.05·3/360)(1+.051/360), D=4.
    result = calculate_policy_scenario(_payload(
        fixings=[{"date": "2026-01-02", "value": 5.0}],
        meetings=[{"date": "2026-01-02", "stepBps": 10}],
        sr3={"windowStart": "2026-01-02", "windowEnd": "2026-01-06"},
    ))
    product = (1 + 0.05 * 3 / 360.0) * (1 + 0.051 / 360.0)
    expected = (product - 1.0) * 360.0 / 4 * 100.0
    assert result["sr3"]["predictedRate"] == pytest.approx(expected, abs=1e-4)
    assert result["sr3"]["predictedRate"] == pytest.approx(5.0255, abs=5e-4)
    # The old erroneous daily-publication form injected synthetic Sat/Sun
    # fixings: Π_old = (1+.05/360)(1+.051/360)^3, D=4 (≈5.0761, +5bp wrong).
    product_old = (1 + 0.05 / 360.0) * (1 + 0.051 / 360.0) ** 3
    old_wrong = (product_old - 1.0) * 360.0 / 4 * 100.0
    assert old_wrong == pytest.approx(5.0761, abs=5e-4)
    assert abs(result["sr3"]["predictedRate"] - old_wrong) > 0.02


def test_scenario_tail_holiday_publication_interval_law():
    # F1 regression: Tue 2026-01-06 observed 5.1, meeting same Tue +10bp,
    # Wed 2026-01-07 is a recognized holiday, window Tue -> Fri
    # (2026-01-06 -> 2026-01-09). Only Tue and Thu are publications; the
    # Tue fixing carries the 2-day Tue+holiday interval.
    # Law-consistent expected: Π = (1+.051·2/360)(1+.052/360), D=3.
    result = calculate_policy_scenario(_payload(
        fixings=[{"date": "2026-01-06", "value": 5.1}],
        meetings=[{"date": "2026-01-06", "stepBps": 10}],
        sr3={"windowStart": "2026-01-06", "windowEnd": "2026-01-09"},
    ))
    product = (1 + 0.051 * 2 / 360.0) * (1 + 0.052 / 360.0)
    expected = (product - 1.0) * 360.0 / 3 * 100.0
    assert result["sr3"]["predictedRate"] == pytest.approx(expected, abs=1e-4)
    assert result["sr3"]["predictedRate"] == pytest.approx(5.1338, abs=5e-4)
    # Old erroneous form injected a synthetic Wed-holiday publication:
    # Π_old = (1+.051/360)(1+.052/360)^2, D=3 (≈5.1674, +3bp wrong).
    product_old = (1 + 0.051 / 360.0) * (1 + 0.052 / 360.0) ** 2
    old_wrong = (product_old - 1.0) * 360.0 / 3 * 100.0
    assert old_wrong == pytest.approx(5.1674, abs=5e-4)
    assert abs(result["sr3"]["predictedRate"] - old_wrong) > 0.02


def test_scenario_tail_matches_compound_sofr_rate_wiring():
    # Equivalent integration assertion: the scenario tail feeds
    # compound_sofr_rate exactly the law-built publication dict (business
    # days only), so the calculator agrees with a direct call.
    from datetime import date as _date

    from services.stir import compound_sofr_rate as _compound

    result = calculate_policy_scenario(_payload(
        fixings=[{"date": "2026-01-02", "value": 5.0}],
        meetings=[{"date": "2026-01-02", "stepBps": 10}],
        sr3={"windowStart": "2026-01-02", "windowEnd": "2026-01-06"},
    ))
    direct = _compound(
        {"2026-01-02": 5.0, "2026-01-05": 5.1},
        _date(2026, 1, 2),
        _date(2026, 1, 6),
    )
    assert direct is not None
    assert result["sr3"]["predictedRate"] == pytest.approx(direct, abs=1e-9)


def test_midpoint_first_meeting_without_baseline_fails_closed():
    # F4 decision: deriveStepFromMidpoint must never default a first
    # meeting (bounds but no prior midpoint) to stepBps 0.0. Fail closed
    # with a typed error unless an explicit baseline/step is supplied.
    with pytest.raises(PolicyScenarioError, match="never.*defaulted|fail-closed"):
        calculate_policy_scenario(_payload(
            fixings=[{"date": "2026-01-05", "value": 5.0}],
            meetings=[{"date": "2026-01-28", "targetLower": 4.25, "targetUpper": 4.5}],
            deriveStepFromMidpoint=True,
        ))


def test_observed_history_never_rewritten_by_steps():
    # Full observed coverage; a meeting inside the window must not rewrite it.
    fixings = [
        {"date": "2026-01-02", "value": 5.0},
        {"date": "2026-01-05", "value": 5.2},
    ]
    plain = calculate_policy_scenario(_payload(
        fixings=fixings,
        sr3={"windowStart": "2026-01-02", "windowEnd": "2026-01-06"},
    ))
    stepped = calculate_policy_scenario(_payload(
        fixings=fixings,
        meetings=[{"date": "2026-01-05", "stepBps": -25}],
        sr3={"windowStart": "2026-01-02", "windowEnd": "2026-01-06"},
    ))
    assert stepped["sr3"]["predictedRate"] == plain["sr3"]["predictedRate"]
    line = {row["date"]: row for row in stepped["fixingLine"]}
    assert line["2026-01-05"]["scenarioValue"] == pytest.approx(5.2, abs=1e-9)
    assert line["2026-01-05"]["provenance"] == "observed"


def test_missing_fixing_returns_unavailable_with_warning():
    result = calculate_policy_scenario(_payload(
        fixings=[{"date": "2026-01-05", "value": 5.0}],
        sr3={"windowStart": "2026-01-05", "windowEnd": "2026-01-09"},
    ))
    assert result["sr3"]["predictedRate"] is None
    assert result["sr3"]["status"] == "unavailable"
    assert any("missing required business-day" in w for w in result["sr3"]["warnings"])


def test_exact_zero_difference_is_valid():
    result = calculate_policy_scenario(_payload(
        fixings=[{"date": "2026-01-05", "value": 5.0}],
        sr3={
            "windowStart": "2026-01-05",
            "windowEnd": "2026-01-06",
            "currentRate": 5.0,
            "currentSource": "synthetic-fixture",
            "currentDate": "2026-01-05",
        },
    ))
    assert result["sr3"]["differenceBps"] == 0.0
    assert result["sr3"]["differenceBps"] is not None


def test_difference_bps_units():
    result = calculate_policy_scenario(_payload(
        fixings=[{"date": "2026-01-05", "value": 5.0}],
        sr3={
            "windowStart": "2026-01-05",
            "windowEnd": "2026-01-06",
            "currentRate": 4.75,
            "currentSource": "synthetic-fixture",
            "currentDate": "2026-01-05",
        },
    ))
    assert result["sr3"]["differenceBps"] == pytest.approx(25.0, abs=1e-6)


def test_sr1_monthly_window_and_spread_override():
    result = calculate_policy_scenario(_payload(
        fixings=[
            {"date": "2026-01-05", "value": 5.0},
            {"date": "2026-01-06", "value": 5.0},
        ],
        sr1={
            "windowStart": "2026-01-05",
            "windowEnd": "2026-01-06",
            "currentRate": 4.9,
            "currentSource": "synthetic-fixture",
            "currentDate": "2026-01-05",
        },
        policySpreadBps=-12.5,
    ))
    assert result["sr1"]["predictedRate"] == pytest.approx(5.0, abs=1e-9)
    assert result["sr1"]["differenceBps"] == pytest.approx(10.0, abs=1e-6)
    assert result["policySpreadBps"] == pytest.approx(-12.5)
    assert result["policySpreadProvenance"] == "explicit-scenario-override"


def test_midpoint_step_never_inferred_by_default():
    with pytest.raises(PolicyScenarioError, match="never inferred"):
        calculate_policy_scenario(_payload(
            fixings=[{"date": "2026-01-05", "value": 5.0}],
            meetings=[{"date": "2026-01-28", "targetLower": 4.25, "targetUpper": 4.5}],
        ))


def test_midpoint_derivation_labelled_when_explicit():
    # First meeting carries an explicit baseline step; the second meeting's
    # step is derived from the midpoint difference and labelled.
    result = calculate_policy_scenario(_payload(
        fixings=[{"date": "2026-01-05", "value": 5.0}],
        meetings=[
            {"date": "2026-01-28", "stepBps": 10, "targetLower": 4.25, "targetUpper": 4.5},
            {"date": "2026-03-18", "targetLower": 4.0, "targetUpper": 4.25},
        ],
        deriveStepFromMidpoint=True,
    ))
    line = {row["date"]: row for row in result["fixingLine"]}
    # Derived second step: (4.125 - 4.375) * 100 = -25bp; cumulative adds
    # the explicit baseline +10bp.
    assert line["2026-03-18"]["cumulativeStepBps"] == pytest.approx(-15.0, abs=1e-9)
    assert any("midpoint" in a for a in result["assumptions"])


def test_current_rate_requires_source_and_date():
    with pytest.raises(PolicyScenarioError, match="explicit currentSource and currentDate"):
        calculate_policy_scenario(_payload(
            fixings=[{"date": "2026-01-05", "value": 5.0}],
            sr3={"windowStart": "2026-01-05", "windowEnd": "2026-01-06", "currentRate": 5.0},
        ))


def test_rejects_nonfinite_and_out_of_range():
    with pytest.raises(PolicyScenarioError, match="finite"):
        calculate_policy_scenario(_payload(
            fixings=[{"date": "2026-01-05", "value": float("nan")}],
        ))
    with pytest.raises(PolicyScenarioError, match="finite"):
        calculate_policy_scenario(_payload(
            fixings=[{"date": "2026-01-05", "value": float("inf")}],
        ))
    with pytest.raises(PolicyScenarioError, match="stepBps"):
        calculate_policy_scenario(_payload(
            meetings=[{"date": "2026-01-28", "stepBps": float("nan")}],
        ))
    with pytest.raises(PolicyScenarioError, match="YYYY-MM-DD"):
        calculate_policy_scenario(_payload(fixings=[{"date": "01/05/2026", "value": 5.0}]))
    with pytest.raises(PolicyScenarioError, match="non-empty array"):
        calculate_policy_scenario(_payload(fixings=[]))


def test_all_numerics_finite_or_null():
    result = calculate_policy_scenario(_payload(
        fixings=[
            {"date": "2026-01-02", "value": 5.0},
            {"date": "2026-01-05", "value": 5.2},
        ],
        meetings=[{"date": "2026-01-28", "stepBps": -25, "targetLower": 4.25, "targetUpper": 4.5}],
        sr3={"windowStart": "2026-01-02", "windowEnd": "2026-01-06"},
        sr1={"windowStart": "2026-01-05", "windowEnd": "2026-01-06"},
        policySpreadBps=3.0,
    ))

    def check(value):
        if isinstance(value, float):
            assert math.isfinite(value), f"non-finite float: {value}"
        elif isinstance(value, dict):
            for nested in value.values():
                check(nested)
        elif isinstance(value, list):
            for nested in value:
                check(nested)

    check(result)
