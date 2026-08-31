"""Unit tests for SR3 strip builder + FRED SOFR compound settlement."""
from datetime import date

from services.stir import (
    build_sr3_contracts,
    compound_sofr_rate,
    fill_settled_sr3,
    reference_quarter,
    third_wednesday,
)
from services.rate_risk import _contract_sort_key


def test_third_wednesday_imm():
    assert third_wednesday(2024, 9) == date(2024, 9, 18)
    assert third_wednesday(2026, 6) == date(2026, 6, 17)
    assert third_wednesday(2030, 12) == date(2030, 12, 18)


def test_build_sr3_strip_u24_to_z30():
    contracts = build_sr3_contracts(2024, "U", 2030, "Z")
    assert contracts[0]["label"] == "SR3U4"
    assert contracts[0]["month"] == "Sep 24"
    assert contracts[0]["symbol"] == "SR3U24.CME"
    assert contracts[-1]["label"] == "SR3Z0"
    assert contracts[-1]["month"] == "Dec 30"
    assert contracts[-1]["symbol"] == "SR3Z30.CME"
    # quarterly only: 26 contracts (U24…Z30)
    assert len(contracts) == 26
    labels = [c["label"] for c in contracts]
    assert "SR3H6" in labels  # Mar 26
    assert "SR3M6" in labels  # Jun 26
    assert "SR3Z0" in labels  # Dec 30


def test_contract_sort_key_year_pivot():
    # U24 before M26 before Z30
    assert _contract_sort_key("SR3U4") < _contract_sort_key("SR3M6")
    assert _contract_sort_key("SR3M6") < _contract_sort_key("SR3Z0")
    assert _contract_sort_key("SR3Z0") > _contract_sort_key("SR3U9")


def test_compound_sofr_flat():
    # One fixing (4.0%) covering the whole window (n = D):
    # R = (1 + r·D/360 − 1)·360/D = r exactly.
    start = date(2024, 9, 18)
    end = date(2024, 9, 25)
    by = {start.isoformat(): 4.0}
    r = compound_sofr_rate(by, start, end)
    assert r is not None
    assert abs(r - 4.0) < 1e-9


def test_compound_sofr_daily_publications():
    # A published fixing for EVERY calendar day (n_i = 1 each) compounds as
    # Π(1 + r/360) — the independent expected value is 4.0013336, NOT exactly
    # 4.0 and NOT the interval-collapsed 4.0. Distinguishes daily publications
    # from a single carried fixing.
    start = date(2024, 9, 18)
    end = date(2024, 9, 25)
    by = {}
    from datetime import timedelta

    d = start
    while d < end:
        by[d.isoformat()] = 4.0
        d += timedelta(days=1)
    r = compound_sofr_rate(by, start, end)
    assert r is not None
    assert abs(r - 4.0013) < 5e-4


# ── Golden vectors for the CME Actual/360 interval form ──────────────────────
# Expected values are hand-derived from R = [Π(1 + r_i·n_i/360) − 1]·360/D·100
# with independent high-precision arithmetic; the production function under
# test is never used to produce them.


def test_compound_sofr_consecutive_business_days_changing_fixing():
    # Mon 2026-01-05 fixing 5.0 covers Mon+Tue (n=2); Wed 2026-01-07 fixing 5.5
    # covers Wed (n=1). D=3. Expected 5.1672 (independent Decimal computation).
    by = {
        "2026-01-05": 5.0,
        "2026-01-07": 5.5,
        "2026-01-08": 5.6,  # not in window
    }
    r = compound_sofr_rate(by, date(2026, 1, 5), date(2026, 1, 8))
    assert r is not None
    assert abs(r - 5.1672) < 5e-4


WEEKEND_EXPECTED = 5.0505  # Fri fixing n=3 covers Fri/Sat/Sun; wrong daily form gives 5.0511


def test_compound_sofr_weekend_single_interval():
    # Fri 2026-01-02 fixing 5.0 applies for n=3 calendar days (Fri, Sat, Sun);
    # Mon 2026-01-05 fixing 5.2 applies for n=1. D=4.
    # Weekend/holiday carry-forward must contribute ONE interval factor
    # (1 + r·3/360), NOT three repeated daily factors (1 + r/360)^3.
    by = {
        "2026-01-02": 5.0,
        "2026-01-05": 5.2,
        "2026-01-06": 5.3,  # not in window
    }
    r = compound_sofr_rate(by, date(2026, 1, 2), date(2026, 1, 6))
    assert r is not None
    assert abs(r - WEEKEND_EXPECTED) < 5e-4
    # Distinguish from the wrong repeated-daily compounding (5.0511…):
    assert abs(r - 5.0511) > 2e-4


