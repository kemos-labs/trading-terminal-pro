"""Golden tests: SERFF classification (C0.1) and interpolate_r nullability (C0.2).

SERFF law: CME SERFF is the same-delivery-month One-Month SOFR vs 30-Day Federal
Funds inter-commodity spread — SR1 − ZQ, ratio 1:1. Four-leg SR3 calendars are
calendar-of-calendars structures (never SERFF); SR3 − ZQ is a different spread
family; SR1/SR3 implied − cash EFFR rows are Derived Proxies (non-listed,
non-executable), never SERFF. Missing exact leg → SERFF Unavailable (null), no
synthetic substitution, no NaN/Infinity.
"""
import math

from services.rate_risk import interpolate_r, stir_spreads


def _c(contract, implied_rate, last_price=None):
    return {"contract": contract, "implied_rate": implied_rate, "last_price": last_price}


def _find(spreads, name):
    return next((s for s in spreads if s.get("name") == name), None)


def test_serff_exact_same_month_sr1_zq_ratio_1_to_1():
    sr1 = [_c("SR1Z6", 3.75, 96.25)]
    zq = [_c("ZQZ6", 3.62, 96.38)]
    out = stir_spreads([], sr1, zq)
    row = _find(out["spreads"], "SERFFZ6")
    assert row is not None
    assert row["kind"] == "serff"
    assert row["legs"] == ["SR1Z6", "ZQZ6"]
    assert row["ratio"] == "1:1"
    assert row["rate_bps"] == round((3.75 - 3.62) * 100.0, 2)
    assert row["price_spread"] == round(96.25 - 96.38, 4)


def test_serff_unavailable_when_either_exact_leg_missing():
    # SR1 present, ZQ absent → Unavailable (null), never an SR3 or cash proxy.
    sr1 = [_c("SR1Z6", 3.75)]
    out = stir_spreads([], sr1, [])
    row = _find(out["spreads"], "SERFFZ6")
    assert row is not None
    assert row["kind"] == "serff"
    assert row["rate_bps"] is None
    assert row["price_spread"] is None
    assert "unavailable" in (row["note"] or "").lower()
    assert "ZQZ6" in (row["note"] or "")

    # ZQ present, SR1 absent.
    zq = [_c("ZQZ6", 3.62)]
    out = stir_spreads([], [], zq)
    row = _find(out["spreads"], "SERFFZ6")
    assert row is not None
    assert row["rate_bps"] is None
    assert "SR1Z6" in (row["note"] or "")

    # Neither leg → no SERFF month row at all (no fabricated month).
    out = stir_spreads([], [], [])
    assert _find(out["spreads"], "SERFFZ6") is None


def test_serff_never_synthesized_from_sr3_or_cash_effr():
    # Full SR3 strip + cash EFFR available but no SR1/ZQ: no SERFF row may be
    # produced from SR3 legs or from the cash EFFR proxy.
    sr3 = [_c(l, 3.7 + i * 0.01) for i, l in enumerate(["SR3M6", "SR3U6", "SR3Z6", "SR3H7"])]
    out = stir_spreads(sr3, [], [], effr=3.65)
    serff_rows = out["by_kind"].get("serff") or []
    assert serff_rows == []
    # Cash proxies live in their own group instead.
    proxy_rows = out["by_kind"].get("derived-proxy") or []
    assert proxy_rows, "derived proxy rows must be grouped separately"
    for p in proxy_rows:
        assert "SERFF" not in (p["name"] or "").upper().replace("PROXY", "")
        assert "not SERFF" in (p["note"] or "")
        assert "non-listed" in (p["note"] or "").lower() or "non-executable" in (p["note"] or "").lower()


