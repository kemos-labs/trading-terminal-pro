import json
import sys
import time
import yfinance as yf

symbol = sys.argv[1] if len(sys.argv) > 1 else "SPY"
mode = sys.argv[2] if len(sys.argv) > 2 else "history"

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
    raise last_err  # type: ignore[misc]


def safe_float(v):
    try:
        if v is None or v != v:
            return 0.0
        return float(v)
    except Exception:
        return 0.0


def safe_int(v):
    try:
        if v is None or v != v:
            return 0
        return int(v)
    except Exception:
        return 0


def fetch_history(sym):
    """~1y of daily OHLCV, normalised to the same shape the frontend expects."""
    ticker = yf.Ticker(sym)
    hist = yf_retry(
        lambda: ticker.history(period="1y", interval="1d", auto_adjust=False)
    )
    rows = []
    for idx, row in hist.iterrows():
        rows.append({
            "date": idx.strftime("%Y-%m-%d"),
            "open": safe_float(row.get("Open")),
            "high": safe_float(row.get("High")),
            "low": safe_float(row.get("Low")),
            "close": safe_float(row.get("Close")),
            "volume": safe_int(row.get("Volume")),
        })
    return {"symbol": sym, "bars": rows}


def fetch_info(sym):
    """Curated fundamentals. yfinance `info` is slow/rate-limited; return whatever we get."""
    ticker = yf.Ticker(sym)
    info = {}
    try:
        info = yf_retry(lambda: ticker.info) or {}
    except Exception:
        info = {}
    officers = info.get("companyOfficers") or []
    rng = info.get("fiftyTwoWeekRange") or ""
    # Observed last print via fast_info (cheap); null when unavailable — never zero-filled.
    last_price = None
    prev_close = None
    try:
        fi = ticker.fast_info
        lp = getattr(fi, "last_price", None) or fi.get("last_price")
        pc = getattr(fi, "previous_close", None) or fi.get("previous_close")
        last_price = float(lp) if lp is not None else None
        prev_close = float(pc) if pc is not None else None
    except Exception:
        pass
    return {
        "symbol": sym,
        "lastPrice": last_price,
        "previousClose": prev_close,
        "companyName": info.get("shortName") or info.get("longName"),
        "marketCap": safe_float(info.get("marketCap")),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "website": info.get("website"),
        "description": info.get("longBusinessSummary"),
        "ceo": (officers[0].get("name") if officers else None),
        "exchange": info.get("exchange"),
        "beta": safe_float(info.get("beta")),
        "range": rng,
        "trailingPE": safe_float(info.get("trailingPE")),
        "dividendYield": safe_float(info.get("dividendYield")),
        "fullTimeEmployees": safe_int(info.get("fullTimeEmployees")),
    }


try:
    if mode == "info":
        result = fetch_info(symbol)
    else:
        result = fetch_history(symbol)
    print(json.dumps(result))
except Exception as e:
    import traceback
    error_json = json.dumps({"error": str(e), "traceback": traceback.format_exc()})
    print(error_json)
    print(error_json, file=sys.stderr)
    sys.exit(1)
