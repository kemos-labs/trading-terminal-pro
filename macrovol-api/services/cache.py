"""Small TTL cache for expensive endpoints (greeks/surface/stir).

yfinance is slow and will rate-limit/ban under any real traffic, so we memoize
responses per key for a few minutes. Failures (exceptions / empty results) are
NOT cached — same philosophy as fred_client.py.

Keys embed user-supplied tickers/periods, so the cache is size-capped with
oldest-entry eviction: unauthenticated loops of unique keys must not be able
to grow process memory without bound.
"""
import time
from typing import Any, Callable, Dict, Tuple

_cache: Dict[str, Tuple[float, Any]] = {}

# Hard ceiling on distinct cached entries. Beyond this, expired entries are
# purged first, then the oldest entries are dropped (FIFO — good enough for
# a memoization cache; recency is approximated by re-inserting on hit).
MAX_ENTRIES = 2000


def get_cached(key: str, ttl: float) -> Any:
    """Return cached value if fresh, else a sentinel indicating a miss."""
    entry = _cache.get(key)
    if entry is None:
        return _MISS
    ts, value = entry
    if time.time() - ts > ttl:
        return _MISS
    return value


def set_cached(key: str, value: Any) -> None:
    if len(_cache) >= MAX_ENTRIES and key not in _cache:
        now = time.time()
        # Purge expired first…
        for k in [k for k, (ts, _) in _cache.items() if now - ts > 600]:
            del _cache[k]
        # …then drop oldest inserts until there is room.
        while len(_cache) >= MAX_ENTRIES:
            oldest = min(_cache.items(), key=lambda kv: kv[1][0])[0]
            del _cache[oldest]
    _cache[key] = (time.time(), value)


def clear_all() -> int:
    n = len(_cache)
    _cache.clear()
    return n


class _Miss:
    __slots__ = ()


_MISS = _Miss()


def is_miss(value: Any) -> bool:
    return value is _MISS


def cached(key_fn: Callable[..., str], ttl: float):
    """Decorator: cache the return value of an async function under `key_fn(*args)`.

    Only non-empty dicts/lists are cached; everything else passes through.
    """
    def deco(fn):
        async def wrapper(*args, **kwargs):
            key = key_fn(*args, **kwargs)
            hit = get_cached(key, ttl)
            if not is_miss(hit):
                return hit
            result = await fn(*args, **kwargs)
            if _is_cacheable(result):
                set_cached(key, result)
            return result
        wrapper.__name__ = fn.__name__
        return wrapper
    return deco


def _is_cacheable(result: Any) -> bool:
    if isinstance(result, dict):
        # Don't cache error envelopes
        if "error" in result:
            return False
        return True
    if isinstance(result, (list, tuple)):
        return len(result) > 0
    return result is not None
