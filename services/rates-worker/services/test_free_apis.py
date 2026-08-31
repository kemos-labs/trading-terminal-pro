"""Unit tests for free-API adapters (no network)."""
from services.fx_board import _pair_rate, PAIR_SPECS
from services.fiscal_auctions import _fmt_offer_bn, _parse_float
from services.perp_basis import _f
from services.global_yields import SERIES


def test_fx_pair_conventions():
    rates = {"JPY": 160.0, "EUR": 0.8, "GBP": 0.75, "AUD": 1.5, "CHF": 0.9, "CAD": 1.4}
    assert abs(_pair_rate(rates, "USDJPY") - 160.0) < 1e-9
    assert abs(_pair_rate(rates, "EURUSD") - 1.25) < 1e-9
    assert abs(_pair_rate(rates, "GBPUSD") - (1 / 0.75)) < 1e-9
    assert abs(_pair_rate(rates, "AUDUSD") - (1 / 1.5)) < 1e-9
    assert abs(_pair_rate(rates, "USDCHF") - 0.9) < 1e-9
    assert abs(_pair_rate(rates, "USDCAD") - 1.4) < 1e-9
    assert _pair_rate(rates, "XXX") is None
    assert _pair_rate({}, "USDJPY") is None
    assert len(PAIR_SPECS) >= 4


def test_offer_fmt():
    assert _fmt_offer_bn(92_000_000_000) == "$92bn"
    assert _fmt_offer_bn(1_500_000_000) == "$1.5bn"
    assert _fmt_offer_bn(None) is None
    assert _parse_float("null") is None
    assert _parse_float("92000000000") == 92_000_000_000.0


def test_perp_float_parse():
    assert _f("63849.90") == 63849.90
    assert _f("") is None
    assert _f(None) is None
    assert _f("notanumber") is None


def test_global_yield_series_codes():
    codes = {c for c, _, _ in SERIES}
    assert "US" in codes and "DE" in codes and "UK" in codes
    assert len(SERIES) >= 4
