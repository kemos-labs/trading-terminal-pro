/**
 * Shared API logic used by BOTH the standalone Fastify server (server.js)
 * and the Vercel serverless functions under /api.
 *
 * Plain ESM (no TypeScript) so it loads directly under Node and Vercel.
 * Keeping it in one place prevents the two deployments from drifting.
 */

import {
  getOrFetch,
  TTL,
  budgetAllows,
  recordBudget,
  FMP_FREE_DAILY,
  getBudgetUsed,
} from './upstreamCache.js';

export const FMP_BASE = 'https://financialmodelingprep.com/stable';

// Endpoints the FMP proxy is allowed to forward. Guarded on both deployments.
// `options/symbol` powers the live option-chain / volatility surface.
// `historical-price-eod/light`, `profile`, `news/stock-latest`, `earnings-calendar`
// power the Quote tab (price chart, fundamentals, news, earnings).
export const FMP_ALLOWED_ENDPOINTS = new Set([
  'quote',
  'treasury-rates',
  'etf/holdings',
  'options/symbol',
  'historical-price-eod/light',
  'profile',
  'news/stock-latest',
  'earnings-calendar',
]);

export function isFmpEndpointAllowed(endpoint) {
  // Dot-segment traversal bypass: fetch() normalizes `.`/`..`/`%2e%2e` upstream,
  // so a raw prefix check like "quote/" would let `/quote/../stable/<anything>`
  // reach ANY paid FMP endpoint. Reject dot segments before matching.
  const lower = String(endpoint).toLowerCase();
  if (lower.includes('%2e')) return false;
  if (lower.split('/').some((seg) => seg === '.' || seg === '..')) return false;
  return [...FMP_ALLOWED_ENDPOINTS].some(
    (e) => endpoint === e || endpoint.startsWith(`${e}?`) || endpoint.startsWith(`${e}/`),
  );
}

// Server-side mirror cache for FMP responses. Protects the daily quota when
// multiple browser tabs / clients hit the same endpoint within the window.
const fmpCache = new Map();
const fmpInflight = new Map();
export const __testHooks = Object.freeze({ fmpInflight });
const FMP_CACHE_TTL = 60_000; // 60s

export function canonicalizeFmpEndpoint(endpoint) {
  const raw = String(endpoint || '');
  const [path, query = ''] = raw.split('?');
  if (raw.indexOf('?') !== raw.lastIndexOf('?') || /%(?![0-9A-Fa-f]{2})/.test(query)) return null;
  if (!isFmpEndpointAllowed(path)) return null;
  const params = new URLSearchParams(query);
  if ([...params].length > 16) return null;
  for (const [key, value] of params) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(key) || value.length > 256) return null;
  }
  params.sort();
  const normalizedQuery = params.toString();
  return normalizedQuery ? `${path}?${normalizedQuery}` : path;
}

/**
 * Forward an allowed FMP endpoint (path + query, without base) and return
 * { status, body }. Used by both the Fastify server and the Vercel function.
 */
