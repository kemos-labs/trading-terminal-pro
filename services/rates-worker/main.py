import asyncio
import math
import os
import re
from collections import Counter
from datetime import date as date_cls, datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from services.fred_client import (
    fetch_series,
    get_latest,
    get_meta,
    source_label,
    is_fred_series_allowed,
)
from services.iv_calculator import build_iv_surface
from services.greeks_calculator import build_greeks_surface, build_interpolated_surface, build_gex_grid, build_charm_exposure_grid
from services import rate_risk
from services import cache as ttl_cache

# TTLs for the expensive yfinance-backed endpoints (seconds).
GREEKS_CACHE_TTL = 120
SURFACE_CACHE_TTL = 120
STIR_CACHE_TTL = 60

app = FastAPI(title="Rates Worker — private rates/macro service")

# Private worker — loopback only. Node is the sole consumer and the only public surface.
# CORS is disabled by default; set RATES_WORKER_CORS_ORIGINS only for explicit browser dev use.
# Wildcard origins are rejected even when configured — a private loopback worker
# must never publish a public CORS surface.
_raw_cors = os.environ.get("RATES_WORKER_CORS_ORIGINS", os.environ.get("MACROVOL_CORS_ORIGIN", ""))
_rejected_cors = [o.strip() for o in _raw_cors.split(",") if o.strip() == "*"]
_rates_cors = [o.strip() for o in _raw_cors.split(",") if o.strip() and o.strip() != "*"]
if _rejected_cors:
    # Never honor '*'; refuse to start the CORS middleware on wildcard config.
    print("rates-worker: wildcard CORS origin rejected (private worker stays origin-pinned)")
if _rates_cors:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_rates_cors,
        allow_credentials=False,
        allow_methods=["GET", "OPTIONS"],
        allow_headers=["Accept", "Content-Type"],
    )

SERIES_MAP = {
    "SOFR": "sofr",
    "DFF": "effr",
    "DGS2": "usy2",
    "DGS10": "usy10",
    "T10Y2Y": "spread_2s10s",
    "T10Y3M": "spread_3m10y",
}

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/api/rates/sofr")
async def get_sofr():
    data = await fetch_series("SOFR", limit=90)
    return {
        "series": "SOFR",
        "data": data,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": "FRED",
    }

# Lightweight rates/macro shared TTL (seconds) — many website users share one FRED pull.
RATES_SUMMARY_TTL = 300
MACRO_SUMMARY_TTL = 300


@app.get("/api/rates/summary")
async def rates_summary():
    """
    Key rates snapshot.
    T10Y2Y / T10Y3M from FRED are already yield spreads in percentage points
    (e.g. 0.35 = 35 bps). Frontend multiplies by 100 for bps display.
    """
    key = "rates:summary:v1"
    hit = ttl_cache.get_cached(key, RATES_SUMMARY_TTL)
    if not ttl_cache.is_miss(hit):
        return hit

    keys = ["SOFR", "DFF", "DGS2", "DGS10", "T10Y2Y", "T10Y3M"]
    # Fail-closed: do not inject hardcoded FALLBACK_DATA into trader-facing rates.
    results = await asyncio.gather(
        *[get_latest(k, allow_fallback=False) for k in keys],
        return_exceptions=True
    )
    values = []
    field_src = {}
    obs_dates = {}
    for i, r in enumerate(results):
        k = keys[i]
        if isinstance(r, Exception) or r is None:
            values.append(None)
            field_src[k] = "unavailable"
        else:
            values.append(r)
            meta = get_meta(k)
            field_src[k] = meta.get("source", "FRED")
            if meta.get("obs_date"):
                obs_dates[k] = meta["obs_date"]
    out = {
        "sofr": values[0],
        "effr": values[1],
        "usy2": values[2],
        "usy10": values[3],
        # percentage points (NOT bps) — FRED convention for T10Y2Y / T10Y3M
        "spread_2s10s": values[4],
        "spread_3m10y": values[5],
        "spread_unit": "percentage_points",
        "spread_note": "FRED T10Y2Y/T10Y3M are in percentage points. ×100 = bps.",
        "field_source": field_src,
        "obs_dates": obs_dates,
        "risk_free_rate": round(float(values[0]) / 100.0, 6) if values[0] is not None else None,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": source_label(keys),
    }
    ttl_cache.set_cached(key, out)
    return out


async def _default_r() -> float | None:
    """SOFR as decimal risk-free. Fail-closed: None if SOFR unavailable (no 4% stub)."""
    sofr = await get_latest("SOFR", allow_fallback=False)
    if sofr is None:
        return None
    return round(float(sofr) / 100.0, 6)


async def _term_curve_points() -> list:
    """Live Treasury CMT points as (T_years, r_decimal) for piecewise r(T)."""
    try:
        _, yields, _, _ = await _load_curve_map()
        return rate_risk.curve_to_points(CURVE_LABELS, yields)
    except Exception:
        return []

# ── Input validation for yfinance-backed endpoints ──────────────────────────
# Tickers/periods flow into cache keys AND upstream yfinance calls: unbounded
# attacker-chosen values would mint unbounded cache entries (memory) and hammer
# Yahoo from the shared egress IP. Validate charset + period enum up front.
_TICKER_RE = re.compile(r"^[A-Za-z0-9.\-=^]{1,16}$")
_ALLOWED_PERIODS = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"}


def _check_ticker(ticker: str) -> None:
    if not _TICKER_RE.match(ticker or ""):
        raise HTTPException(status_code=400, detail="Invalid ticker.")


@app.get("/api/surface/{ticker}")
async def get_surface(
    ticker: str,
    r: float | None = Query(None, description="Risk-free rate decimal; default = live SOFR"),
    q: float = Query(0.0),
    strike_range: float = Query(0.3),
):
    _check_ticker(ticker)
    from fastapi.responses import JSONResponse
    r_eff = r if r is not None else await _default_r()
    # When r not overridden, price each expiry with piecewise Treasury r(T)
    curve_pts = None if r is not None else await _term_curve_points()
    if r is None and r_eff is None and not curve_pts:
        return JSONResponse(
            status_code=503,
            content={"error": "Risk-free unavailable: SOFR and Treasury curve both missing (fail-closed)."},
        )
    # Term structure can still price without a flat SOFR anchor; use front CMT if needed.
    if r_eff is None and curve_pts:
        r_eff = float(curve_pts[0][1])
    r_mode = "flat" if r is not None else ("term_structure" if curve_pts else "SOFR")
    key = f"surface:{ticker}:{r_eff}:{q}:{strike_range}:{r_mode}"
    hit = ttl_cache.get_cached(key, SURFACE_CACHE_TTL)
    if not ttl_cache.is_miss(hit):
        return hit
    try:
        result = await asyncio.to_thread(build_iv_surface, ticker, r_eff, q, strike_range, curve_pts)
        result["as_of"] = datetime.now(timezone.utc).isoformat()
        result["source"] = "yfinance"
        result["r"] = r_eff
        result["q"] = q
        result["r_source"] = "query" if r is not None else ("treasury_term + SOFR anchor" if curve_pts else "SOFR")
        result["r_mode"] = r_mode
        ttl_cache.set_cached(key, result)
        return result
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/api/surface/{ticker}/preview")
async def get_surface_preview(
    ticker: str,
    r: float | None = Query(None),
    q: float = Query(0.0),
):
    _check_ticker(ticker)
    from fastapi.responses import JSONResponse
    r_eff = r if r is not None else await _default_r()
    curve_pts = None if r is not None else await _term_curve_points()
    if r is None and r_eff is None and not curve_pts:
        return JSONResponse(
            status_code=503,
            content={"error": "Risk-free unavailable: SOFR and Treasury curve both missing (fail-closed)."},
        )
    if r_eff is None and curve_pts:
        r_eff = float(curve_pts[0][1])
    key = f"surface_preview:{ticker}:{r_eff}:{q}"
    hit = ttl_cache.get_cached(key, SURFACE_CACHE_TTL)
    if not ttl_cache.is_miss(hit):
        return hit
    try:
        result = await asyncio.to_thread(build_iv_surface, ticker, r_eff, q, 0.15, curve_pts)
        result["expiries"] = result["expiries"][:4]
        result["iv_grid"] = result["iv_grid"][:4]
        result["as_of"] = datetime.now(timezone.utc).isoformat()
        result["source"] = "yfinance"
        result["r"] = r_eff
        result["q"] = q
        ttl_cache.set_cached(key, result)
        return result
    except Exception as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=500, content={"error": str(e)})

# FRED constant-maturity Treasury IDs — short end uses MO suffix (DGS1MO not DGS1M).
CURVE_IDS = ["DGS1MO", "DGS3MO", "DGS6MO", "DGS1", "DGS2", "DGS5", "DGS10", "DGS20", "DGS30"]
CURVE_LABELS = ["1M", "3M", "6M", "1Y", "2Y", "5Y", "10Y", "20Y", "30Y"]

