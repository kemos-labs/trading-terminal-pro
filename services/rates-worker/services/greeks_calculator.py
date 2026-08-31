import yfinance as yf
import numpy as np
from scipy.stats import norm
from scipy.interpolate import griddata
from datetime import datetime, date, timezone
import math

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore

_ET = ZoneInfo("America/New_York") if ZoneInfo else None
_SEC_PER_YEAR = 365.25 * 24 * 3600
_POST_CLOSE_T = 1.0 / _SEC_PER_YEAR  # ~1 second residual after 16:00 ET


def year_fraction_to_expiry(exp_str: str, now: datetime | None = None) -> float:
    """
    Continuous year fraction to regular-session close (16:00 America/New_York).
    Aligns with terminal `yearFractionToExpiry` (ACT/365.25) — not calendar days/365.
    After the close, returns a tiny residual so callers can skip expired slices.
    """
    parts = exp_str.strip().split("-")
    if len(parts) < 3:
        return _POST_CLOSE_T
    try:
        y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        return _POST_CLOSE_T
    if _ET is not None:
        close = datetime(y, m, d, 16, 0, 0, tzinfo=_ET)
        now_dt = now or datetime.now(timezone.utc)
        if now_dt.tzinfo is None:
            now_dt = now_dt.replace(tzinfo=timezone.utc)
        left = (close - now_dt).total_seconds()
    else:
        # Fallback without zoneinfo: treat close as UTC-4 approximation (EDT).
        close = datetime(y, m, d, 20, 0, 0, tzinfo=timezone.utc)
        now_dt = now or datetime.now(timezone.utc)
        left = (close - now_dt).total_seconds()
    if left <= 0:
        return _POST_CLOSE_T
    return left / _SEC_PER_YEAR