def test_compound_sofr_market_holiday_no_publication():
    # Tue 2026-01-06 fixing 5.1 covers Tue+Wed (Wed = market holiday, no
    # publication; n=2). Thu 2026-01-08 fixing 5.3 covers Thu (n=1). D=3.
    by = {
        "2026-01-06": 5.1,
        "2026-01-08": 5.3,
        "2026-01-09": 5.4,  # not in window
    }
    r = compound_sofr_rate(by, date(2026, 1, 6), date(2026, 1, 9))
    assert r is not None
    assert abs(r - 5.1672) < 5e-4


def test_compound_sofr_leap_day():
    # Fri 2028-02-25 fixing 4.9 covers Fri/Sat/Sun (n=3); Mon 2028-02-28 fixing
    # 5.0 (n=1); leap day Tue 2028-02-29 fixing 5.1 (n=1); Wed 2028-03-01 fixing
    # 5.2 (n=1). D = 6 actual calendar days including Feb 29.
    by = {
        "2028-02-25": 4.9,
        "2028-02-28": 5.0,
        "2028-02-29": 5.1,
        "2028-03-01": 5.2,
        "2028-03-02": 5.3,  # not in window
    }
    r = compound_sofr_rate(by, date(2028, 2, 25), date(2028, 3, 2))
    assert r is not None
    assert abs(r - 5.0014) < 5e-4


def test_compound_sofr_quarter_boundary():
    # Window crosses the Mar→Apr / Q1→Q2 boundary: Mon 2026-03-30 fixing 5.0,
    # Tue 2026-03-31 fixing 5.05, Wed 2026-04-01 fixing 5.1. D=3, n=(1,1,1).
    by = {
        "2026-03-30": 5.0,
        "2026-03-31": 5.05,
        "2026-04-01": 5.1,
        "2026-04-02": 5.2,  # not in window
    }
    r = compound_sofr_rate(by, date(2026, 3, 30), date(2026, 4, 2))
    assert r is not None
    assert abs(r - 5.0507) < 5e-4


def test_compound_sofr_incomplete_reference_quarter_returns_none():
    # Fixings end 2026-03-31 but the reference quarter runs to 2026-06-17:
    # not fully observed → None, never a partial or synthetic rate.
    by = {"2026-01-02": 5.0, "2026-03-31": 5.1}
    r = compound_sofr_rate(by, date(2026, 1, 2), date(2026, 6, 17))
    assert r is None


def test_compound_sofr_missing_fixing_gap_returns_none():
    # Gap of >14 days between publications (2026-01-05 → 2026-01-27): the
    # carry-forward lookback is exhausted mid-window → None (fail closed).
    by = {"2026-01-05": 5.0, "2026-01-27": 5.4}
    r = compound_sofr_rate(by, date(2026, 1, 5), date(2026, 1, 29))
    assert r is None


def test_compound_sofr_degenerate_windows():
    by = {"2026-01-05": 5.0}
    assert compound_sofr_rate(by, date(2026, 1, 5), date(2026, 1, 5)) is None  # empty window
    assert compound_sofr_rate({}, date(2026, 1, 5), date(2026, 1, 6)) is None  # no data


def test_fill_settled_skips_open_and_live():
    contracts = build_sr3_contracts(2024, "U", 2026, "M")
    rows = [
        {
            "contract": "SR3U4",
            "implied_rate": None,
            "source": "unavailable",
            "last_price": None,
        },
        {
            "contract": "SR3M6",
            "implied_rate": 3.67,
            "source": "live",
            "last_price": 96.33,
        },
    ]
    # Synthetic SOFR flat 5% covering U24 reference quarter
    by_list = []
    d = date(2024, 9, 1)
    from datetime import timedelta

    while d <= date(2024, 12, 31):
        by_list.append({"date": d.isoformat(), "value": 5.0})
        d += timedelta(days=1)

    filled = fill_settled_sr3(rows, contracts, by_list, as_of=date(2026, 7, 10))
    u24 = next(r for r in filled if r["contract"] == "SR3U4")
    m26 = next(r for r in filled if r["contract"] == "SR3M6")
    assert u24["source"] == "settled"
    assert u24["implied_rate"] is not None
    assert abs(u24["implied_rate"] - 5.0) < 0.05
    assert m26["source"] == "live"
    assert m26["implied_rate"] == 3.67


def test_reference_quarter_u24():
    s, e = reference_quarter(2024, "U")
    assert s == date(2024, 9, 18)
    assert e == date(2024, 12, 18)