@app.get("/api/rates/curve")
async def get_rates_curve():
    tasks = [fetch_series(sid, limit=5) for sid in CURVE_IDS]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    yields = []
    obs_dates = []
    live_n = 0
    for r in results:
        if isinstance(r, Exception) or not r:
            yields.append(None)
            obs_dates.append(None)
        else:
            yields.append(r[0]["value"])
            obs_dates.append(r[0]["date"])
            live_n += 1
    return {
        "labels": CURVE_LABELS,
        "series_ids": CURVE_IDS,
        "yields": yields,
        "obs_dates": obs_dates,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": f"FRED ({live_n}/{len(CURVE_IDS)} tenors live)",
        "note": "Constant maturity Treasury yields. Short end: DGS1MO/DGS3MO/DGS6MO.",
    }


async def _load_curve_map() -> tuple[dict[str, float | None], list, list, str]:
    """Fetch live curve → label→yield map + arrays + source string."""
    tasks = [fetch_series(sid, limit=5) for sid in CURVE_IDS]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    yields: list[float | None] = []
    obs_dates: list[str | None] = []
    live_n = 0
    for r in results:
        if isinstance(r, Exception) or not r:
            yields.append(None)
            obs_dates.append(None)
        else:
            yields.append(r[0]["value"])
            obs_dates.append(r[0]["date"])
            live_n += 1
    by_label = {lab: y for lab, y in zip(CURVE_LABELS, yields)}
    source = f"FRED ({live_n}/{len(CURVE_IDS)} tenors live)"
    return by_label, yields, obs_dates, source


@app.get("/api/rates/shape")
async def rates_shape(history: int = Query(60, ge=10, le=260)):
    """
    Curve shape desk: live spreads + history for every board spread.
    History from FRED daily CMTs (aligned dates only — no invented points).
    """
    by_label, yields, obs_dates, source = await _load_curve_map()
    shape = rate_risk.compute_shape(by_label)

    # All tenors needed for 2s5s / 5s10s / 10s30s / 3m10y / fly + classics
    dgs3m, dgs2, dgs5, dgs10, dgs30 = await asyncio.gather(
        fetch_series("DGS3MO", limit=history + 20),
        fetch_series("DGS2", limit=history + 20),
        fetch_series("DGS5", limit=history + 20),
        fetch_series("DGS10", limit=history + 20),
        fetch_series("DGS30", limit=history + 20),
    )

    hist_2s10s = rate_risk.align_spread_history(dgs10, dgs2, max_points=history)
    hist_5s30s = rate_risk.align_spread_history(dgs30, dgs5, max_points=history)
    hist_2s5s = rate_risk.align_spread_history(dgs5, dgs2, max_points=history)
    hist_5s10s = rate_risk.align_spread_history(dgs10, dgs5, max_points=history)
    hist_10s30s = rate_risk.align_spread_history(dgs30, dgs10, max_points=history)
    hist_3m10y = rate_risk.align_spread_history(dgs10, dgs3m, max_points=history)

    # Butterfly history: need 2,5,10 on same dates
    m5 = {r["date"]: r["value"] for r in dgs5}
    m10 = {r["date"]: r["value"] for r in dgs10}
    fly_hist = []
    for r in dgs2:
        d = r["date"]
        if d not in m5 or d not in m10:
            continue
        fly_pp = 2 * m5[d] - r["value"] - m10[d]
        fly_hist.append({"date": d, "spread_bps": round(fly_pp * 100.0, 1)})
        if len(fly_hist) >= history:
            break
    fly_hist.reverse()

    def _spark(series: list[dict], key: str = "spread_bps") -> list[float]:
        return [float(p[key]) for p in series if p.get(key) is not None]

    return {
        **shape,
        "curve": {"labels": CURVE_LABELS, "yields": yields, "obs_dates": obs_dates},
        "history": {
            "2s10s": hist_2s10s,
            "5s30s": hist_5s30s,
            "2s5s": hist_2s5s,
            "5s10s": hist_5s10s,
            "10s30s": hist_10s30s,
            "3m10y": hist_3m10y,
            "fly_2s5s10s": fly_hist,
            "spark_2s10s": _spark(hist_2s10s),
            "spark_5s30s": _spark(hist_5s30s),
            "spark_2s5s": _spark(hist_2s5s),
            "spark_5s10s": _spark(hist_5s10s),
            "spark_10s30s": _spark(hist_10s30s),
            "spark_3m10y": _spark(hist_3m10y),
            "spark_fly": _spark(fly_hist),
        },
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": source,
    }


@app.get("/api/rates/term-structure")
async def rates_term_structure(T: float = Query(0.25, ge=0.01, le=40.0)):
    """
    Interpolated risk-free rate r(T) from live Treasury CMTs (decimal).
    Used by options pricing when term-structure mode is on.
    """
    by_label, yields, _, source = await _load_curve_map()
    pts = rate_risk.curve_to_points(CURVE_LABELS, yields)
    r = rate_risk.interpolate_r(pts, T)
    sofr = await get_latest("SOFR")
    sofr_dec = round(float(sofr) / 100.0, 6) if sofr is not None else None
    # For very short T prefer SOFR when available
    r_used: float | None = r
    r_source = "treasury_curve"
    warnings: list[str] = []
    if T <= 0.25 and sofr_dec is not None:
        # blend: T→0 use SOFR, T→0.25 use 3M tsy
        if r is None:
            # No curve — observed SOFR is still a valid short-T input on its own.
            r_used = sofr_dec
            r_source = "sofr_only_no_curve"
            warnings.append("treasury_curve_unavailable: r(T) sourced from observed SOFR only")
        else:
            w = min(max(T / 0.25, 0.0), 1.0)
            r_used = sofr_dec * (1 - w) + r * w
            r_source = "sofr_blend_3m"
    elif r is None:
        warnings.append("treasury_curve_unavailable: no live Treasury CMT points; r(T) unavailable (fail-closed, no default rate)")
    return {
        "T": T,
        "r": round(r_used, 6) if r_used is not None else None,
        "r_pct": round(r_used * 100.0, 4) if r_used is not None else None,
        "available": r_used is not None,
        "r_source": r_source if r_used is not None else "unavailable",
        "curve_points": [{"T": t, "r": round(rv, 6), "r_pct": round(rv * 100, 4)} for t, rv in pts],
        "curve_coverage": {"points": len(pts), "state": "full" if len(pts) >= len(CURVE_LABELS) else "partial"},
        "warnings": warnings,
        "sofr": sofr,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": source,
    }


RSS_FEEDS = {
    "conks": "https://conkstack.substack.com/feed",
    "alphapicks": "https://alphapicks.substack.com/feed",
}