export async function proxyFmp(endpoint, apiKey, base = FMP_BASE) {
  const canonicalEndpoint = canonicalizeFmpEndpoint(endpoint);
  if (!canonicalEndpoint) return { status: 400, body: { error: 'Invalid FMP endpoint or query' } };
  if (!apiKey) {
    return { status: 503, body: { error: 'FMP API key not configured on server' } };
  }
  const cached = fmpCache.get(canonicalEndpoint);
  if (cached && Date.now() - cached.t < FMP_CACHE_TTL) {
    fmpCache.delete(canonicalEndpoint);
    fmpCache.set(canonicalEndpoint, cached);
    return { status: 200, body: cached.b, fromCache: true, upstreamFill: false };
  }
  const pending = fmpInflight.get(canonicalEndpoint);
  if (pending) return pending.then((result) => ({ ...result, coalesced: true }));
  if (fmpInflight.size >= 500) {
    return { status: 503, body: { error: 'FMP proxy overloaded' }, fromCache: false, upstreamFill: false };
  }
  if (!budgetAllows('fmp', FMP_FREE_DAILY)) {
    return { status: 429, body: { error: 'FMP daily budget exhausted', cap: FMP_FREE_DAILY, used: getBudgetUsed('fmp') }, fromCache: false, upstreamFill: false };
  }
  const load = (async () => {
    const sep = canonicalEndpoint.includes('?') ? '&' : '?';
    const target = `${base}/${canonicalEndpoint}${sep}apikey=${apiKey}`;
    // Quota is charged at the actual upstream attempt boundary, including failures.
    recordBudget('fmp', 1);
    let timer;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(target, { signal: controller.signal });
      if (!res.ok) return { status: res.status, body: { error: 'FMP API error', status: res.status }, fromCache: false, upstreamFill: true };
      const json = await res.json();
      fmpCache.delete(canonicalEndpoint);
      fmpCache.set(canonicalEndpoint, { t: Date.now(), b: json });
      while (fmpCache.size > 500) fmpCache.delete(fmpCache.keys().next().value);
      return { status: 200, body: json, fromCache: false, upstreamFill: true };
    } catch (err) {
      return { status: 502, body: { error: 'FMP proxy error', detail: err.message }, fromCache: false, upstreamFill: true };
    } finally {
      clearTimeout(timer);
      fmpInflight.delete(canonicalEndpoint);
    }
  })();
  fmpInflight.set(canonicalEndpoint, load);
  return load;
}

/**
 * Shared, budget-gated FMP quote for any route/stream that needs spot ticks.
 *
 * Uses the SAME cache entry as the /api/fmp/stable/* proxy (`fmp:<url>`), so
 * the SSE stream, the REST proxy and the warmer all share one upstream call
 * per TTL window per symbol — N clients never mean N× upstream calls.
 *
 * Budget: records one FMP call per cold fill; when the daily free-tier budget
 * is exhausted, serves the last good value via allowStaleOnError instead of
 * silently burning quota (the SSE stream previously bypassed accounting).
 *
 * @returns {Promise<{ quote: object|null, ageMs: number, stale: boolean, error: string|null }>}
 */
export async function fetchFmpQuoteShared(symbol, apiKey, base = FMP_BASE) {
  const endpoint = `quote?symbol=${encodeURIComponent(symbol)}`;
  const key = `fmp:${endpoint}`;
  if (!apiKey) {
    return { quote: null, ageMs: 0, stale: false, error: 'no_api_key' };
  }
  try {
    const { data, ageMs, stale } = await getOrFetch(
      key,
      TTL.FMP_QUOTE_MS,
      async () => {
        if (!budgetAllows('fmp', FMP_FREE_DAILY)) {
          const err = new Error('FMP daily budget exhausted');
          err.code = 'budget_exhausted';
          throw err;
        }
        const { status, body } = await proxyFmp(endpoint, apiKey, base);
        if (status !== 200 || !Array.isArray(body) || !body[0]) {
          throw new Error(body?.error || `FMP ${status}`);
        }
        return body[0];
      },
      { allowStaleOnError: true },
    );
    return { quote: data ?? null, ageMs, stale, error: null };
  } catch (err) {
    return { quote: null, ageMs: 0, stale: false, error: err?.code || err.message || 'fmp_failed' };
  }
}

// Deterministic PRNG so the synthetic SPY history is stable across requests.
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Memoized: the 30-year series is expensive to regenerate and should be
// identical on every request, so compute it once and reuse.
let spyHistoryCache = null;
let spyHistoryLiveCache = null;
let spyHistoryLiveAt = 0;
const SPY_LIVE_TTL = 6 * 60 * 60 * 1000; // 6h

/** Synthetic fallback (offline / no API key). */
export function buildSpyHistorySynthetic() {
  if (spyHistoryCache) return spyHistoryCache;
  const rand = mulberry32(0x5dee5);
  const data = [];
  let price = 40;
  let rv = 18;
  const start = new Date('1993-01-29');
  const now = new Date();

  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const ret = (rand() - 0.5) * 0.02;
    price *= 1 + ret;
    rv = Math.max(8, Math.min(80, rv + (rand() - 0.5) * 2));
    data.push({
      date: d.toISOString().slice(0, 10),
      close: Math.round(price * 100) / 100,
      return: Math.round(ret * 100000) / 100000,
      logReturn: Math.round(Math.log(1 + ret) * 100000) / 100000,
      // Synthetic realized-vol path — NOT CBOE VIX / VIXCLS.
      rv_20d_pct: Math.round(rv * 10) / 10,
    });
  }

  spyHistoryCache = { symbol: 'SPY', data, source: 'synthetic' };
  return spyHistoryCache;
}

