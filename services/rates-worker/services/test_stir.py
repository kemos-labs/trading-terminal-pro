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
    # Constant 4% SOFR for a short window → ~4% compounded
    start = date(2024, 9, 18)
    end = date(2024, 9, 25)
    by = {}
    d = start
    from datetime import timedelta

    while d < end:
        by[d.isoformat()] = 4.0
        d += timedelta(days=1)
    # also need prior Friday for any weekend fill — not needed if all days filled
    r = compound_sofr_rate(by, start, end)
    assert r is not None
    assert abs(r - 4.0) < 0.02


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