def bs_price(S, K, T, r, q, sigma, option_type="call"):
    if T <= 0 or sigma <= 0:
        return 0.0
    d1 = (math.log(S / K) + (r - q + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    if option_type == "call":
        return S * math.exp(-q * T) * norm.cdf(d1) - K * math.exp(-r * T) * norm.cdf(d2)
    else:
        return K * math.exp(-r * T) * norm.cdf(-d2) - S * math.exp(-q * T) * norm.cdf(-d1)


def compute_greeks(S, K, T, r, q, sigma, option_type="call"):
    """
    Black-Scholes greeks — market desk convention (aligned with terminal TS computeGreeks):
      θ, charm → per calendar day (/365)
      ν       → per 1 volatility point (/100)
      vanna   → ∂²V/∂S∂σ on raw-σ scale
    """
    if T <= 0 or sigma <= 0:
        return None
    d1 = (math.log(S / K) + (r - q + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    sqrt_T = math.sqrt(T)
    exp_qT = math.exp(-q * T)
    exp_rT = math.exp(-r * T)
    pdf_d1 = norm.pdf(d1)

    if option_type == "call":
        delta = exp_qT * norm.cdf(d1)
        theta = (
            -(S * exp_qT * pdf_d1 * sigma) / (2 * sqrt_T)
            - r * K * exp_rT * norm.cdf(d2)
            + q * S * exp_qT * norm.cdf(d1)
        ) / 365
    else:
        delta = -exp_qT * norm.cdf(-d1)
        theta = (
            -(S * exp_qT * pdf_d1 * sigma) / (2 * sqrt_T)
            + r * K * exp_rT * norm.cdf(-d2)
            - q * S * exp_qT * norm.cdf(-d1)
        ) / 365

    gamma = (exp_qT * pdf_d1) / (S * sigma * sqrt_T)
    vega = S * exp_qT * pdf_d1 * sqrt_T / 100  # per 1 vol point

    # Vanna: ∂²V/∂S∂σ (per 1 vol unit; scale carefully in UI)
    vanna = -exp_qT * pdf_d1 * d2 / sigma

    # Charm (delta decay) — Wikipedia / Haug analytic form, then /365 for per-day
    # call: -e^{-qT} [ n(d1)·(2(r-q)T − d2 σ√T)/(2T σ √T) − q N(d1) ]
    # put:  -e^{-qT} [ n(d1)·(2(r-q)T − d2 σ√T)/(2T σ √T) + q N(-d1) ]
    term = pdf_d1 * (2 * (r - q) * T - d2 * sigma * sqrt_T) / (2 * T * sigma * sqrt_T)
    if option_type == "call":
        charm_annual = -exp_qT * (term - q * norm.cdf(d1))
    else:
        charm_annual = -exp_qT * (term + q * norm.cdf(-d1))
    charm = charm_annual / 365

    return {
        "delta": round(delta, 4) if math.isfinite(delta) else 0,
        "gamma": round(gamma, 6) if math.isfinite(gamma) else 0,
        "vega": round(vega, 4) if math.isfinite(vega) else 0,
        "theta": round(theta, 4) if math.isfinite(theta) else 0,
        "vanna": round(vanna, 4) if math.isfinite(vanna) else 0,
        "charm": round(charm, 6) if math.isfinite(charm) else 0,
    }


def otm_points(points: list, spot: float) -> list:
    """Market OTM convention: put wing K < spot, call wing K ≥ spot."""
    out = []
    for p in points:
        K = p.get("K")
        t = p.get("type")
        if K is None or t not in ("call", "put"):
            continue
        if t == "put" and K < spot:
            out.append(p)
        elif t == "call" and K >= spot:
            out.append(p)
    return out


def compute_iv(market_price, S, K, T, r, q, option_type="call"):
    if T <= 0 or market_price <= 0:
        return None
    disc_s = S * math.exp(-q * T)
    disc_k = K * math.exp(-r * T)
    intrinsic = max(0.0, disc_s - disc_k) if option_type == "call" else max(0.0, disc_k - disc_s)
    if market_price < intrinsic * 0.99:
        return None
    lo, hi = 0.001, 5.0
    for _ in range(200):
        mid = (lo + hi) / 2
        price = bs_price(S, K, T, r, q, mid, option_type)
        if abs(price - market_price) < 1e-6:
            return mid
        if price > market_price:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def _r_for_T(T: float, r: float, curve_points=None) -> float:
    if not curve_points:
        return r
    try:
        from services.rate_risk import interpolate_r
        return interpolate_r(curve_points, T)
    except Exception:
        return r


def build_greeks_surface(ticker: str, r: float = 0.05, q: float = 0.0, curve_points=None) -> dict:
    stock = yf.Ticker(ticker)
    spot = stock.fast_info.get("lastPrice") or stock.fast_info.get("previousClose")
    if not spot:
        hist = stock.history(period="1d")
        spot = float(hist["Close"].iloc[-1])

    expiries = stock.options[:8]

    all_points = []

    for exp_str in expiries:
        # Continuous T to 16:00 ET (include 0DTE / weeklies). Skip only after close.
        T = year_fraction_to_expiry(exp_str)
        if T <= _POST_CLOSE_T * 10:
            continue
        r_t = _r_for_T(T, r, curve_points)
        try:
            chain = stock.option_chain(exp_str)
        except Exception:
            continue

        for _, row in chain.calls.iterrows():
            pt = _point_from_row(row, spot, T, r_t, q, "call")
            if pt:
                all_points.append(pt)

        for _, row in chain.puts.iterrows():
            pt = _point_from_row(row, spot, T, r_t, q, "put")
            if pt:
                all_points.append(pt)

    if not all_points:
        raise ValueError(f"No valid options data for {ticker}")

    nearest_T = min(set(p["T"] for p in all_points))
    atm_calls = [p for p in all_points if p["T"] == nearest_T and p["type"] == "call"]
    atm_point = min(atm_calls, key=lambda p: abs(p["K"] - spot)) if atm_calls else None

    gex_list = build_gex_strikes(all_points, spot)
    flip = compute_gex_flip(gex_list, spot)

    return {
        "ticker": ticker,
        "spot": float(spot),
        "timestamp": datetime.now().isoformat(),
        "total_points": len(all_points),
        "atm": atm_point,
        "gex": gex_list,
        "gex_flip": flip,
        "gex_convention": (
            "Naive dealer convention: call GEX = +γ·OI·100·S²·0.01, put GEX = −γ·OI·100·S²·0.01. "
            "Assumes dealers short calls / long puts. Not a position inventory model."
        ),
        "r": r,
        "q": q,
        "r_mode": "term_structure" if curve_points else "flat",
        "points": all_points,
    }


def _point_from_row(row, spot, T, r, q, option_type: str):
    K = float(row["strike"])
    if K < spot * 0.85 or K > spot * 1.15:
        return None
    bid = float(row.get("bid", 0) or 0)
    ask = float(row.get("ask", 0) or 0)
    last = float(row.get("lastPrice", 0) or 0)
    oi_raw = row.get("openInterest", 0)
    oi = float(oi_raw) if oi_raw and not (isinstance(oi_raw, float) and math.isnan(oi_raw)) else 0.0
    if bid > 0 and ask > 0:
        mid = (bid + ask) / 2
    elif last > 0:
        mid = last
    else:
        return None
    iv = compute_iv(mid, spot, K, T, r, q, option_type)
    # Keep in sync with VALIDATION_CONFIG.ranges (TS) and iv_calculator (Python).
    if not iv or iv < 0.01 or iv > 3.0:
        return None
    greeks = compute_greeks(spot, K, T, r, q, iv, option_type)
    if not greeks:
        return None
    return {
        "T": round(T, 4),
        "K": K,
        "iv": round(iv * 100, 2),
        "oi": oi,
        "type": option_type,
        **greeks,
    }


def _gex_unit(gamma: float, oi: float, spot: float, option_type: str) -> float:
    """Dollar gamma exposure for 1% spot move. Call +, put − (naive dealer convention)."""
    sign = 1 if option_type == "call" else -1
    return sign * gamma * oi * 100 * spot * spot * 0.01


def build_gex_grid(points: list, spot: float, n_T: int = 25, n_K: int = 35) -> dict:
    data = []
    for p in points:
        g = p.get("gamma")
        oi = p.get("oi", 0)
        if g is None or not oi:
            continue
        gex = _gex_unit(g, oi, spot, p["type"])
        if math.isfinite(gex):
            data.append((p["T"], p["K"], gex))
    if len(data) < 10:
        return {"T_vals": [], "K_vals": [], "grid": []}
    return _interpolate_grid(data, n_T, n_K, decimals=2)


def build_gex_strikes(points: list, spot: float) -> list:
    gex_by_strike = {}
    for p in points:
        K = p["K"]
        g = p.get("gamma")
        oi = p.get("oi", 0)
        if g and oi and math.isfinite(g):
            gex = _gex_unit(g, oi, spot, p["type"])
            if math.isfinite(gex):
                gex_by_strike[K] = gex_by_strike.get(K, 0) + gex
    return [{"strike": k, "gex": round(v, 2)} for k, v in sorted(gex_by_strike.items()) if math.isfinite(v)]


def compute_gex_flip(gex_list: list, spot: float) -> dict | None:
    """
    Cumulative net-GEX zero-crossing (SpotGamma-style), aligned with terminal
    `flipFromSeries` in src/lib/options/analytics.ts and the glossary.

    Walk strikes low→high; flip = first strike where running sum crosses from
    negative to ≥0. If no such cross, fall back to the strike of min |running sum|.
    """
    if not gex_list:
        return None
    # Ensure low→high strike order (build_gex_strikes already sorts, but be safe).
    ordered = sorted(gex_list, key=lambda g: g["strike"])
    cumulative = 0.0
    prev_cum = 0.0
    flip = None
    for p in ordered:
        prev_cum = cumulative
        cumulative += float(p["gex"])
        if flip is None and prev_cum < 0 and cumulative >= 0:
            flip = float(p["strike"])
    if flip is None:
        best = ordered[0]
        run = 0.0
        best_abs = float("inf")
        for p in ordered:
            run += float(p["gex"])
            a = abs(run)
            if a < best_abs:
                best_abs = a
                best = p
        flip = float(best["strike"])
    return {
        "strike": round(flip, 2),
        "spot_vs_flip": "above" if spot > flip else "below" if spot < flip else "at",
        "net_gex": round(sum(float(g["gex"]) for g in ordered), 2),
        "method": "cumulative",
    }


def build_charm_exposure_grid(points: list, spot: float, n_T: int = 25, n_K: int = 35) -> dict:
    """
    Charm exposure ≈ BS-signed charm_per_day × OI × 100 × S
    (dollar-delta change per day). Matches terminal analytics.ts — uses model-signed
    charm; does NOT re-flip puts (GEX still uses call+/put− naive convention).
    """
    data = []
    for p in points:
        c = p.get("charm")
        oi = p.get("oi", 0)
        if c is None or not oi:
            continue
        # Dollar-delta decay per calendar day (BS-signed charm)
        exposure = c * oi * 100 * spot
        if math.isfinite(exposure):
            data.append((p["T"], p["K"], exposure))
    if len(data) < 10:
        return {"T_vals": [], "K_vals": [], "grid": []}
    return _interpolate_grid(data, n_T, n_K, decimals=2)


def build_interpolated_surface(
    points: list,
    greek_key: str,
    n_T: int = 25,
    n_K: int = 35,
    *,
    spot: float | None = None,
    otm_only: bool = True,
) -> dict:
    """
    Interpolate a greek surface. Default otm_only=True so call/put deltas are
    not averaged into nonsense near ATM (matches terminal 3D / heatmap OTM).
    """
    src = points
    if otm_only and spot is not None and spot > 0:
        filtered = otm_points(points, spot)
        if len(filtered) >= 10:
            src = filtered
    data = [(p["T"], p["K"], p[greek_key]) for p in src if p.get(greek_key) is not None]
    if len(data) < 10:
        return {"T_vals": [], "K_vals": [], "grid": []}
    return _interpolate_grid(data, n_T, n_K, decimals=6)


def _interpolate_grid(
    data: list,
    n_T: int,
    n_K: int,
    decimals: int = 4,
    *,
    value_min: float | None = None,
    value_max: float | None = None,
) -> dict:
    """
    Scatter → regular grid. Linear interior (no cubic overshoot) + nearest for
    residual holes. Optional value band drops non-physical cells (e.g. IV).
    """
    arr = np.array(data)
    T_vals = np.linspace(arr[:, 0].min(), arr[:, 0].max(), n_T)
    K_vals = np.linspace(arr[:, 1].min(), arr[:, 1].max(), n_K)
    T_grid, K_grid = np.meshgrid(T_vals, K_vals)
    linear = griddata(arr[:, :2], arr[:, 2], (T_grid, K_grid), method="linear")
    nearest = griddata(arr[:, :2], arr[:, 2], (T_grid, K_grid), method="nearest")

    def in_band(a: np.ndarray) -> np.ndarray:
        ok = np.isfinite(a)
        if value_min is not None:
            ok &= a >= value_min
        if value_max is not None:
            ok &= a <= value_max
        return ok

    grid = np.full_like(linear, np.nan, dtype=float)
    m = in_band(linear)
    grid[m] = linear[m]
    m = ~np.isfinite(grid) & in_band(nearest)
    grid[m] = nearest[m]

    return {
        "T_vals": [round(float(t), 4) for t in T_vals],
        "K_vals": [round(float(k), 2) for k in K_vals],
        "grid": [[round(float(v), decimals) if not np.isnan(v) else None for v in row] for row in grid.T],
    }
