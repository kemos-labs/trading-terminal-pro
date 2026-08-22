/**
 * Shared in-process cache for upstream market data.
 * Many browser users → one cached snapshot; background warmer fills keys.
 * Railway (or any single Node process) is the sole owner of free-tier API keys.
 */

/** @typedef {{ data: unknown, timestamp: number, source?: string }} CacheEntry */

const store = new Map();
/** @type {Map<string, Promise<unknown>>} */
const inflight = new Map();

/**
 * Cache size cap — the store is keyed by symbol × endpoint and grows without
 * bound otherwise (a symbol-search storm grows it forever). Map iteration
 * order is insertion order, so delete+set on access gives LRU semantics.
 * Override with MAX_CACHE_ENTRIES env var; 0 disables eviction.
 */
export const MAX_CACHE_ENTRIES = Math.max(0, parseInt(process.env.MAX_CACHE_ENTRIES || '5000', 10) || 5000);
/** Observability: total evictions since boot (surfaced via cacheStats). */
let evictions = 0;

function setEntry(key, entry) {
  store.delete(key);
  store.set(key, entry);
  if (MAX_CACHE_ENTRIES > 0) {
    while (store.size > MAX_CACHE_ENTRIES) {
      const oldest = store.keys().next().value;
      store.delete(oldest);
      evictions += 1;
    }
  }
}

/** Return the live entry for key, refreshing its LRU recency. */
function touch(key) {
  const hit = store.get(key);
  if (!hit) return null;
  store.delete(key);
  store.set(key, hit);
  return hit;
}

/** Per-day call counters for hard-budgeted providers. */
const dayBudget = new Map();
/** Per-calendar-month counters (TradingView RapidAPI 150/mo). */
const monthBudget = new Map();

function dayKey(provider) {
  const d = new Date();
  return `${provider}:${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

function monthKey(provider) {
  const d = new Date();
  return `${provider}:${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
}

export function getBudgetUsed(provider) {
  return dayBudget.get(dayKey(provider)) || 0;
}

export function getMonthBudgetUsed(provider) {
  return monthBudget.get(monthKey(provider)) || 0;
}

export function recordBudget(provider, n = 1) {
  const k = dayKey(provider);
  dayBudget.set(k, (dayBudget.get(k) || 0) + n);
  return dayBudget.get(k);
}

export function recordMonthBudget(provider, n = 1) {
  const k = monthKey(provider);
  monthBudget.set(k, (monthBudget.get(k) || 0) + n);
  return monthBudget.get(k);
}

/**
 * @param {string} provider
 * @param {number} maxPerDay
 * @param {number} [headroom=0.85] leave unused room under hard cap
 */
export function budgetAllows(provider, maxPerDay, headroom = 0.85) {
  return getBudgetUsed(provider) < Math.floor(maxPerDay * headroom);
}

/**
 * @param {string} provider
 * @param {number} maxPerMonth
 * @param {number} [headroom=0.85]
 */
export function monthBudgetAllows(provider, maxPerMonth, headroom = 0.85) {
  return getMonthBudgetUsed(provider) < Math.floor(maxPerMonth * headroom);
}

/**
 * @template T
 * @param {string} key
 * @param {number} ttlMs
 * @param {() => Promise<T>} loader
 * @param {{ allowStaleOnError?: boolean, force?: boolean, cacheIf?: (data: T) => boolean }} [opts]
 * @returns {Promise<{ data: T, fromCache: boolean, ageMs: number, stale?: boolean }>}
 *
 * `cacheIf` — when provided, only persist loader results that pass the predicate
 * (e.g. MacroVol proxy: cache only HTTP 2xx envelopes; never sticky 5xx bodies).
 * On loader throw with a prior hit and allowStaleOnError, returns last good data
 * with `stale: true` so clients can label provenance.
 */
export async function getOrFetch(key, ttlMs, loader, opts = {}) {
  const now = Date.now();
  const hit = touch(key);
  if (!opts.force && hit && now - hit.timestamp < ttlMs) {
    return { data: hit.data, fromCache: true, ageMs: now - hit.timestamp, stale: false };
  }

  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const data = await loader();
        const okToCache = typeof opts.cacheIf === 'function' ? !!opts.cacheIf(data) : true;
        if (okToCache) {
          setEntry(key, { data, timestamp: Date.now() });
        }
        return { data, stale: false, hitTs: null };
      } catch (err) {
        if (opts.allowStaleOnError !== false && hit) {
          return { data: hit.data, stale: true, hitTs: hit.timestamp };
        }
        throw err;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, pending);
  }

  const result = await pending;
  if (result.stale) {
    return {
      data: result.data,
      fromCache: true,
      ageMs: result.hitTs != null ? Date.now() - result.hitTs : 0,
      stale: true,
    };
  }
  const entry = store.get(key);
  const ageMs = entry ? Date.now() - entry.timestamp : 0;
  // Fresh network fill (or single-flight join on a miss) reports fromCache: false.
  return { data: result.data, fromCache: false, ageMs, stale: false };
}