/** @deprecated use buildSpyHistory / buildSpyHistoryAsync */
export function buildSpyHistory() {
  return buildSpyHistorySynthetic();
}

/**
 * Build SPY daily history from real closes.
 * Prefer FMP when an API key is set. Never inject synthetic demo series unless
 * opts.allowSynthetic === true (offline/tests only).
 * Returns { symbol, data, source: 'fmp' | 'yfinance' | 'none' | 'synthetic' }.
 */
export function barsToSpyHistoryPayload(sorted, source) {
  const data = [];
  for (let i = 0; i < sorted.length; i++) {
    const close = sorted[i].close;
    const prev = i > 0 ? sorted[i - 1].close : close;
    const ret = prev > 0 ? (close - prev) / prev : 0;
    // 20d close-to-close realized vol (annualized %). NOT CBOE VIX / FRED VIXCLS.
    let rv_20d_pct = 18;
    if (i >= 20) {
      let sum = 0;
      let sum2 = 0;
      for (let j = i - 19; j <= i; j++) {
        const p0 = sorted[j - 1] ? sorted[j - 1].close : sorted[j].close;
        const r = p0 > 0 ? Math.log(sorted[j].close / p0) : 0;
        sum += r;
        sum2 += r * r;
      }
      const n = 20;
      const mean = sum / n;
      const var_ = Math.max(0, sum2 / n - mean * mean);
      rv_20d_pct = Math.min(80, Math.max(8, Math.sqrt(var_ * 252) * 100));
    }
    data.push({
      date: sorted[i].date,
      close: Math.round(close * 100) / 100,
      return: Math.round(ret * 100000) / 100000,
      logReturn: Math.round(Math.log(1 + ret) * 100000) / 100000,
      rv_20d_pct: Math.round(rv_20d_pct * 10) / 10,
    });
  }
  return { symbol: 'SPY', data, source };
}

export async function buildSpyHistoryAsync(apiKey, base = FMP_BASE, opts = {}) {
  const allowSynthetic = opts.allowSynthetic === true;
  const now = Date.now();
  if (spyHistoryLiveCache && now - spyHistoryLiveAt < SPY_LIVE_TTL) {
    return spyHistoryLiveCache;
  }
  if (!apiKey) {
    return allowSynthetic
      ? buildSpyHistorySynthetic()
      : { symbol: 'SPY', data: [], source: 'none' };
  }

  try {
    // FMP free tier supports historical-price-eod/light; pull a long window.
    const endpoint = 'historical-price-eod/light?symbol=SPY&limit=7500';
    const { status, body } = await proxyFmp(endpoint, apiKey, base);
    if (status !== 200 || !body) {
      return allowSynthetic
        ? buildSpyHistorySynthetic()
        : { symbol: 'SPY', data: [], source: 'none' };
    }

    let bars = [];
    if (Array.isArray(body)) bars = body;
    else if (body && Array.isArray(body.historical)) bars = body.historical;
    if (bars.length < 50) {
      return allowSynthetic
        ? buildSpyHistorySynthetic()
        : { symbol: 'SPY', data: [], source: 'none' };
    }

    // FMP typically returns newest-first; sort ascending by date.
    const sorted = bars
      .map((b) => ({
        date: String(b.date ?? ''),
        close: Number(b.close),
      }))
      .filter((b) => b.date && isFinite(b.close) && b.close > 0)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    if (sorted.length < 50) {
      return allowSynthetic
        ? buildSpyHistorySynthetic()
        : { symbol: 'SPY', data: [], source: 'none' };
    }

    spyHistoryLiveCache = barsToSpyHistoryPayload(sorted, 'fmp');
    spyHistoryLiveAt = now;
    return spyHistoryLiveCache;
  } catch {
    return allowSynthetic
      ? buildSpyHistorySynthetic()
      : { symbol: 'SPY', data: [], source: 'none' };
  }
}
