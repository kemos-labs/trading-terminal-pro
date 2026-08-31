"""
Japanese Government Bond (JGB) constant-maturity yield curve.

Primary source: Ministry of Finance Japan (MoF) daily CSV — real market levels,
not demo/synthetic. Encoding is Shift_JIS; dates use Japanese imperial eras
(R = Reiwa, H = Heisei, S = Showa).
"""
from __future__ import annotations

import csv
import io
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx

# Compact daily file (recent window) — enough for today + ~1Y compare.
MOF_JGB_URL = "https://www.mof.go.jp/jgbs/reference/interest_rate/jgbcm.csv"
# Full history when recent file lacks a ~1Y snapshot.
MOF_JGB_ALL_URL = "https://www.mof.go.jp/jgbs/reference/interest_rate/data/jgbcm_all.csv"

# Column order after 基準日 (as of 2024+ MoF file).
TENOR_LABELS = [
    "1Y", "2Y", "3Y", "4Y", "5Y", "6Y", "7Y", "8Y", "9Y",
    "10Y", "15Y", "20Y", "25Y", "30Y", "40Y",
]

_cache: dict[str, Any] = {}
CACHE_TTL = 900  # 15 min


def _parse_imperial_date(token: str) -> date | None:
    """
    Parse MoF date tokens like 'R8.7.10', 'H31.4.1', 'S49.9.24'.
    Reiwa (R) year 1 = 2019, Heisei (H) year 1 = 1989, Showa (S) year 1 = 1926.
    """
    t = (token or "").strip().upper()
    if not t or t in ("-", "－", "—"):
        return None
    era_map = {"R": 2018, "H": 1988, "S": 1925}  # era_year + offset → CE year
    era = t[0]
    if era not in era_map:
        # Fallback ISO YYYY-MM-DD if ever published that way
        try:
            return date.fromisoformat(t[:10])
        except ValueError:
            return None
    rest = t[1:]
    parts = rest.replace("/", ".").split(".")
    if len(parts) != 3:
        return None
    try:
        ey, m, d = int(parts[0]), int(parts[1]), int(parts[2])
        year = era_map[era] + ey
        return date(year, m, d)
    except (ValueError, OverflowError):
        return None


def _parse_yield(raw: str) -> float | None:
    s = (raw or "").strip()
    if not s or s in ("-", "－", "—", "…", "..."):
        return None
    try:
        v = float(s)
        return v if abs(v) < 50 else None  # sanity: JGB % not 5000 bps string
    except ValueError:
        return None


