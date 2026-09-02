/**
 * Shared in-process cache for upstream market data.
 * Many browser users → one cached snapshot; background warmer fills keys.
 * Railway (or any single Node process) is the sole owner of free-tier API keys.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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
const metrics = {
  freshHits: 0,
  misses: 0,
  upstreamLoads: 0,
  coalescedJoins: 0,
  staleServes: 0,
  loadErrors: 0,
  rejectedPayloads: 0,
};
const SAFE_PROVIDER_ERROR_CODES = new Set([
  'upstream-error',
  'budget_exhausted',
  'rate_limited',
  'timeout',
  'http_error',
  'provider_unavailable',
  'invalid_payload',
  'not_allowlisted',
  'insufficient_coverage',
]);

export function sanitizeProviderErrorCode(value) {
  if (SAFE_PROVIDER_ERROR_CODES.has(value)) return value;
  return typeof value === 'string' && /^http-[45][0-9]{2}$/.test(value) ? value : null;
}

function safeProviderError(error) {
  const code = sanitizeProviderErrorCode(error?.code);
  if (code) return code;
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599) return `http-${error.status}`;
  if (error?.name === 'AbortError') return 'timeout';
  return 'upstream-error';
}

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

function getLedgerPath() {
  const configured = String(process.env.QUOTA_LEDGER_PATH ?? '').trim();
  if (configured) return resolve(configured);
  return process.env.NODE_ENV === 'test' ? null : resolve(process.cwd(), '.data', 'quota-ledger.json');
}
let quotaLedgerPath = getLedgerPath();
let quotaLedgerPersistent = Boolean(quotaLedgerPath);
let quotaLedgerError = null;

function currentDaySuffix() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

function currentMonthSuffix() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
}

function safeEntries(value, suffix) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, count]) => (
    key.endsWith(`:${suffix}`) && Number.isSafeInteger(count) && count >= 0 ? [[key, count]] : []
  ));
}

function loadQuotaLedger() {
  quotaLedgerPath = getLedgerPath();
  quotaLedgerPersistent = Boolean(quotaLedgerPath);
  if (!quotaLedgerPath || !existsSync(quotaLedgerPath)) return;
  try {
    const parsed = JSON.parse(readFileSync(quotaLedgerPath, 'utf8'));
    for (const [key, count] of safeEntries(parsed?.daily, currentDaySuffix())) dayBudget.set(key, count);
    for (const [key, count] of safeEntries(parsed?.monthly, currentMonthSuffix())) monthBudget.set(key, count);
  } catch (error) {
    quotaLedgerPersistent = false;
    quotaLedgerError = `load-failed:${error?.code ?? 'invalid-ledger'}`;
  }
}

function persistQuotaLedger() {
  quotaLedgerPath = getLedgerPath();
  quotaLedgerPersistent = Boolean(quotaLedgerPath);
  if (!quotaLedgerPath || !quotaLedgerPersistent) return;
  try {
    const parent = dirname(quotaLedgerPath);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const tempPath = `${quotaLedgerPath}.${process.pid}.tmp`;
    const payload = JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      daily: Object.fromEntries([...dayBudget].filter(([key]) => key.endsWith(`:${currentDaySuffix()}`))),
      monthly: Object.fromEntries([...monthBudget].filter(([key]) => key.endsWith(`:${currentMonthSuffix()}`))),
    });
    writeFileSync(tempPath, payload, { encoding: 'utf8', mode: 0o600 });
    renameSync(tempPath, quotaLedgerPath);
    quotaLedgerError = null;
  } catch (error) {
    quotaLedgerPersistent = false;
    quotaLedgerError = `write-failed:${error?.code ?? 'io-error'}`;
  }
}

loadQuotaLedger();
persistQuotaLedger();

function assertBudgetMutation(provider, n) {
  if (typeof provider !== 'string' || !/^[a-z0-9._-]{1,64}$/i.test(provider)) {
    throw new TypeError('provider must be a bounded identifier');
  }
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new TypeError('quota increment must be a positive safe integer');
  }
}

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
  assertBudgetMutation(provider, n);
  const k = dayKey(provider);
  dayBudget.set(k, (dayBudget.get(k) || 0) + n);
  persistQuotaLedger();
  return dayBudget.get(k);
}

export function recordMonthBudget(provider, n = 1) {
  assertBudgetMutation(provider, n);
  const k = monthKey(provider);
  monthBudget.set(k, (monthBudget.get(k) || 0) + n);
  persistQuotaLedger();
  return monthBudget.get(k);
}

/** Test-only isolation hook; production callers should never reset quota state. */
export function clearBudgetsForTests() {
  dayBudget.clear();
  monthBudget.clear();
}