@app.get("/api/feed/{source}")
async def get_feed(source: str):
    url = RSS_FEEDS.get(source)
    if not url:
        return {"error": "Unknown source", "posts": []}
    try:
        import xmltodict
        import httpx
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            r = await client.get(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/rss+xml, application/xml, text/xml, */*"
            })
            text = r.text.strip()
            if not text.startswith("<?xml") and not text.startswith("<rss"):
                return {"error": f"Not XML: {text[:100]}", "posts": []}
            parsed = xmltodict.parse(text)
            items = parsed["rss"]["channel"]["item"]
            if isinstance(items, dict):
                items = [items]
            posts = []
            for item in items[:10]:
                description = item.get("description", "") or ""
                if "paid subscriber" in description.lower():
                    continue
                posts.append({
                    "title": item.get("title", ""),
                    "link": item.get("link", ""),
                    "date": item.get("pubDate", "")[:16],
                    "description": description[:200].strip(),
                })
            return {
                "source": source,
                "posts": posts[:5],
                "as_of": datetime.now(timezone.utc).isoformat(),
            }
    except Exception as e:
        return {"error": str(e), "posts": []}

def _as_float_or_none(x) -> float | None:
    """Fail-closed numeric coerce — never inject hardcoded market levels."""
    if isinstance(x, (int, float)) and not isinstance(x, bool):
        try:
            v = float(x)
            return v if v == v else None  # NaN guard
        except (TypeError, ValueError):
            return None
    return None


@app.get("/api/rates/plumbing")
async def rates_plumbing():
    results = await asyncio.gather(
        get_latest("IORB", allow_fallback=False),
        get_latest("SOFR", allow_fallback=False),
        get_latest("DFF", allow_fallback=False),
        fetch_series("RRPONTSYD", limit=500),
        fetch_series("WRESBAL", limit=365),
        return_exceptions=True
    )

    # Fail-closed: missing FRED prints stay null (UI shows "—"), never 3.65/3.62 stubs.
    iorb = _as_float_or_none(results[0] if not isinstance(results[0], Exception) else None)
    sofr = _as_float_or_none(results[1] if not isinstance(results[1], Exception) else None)
    effr = _as_float_or_none(results[2] if not isinstance(results[2], Exception) else None)

    rrp_data = results[3] if isinstance(results[3], list) else []
    rrp_latest = rrp_data[0]["value"] if rrp_data else None

    wresbal_data = results[4] if isinstance(results[4], list) else []

    rrp_override = os.getenv("RATES_RRP_OVERRIDE")
    if rrp_override is not None:
        try:
            rrp_rate = float(rrp_override)
            rrp_rate_source = "override"
            rrp_rate_note = "Manual override via RATES_RRP_OVERRIDE env var."
        except ValueError:
            rrp_rate = None
            rrp_rate_source = "unavailable"
            rrp_rate_note = "RATES_RRP_OVERRIDE env var is not a valid float."
    elif iorb is not None:
        rrp_rate = round(iorb - 0.10, 2)
        rrp_rate_source = "derived_iorb_minus_10bps"
        rrp_rate_note = "RRP offering rate = IORB - 10 bps (NY Fed convention). No direct FRED series. Derived, not a live print."
    else:
        rrp_rate = None
        rrp_rate_source = "unavailable"
        rrp_rate_note = "FRED IORB unavailable and no override set."

    def fmt_rrp(d):
        return {"date": d["date"], "volume": round(d["value"], 2)}

    def fmt_wresbal(d):
        return {"date": d["date"], "reserves": round(d["value"], 1)}

    return {
        "iorb": iorb,
        "sofr": sofr,
        "effr": effr,
        "rrp_rate": rrp_rate,
        "rrp_rate_source": rrp_rate_source,
        "rrp_rate_note": rrp_rate_note,
        "rrp_volume_latest": round(rrp_latest, 2) if rrp_latest else None,
        "rrp_volume_unit": "USD_billions",
        "rrp_volume_history": [fmt_rrp(d) for d in reversed(rrp_data[-90:])] if rrp_data else [],
        "wresbal_history": [fmt_wresbal(d) for d in reversed(wresbal_data[-365:])] if wresbal_data else [],
        "wresbal_unit": "USD_millions",
        "obs_dates": {
            "IORB": get_meta("IORB").get("obs_date"),
            "SOFR": get_meta("SOFR").get("obs_date"),
            "DFF": get_meta("DFF").get("obs_date"),
            "RRPONTSYD": rrp_data[0]["date"] if rrp_data else None,
            "WRESBAL": wresbal_data[0]["date"] if wresbal_data else None,
        },
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": source_label(["IORB", "SOFR", "DFF"]),
    }

@app.get("/api/rates/basis")
async def rates_basis():
    results = await asyncio.gather(
        get_latest("SOFR", allow_fallback=False),
        get_latest("DFF", allow_fallback=False),
        get_latest("IORB", allow_fallback=False),
        return_exceptions=True
    )
    # Fail-closed: never inject 3.62/3.65 stubs when FRED is down.
    sofr = _as_float_or_none(results[0] if not isinstance(results[0], Exception) else None)
    effr = _as_float_or_none(results[1] if not isinstance(results[1], Exception) else None)
    iorb = _as_float_or_none(results[2] if not isinstance(results[2], Exception) else None)

    def bps_spread(a: float | None, b: float | None) -> float | None:
        if a is None or b is None:
            return None
        return round((a - b) * 100, 1)

    sofr_effr = bps_spread(sofr, effr)
    sofr_iorb = bps_spread(sofr, iorb)
    effr_iorb = bps_spread(effr, iorb)
    # Regime diagnostics for floor system (post-ample-reserves / drained RRP era)
    if sofr_iorb is None:
        regime = "unknown"
        regime_note = "SOFR−IORB unavailable — missing FRED prints (fail-closed)."
    elif sofr_iorb < -25:
        regime = "wide_discount"
        regime_note = "SOFR well below IORB — unusual; check data quality or quarter-end effects."
    elif sofr_iorb > 5:
        regime = "above_floor"
        regime_note = "SOFR above IORB — reserve scarcity / balance-sheet pressure signal."
    else:
        regime = "corridor_normal"
        regime_note = "SOFR near IORB — typical ample-reserves corridor."
    return {
        "sofr": sofr,
        "effr": effr,
        "iorb": iorb,
        "sofr_effr": sofr_effr,
        "sofr_iorb": sofr_iorb,
        "effr_iorb": effr_iorb,
        "unit": "bps",
        "regime": regime,
        "regime_note": regime_note,
        "context": {
            "sofr_effr": "Secured (SOFR) vs unsecured (EFFR) overnight. Typical: about −5 to +5 bps.",
            "sofr_iorb": "SOFR vs interest on reserves. Typical ample-reserves: about −15 to +5 bps (NOT −50/−80). Rising toward 0 / positive can signal tighter plumbing.",
            "effr_iorb": "EFFR vs IORB floor. Usually slightly below IORB (corridor width).",
        },
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": source_label(["SOFR", "DFF", "IORB"]),
        "obs_dates": {
            "SOFR": get_meta("SOFR").get("obs_date"),
            "DFF": get_meta("DFF").get("obs_date"),
            "IORB": get_meta("IORB").get("obs_date"),
        },
    }

@app.get("/api/rates/basis-history")
async def rates_basis_history(limit: int = 90):
    """SOFR−EFFR / SOFR−IORB / EFFR−IORB history in bps + rolling z-scores."""
    lim = max(30, min(int(limit), 400))
    results = await asyncio.gather(
        fetch_series("SOFR", limit=lim),
        fetch_series("DFF", limit=lim),
        fetch_series("IORB", limit=lim),
        return_exceptions=True,
    )
    sofr_s = results[0] if isinstance(results[0], list) else []
    effr_s = results[1] if isinstance(results[1], list) else []
    iorb_s = results[2] if isinstance(results[2], list) else []

    def by_date(series: list) -> dict:
        return {d["date"]: d["value"] for d in series if d.get("date") is not None}

    s_map, e_map, i_map = by_date(sofr_s), by_date(effr_s), by_date(iorb_s)
    dates = sorted(set(s_map) & set(e_map) & set(i_map))
    history = []
    for d in dates:
        sofr, effr, iorb = s_map[d], e_map[d], i_map[d]
        history.append({
            "date": d,
            "sofr": sofr,
            "effr": effr,
            "iorb": iorb,
            "sofr_effr_bps": round((sofr - effr) * 100, 2),
            "sofr_iorb_bps": round((sofr - iorb) * 100, 2),
            "effr_iorb_bps": round((effr - iorb) * 100, 2),
        })

    def zscore(vals: list[float]) -> float | None:
        if len(vals) < 10:
            return None
        import statistics
        try:
            mu = statistics.mean(vals)
            sd = statistics.pstdev(vals)
            if sd < 1e-9:
                return 0.0
            return round((vals[-1] - mu) / sd, 2)
        except Exception:
            return None

    se = [h["sofr_effr_bps"] for h in history]
    si = [h["sofr_iorb_bps"] for h in history]
    ei = [h["effr_iorb_bps"] for h in history]
    latest = history[-1] if history else None
    return {
        "history": history[-lim:],
        "latest": latest,
        "zscore": {
            "sofr_effr": zscore(se),
            "sofr_iorb": zscore(si),
            "effr_iorb": zscore(ei),
            "window": len(history),
        },
        "unit": "bps",
        "note": "Spreads in basis points. Z-score vs full returned window (population).",
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": source_label(["SOFR", "DFF", "IORB"]),
    }


def _curve_history_lookback(periods: str) -> tuple[str, int, int]:
    """
    Parse compare window → (label, fetch_limit, target_days).
    Presets: 1W/1M/3M/6M/1Y/2Y. Custom: Nd or N (calendar days, 7–800).
    Never invents yields — only sizes the FRED observation window.
    """
    raw = (periods or "1Y").strip()
    key = raw.upper()
    limit_map = {"1W": 15, "1M": 35, "3M": 90, "6M": 160, "1Y": 280, "2Y": 540}
    target_days = {"1W": 7, "1M": 30, "3M": 90, "6M": 180, "1Y": 365, "2Y": 730}
    if key in target_days:
        return key, limit_map[key], target_days[key]
    # Custom day count: "45d", "45D", "45"
    m = re.fullmatch(r"(\d+)\s*D?", key)
    if m:
        days = max(7, min(int(m.group(1)), 800))
        return f"{days}d", min(days + 40, 900), days
    return "1Y", 280, 365


@app.get("/api/rates/curve-history")
async def curve_history(periods: str = "1Y"):
    """
    Live UST CMT curve vs a historical snapshot (default 1Y ago).
    Used by Curves & Spreads dual-curve chart (today white · compare blue).
    FRED series are newest-first. periods: 1M|3M|6M|1Y|2Y or Nd custom days.
    """
    tenors = list(CURVE_IDS)
    labels = list(CURVE_LABELS)

    periods_label, limit, want_days = _curve_history_lookback(periods)
    periods = periods_label

    results = await asyncio.gather(
        *[fetch_series(t, limit=limit + 10) for t in tenors],
        return_exceptions=True
    )

    today_yields: list[float | None] = []
    historical_yields: list[float | None] = []
    hist_dates: list[str | None] = []
    today_dates: list[str | None] = []
    live_n = 0

    target = date_cls.today() - timedelta(days=want_days)

    def _pick_near(series: list[dict], target_d: date_cls) -> tuple[float | None, str | None]:
        """Closest observation on or before target_d (FRED desc-sorted)."""
        best = None
        best_delta = None
        for row in series:
            try:
                d = date_cls.fromisoformat(row["date"])
            except Exception:
                continue
            delta = abs((d - target_d).days)
            # Prefer on-or-before; still accept nearest within 14d if needed
            if d > target_d and delta > 14:
                continue
            if best is None or delta < best_delta:
                best = row
                best_delta = delta
        if best is None and series:
            # fallback: oldest in window
            best = series[-1]
        if not best:
            return None, None
        return float(best["value"]), best["date"]

    for result in results:
        if isinstance(result, Exception) or not result:
            today_yields.append(None)
            historical_yields.append(None)
            hist_dates.append(None)
            today_dates.append(None)
            continue
        live_n += 1
        today_yields.append(result[0]["value"])
        today_dates.append(result[0].get("date"))
        hy, hd = _pick_near(result, target)
        historical_yields.append(hy)
        hist_dates.append(hd)

    # Majority historical as_of for legend
    compare_as_of = None
    counted = Counter(d for d in hist_dates if d)
    if counted:
        compare_as_of = counted.most_common(1)[0][0]
    today_as_of = None
    counted_t = Counter(d for d in today_dates if d)
    if counted_t:
        today_as_of = counted_t.most_common(1)[0][0]

    points = []
    for lab, t, h in zip(labels, today_yields, historical_yields):
        points.append({
            "label": lab,
            "today": t,
            "historical": h,
            "delta_bps": round((t - h) * 100.0, 1) if t is not None and h is not None else None,
        })

    return {
        "labels": labels,
        "series_ids": tenors,
        "today": today_yields,
        "historical": historical_yields,
        "historical_dates": hist_dates,
        "today_dates": today_dates,
        "today_as_of": today_as_of,
        "compare_as_of": compare_as_of,
        "compare_label": f"UST CMT · {compare_as_of}" if compare_as_of else f"UST CMT · {periods} ago",
        "points": points,
        "periods": periods,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": f"FRED ({live_n}/{len(tenors)} tenors live)",
        "note": f"Today vs ~{periods} ago constant-maturity Treasury yields. No synthetic points.",
    }

@app.get("/api/rates/correlations")
async def rates_correlations(window: int = Query(30, ge=5, le=252), period: str = Query("1y")):
    try:
        from services.correlations import compute_correlation_matrix
        result = await compute_correlation_matrix(window=window, period=period)
        if not result.get("as_of"):
            result["as_of"] = datetime.now(timezone.utc).isoformat()
        return result
    except Exception as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=500,
            content={"error": f"{type(e).__name__}: {str(e)}", "as_of": datetime.now(timezone.utc).isoformat()},
        )


@app.get("/api/rates/jgb-curve")
async def get_jgb_curve(compare_days: int = Query(365, ge=30, le=800)):
    """
    Live Japanese Government Bond (JGB) constant-maturity curve vs ~1Y ago.
    Source: Ministry of Finance Japan daily CSV — real yields, no synthetic points.
    """
    key = f"jgb_curve:{compare_days}"
    hit = ttl_cache.get_cached(key, 900)
    if not ttl_cache.is_miss(hit):
        return hit
    try:
        from services.jgb_curve import build_jgb_curve
        result = await build_jgb_curve(compare_days=compare_days)
        if not result.get("error"):
            ttl_cache.set_cached(key, result)
        return result
    except Exception as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=502,
            content={
                "error": f"{type(e).__name__}: {str(e)}",
                "as_of": datetime.now(timezone.utc).isoformat(),
                "source": "MoF Japan",
                "note": "Failed to fetch MoF JGB CSV. No demo curve injected.",
            },
        )


@app.get("/api/rates/fx")
async def get_fx_board():
    """
    Multi-pair FX board (USDJPY, EURUSD, GBPUSD, AUDUSD, USDCHF, USDCAD).
    Source: Frankfurter / ECB daily reference — free, no API key.
    """
    key = "fx_board:v1"
    hit = ttl_cache.get_cached(key, 600)
    if not ttl_cache.is_miss(hit):
        return hit
    try:
        from services.fx_board import build_fx_board
        result = await build_fx_board()
        if not result.get("error"):
            ttl_cache.set_cached(key, result)
        return result
    except Exception as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=502,
            content={
                "pairs": [],
                "error": f"{type(e).__name__}: {str(e)}",
                "as_of": datetime.now(timezone.utc).isoformat(),
                "source": "Frankfurter",
                "note": "Failed to fetch Frankfurter rates. No synthetic FX levels.",
            },
        )


@app.get("/api/rates/auctions")
async def get_treasury_auctions(limit: int = Query(20, ge=1, le=50)):
    """
    Upcoming U.S. Treasury auctions (FiscalData). Supply narrative next to UST curve.
    """
    key = f"fiscal_auctions:{limit}"
    hit = ttl_cache.get_cached(key, 900)
    if not ttl_cache.is_miss(hit):
        return hit
    try:
        from services.fiscal_auctions import build_upcoming_auctions
        result = await build_upcoming_auctions(limit=limit)
        if not result.get("error"):
            ttl_cache.set_cached(key, result)
        return result
    except Exception as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=502,
            content={
                "auctions": [],
                "error": f"{type(e).__name__}: {str(e)}",
                "as_of": datetime.now(timezone.utc).isoformat(),
                "source": "U.S. Treasury FiscalData",
                "note": "Failed to fetch upcoming auctions. No synthetic calendar.",
            },
        )


@app.get("/api/crypto/spot")
async def get_crypto_spot():
    """
    BTC/ETH USD spot from CoinGecko — backup when Deribit index fails.
    Free / keyless; rate-limited. Fail-closed (no synthetic prices).
    """
    key = "coingecko_spot:v1"
    # Separate cache keys for success vs error so we don't hammer CoinGecko on every request
    error_key = f"{key}:error"
    # Check success cache (60s TTL)
    hit = ttl_cache.get_cached(key, 60)
    if not ttl_cache.is_miss(hit):
        return hit
    # Check error cache (300s TTL) — avoid re-hitting CoinGecko during rate-limit windows
    err_hit = ttl_cache.get_cached(error_key, 300)
    if not ttl_cache.is_miss(err_hit):
        return err_hit
    try:
        from services.coingecko import build_crypto_spot
        result = await build_crypto_spot()
        if result.get("error"):
            ttl_cache.set_cached(error_key, result)
        else:
            ttl_cache.set_cached(key, result)
        return result
    except Exception as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=502,
            content={
                "assets": [],
                "error": f"{type(e).__name__}: {str(e)}",
                "as_of": datetime.now(timezone.utc).isoformat(),
                "source": "CoinGecko",
                "note": "Failed to fetch CoinGecko spot. No synthetic crypto levels.",
            },
        )


@app.get("/api/rates/global-yields")
async def get_global_yields():
    """
    US / DE / UK / FR / JP 10Y sovereign yields (FRED). Multi-curve context after UST + JGB.
    """
    key = "global_yields:v1"
    hit = ttl_cache.get_cached(key, 600)
    if not ttl_cache.is_miss(hit):
        return hit
    try:
        from services.global_yields import build_global_yields
        result = await build_global_yields()
        if not result.get("error"):
            ttl_cache.set_cached(key, result)
        return result
    except Exception as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=502,
            content={
                "points": [],
                "error": f"{type(e).__name__}: {str(e)}",
                "as_of": datetime.now(timezone.utc).isoformat(),
                "source": "FRED",
                "note": "Failed to fetch global yields. No synthetic levels.",
            },
        )


@app.get("/api/crypto/perp-basis")
async def get_perp_basis():
    """BTC/ETH linear perp mark vs index (Bybit public). Fail-closed."""
    key = "perp_basis:v1"
    hit = ttl_cache.get_cached(key, 30)
    if not ttl_cache.is_miss(hit):
        return hit
    try:
        from services.perp_basis import build_perp_basis
        result = await build_perp_basis()
        if not result.get("error"):
            ttl_cache.set_cached(key, result)
        return result
    except Exception as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=502,
            content={
                "rows": [],
                "error": f"{type(e).__name__}: {str(e)}",
                "as_of": datetime.now(timezone.utc).isoformat(),
                "source": "Bybit",
                "note": "Failed to fetch Bybit perp basis. No synthetic levels.",
            },
        )


@app.get("/api/sec/context/{symbol}")
async def get_sec_context(symbol: str, limit: int = Query(8, ge=1, le=20)):
    """Recent SEC EDGAR filings for equity ticker (8-K / 10-Q / 10-K). No key."""
    key = f"sec_ctx:{symbol.upper()}:{limit}"
    hit = ttl_cache.get_cached(key, 900)
    if not ttl_cache.is_miss(hit):
        return hit
    try:
        from services.sec_context import build_sec_context
        result = await build_sec_context(symbol, limit=limit)
        if not result.get("error") or result.get("error") in ("not_equity", "cik_not_found", "no_recent_filings"):
            ttl_cache.set_cached(key, result)
        return result
    except Exception as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=502,
            content={
                "symbol": symbol.upper(),
                "filings": [],
                "error": f"{type(e).__name__}: {str(e)}",
                "as_of": datetime.now(timezone.utc).isoformat(),
                "source": "SEC EDGAR",
                "note": "Failed to fetch SEC context. No synthetic filings.",
            },
        )


# No hardcoded market levels — missing FRED observations stay None.
# UI must render "—" / unavailable rather than stale demo numbers.

@app.get("/api/macro/summary")
async def get_macro_summary():
    mkey = "macro:summary:v1"
    mhit = ttl_cache.get_cached(mkey, MACRO_SUMMARY_TTL)
    if not ttl_cache.is_miss(mhit):
        return mhit

    results = await asyncio.gather(
        fetch_series("CPIAUCSL", limit=14),
        fetch_series("PCEPILFE", limit=14),
        fetch_series("PAYEMS", limit=2),
        fetch_series("UNRATE", limit=1),
        fetch_series("RSAFS", limit=1),
        fetch_series("HOUST", limit=1),
        fetch_series("WALCL", limit=1),
        fetch_series("CPILFESL", limit=14),
        return_exceptions=True,
    )

    def get(ix: int):
        r = results[ix]
        return r if not isinstance(r, Exception) and r else None

    cpi_data = get(0)
    pce_data = get(1)
    core_cpi_data = get(7)

    def yoY(data):
        if not data or len(data) < 2:
            return None
        latest = data[0]
        try:
            latest_date = datetime.strptime(latest["date"], "%Y-%m-%d")
            target_date = latest_date.replace(year=latest_date.year - 1)
        except (KeyError, ValueError, TypeError):
            return None
        year_ago = None
        min_diff = None
        for d in data:
            try:
                d_date = datetime.strptime(d["date"], "%Y-%m-%d")
            except (KeyError, ValueError, TypeError):
                continue
            diff = abs((d_date - target_date).days)
            if min_diff is None or diff < min_diff:
                min_diff = diff
                year_ago = d
        if year_ago is None or min_diff is None or min_diff > 45:
            return None
        try:
            latest_val = float(latest["value"])
            year_ago_val = float(year_ago["value"])
        except (KeyError, ValueError, TypeError):
            return None
        if year_ago_val == 0:
            return None
        return round(((latest_val - year_ago_val) / year_ago_val) * 100, 2)

    cpi_yoy = yoY(cpi_data)
    core_pce_yoy = yoY(pce_data)
    core_cpi_yoy = yoY(core_cpi_data)
    nfp_raw = (
        round(results[2][0]["value"] - results[2][1]["value"], 1)
        if not isinstance(results[2], Exception) and results[2] and len(results[2]) >= 2
        else None
    )
    unrate = results[3][0]["value"] if not isinstance(results[3], Exception) and results[3] else None
    retail = results[4][0]["value"] if not isinstance(results[4], Exception) and results[4] else None
    housing = results[5][0]["value"] if not isinstance(results[5], Exception) and results[5] else None
    fed_bs = results[6][0]["value"] if not isinstance(results[6], Exception) and results[6] else None

    missing = []
    for name, val in (
        ("cpi_yoy", cpi_yoy),
        ("core_pce_yoy", core_pce_yoy),
        ("core_cpi_yoy", core_cpi_yoy),
        ("nfp_mom", nfp_raw),
        ("unemployment", unrate),
        ("retail_sales", retail),
        ("housing_starts", housing),
        ("fed_balance_sheet", fed_bs),
    ):
        if val is None:
            missing.append(name)

    def _obs(data):
        return data[0]["date"] if data else None

    out = {
        "cpi_yoy": cpi_yoy,
        "core_pce_yoy": core_pce_yoy,
        "core_cpi_yoy": core_cpi_yoy,
        "nfp_mom": nfp_raw,
        "unemployment": unrate,
        "retail_sales": retail,
        "housing_starts": housing,
        "fed_balance_sheet": fed_bs,
        "units": {
            "cpi_yoy": "percent_yoy",
            "core_cpi_yoy": "percent_yoy",
            "core_pce_yoy": "percent_yoy",
            "nfp_mom": "thousands_jobs",
            "unemployment": "percent",
            "retail_sales": "USD_millions",
            "housing_starts": "thousands_units_saar",
            "fed_balance_sheet": "USD_millions",
        },
        "obs_dates": {
            "cpi": _obs(cpi_data),
            "core_cpi": _obs(core_cpi_data),
            "core_pce": _obs(pce_data),
            "nfp": _obs(get(2)),
            "unemployment": _obs(get(3)),
            "retail_sales": _obs(get(4)),
            "housing_starts": _obs(get(5)),
            "fed_balance_sheet": _obs(get(6)),
        },
        "fallback_fields": [],
        "missing_fields": missing,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": "FRED" if not missing else ("FRED+partial" if len(missing) < 8 else "unavailable"),
        "note": "CPI/PCE release dates lag; obs_dates show last published observation, not request time. Missing fields are null — never hard-coded.",
    }
    ttl_cache.set_cached(mkey, out)
    return out

@app.get("/api/macro/series/{series_id}")
async def get_macro_series(series_id: str, limit: int = Query(500, ge=1, le=2000)):
    sid = (series_id or "").upper().strip()
    if not is_fred_series_allowed(sid):
        raise HTTPException(status_code=404, detail="Series not allowed")
    data = await fetch_series(sid, limit)
    return {
        "series": sid,
        "data": data,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": "FRED",
    }


# Free FRED series already available under our key — batched once for the whole desk.
# Shared TTL: N browsers must not N× FRED (Node proxy also caches /macro/stress).
MACRO_STRESS_TTL = 300
# FRED BAML* OAS series are Percent (e.g. 2.72 = 2.72pp ≈ 272 bps) — not raw bps.
STRESS_SERIES = {
    "vix": ("VIXCLS", "index", "VIX close"),
    "hy_oas": ("BAMLH0A0HYM2", "percent", "ICE BofA HY OAS"),
    "ig_oas": ("BAMLC0A0CM", "percent", "ICE BofA IG OAS"),
    "bei_5y": ("T5YIE", "percent", "5Y breakeven inflation"),
    "bei_10y": ("T10YIE", "percent", "10Y breakeven inflation"),
    "real_10y": ("DFII10", "percent", "10Y TIPS real yield"),
    "usd_broad": ("DTWEXBGS", "index", "Trade-weighted USD broad"),
    "nfci": ("NFCI", "index", "Chicago Fed NFCI"),
    "term_sofr_3m": ("TSFR3M", "percent", "3M term SOFR"),
}


@app.get("/api/macro/stress")
async def get_macro_stress():
    """
    One shared pack of free FRED risk/liquidity prints.
    Complements /macro/summary (activity) with credit, vol, inflation expectations, USD, conditions.
    Fail-closed nulls — never inject FALLBACK_DATA into trader UI.
    """
    mkey = "macro:stress:v1"
    mhit = ttl_cache.get_cached(mkey, MACRO_STRESS_TTL)
    if not ttl_cache.is_miss(mhit):
        return mhit

    ids = [sid for sid, _, _ in STRESS_SERIES.values()]
    results = await asyncio.gather(
        *[get_latest(sid, allow_fallback=False) for sid in ids],
        return_exceptions=True,
    )

    fields: dict = {}
    units: dict = {}
    labels: dict = {}
    obs_dates: dict = {}
    field_source: dict = {}
    missing: list[str] = []

    for i, (key, (sid, unit, label)) in enumerate(STRESS_SERIES.items()):
        r = results[i]
        units[key] = unit
        labels[key] = label
        if isinstance(r, Exception) or r is None:
            fields[key] = None
            missing.append(key)
            field_source[key] = "unavailable"
            obs_dates[key] = None
        else:
            fields[key] = float(r)
            meta = get_meta(sid)
            field_source[key] = meta.get("source", "FRED")
            obs_dates[key] = meta.get("obs_date")

    live_n = sum(1 for v in fields.values() if v is not None)
    out = {
        **fields,
        "units": units,
        "labels": labels,
        "obs_dates": obs_dates,
        "field_source": field_source,
        "series_ids": {k: v[0] for k, v in STRESS_SERIES.items()},
        "missing_fields": missing,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": "FRED" if not missing else ("FRED+partial" if live_n else "unavailable"),
        "note": (
            "Free FRED stress pack · shared TTL · HY/IG OAS, VIX, BEI, real yields, USD, NFCI, term SOFR. "
            "Null = missing observation, not a fake print."
        ),
    }
    ttl_cache.set_cached(mkey, out)
    return out


PRIMARY_BOARD_TTL = 3600  # keyless OFR/ECB — 1h shared


@app.get("/api/macro/primary")
async def get_macro_primary():
    """
    Keyless primary-source pack: OFR NY Fed repo rates + ECB deposit facility.
    Complements /macro/stress (FRED). Fail-closed nulls.
    """
    mkey = "macro:primary:v1"
    mhit = ttl_cache.get_cached(mkey, PRIMARY_BOARD_TTL)
    if not ttl_cache.is_miss(mhit):
        return mhit
    try:
        from services.free_primary import build_primary_board
        out = await asyncio.to_thread(build_primary_board)
        ttl_cache.set_cached(mkey, out)
        return out
    except Exception as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=502,
            content={
                "error": f"{type(e).__name__}: {e}",
                "source": "unavailable",
                "note": "Primary board fetch failed — no synthetic levels.",
            },
        )


def _debug_enabled() -> bool:
    """Debug routes off by default. Enable only with RATES_WORKER_DEBUG=1 (local ops)."""
    return os.getenv("RATES_WORKER_DEBUG", os.getenv("MACROVOL_DEBUG", "0")) == "1"


@app.get("/api/debug/fred")
async def debug_fred():
    from fastapi.responses import JSONResponse
    if not _debug_enabled():
        return JSONResponse(status_code=404, content={"error": "Not found"})
    import httpx
    api_key = os.getenv("FRED_API_KEY")
    url = "https://api.stlouisfed.org/fred/series/observations"
    params = {
        "series_id": "DFF",
        "api_key": api_key,
        "file_type": "json",
        "sort_order": "desc",
        "limit": 1
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, params=params)
        return {
            "status_code": r.status_code,
            "api_key_present": bool(api_key),
            "api_key_length": len(api_key) if api_key else 0,
            "response": r.json()
        }

@app.get("/api/debug/clear-cache")
async def clear_cache():
    from fastapi.responses import JSONResponse
    if not _debug_enabled():
        return JSONResponse(status_code=404, content={"error": "Not found"})
    import services.fred_client as fc
    fred_n = len(fc._cache)
    fc._cache.clear()
    ttl_n = ttl_cache.clear_all()
    return {"message": "Caches cleared", "fred_cache_size": fred_n, "ttl_cache_size": ttl_n}

@app.get("/api/debug/sofr")
async def debug_sofr():
    from fastapi.responses import JSONResponse
    if not _debug_enabled():
        return JSONResponse(status_code=404, content={"error": "Not found"})
    import services.fred_client as fc
    fc._cache.clear()
    result = await fc.get_latest("SOFR")
    return {"sofr": result, "cache_size": len(fc._cache)}

@app.get("/api/stir/strip")
async def get_stir_strip():
    """
    CME-style STIR desk strip:
      - 3M SOFR (SFR/SR3), 1M SOFR (SR1), Fed Funds (ZQ)
      - Treasury futures front (ZT/ZF/ZN/TN/ZB)
      - NY Fed reference prints (percentiles, volume, target)
      - Desk spreads: calendars, flies, packs, SERFF, inter, cash
    Free data: yfinance (delayed) + NY Fed Markets API + FRED (IORB).
    """
    key = "stir_strip:v6"
    hit = ttl_cache.get_cached(key, STIR_CACHE_TTL)
    if not ttl_cache.is_miss(hit):
        return hit
    import yfinance as yf
    import asyncio
    from services.nyfed_client import fetch_reference_rates
    from services.stir import build_sr3_contracts, fill_settled_sr3

    # 3M SOFR (CME SR3) — Sep 2024 → Dec 2030 quarterly (Bloomberg-style path).
    # Live: yfinance SR3{M}{YY}.CME. Expired: FRED SOFR compound final settlement.
    # Board tickers SFR{M}{Y}; yfinance symbols SR3{M}{YY}.CME
    SR3_CONTRACTS = build_sr3_contracts(
        start_year=2024, start_code="U", end_year=2030, end_code="Z"
    )

    # 1M SOFR (CME SR1) — months that yfinance usually quotes
    SR1_CONTRACTS = [
        {"symbol": "SR1M26.CME", "label": "SR1M6", "ticker": "SR1M6", "month": "Jun 26"},
        {"symbol": "SR1N26.CME", "label": "SR1N6", "ticker": "SR1N6", "month": "Jul 26"},
        {"symbol": "SR1Q26.CME", "label": "SR1Q6", "ticker": "SR1Q6", "month": "Aug 26"},
        {"symbol": "SR1U26.CME", "label": "SR1U6", "ticker": "SR1U6", "month": "Sep 26"},
        {"symbol": "SR1V26.CME", "label": "SR1V6", "ticker": "SR1V6", "month": "Oct 26"},
        {"symbol": "SR1X26.CME", "label": "SR1X6", "ticker": "SR1X6", "month": "Nov 26"},
        {"symbol": "SR1Z26.CME", "label": "SR1Z6", "ticker": "SR1Z6", "month": "Dec 26"},
        {"symbol": "SR1F27.CME", "label": "SR1F7", "ticker": "SR1F7", "month": "Jan 27"},
        {"symbol": "SR1G27.CME", "label": "SR1G7", "ticker": "SR1G7", "month": "Feb 27"},
        {"symbol": "SR1H27.CME", "label": "SR1H7", "ticker": "SR1H7", "month": "Mar 27"},
        {"symbol": "SR1M27.CME", "label": "SR1M7", "ticker": "SR1M7", "month": "Jun 27"},
        {"symbol": "SR1Z27.CME", "label": "SR1Z7", "ticker": "SR1Z7", "month": "Dec 27"},
    ]

    # Fed Funds futures (ZQ) — often missing on yfinance; keep a short list for when live
    ZQ_CONTRACTS = [
        {"symbol": "ZQM26.CME", "label": "ZQM6", "ticker": "ZQM6", "month": "Jun 26"},
        {"symbol": "ZQN26.CME", "label": "ZQN6", "ticker": "ZQN6", "month": "Jul 26"},
        {"symbol": "ZQQ26.CME", "label": "ZQQ6", "ticker": "ZQQ6", "month": "Aug 26"},
        {"symbol": "ZQU26.CME", "label": "ZQU6", "ticker": "ZQU6", "month": "Sep 26"},
        {"symbol": "ZQV26.CME", "label": "ZQV6", "ticker": "ZQV6", "month": "Oct 26"},
        {"symbol": "ZQX26.CME", "label": "ZQX6", "ticker": "ZQX6", "month": "Nov 26"},
        {"symbol": "ZQZ26.CME", "label": "ZQZ6", "ticker": "ZQZ6", "month": "Dec 26"},
        {"symbol": "ZQH27.CME", "label": "ZQH7", "ticker": "ZQH7", "month": "Mar 27"},
    ]

    # CME Treasury futures — core rates complex (front continuous)
    TSY_FUTURES = [
        {"symbol": "ZT=F", "label": "ZT", "ticker": "ZT", "month": "2Y", "product": "2-Year T-Note"},
        {"symbol": "ZF=F", "label": "ZF", "ticker": "ZF", "month": "5Y", "product": "5-Year T-Note"},
        {"symbol": "ZN=F", "label": "ZN", "ticker": "ZN", "month": "10Y", "product": "10-Year T-Note"},
        {"symbol": "TN=F", "label": "TN", "ticker": "TN", "month": "10Y Ultra", "product": "Ultra 10-Year"},
        {"symbol": "ZB=F", "label": "ZB", "ticker": "ZB", "month": "30Y", "product": "U.S. Treasury Bond"},
        {"symbol": "UB=F", "label": "UB", "ticker": "UB", "month": "Ultra Bond", "product": "Ultra T-Bond"},
    ]

    allow_fb = os.getenv("ALLOW_STIR_FALLBACK", "0") == "1"
    SR3_FALLBACK = {
        "SR3H6": 3.535, "SR3M6": 3.340,
        "SR3U6": 3.205, "SR3Z6": 3.165, "SR3H7": 3.170,
        "SR3M7": 3.195, "SR3U7": 3.235, "SR3Z7": 3.285,
        "SR3H8": 3.335, "SR3M8": 3.38, "SR3U8": 3.42, "SR3Z8": 3.485,
    } if allow_fb else {}
    SR1_FALLBACK = {} if not allow_fb else {}
    ZQ_FALLBACK = {} if not allow_fb else {
        "ZQM6": 3.65, "ZQU6": 3.59, "ZQZ6": 3.62,
        "ZQH7": 3.62, "ZQM7": 3.61, "ZQZ7": 3.60,
    }

    _semaphore = asyncio.Semaphore(8)

    def _yf_fetch_quote(symbol: str) -> dict:
        """CME board fields: last, settlement≈prev, high, low, open, volume."""
        empty = {
            "last": None, "prev": None, "high": None, "low": None,
            "open": None, "volume": None,
        }
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.fast_info

            def g(*keys):
                for k in keys:
                    if hasattr(info, "get"):
                        v = info.get(k)
                    else:
                        v = getattr(info, k, None)
                    if v is not None:
                        return v
                return None

            last = g("lastPrice", "last_price")
            prev = g("previousClose", "previous_close")
            high = g("dayHigh", "day_high")
            low = g("dayLow", "day_low")
            opn = g("open", "regularMarketOpen", "open")
            vol = g("lastVolume", "last_volume", "regularMarketVolume", "threeMonthAverageVolume")
            # Volume often missing on fast_info — pull last bar from history
            if vol is None:
                try:
                    hist = ticker.history(period="5d")
                    if hist is not None and len(hist) > 0 and "Volume" in hist.columns:
                        v = hist["Volume"].iloc[-1]
                        if v == v and float(v) > 0:  # not NaN
                            vol = float(v)
                        if high is None and "High" in hist.columns:
                            high = float(hist["High"].iloc[-1])
                        if low is None and "Low" in hist.columns:
                            low = float(hist["Low"].iloc[-1])
                        if opn is None and "Open" in hist.columns:
                            opn = float(hist["Open"].iloc[-1])
                        if last is None and "Close" in hist.columns:
                            last = float(hist["Close"].iloc[-1])
                except Exception:
                    pass
            if last is None and prev is not None:
                last = prev
            return {
                "last": float(last) if last is not None else None,
                "prev": float(prev) if prev is not None else None,
                "high": float(high) if high is not None else None,
                "low": float(low) if low is not None else None,
                "open": float(opn) if opn is not None else None,
                "volume": int(vol) if vol is not None else None,
            }
        except Exception:
            return empty

    async def fetch_quote(symbol: str) -> dict:
        async with _semaphore:
            try:
                return await asyncio.wait_for(
                    asyncio.to_thread(_yf_fetch_quote, symbol),
                    timeout=14,
                )
            except Exception:
                return {
                    "last": None, "prev": None, "high": None, "low": None,
                    "open": None, "volume": None,
                }

    async def process_contracts(contracts, fallbacks, *, rate_style: bool = True):
        """rate_style=True → IMM index (100−price); False → price-only (Tsy futures)."""
        today = date_cls.today()

        async def process_one(c):
            # Skip yfinance for fully expired SR3 (ref quarter done) — fill via FRED later
            skip_yf = False
            if rate_style and c.get("ref_end"):
                try:
                    if date_cls.fromisoformat(str(c["ref_end"])) < today:
                        skip_yf = True
                except ValueError:
                    pass

            if skip_yf:
                quote = {
                    "last": None, "prev": None, "high": None, "low": None,
                    "open": None, "volume": None,
                }
            else:
                quote = await fetch_quote(c["symbol"])
            last_px = quote.get("last")
            prev_px = quote.get("prev")
            rate = None
            source = "unavailable"
            if rate_style:
                if last_px is not None and last_px > 50:
                    rate = round(100.0 - float(last_px), 4)
                    source = "live"
                elif c["label"] in fallbacks:
                    rate = fallbacks[c["label"]]
                    last_px = round(100.0 - float(rate), 4)
                    source = "fallback"
            else:
                if last_px is not None:
                    source = "live"

            net = None
            if last_px is not None and prev_px is not None:
                net = round(float(last_px) - float(prev_px), 4)

            ticker = c.get("ticker") or c["label"]
            if c["label"].startswith("SR3") and not str(ticker).startswith("SFR"):
                ticker = "SFR" + c["label"][3:]

            row = {
                "contract": c["label"],
                "ticker": ticker,
                "month": c["month"],
                "product": c.get("product"),
                "ref_start": c.get("ref_start"),
                "ref_end": c.get("ref_end"),
                "implied_rate": rate,
                "last_price": round(float(last_px), 4) if last_px is not None else (
                    round(100.0 - float(rate), 4) if rate is not None else None
                ),
                "prev_close": round(float(prev_px), 4) if prev_px is not None else None,
                "settlement": round(float(prev_px), 4) if prev_px is not None else None,
                "high": round(float(quote["high"]), 4) if quote.get("high") is not None else None,
                "low": round(float(quote["low"]), 4) if quote.get("low") is not None else None,
                "open": round(float(quote["open"]), 4) if quote.get("open") is not None else None,
                "volume": quote.get("volume"),
                "net": net,
                "change": net,
                "source": source,
                "historical_1w": None,
                "historical_1m": None,
                "historical_3m": None,
            }
            return row

        tasks = [process_one(c) for c in contracts]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return [r for r in results if not isinstance(r, Exception)]

    sr3_results, sr1_results, zq_results, tsy_results, nyfed, sofr_hist = await asyncio.gather(
        process_contracts(SR3_CONTRACTS, SR3_FALLBACK),
        process_contracts(SR1_CONTRACTS, SR1_FALLBACK),
        process_contracts(ZQ_CONTRACTS, ZQ_FALLBACK),
        process_contracts(TSY_FUTURES, {}, rate_style=False),
        fetch_reference_rates(),
        fetch_series("SOFR", limit=900),
        return_exceptions=True,
    )
    if isinstance(sr3_results, Exception):
        sr3_results = []
    if isinstance(sr1_results, Exception):
        sr1_results = []
    if isinstance(zq_results, Exception):
        zq_results = []
    if isinstance(tsy_results, Exception):
        tsy_results = []
    if isinstance(nyfed, Exception):
        nyfed = {"rates": {}, "error": str(nyfed)}
    if isinstance(sofr_hist, Exception):
        sofr_hist = []

    # Expired SR3 (delisted on Yahoo): FRED-compounded final settlement Sep24→last full IMM
    sr3_results = fill_settled_sr3(
        sr3_results,
        SR3_CONTRACTS,
        sofr_hist if isinstance(sofr_hist, list) else [],
        as_of=date_cls.today(),
    )
    # Keep strip chronological (U24 … Z30)
    sr3_results = sorted(
        sr3_results,
        key=lambda r: rate_risk._contract_sort_key(str(r.get("contract") or "")),
    )

    live_count = sum(1 for r in sr3_results if r.get("source") == "live")
    settled_count = sum(1 for r in sr3_results if r.get("source") == "settled")
    live_sr1 = sum(1 for r in sr1_results if r.get("source") == "live")
    live_zq = sum(1 for r in zq_results if r.get("source") == "live")
    live_tsy = sum(1 for r in tsy_results if r.get("source") == "live")
    fallback_count = sum(
        1 for r in sr3_results + sr1_results + zq_results if r.get("source") == "fallback"
    )
    unavailable_count = sum(
        1 for r in sr3_results + sr1_results + zq_results if r.get("source") == "unavailable"
    )

    # Prefer NY Fed official prints for SOFR/EFFR; FRED for IORB
    ny_rates = (nyfed or {}).get("rates") or {}
    sofr_v = ny_rates.get("SOFR", {}).get("rate")
    effr_v = ny_rates.get("EFFR", {}).get("rate")
    iorb = await get_latest("IORB")
    iorb_v = iorb if isinstance(iorb, (int, float)) else None
    # FRED backup if NY Fed missing
    if sofr_v is None:
        s = await get_latest("SOFR")
        sofr_v = s if isinstance(s, (int, float)) else None
    if effr_v is None:
        e = await get_latest("DFF")
        effr_v = e if isinstance(e, (int, float)) else None

    path = rate_risk.stir_path_analysis(sr3_results, sofr_v)
    spreads = rate_risk.stir_spreads(
        sr3_results,
        sr1_results,
        zq_results,
        sofr=sofr_v,
        effr=effr_v,
        iorb=iorb_v,
    )

    # SERFF board rows (CME ICS style):
    # kind 'serff' = true listed SERFF: same-month SR1 − ZQ (ratio 1:1).
    # kind 'derived-proxy' = SR1/SR3 implied − cash EFFR; non-listed, non-executable.
    # Never mixes in SR3−ZQ (own intermarket family) or four-leg SR3 calendars.
    serff_board = []
    for s in (spreads.get("by_kind") or {}).get("serff") or []:
        serff_board.append({
            "cc": "SR1/ZQ",
            "name": s.get("name"),
            "description": s.get("note") or "",
            "last_bps": s.get("rate_bps"),
            "price_spread": s.get("price_spread"),
            "legs": s.get("legs"),
            "ratio": s.get("ratio"),
            "kind": "serff",
            "imply": s.get("imply"),
        })
    for s in (spreads.get("by_kind") or {}).get("derived-proxy") or []:
        serff_board.append({
            "cc": "Proxy",
            "name": s.get("name"),
            "description": s.get("note") or "",
            "last_bps": s.get("rate_bps"),
            "price_spread": s.get("price_spread"),
            "legs": s.get("legs"),
            "ratio": s.get("ratio"),
            "kind": "derived-proxy",
            "imply": s.get("imply"),
        })

    # Dual strip for Bloomberg-style chart: live yield vs prior settlement yield.
    # Implied rate = 100 − futures price. Settlement ≈ previous close.
    settle_by_label = {}
    for row in sr3_results:
        lab = row.get("contract")
        px = row.get("settlement") if row.get("settlement") is not None else row.get("prev_close")
        if lab and px is not None and float(px) > 50:
            settle_by_label[lab] = round(100.0 - float(px), 4)

    # Reference-quarter metadata per contract (exact legs for tooltips; never guessed client-side).
    meta_by_label = {}
    for row in sr3_results:
        lab = row.get("contract")
        if lab:
            meta_by_label[lab] = {
                "ref_start": row.get("ref_start"),
                "ref_end": row.get("ref_end"),
                "last_price": row.get("last_price"),
                "settlement": row.get("settlement"),
                "prev_close": row.get("prev_close"),
            }

    chart = []
    for p in (path.get("points") or []):
        lab = p.get("contract")
        prior = settle_by_label.get(lab) if lab else None
        meta = meta_by_label.get(lab) or {}
        px = meta.get("last_price")
        if px is None:
            px = meta.get("settlement") if meta.get("settlement") is not None else meta.get("prev_close")
        chart.append({
            "x": p.get("month") or lab,
            "contract": lab,
            "ticker": p.get("ticker"),
            "implied_rate": p.get("implied_rate"),
            "prior_rate": prior,
            "source": p.get("source"),
            "vs_sofr_bps": p.get("vs_sofr_bps"),
            "ref_start": meta.get("ref_start"),
            "ref_end": meta.get("ref_end"),
            "futures_price": px,
        })

    # Compact reference-rate print for UI (CME/NYFed style)
    ref_print = []
    for code in ("SOFR", "EFFR", "OBFR", "TGCR", "BGCR"):
        row = ny_rates.get(code)
        if not row:
            continue
        ref_print.append({
            "code": code,
            "rate": row.get("rate"),
            "p1": row.get("p1"),
            "p25": row.get("p25"),
            "p75": row.get("p75"),
            "p99": row.get("p99"),
            "volume_bn": row.get("volume_bn"),
            "effective_date": row.get("effective_date"),
            "target_from": row.get("target_from"),
            "target_to": row.get("target_to"),
        })

    result = {
        "sr3": sr3_results,
        "sr1": sr1_results,
        "zq": zq_results,
        "treasury_futures": tsy_results,
        "live_count": live_count,
        "settled_count": settled_count,
        "live_sr1": live_sr1,
        "live_zq": live_zq,
        "live_tsy": live_tsy,
        "total_sr3": len(sr3_results),
        "fallback_count": fallback_count,
        "unavailable_count": unavailable_count,
        "history_available": settled_count,
        "history_note": (
            "CME-style board: Last · Change/Net · Settlement(prev) · High · Low · Volume. "
            "Live = delayed yfinance. Expired = FRED SOFR compound final settlement "
            "(Sep 2024 → last completed IMM quarter). Strip through Dec 2030."
        ),
        "quality_note": (
            "Modeled after CME STIR delivery: outrights grid + ICS spreads (SERFF) + packs/flies. "
            "SFR = SR3 3M SOFR. Strip U24→Z30. Settled legs use FRED SOFR compound (not invented). "
            "NY Fed = official overnight prints + percentiles + $bn volume + FOMC target. "
            "ALLOW_STIR_FALLBACK=0 by default."
        ),
        "path": path,
        "chart": chart,
        "spreads": spreads,
        "serff_board": serff_board,
        "nyfed": {
            "rates": ny_rates,
            "sofr_avg": (nyfed or {}).get("sofr_avg"),
            "target": (nyfed or {}).get("target"),
            "corridor": (nyfed or {}).get("corridor"),
            "as_of": (nyfed or {}).get("as_of"),
            "source": (nyfed or {}).get("source"),
            "note": (nyfed or {}).get("note"),
            "ref_print": ref_print,
        },
        "sofr": sofr_v,
        "effr": effr_v,
        "iorb": iorb_v,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": "yfinance+NYFed+FRED",
        "delivery_note": (
            "Inspired by CME rates UX: (1) outright strip with H/L/Vol, "
            "(2) intermarket SERFF board, (3) calendar/fly/pack pack, "
            "(4) cash reference print, (5) Treasury futures continuum."
        ),
    }
    ttl_cache.set_cached(key, result)
    return result

def _estimate_dividend_yield(ticker: str) -> tuple[float, str]:
    """
    Live dividend yield for BS q. Prefer yfinance info; fall back to 0 (no silent 1.3%).
    Returns (q_decimal, q_source).
    """
    try:
        import yfinance as yf
        info = yf.Ticker(ticker).info or {}
        dy = info.get("dividendYield")
        if dy is not None:
            q = float(dy)
            if math.isfinite(q) and q >= 0:
                # yfinance may return percent (1.3) or decimal (0.013) depending on version
                if q > 1.0:
                    q = q / 100.0
                return round(min(q, 0.25), 6), "yfinance.dividendYield"
        rate = info.get("dividendRate")
        price = info.get("currentPrice") or info.get("regularMarketPrice")
        if rate is not None and price and float(price) > 0:
            q = float(rate) / float(price)
            if math.isfinite(q) and q >= 0:
                return round(min(q, 0.25), 6), "yfinance.dividendRate/price"
    except Exception:
        pass
    return 0.0, "none_zero"


@app.get("/api/greeks/{ticker}")
async def get_greeks(
    ticker: str,
    r: float | None = Query(None, description="Risk-free decimal; default = live SOFR"),
    q: float | None = Query(None, description="Dividend yield decimal; default = yfinance estimate"),
):
    _check_ticker(ticker)
    from fastapi.responses import JSONResponse
    r_eff = r if r is not None else await _default_r()
    curve_pts = None if r is not None else await _term_curve_points()
    if r is None and r_eff is None and not curve_pts:
        return JSONResponse(
            status_code=503,
            content={"error": "Risk-free unavailable: SOFR and Treasury curve both missing (fail-closed)."},
        )
    if r_eff is None and curve_pts:
        r_eff = float(curve_pts[0][1])
    r_mode = "flat" if r is not None else ("term_structure" if curve_pts else "SOFR")
    if q is not None:
        q_eff = float(q)
        q_source = "query"
    else:
        q_eff, q_source = await asyncio.to_thread(_estimate_dividend_yield, ticker)
    key = f"greeks:{ticker}:{r_eff}:{q_eff}:{r_mode}:{q_source}"
    hit = ttl_cache.get_cached(key, GREEKS_CACHE_TTL)
    if not ttl_cache.is_miss(hit):
        return hit
    try:
        result = await asyncio.to_thread(build_greeks_surface, ticker, r_eff, q_eff, curve_pts)
        spot = result["spot"]
        surfaces = {}
        for greek in ["delta", "gamma", "vega", "theta", "vanna", "charm"]:
            # OTM-only interpolation — same wing convention as terminal heatmap / 3D surface
            surfaces[greek] = build_interpolated_surface(
                result["points"], greek, spot=spot, otm_only=True,
            )
        result["surfaces"] = surfaces
        result["gex_grid"] = build_gex_grid(result["points"], spot)
        result["charm_grid"] = build_charm_exposure_grid(result["points"], spot)
        result["as_of"] = datetime.now(timezone.utc).isoformat()
        result["source"] = "yfinance"
        result["r"] = r_eff
        result["q"] = q_eff
        result["r_source"] = "query" if r is not None else ("treasury_term + SOFR anchor" if curve_pts else "SOFR")
        result["q_source"] = q_source
        result["r_mode"] = r_mode
        result["units"] = {
            "delta": "dimensionless",
            "gamma": "per_dollar",
            "theta": "per_calendar_day",
            "vega": "per_1_vol_point",
            "charm": "per_calendar_day",
            "vanna": "raw_dV_dS_dsigma",
            "surface_side": "otm",
        }
        # Explicit provenance separation (P0): observed quotes -> derived
        # per-contract Greeks -> interpolated model grid -> unavailable holes.
        # `points` are derived per-contract BSM values (never observed provider
        # cells); `surfaces`/`gex_grid`/`charm_grid` are interpolated model
        # layers (linear interior + nearest hole-fill); holes in the model grid
        # are filled and must never be read as observed.
        result["surface_provenance"] = {
            "observed": "yfinance bid/ask/last quotes (two-sided midpoint when bid>0 and ask>0, else last)",
            "derived": "per-contract BSM Greeks solved from price_source (midpoint or last); iv_source mirrors price_source",
            "model": "interpolated OTM grid: linear interior + nearest-neighbor hole-fill (scipy griddata)",
            "model_kind": "interpolated-model",
            "model_method": "linear+nearest",
            "surface_side": "otm",
            "holes": "model grid holes are filled via nearest; observed-layer holes stay unavailable (null)",
            "oi": "missing OI is null (unavailable), observed zero stays 0.0; GEX/charm skip null OI",
            "price_provenance": "price_source is midpoint when two-sided, else last; last-derived IV/Greeks are not midpoint-observed or executable",
        }
        result["points_provenance"] = "derived per-contract BSM (price_source/iv_source per point); not observed provider cells"
        result["charm_note"] = (
            "Charm is per calendar day (Δ delta / day) — same unit as terminal 3D/heatmap. "
            "Surfaces use OTM quotes (put K<S, call K≥S). Exposure grid = charm × OI × 100 × S."
        )
        result["surface_note"] = (
            "Interpolated MODEL grid (linear interior + nearest hole-fill) of BSM-derived "
            "OTM Greeks from yfinance quotes — not observed provider cells. Observed-layer "
            "values are the per-contract derived points (price_source midpoint/last); "
            "unavailable cells stay null. Terminal 3D renders observed contract nodes "
            "separately from this model mesh. Levels can differ when r/q, IV solver, "
            "or chain source diverge."
        )
        ttl_cache.set_cached(key, result)
        return result
    except ValueError as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=400, content={"error": str(e)})
    except Exception as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=500,
            content={"error": f"{type(e).__name__}: {str(e)}"},
        )

@app.get("/api/greeks/{ticker}/history")
async def get_greeks_history(ticker: str, period: str = "1mo"):
    _check_ticker(ticker)
    if period not in _ALLOWED_PERIODS:
        raise HTTPException(status_code=400, detail="Invalid period.")
    key = f"greeks_history:{ticker}:{period}"
    hit = ttl_cache.get_cached(key, GREEKS_CACHE_TTL)
    if not ttl_cache.is_miss(hit):
        return hit
    try:
        import yfinance as yf
        import pandas as pd
        stock = yf.Ticker(ticker)
        hist = stock.history(period=period)
        if hist.empty:
            return {
                "ticker": ticker,
                "data": [],
                "as_of": datetime.now(timezone.utc).isoformat(),
                "source": "yfinance",
            }
        data = []
        for idx, row in hist.iterrows():
            data.append({
                "date": idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx),
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(float(row["Close"]), 2),
                "volume": int(row["Volume"]) if "Volume" in row else 0,
            })
        result = {
            "ticker": ticker,
            "data": data,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "source": "yfinance",
        }
        ttl_cache.set_cached(key, result)
        return result
    except Exception as e:
        return {
            "ticker": ticker,
            "data": [],
            "error": str(e),
            "as_of": datetime.now(timezone.utc).isoformat(),
        }

if __name__ == "__main__":
    import os

    import uvicorn
    # Loopback by default — production paths (start-production.sh, Node proxy)
    # never hit this block, and a bare `python main.py` on a shared box must
    # not publish the API (wildcard CORS included) on every interface.
    host = os.environ.get("RATES_WORKER_BIND_HOST", os.environ.get("MACROVOL_BIND_HOST", "127.0.0.1"))
    port = int(os.environ.get("RATES_WORKER_PORT", os.environ.get("MACROVOL_PORT", "8000")))
    print(f"rates-worker: starting on http://{host}:{port} (loopback-only private service)")
    uvicorn.run("main:app", host=host, port=port, reload=False)
