"""Unit tests for MoF JGB curve parsing (no network)."""
from services.jgb_curve import (
    TENOR_LABELS,
    _parse_imperial_date,
    _parse_mof_rows,
    _nearest_on_or_before,
)
from datetime import date


def test_imperial_dates():
    assert _parse_imperial_date("R8.7.10") == date(2026, 7, 10)
    assert _parse_imperial_date("H31.4.1") == date(2019, 4, 1)
    assert _parse_imperial_date("S49.9.24") == date(1974, 9, 24)
    assert _parse_imperial_date("-") is None


def test_parse_mof_rows_newest_first():
    sample = (
        "header junk\n"
        "基準日,1年,2年,3年,4年,5年,6年,7年,8年,9年,10年,15年,20年,25年,30年,40年\n"
        "R7.7.10,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0,1.1,1.5,1.8,2.0,2.1,2.2\n"
        "R8.7.10,1.164,1.4,1.554,1.777,1.959,2.099,2.255,2.421,2.572,2.711,3.286,3.632,3.889,3.883,3.782\n"
    )
    rows = _parse_mof_rows(sample)
    assert len(rows) == 2
    assert rows[0]["as_of"] == "2026-07-10"
    assert rows[0]["yields"][0] == 1.164
    assert rows[0]["yields"][9] == 2.711  # 10Y
    assert len(rows[0]["yields"]) == len(TENOR_LABELS)


def test_nearest_on_or_before():
    rows = [
        {"as_of": "2026-07-10", "yields": [1.0] * 15},
        {"as_of": "2025-07-09", "yields": [0.5] * 15},
        {"as_of": "2025-06-01", "yields": [0.4] * 15},
    ]
    hit = _nearest_on_or_before(rows, date(2025, 7, 10))
    assert hit is not None
    assert hit["as_of"] == "2025-07-09"
