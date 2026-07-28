#!/usr/bin/env python3
"""Fetch an option chain via yfinance and emit JSON on stdout.

Usage:
  python3 fetch_options.py SYMBOL [MAX_EXPIRIES]

MAX_EXPIRIES defaults to 12. Spot prefers fast_info over the heavy info dict.
"""
import json
import sys
import time
import yfinance as yf

symbol = sys.argv[1] if len(sys.argv) > 1 else "SPY"
try:
    max_expiries = int(sys.argv[2]) if len(sys.argv) > 2 else 12
except ValueError:
    max_expiries = 12
max_expiries = max(1, min(max_expiries, 24))

MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds


def yf_retry(fn, *args, **kwargs):
    """Call fn(*args, **kwargs) with retry + exponential backoff on rate-limit errors."""
    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            msg = str(e).lower()
            if "rate limit" in msg or "429" in msg or "too many requests" in msg:
                last_err = e
                if attempt < MAX_RETRIES - 1:
                    delay = RETRY_DELAY * (2 ** attempt)
                    time.sleep(delay)
                    continue
            raise
    raise last_err


def safe_int(v):
    try:
        if v is None or v != v:
            return 0
        return int(v)
    except Exception:
        return 0


def safe_float(v):
    try:
        if v is None or v != v:
            return 0.0
        return float(v)
    except Exception:
        return 0.0


def resolve_spot(ticker):
    """Prefer fast_info (cheap) then fall back to info fields."""
    try:
        fi = getattr(ticker, "fast_info", None)
        if fi is not None:
            for key in ("last_price", "lastPrice", "regular_market_price", "regularMarketPrice"):
                try:
                    v = fi[key] if hasattr(fi, "__getitem__") else getattr(fi, key, None)
                except Exception:
                    v = getattr(fi, key, None) if not hasattr(fi, "__getitem__") else None
                if v is not None:
                    f = safe_float(v)
                    if f > 0:
                        return f
    except Exception:
        pass
    try:
        info = ticker.info or {}
        for key in ("regularMarketPrice", "currentPrice", "previousClose"):
            f = safe_float(info.get(key))
            if f > 0:
                return f
    except Exception:
        pass
    return 0.0


try:
    ticker = yf.Ticker(symbol)
    spot = resolve_spot(ticker)

    all_exps = list(yf_retry(lambda: ticker.options) or [])
    expirations = all_exps[:max_expiries]
    quotes = []

    for exp in expirations:
        chain = yf_retry(lambda e=exp: ticker.option_chain(e))
        calls = chain.calls
        puts = chain.puts

        put_map = {row["strike"]: row for _, row in puts.iterrows()}

        for _, c in calls.iterrows():
            strike = safe_float(c["strike"])
            p = put_map.get(strike)

            quotes.append({
                "strike": strike,
                "expiry": exp,
                "type": "call",
                "bid": safe_float(c.get("bid")),
                "ask": safe_float(c.get("ask")),
                "last": safe_float(c.get("lastPrice")),
                "iv": safe_float(c.get("impliedVolatility")),
                "volume": safe_int(c.get("volume")),
                "openInterest": safe_int(c.get("openInterest")),
            })

            if p is not None:
                quotes.append({
                    "strike": strike,
                    "expiry": exp,
                    "type": "put",
                    "bid": safe_float(p.get("bid")),
                    "ask": safe_float(p.get("ask")),
                    "last": safe_float(p.get("lastPrice")),
                    "iv": safe_float(p.get("impliedVolatility")),
                    "volume": safe_int(p.get("volume")),
                    "openInterest": safe_int(p.get("openInterest")),
                })

    result = {
        "symbol": symbol,
        "spot": safe_float(spot),
        "expirations": expirations,
        "quotes": quotes,
        "timestamp": int(time.time() * 1000),
    }

    print(json.dumps(result))
except Exception as e:
    import traceback
    error_json = json.dumps({"error": str(e), "traceback": traceback.format_exc()})
    print(error_json)
    print(error_json, file=sys.stderr)
    sys.exit(1)