def _decode_csv_bytes(raw: bytes) -> str:
    for enc in ("cp932", "shift_jis", "utf-8-sig", "utf-8"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _parse_mof_rows(text: str) -> list[dict[str, Any]]:
    """Return rows newest-first: {as_of: ISO date, yields: list[float|None]}."""
    reader = csv.reader(io.StringIO(text))
    rows_out: list[dict[str, Any]] = []
    for parts in reader:
        if not parts:
            continue
        first = (parts[0] or "").strip()
        # Data rows start with era letter + digits (R/H/S)
        if not first or first[0] not in ("R", "H", "S", "r", "h", "s"):
            continue
        as_of = _parse_imperial_date(first)
        if as_of is None:
            continue
        vals = parts[1 : 1 + len(TENOR_LABELS)]
        # Pad if short
        while len(vals) < len(TENOR_LABELS):
            vals.append("")
        yields = [_parse_yield(v) for v in vals[: len(TENOR_LABELS)]]
        if all(y is None for y in yields):
            continue
        rows_out.append({"as_of": as_of.isoformat(), "yields": yields, "_d": as_of})
    # Newest first
    rows_out.sort(key=lambda r: r["_d"], reverse=True)
    for r in rows_out:
        del r["_d"]
    return rows_out


async def _fetch_url(url: str, timeout: float = 45.0) -> bytes:
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(url, headers={"User-Agent": "TradingTerminalPro/1.0 (rates desk)"})
        resp.raise_for_status()
        return resp.content


async def load_jgb_rows(*, prefer_full: bool = False) -> list[dict[str, Any]]:
    """Load and cache MoF rows (newest first)."""
    cache_key = "jgb_all" if prefer_full else "jgb_recent"
    now = time.time()
    hit = _cache.get(cache_key)
    if hit and now - hit["time"] < CACHE_TTL:
        return hit["data"]

    urls = [MOF_JGB_ALL_URL, MOF_JGB_URL] if prefer_full else [MOF_JGB_URL, MOF_JGB_ALL_URL]
    last_err: Exception | None = None
    for url in urls:
        try:
            raw = await _fetch_url(url)
            text = _decode_csv_bytes(raw)
            rows = _parse_mof_rows(text)
            if rows:
                _cache[cache_key] = {"data": rows, "time": now, "url": url}
                return rows
        except Exception as e:
            last_err = e
            continue
    if last_err:
        raise last_err
    return []


def _nearest_on_or_before(rows: list[dict[str, Any]], target: date) -> dict[str, Any] | None:
    """rows newest-first; find closest observation on or before target."""
    best = None
    best_delta = None
    for r in rows:
        d = date.fromisoformat(r["as_of"])
        if d > target:
            continue
        delta = (target - d).days
        if best is None or delta < best_delta:  # type: ignore[operator]
            best = r
            best_delta = delta
            if delta == 0:
                break
    return best


async def build_jgb_curve(compare_days: int = 365) -> dict[str, Any]:
    """
    Live JGB CMT curve vs ~compare_days ago (default 1Y).
    Fail-closed: no synthetic yields — missing tenors stay null.
    """
    rows = await load_jgb_rows(prefer_full=False)
    if not rows:
        rows = await load_jgb_rows(prefer_full=True)
    if not rows:
        return {
            "labels": TENOR_LABELS,
            "today": [None] * len(TENOR_LABELS),
            "historical": [None] * len(TENOR_LABELS),
            "points": [],
            "today_as_of": None,
            "compare_as_of": None,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "source": "MoF Japan",
            "error": "No JGB curve rows from MoF CSV",
            "note": "Ministry of Finance Japan constant-maturity JGB yields. No synthetic points.",
        }

    today_row = rows[0]
    today_d = date.fromisoformat(today_row["as_of"])
    target = today_d - timedelta(days=compare_days)

    # May need full history for 1Y lookback if recent file is short
    hist_row = _nearest_on_or_before(rows, target)
    if hist_row is None or (today_d - date.fromisoformat(hist_row["as_of"])).days < compare_days * 0.7:
        try:
            full = await load_jgb_rows(prefer_full=True)
            if full:
                rows = full
                today_row = rows[0]
                today_d = date.fromisoformat(today_row["as_of"])
                target = today_d - timedelta(days=compare_days)
                hist_row = _nearest_on_or_before(rows, target)
        except Exception:
            pass

    today_y = today_row["yields"]
    hist_y = hist_row["yields"] if hist_row else [None] * len(TENOR_LABELS)
    compare_as_of = hist_row["as_of"] if hist_row else None

    points = []
    for lab, t, h in zip(TENOR_LABELS, today_y, hist_y):
        delta_bps = None
        if t is not None and h is not None:
            delta_bps = round((t - h) * 100, 1)
        points.append({
            "label": lab,
            "today": t,
            "historical": h,
            "delta_bps": delta_bps,
        })

    live_n = sum(1 for y in today_y if y is not None)
    return {
        "labels": TENOR_LABELS,
        "today": today_y,
        "historical": hist_y,
        "points": points,
        "today_as_of": today_row["as_of"],
        "compare_as_of": compare_as_of,
        "compare_label": f"~{compare_days}d",
        "periods": f"{compare_days}d",
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": f"MoF Japan ({live_n}/{len(TENOR_LABELS)} tenors live)",
        "note": (
            "Japanese Government Bond constant-maturity yields from Ministry of Finance Japan. "
            "White = latest business day · blue = ~1Y prior. No synthetic / demo points."
        ),
        "currency": "JPY",
        "unit": "percent",
    }
