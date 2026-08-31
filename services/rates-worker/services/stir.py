"""
CME 3M SOFR (SR3) strip helpers.

Live quotes come from yfinance. Expired contracts (delisted on Yahoo) are
filled with CME-style final settlement from FRED daily SOFR compounding
over the IMM reference quarter — real prints, not invented prices.
"""
from __future__ import annotations

from calendar import WEDNESDAY, monthcalendar
from datetime import date, timedelta
from typing import Any, Iterable


# Quarterly SR3 month codes → calendar month
SR3_MONTH_CODES: list[tuple[str, int, str]] = [
    ("H", 3, "Mar"),
    ("M", 6, "Jun"),
    ("U", 9, "Sep"),
    ("Z", 12, "Dec"),
]
_CODE_TO_MONTH = {c: m for c, m, _ in SR3_MONTH_CODES}
_CODE_TO_LABEL = {c: lab for c, _, lab in SR3_MONTH_CODES}


def third_wednesday(year: int, month: int) -> date:
    """IMM date: third Wednesday of month."""
    cal = monthcalendar(year, month)
    wednesdays = [week[WEDNESDAY] for week in cal if week[WEDNESDAY] != 0]
    return date(year, month, wednesdays[2])


def next_imm_quarter(year: int, month: int) -> tuple[int, int]:
    """Next quarterly IMM month after (year, month)."""
    nm, ny = month + 3, year
    if nm > 12:
        nm -= 12
        ny += 1
    return ny, nm


def reference_quarter(year: int, month_code: str) -> tuple[date, date]:
    """
    CME 3M SOFR Reference Quarter:
    start = third Wednesday of contract month
    end   = third Wednesday of third subsequent month (exclusive end for accrual)
    """
    m = _CODE_TO_MONTH[month_code]
    start = third_wednesday(year, m)
    ny, nm = next_imm_quarter(year, m)
    end = third_wednesday(ny, nm)
    return start, end


def year_digit(year: int) -> str:
    """Board-style single-digit year (2026→6, 2030→0)."""
    return str(year % 10)


def build_sr3_contracts(
    start_year: int = 2024,
    start_code: str = "U",
    end_year: int = 2030,
    end_code: str = "Z",
) -> list[dict[str, Any]]:
    """
    Quarterly SR3 strip from Sep 2024 (U24) through Dec 2030 (Z30).
    Symbols: SR3{M}{YY}.CME  Labels: SR3{M}{Y}  Tickers: SFR{M}{Y}
    """
    start_m = _CODE_TO_MONTH[start_code]
    end_m = _CODE_TO_MONTH[end_code]
    out: list[dict[str, Any]] = []
    for y in range(start_year, end_year + 1):
        for code, month, mon_lab in SR3_MONTH_CODES:
            if (y, month) < (start_year, start_m):
                continue
            if (y, month) > (end_year, end_m):
                continue
            yd = year_digit(y)
            yy = f"{y % 100:02d}"
            ref_start, ref_end = reference_quarter(y, code)
            out.append(
                {
                    "symbol": f"SR3{code}{yy}.CME",
                    "label": f"SR3{code}{yd}",
                    "ticker": f"SFR{code}{yd}",
                    "month": f"{mon_lab} {yy}",
                    "year": y,
                    "month_num": month,
                    "month_code": code,
                    "ref_start": ref_start.isoformat(),
                    "ref_end": ref_end.isoformat(),
                }
            )
    return out


def compound_sofr_rate(
    sofr_by_date: dict[str, float],
    start: date,
    end: date,
) -> float | None:
    """
    CME-style compounded SOFR % for [start, end) using Actual/360:

        R = [ Π (1 + SOFR_i * n_i / 360) − 1 ] * 360 / D * 100

    Each calendar day uses the most recent published SOFR on or before that day
    (weekend/holiday fill). Returns None if end is not fully observed or data missing.
    """
    if end <= start:
        return None
    D = (end - start).days
    if D <= 0:
        return None

    def sofr_on_or_before(day: date) -> float | None:
        for k in range(0, 14):
            key = (day - timedelta(days=k)).isoformat()
            if key in sofr_by_date:
                return float(sofr_by_date[key])
        return None

    product = 1.0
    d = start
    while d < end:
        rate = sofr_on_or_before(d)
        if rate is None:
            return None
        product *= 1.0 + (rate / 100.0) * (1.0 / 360.0)
        d += timedelta(days=1)

    return round((product - 1.0) * 360.0 / D * 100.0, 4)


def fill_settled_sr3(
    rows: list[dict[str, Any]],
    contracts: list[dict[str, Any]],
    sofr_series: Iterable[dict[str, Any]],
    *,
    as_of: date | None = None,
) -> list[dict[str, Any]]:
    """
    For SR3 rows without a live price whose reference quarter has fully ended,
    attach FRED-compounded final settlement as source='settled'.
    """
    as_of = as_of or date.today()
    by_date = {
        str(o["date"]): float(o["value"])
        for o in sofr_series
        if o.get("date") is not None and o.get("value") is not None
    }
    meta_by_label = {c["label"]: c for c in contracts}
    out: list[dict[str, Any]] = []

    for row in rows:
        lab = row.get("contract")
        meta = meta_by_label.get(lab) if lab else None
        if (
            row.get("source") == "live"
            or row.get("implied_rate") is not None
            or not meta
        ):
            out.append(row)
            continue

        try:
            ref_start = date.fromisoformat(meta["ref_start"])
            ref_end = date.fromisoformat(meta["ref_end"])
        except (KeyError, TypeError, ValueError):
            out.append(row)
            continue

        # Only settle after the reference quarter has fully completed
        if ref_end > as_of:
            out.append(row)
            continue

        rate = compound_sofr_rate(by_date, ref_start, ref_end)
        if rate is None:
            out.append(row)
            continue

        px = round(100.0 - float(rate), 4)
        filled = dict(row)
        filled.update(
            {
                "implied_rate": rate,
                "last_price": px,
                "prev_close": px,
                "settlement": px,
                "net": 0.0,
                "change": 0.0,
                "source": "settled",
                "high": None,
                "low": None,
                "open": None,
                "volume": None,
                "note": f"Final settlement ≈ FRED SOFR compound {meta['ref_start']}→{meta['ref_end']}",
            }
        )
        out.append(filled)
    return out
