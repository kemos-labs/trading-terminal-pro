import yfinance as yf
import numpy as np
from scipy.stats import norm
from scipy.interpolate import griddata
from datetime import datetime
import math

from services.greeks_calculator import year_fraction_to_expiry, _POST_CLOSE_T

# Match VALIDATION_CONFIG.ranges / greeks_calculator (IV as decimal before *100 for grid).
_MIN_IV = 0.01
_MAX_IV = 3.0
# Grid is stored in percent (same as raw_points append).
_MIN_IV_PCT = _MIN_IV * 100
_MAX_IV_PCT = _MAX_IV * 100


def black_scholes_price(S, K, T, r, q, sigma, option_type="call"):
    if T <= 0 or sigma <= 0:
        return 0.0
    d1 = (math.log(S / K) + (r - q + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    if option_type == "call":
        return S * math.exp(-q * T) * norm.cdf(d1) - K * math.exp(-r * T) * norm.cdf(d2)
    else:
        return K * math.exp(-r * T) * norm.cdf(-d2) - S * math.exp(-q * T) * norm.cdf(-d1)


def implied_volatility(market_price, S, K, T, r, q, option_type="call"):
    if T <= 0 or market_price <= 0:
        return None
    # European discounted intrinsic (matches TS ivSolver / yahoo pipeline).
    disc_s = S * math.exp(-q * T)
    disc_k = K * math.exp(-r * T)
    intrinsic = max(0.0, disc_s - disc_k) if option_type == "call" else max(0.0, disc_k - disc_s)
    if market_price < intrinsic * 0.99:
        return None
    lo, hi = 0.001, 5.0
    for _ in range(200):
        mid = (lo + hi) / 2
        price = black_scholes_price(S, K, T, r, q, mid, option_type)
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


def _sanitize_iv_grid(primary: np.ndarray, linear: np.ndarray, nearest: np.ndarray) -> np.ndarray:
    """
    Build a market-truthful IV grid (percent).

    Cubic overshoot routinely invents negative / 100%+ junk IVs. Prefer linear
    (convex combination of observed IVs), accept cubic only when finite and in-band,
    then nearest, else NaN (serialized as null — never fake vol).
    """
    out = np.full_like(primary, np.nan, dtype=float)

    def in_band(arr: np.ndarray) -> np.ndarray:
        return np.isfinite(arr) & (arr >= _MIN_IV_PCT) & (arr <= _MAX_IV_PCT)

    # 1) Linear interior (no overshoot past sample min/max in practice for IV)
    m = in_band(linear)
    out[m] = linear[m]

    # 2) Cubic only where still empty and cubic is sane (smooth interior)
    m = ~np.isfinite(out) & in_band(primary)
    out[m] = primary[m]

    # 3) Nearest for residual holes inside data hull vicinity
    m = ~np.isfinite(out) & in_band(nearest)
    out[m] = nearest[m]

    return out


def build_iv_surface(
    ticker: str,
    r: float = 0.05,
    q: float = 0.0,
    strike_range: float = 0.3,
    curve_points=None,
) -> dict:
    stock = yf.Ticker(ticker)
    spot = stock.fast_info.get("lastPrice") or stock.fast_info.get("previousClose")
    if not spot:
        hist = stock.history(period="1d")
        spot = float(hist["Close"].iloc[-1])

    raw_points = []

    for exp_str in stock.options:
        # Continuous T to 16:00 ET — same ACT/365.25 as greeks_calculator / terminal.
        T = year_fraction_to_expiry(exp_str)
        # Include weeklies + 0DTE; skip only residual after close. Cap at 3y.
        if T <= _POST_CLOSE_T * 10 or T > 3.0:
            continue
        r_t = _r_for_T(T, r, curve_points)
        try:
            chain = stock.option_chain(exp_str)
        except Exception:
            continue

        # Calls + puts (OTM preferred) for denser smile / less call-only bias
        for opt_type, frame in (("call", chain.calls), ("put", chain.puts)):
            for _, row in frame.iterrows():
                K = float(row["strike"])
                if K < spot * (1 - strike_range) or K > spot * (1 + strike_range):
                    continue
                # Prefer OTM: calls above spot, puts below — reduces deep ITM IV noise
                if opt_type == "call" and K < spot * 0.98:
                    continue
                if opt_type == "put" and K > spot * 1.02:
                    continue
                bid = float(row.get("bid", 0) or 0)
                ask = float(row.get("ask", 0) or 0)
                volume = float(row.get("volume", 0) or 0)
                oi = float(row.get("openInterest", 0) or 0)
                # Liquid two-sided market: require bid; volume OR OI (after-hours
                # volume can be sparse while OI still marks a real book).
                if bid <= 0 or ask <= 0 or ask < bid:
                    continue
                if volume < 1 and oi < 10:
                    continue
                mid = (bid + ask) / 2
                iv = implied_volatility(mid, spot, K, T, r_t, q, opt_type)
                if iv and _MIN_IV < iv < _MAX_IV:
                    raw_points.append((T, K, iv * 100))

    if len(raw_points) < 10:
        raise ValueError(f"Not enough valid options data for {ticker} (got {len(raw_points)} points)")

    raw_points = np.array(raw_points)

    T_vals = np.linspace(raw_points[:, 0].min(), raw_points[:, 0].max(), 30)
    K_vals = np.linspace(raw_points[:, 1].min(), raw_points[:, 1].max(), 40)
    T_grid, K_grid = np.meshgrid(T_vals, K_vals)

    iv_grid_cubic = griddata(
        points=raw_points[:, :2],
        values=raw_points[:, 2],
        xi=(T_grid, K_grid),
        method="cubic",
    )
    iv_grid_linear = griddata(
        points=raw_points[:, :2],
        values=raw_points[:, 2],
        xi=(T_grid, K_grid),
        method="linear",
    )
    iv_grid_nearest = griddata(
        points=raw_points[:, :2],
        values=raw_points[:, 2],
        xi=(T_grid, K_grid),
        method="nearest",
    )
    iv_grid = _sanitize_iv_grid(iv_grid_cubic, iv_grid_linear, iv_grid_nearest)

    return {
        "ticker": ticker,
        "spot": float(spot),
        "expiries": [round(float(t), 4) for t in T_vals],
        "strikes": [round(float(k), 2) for k in K_vals],
        "iv_grid": [
            [round(float(v), 4) if v is not None and not np.isnan(v) else None for v in row]
            for row in iv_grid.T
        ],
        "timestamp": datetime.now().isoformat(),
        "raw_points": len(raw_points),
        "r_mode": "term_structure" if curve_points else "flat",
        "t_convention": "continuous_act365.25_to_16:00_ET",
        "iv_units": "percent",
    }