def test_four_leg_sr3_is_calendar_of_calendars_not_serff():
    sr3 = [
        _c("SR3M6", 3.70), _c("SR3U6", 3.65), _c("SR3M7", 3.60), _c("SR3U7", 3.55),
        _c("SR3Z6", 3.68), _c("SR3H7", 3.63), _c("SR3Z7", 3.58), _c("SR3H8", 3.53),
    ]
    out = stir_spreads(sr3, [], [])
    four_legs = [
        s for s in out["spreads"]
        if len(s.get("legs") or []) == 4 and s.get("ratio") == "1:-1:-1:1"
    ]
    assert four_legs, "four-leg SR3 structures must remain available"
    for s in four_legs:
        assert s["kind"] == "calendar-of-calendars"
        assert "SERFF" not in (s["name"] or "").upper()
        assert "not serff" in (s["note"] or "").lower()
    # None of them may appear in the serff group.
    for s in out["by_kind"].get("serff") or []:
        assert s.get("ratio") != "1:-1:-1:1"
        assert len(s.get("legs") or []) != 4


def test_sr3_zq_inter_is_not_labelled_serff():
    sr3 = [_c("SR3Z6", 3.70)]
    zq = [_c("ZQZ6", 3.62)]
    out = stir_spreads(sr3, [], zq)
    row = _find(out["spreads"], "SR3Z6−ZQZ6")
    assert row is not None
    assert row["kind"] == "inter"
    assert "never label as SERFF" in (row["note"] or "")
    # SR1−ZQ same month is SERFF (covered by the serff group), not duplicated as inter.
    assert not any(
        s["kind"] == "inter" and (s.get("legs") or []) == ["SR1Z6", "ZQZ6"]
        for s in out["spreads"]
    )


def test_serff_rows_present_with_cash_proxy_separation_when_all_sources_live():
    sr3 = [_c("SR3Z6", 3.70)]
    sr1 = [_c("SR1Z6", 3.75, 96.25)]
    zq = [_c("ZQZ6", 3.62, 96.38)]
    out = stir_spreads(sr3, sr1, zq, effr=3.65)
    serff = _find(out["spreads"], "SERFFZ6")
    assert serff is not None and serff["kind"] == "serff" and serff["rate_bps"] == 13.0
    proxy = _find(out["spreads"], "SR1Z6−EFFR (proxy)")
    assert proxy is not None and proxy["kind"] == "derived-proxy"
    # The proxy value must differ from the listed SERFF bps and be clearly non-listed.
    assert proxy["rate_bps"] == round((3.75 - 3.65) * 100.0, 2)
    assert proxy["rate_bps"] != serff["rate_bps"]


def test_no_nan_or_infinity_anywhere_in_spreads():
    sr3 = [_c("SR3M6", 3.70), _c("SR3U6", 3.65), _c("SR3M7", 3.60), _c("SR3U7", 3.55),
           _c("SR3Z6", 3.68), _c("SR3H7", 3.63), _c("SR3Z7", 3.58), _c("SR3H8", 3.53)]
    sr1 = [_c("SR1Z6", 3.75), _c("SR1M6", None)]
    zq = [_c("ZQZ6", 3.62)]
    out = stir_spreads(sr3, sr1, zq, sofr=4.3, effr=4.29, iorb=4.4)

    def walk(v):
        if isinstance(v, float):
            assert math.isfinite(v), f"non-finite value {v}"
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(out)


# ── interpolate_r nullability (C0.2) ────────────────────────────────────────


def test_interpolate_r_empty_curve_returns_none_not_004():
    assert interpolate_r([], 1.0) is None


def test_interpolate_r_valid_curve_values():
    curve = [(0.25, 0.042), (0.5, 0.045), (1.0, 0.048)]
    assert interpolate_r(curve, 0.25) == 0.042
    assert interpolate_r(curve, 1.0) == 0.048
    # Midpoint interpolation is exact between nodes.
    assert abs(interpolate_r(curve, 0.75) - 0.0465) < 1e-12
    # Outside the curve: flat extrapolation from nearest edge node (still observed data).
    assert interpolate_r(curve, 0.1) == 0.042
    assert interpolate_r(curve, 2.0) == 0.048