export function peek(key) {
  return touch(key);
}

export function setCache(key, data) {
  setEntry(key, { data, timestamp: Date.now() });
}

/** Free-tier caps (documented; use with headroom 0.85). */
export const FMP_FREE_DAILY = 250;
export const ALPHA_VANTAGE_FREE_DAILY = 25;
/** Finnhub free is high per-minute; we still track daily for transparency. */
export const FINNHUB_SOFT_DAILY = 5_000;
/** RapidAPI TradingView free/hobby — user plan: 150/month. */
export const TRADINGVIEW_FREE_MONTHLY = 150;

/** TTLs aligned to provider limits (shared board refresh cadence). */
export const TTL = {
  OPTIONS_MS: 3 * 60_000,       // yfinance — 3 min shared chain
  OPTIONS_PROBE_MS: 60_000,
  DERIBIT_MS: 45_000,           // public market data
  FMP_QUOTE_MS: 5 * 60_000,     // free 250/day → ~every 5+ min
  FMP_HEAVY_MS: 30 * 60_000,    // history / rare endpoints
  BRIEFING_MS: 5 * 60_000,      // rates + macro snapshot for boot UI
  YF_ENRICH_MS: 10 * 60_000,
  FINNHUB_NEWS_MS: 5 * 60_000,  // company/market news
  FINNHUB_EARNINGS_MS: 30 * 60_000,
  FINNHUB_QUOTE_MS: 2 * 60_000, // SPY quote — shared 2 min
  /** Economic calendar — rarely changes; one shared pull for all visitors */
  FINNHUB_ECO_MS: 6 * 60 * 60_000,
  FINNHUB_META_MS: 24 * 60 * 60_000, // peers / recommendation
  /** Alpha Vantage ~25/day → ~every 90–120 min for a few symbols */
  ALPHA_VANTAGE_MS: 90 * 60_000,
  /** TradingView RapidAPI ~5/day usable → multi-hour TTL */
  TRADINGVIEW_MS: 6 * 60 * 60_000,
  /** Massive/Polygon-style prev bar — daily is enough */
  MASSIVE_PREV_MS: 60 * 60_000,
  DESK_STATUS_MS: 30_000,
};

/** FlashAlpha free ≈ 5/day — soft budget for levels only */
export const FLASHALPHA_FREE_DAILY = 5;

/** SAHMK (Tadawul) free tier = 100/day, ~15m delayed, 10/min burst. */
export const SAHMK_FREE_DAILY = 100;

export function cacheStats() {
  const keys = [];
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    keys.push({ key: k, ageMs: now - v.timestamp });
  }
  return {
    entries: store.size,
    maxEntries: MAX_CACHE_ENTRIES,
    evictions,
    keys,
    budgets: {
      fmp: { used: getBudgetUsed('fmp'), capDaily: FMP_FREE_DAILY },
      alphavantage: {
        used: getBudgetUsed('alphavantage'),
        capDaily: ALPHA_VANTAGE_FREE_DAILY,
      },
      finnhub: {
        used: getBudgetUsed('finnhub'),
        capDailySoft: FINNHUB_SOFT_DAILY,
      },
      tradingview: {
        usedMonth: getMonthBudgetUsed('tradingview'),
        capMonthly: TRADINGVIEW_FREE_MONTHLY,
        usedToday: getBudgetUsed('tradingview'),
      },
    },
  };
}