export function quotaLedgerStatus() {
  return {
    scope: quotaLedgerPersistent ? 'persistent-file-single-process' : 'process-local',
    persistent: quotaLedgerPersistent,
    healthy: quotaLedgerPersistent && quotaLedgerError == null,
    error: quotaLedgerError,
  };
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
 * @param {{ allowStaleOnError?: boolean, maxStaleMs?: number, force?: boolean, cacheIf?: (data: T) => boolean }} [opts]
 * @returns {Promise<{ data: T, fromCache: boolean, ageMs: number, stale?: boolean, coalesced?: boolean, providerError: string | null }>}
 *
 * `cacheIf` — when provided, only persist loader results that pass the predicate
 * (e.g. MacroVol proxy: cache only HTTP 2xx envelopes; never sticky 5xx bodies).
 * On loader throw with a prior hit and allowStaleOnError, returns last good data
 * with `stale: true` so clients can label provenance.
 */
export async function getOrFetch(key, ttlMs, loader, opts = {}) {
  const now = Date.now();
  const hit = touch(key);
  const hitAgeMs = hit ? now - hit.timestamp : null;
  if (!opts.force && hit && hitAgeMs < ttlMs) {
    metrics.freshHits += 1;
    return { data: hit.data, fromCache: true, ageMs: hitAgeMs, stale: false, coalesced: false, providerError: null };
  }

  metrics.misses += 1;
  let pending = inflight.get(key);
  const joinedInflight = Boolean(pending);
  if (joinedInflight) metrics.coalescedJoins += 1;
  if (!pending) {
    metrics.upstreamLoads += 1;
    pending = (async () => {
      try {
        const data = await loader();
        const okToCache = typeof opts.cacheIf === 'function' ? Boolean(opts.cacheIf(data)) : true;
        if (okToCache) {
          setEntry(key, { data, timestamp: Date.now() });
        } else {
          metrics.rejectedPayloads += 1;
        }
        return { data, stale: false, hitTs: null };
      } catch (err) {
        metrics.loadErrors += 1;
        const defaultMaxStaleMs = Math.max(ttlMs, ttlMs * 10);
        const maxStaleMs = Number.isFinite(opts.maxStaleMs)
          ? Math.max(0, Number(opts.maxStaleMs))
          : defaultMaxStaleMs;
        const staleAgeMs = hit ? Date.now() - hit.timestamp : Infinity;
        if (opts.allowStaleOnError !== false && hit && staleAgeMs <= maxStaleMs) {
          metrics.staleServes += 1;
          return { data: hit.data, stale: true, hitTs: hit.timestamp, providerError: safeProviderError(err) };
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
      coalesced: joinedInflight,
      providerError: result.providerError ?? 'upstream-error',
    };
  }
  const entry = store.get(key);
  const ageMs = entry ? Date.now() - entry.timestamp : 0;
  // A single-flight join shares a successful upstream fill; it is not a prior cache hit.
  return { data: result.data, fromCache: false, ageMs, stale: false, coalesced: joinedInflight, providerError: null };
}

export function peek(key) {
  return touch(key);
}

/** Test hook — drop every cached entry and in-flight promise (isolation). */
export function clearCacheForTests() {
  store.clear();
  inflight.clear();
  evictions = 0;
  for (const key of Object.keys(metrics)) metrics[key] = 0;
}

export function setCache(key, data) {
  setEntry(key, { data, timestamp: Date.now() });
}

export function deleteCache(key) {
  store.delete(key);
  inflight.delete(key);
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
  // Raw cache keys reveal which symbols every visitor is querying, live.
  // Ops-only: gate behind EXPOSE_KEY_STATUS (same flag as provider key booleans).
  const expose = process.env.EXPOSE_KEY_STATUS === '1';
  const keys = [];
  if (expose) {
    const now = Date.now();
    for (const [k, v] of store.entries()) {
      keys.push({ key: k, ageMs: now - v.timestamp });
    }
  }
  return {
    entries: store.size,
    maxEntries: MAX_CACHE_ENTRIES,
    evictions,
    inFlight: inflight.size,
    metrics: { ...metrics },
    keys,
    budgets: {
      ledger: quotaLedgerStatus(),
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
