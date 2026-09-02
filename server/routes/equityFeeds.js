/**
 * Equity chain + yfinance enrichment routes — restored (Phase 1).
 * Recovers the registered-but-deleted handlers for /api/options, /api/yf/* that
 * the Vol/Positioning/Trade desks call on first use. Deletion happened during the
 * server decomposition (5a6e8d0); implementations recovered from 64c90fa/166dd08.
 *
 * Data rules: real yfinance/FMP data or typed fail-closed errors — never synthetic.
 * Quota: one upstream fill per cache key + TTL via shared upstreamCache (single-flight).
 */
import { execFile as execFileImpl } from 'node:child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getOrFetch, peek, TTL } from '../../api/upstreamCache.js';
import { validateSymbol } from '../validation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Indirection point for the upstream process boundary. Tests override this to
 * stub the yfinance python fetchers deterministically (process spawns are not
 * interceptable in-band). Production always uses the real execFile.
 */
export const __testHooks = { execFile: execFileImpl };
const runProc = (...args) => __testHooks.execFile(...args);

function runOptionsFetcher(symbol, maxArg) {
  return new Promise((resolve, reject) => {
    const args = [join(__dirname, '../../fetch_options.py'), symbol];
    if (maxArg) args.push(String(maxArg));
    // yfinance often needs 45–90s for multi-expiry equity chains.
    runProc('python3', args, { timeout: maxArg ? 30_000 : 90_000 }, (err, stdout, stderr) => {
      const tryParse = (raw) => {
        if (!raw) return null;
        try {
          const data = JSON.parse(String(raw).trim().split('\n').filter(Boolean).pop());
          if (data && !data.error && Array.isArray(data.quotes)) return data;
          if (data?.error) return { __err: data.error };
        } catch { /* fall through */ }
        return null;
      };
      const parsed = tryParse(stdout);
      if (parsed && !parsed.__err) return resolve(parsed);
      if (err) {
        const detail = parsed?.__err || stderr || stdout?.slice(0, 500) || err.message;
        const failure = new Error(detail);
        if (err.code) failure.code = err.code;
        return reject(failure);
      }
      if (parsed?.__err) return reject(new Error(parsed.__err));
      reject(new Error('Invalid response from data fetcher'));
    });
  });
}

/** yfinance enrichment runner (history/info) — same JSON-on-stdout contract. */
function runYf(symbol, mode) {
  return new Promise((resolve, reject) => {
    runProc('python3', [join(__dirname, '../../fetch_yf.py'), symbol, mode], { timeout: 60_000 }, (err, stdout, stderr) => {
      // Accept JSON even if yfinance wrote rate-limit noise to stderr.
      try {
        const line = String(stdout || '').trim().split('\n').filter(Boolean).pop();
        if (line) {
          const data = JSON.parse(line);
          if (!data.error) return resolve(data);
          return reject(new Error(data.error));
        }
      } catch { /* fall through to err */ }
      if (err) {
        const detail = stderr || stdout?.slice(0, 500) || err.message;
        return reject(new Error(detail));
      }
      reject(new Error('Invalid response from yfinance fetcher'));
    });
  });
}

function finiteNumber(value, { min = -Infinity } = {}) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? n : null;
}

function cacheMetadata(result) {
  const stale = Boolean(result?.stale);
  const hit = Boolean(result?.fromCache);
  return {
    state: result?.providerError && stale ? 'stale' : result?.providerError ? 'unavailable' : stale ? 'stale' : hit ? 'fresh' : 'miss',
    hit,
    ageMs: Number.isFinite(result?.ageMs) ? Math.max(0, result.ageMs) : 0,
    stale,
    coalesced: Boolean(result?.coalesced),
    providerError: result?.providerError ?? null,
  };
}

function normalizeYfHistory(payload, symbol) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.bars)) {
    const error = new Error('Invalid yfinance history payload');
    error.code = 'invalid_payload';
    throw error;
  }
  const bars = payload.bars.filter((bar) => bar && typeof bar === 'object' && !Array.isArray(bar)).map((bar) => ({
    date: String(bar.date ?? ''),
    open: finiteNumber(bar.open, { min: 0 }),
    high: finiteNumber(bar.high, { min: 0 }),
    low: finiteNumber(bar.low, { min: 0 }),
    close: finiteNumber(bar.close, { min: 0 }),
    volume: finiteNumber(bar.volume, { min: 0 }),
  }));
  const usable = bars.filter((bar) => bar.date && bar.open != null && bar.high != null && bar.low != null && bar.close != null && bar.volume != null && bar.open > 0 && bar.high > 0 && bar.low > 0 && bar.close > 0);
  if (!usable.length && payload.bars.length) {
    const error = new Error('No usable yfinance history bars');
    error.code = 'invalid_payload';
    throw error;
  }
  return { symbol, bars: usable, coverage: { observed: usable.length, dropped: payload.bars.length - usable.length }, warnings: usable.length < payload.bars.length ? ['invalid-bars-dropped'] : [] };
}

function normalizeYfInfo(payload, symbol) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const error = new Error('Invalid yfinance info payload');
    error.code = 'invalid_payload';
    throw error;
  }
  const numericFields = new Set(['marketCap', 'beta', 'lastPrice', 'price', 'previousClose', 'volume']);
  const normalized = Object.fromEntries(Object.entries(payload).map(([key, value]) => [
    key,
    numericFields.has(key) ? finiteNumber(value, { min: key === 'marketCap' || key === 'volume' ? 0 : -Infinity }) : typeof value === 'number' ? (Number.isFinite(value) ? value : null) : value,
  ]));
  return { ...normalized, symbol: String(normalized.symbol ?? symbol) };
}

export async function getOptionChainSnapshot(symbol, { probe = false, max = null } = {}) {
  const maxArg = Number.isFinite(Number(max)) && Number(max) > 0
    ? Math.min(Math.trunc(Number(max)), 12)
    : null;
  const cacheKey = `options:${symbol}:${maxArg || 'full'}`;

  const stale = peek(cacheKey);
  if (stale && Date.now() - stale.timestamp < TTL.OPTIONS_MS) {
    const contracts = Array.isArray(stale.data?.quotes) ? stale.data.quotes.length : 0;
    const cache = {
      hit: true,
      ageMs: Math.max(0, Date.now() - stale.timestamp),
      stale: false,
      coalesced: false,
      providerError: null,
    };
    if (probe) return { available: contracts >= 10, contracts, fromCache: true, _cache: cache };
    return { ...stale.data, _cache: cache };
  }

  const {
    data: result,
    fromCache,
    ageMs,
    stale: wasStale,
    coalesced,
    providerError,
  } = await getOrFetch(
    cacheKey,
    probe ? TTL.OPTIONS_PROBE_MS : TTL.OPTIONS_MS,
    () => runOptionsFetcher(symbol, maxArg),
    { allowStaleOnError: true },
  );
  const contracts = Array.isArray(result.quotes) ? result.quotes.length : 0;
  if (!probe && (!Number.isFinite(Number(result.spot)) || Number(result.spot) <= 0 || contracts === 0)) {
    const error = new Error('Empty chain payload from provider');
    error.code = 'insufficient_coverage';
    throw error;
  }
  const cache = {
    hit: Boolean(fromCache),
    ageMs: Number.isFinite(ageMs) ? Math.max(0, ageMs) : null,
    stale: Boolean(wasStale),
    coalesced: Boolean(coalesced),
    providerError: providerError ?? null,
  };
  if (probe) return { available: contracts >= 10, contracts, fromCache, _cache: cache };
  return { ...result, _cache: cache };
}

export function registerEquityFeedsRoutes(fastify) {
  // Option chain — backs Vol/Positioning/Trade first paint.
  fastify.get('/api/options/:symbol', async (request, reply) => {
    const symbol = validateSymbol(request.params.symbol);
    if (!symbol) {
      reply.code(400);
      return { error: 'Invalid symbol' };
    }
    const { probe, max } = request.query ?? {};
    const isProbe = probe === '1' || probe === 'true';
    try {
      return await getOptionChainSnapshot(symbol, { probe: isProbe, max });
    } catch (err) {
      if (err?.code === 'insufficient_coverage') {
        reply.code(502);
        return { error: 'No option chain for symbol', detail: err.message };
      }
      console.error('API endpoint error:', err);
      reply.code(502);
      return { error: 'Failed to fetch data', detail: err.message };
    }
  });

  // yfinance history — RV/realized-vol and price-history fallback.
  fastify.get('/api/yf/history/:symbol', async (request, reply) => {
    const symbol = validateSymbol(request.params.symbol);
    if (!symbol) {
      reply.code(400);
      return { error: 'Invalid symbol' };
    }
    try {
      const result = await getOrFetch(`yf:history:${symbol}`, TTL.YF_ENRICH_MS, async () => normalizeYfHistory(await runYf(symbol, 'history'), symbol), { allowStaleOnError: true });
      return { ...result.data, fromCache: result.fromCache, ageMs: result.ageMs, cache: cacheMetadata(result) };
    } catch {
      reply.code(502);
      return { error: 'Failed to fetch yfinance history' };
    }
  });

  // yfinance info — profile/quote fallback when FMP is unkeyed.
  fastify.get('/api/yf/info/:symbol', async (request, reply) => {
    const symbol = validateSymbol(request.params.symbol);
    if (!symbol) {
      reply.code(400);
      return { error: 'Invalid symbol' };
    }
    try {
      const result = await getOrFetch(`yf:info:${symbol}`, TTL.YF_ENRICH_MS, async () => normalizeYfInfo(await runYf(symbol, 'info'), symbol), { allowStaleOnError: true });
      return { ...result.data, fromCache: result.fromCache, ageMs: result.ageMs, cache: cacheMetadata(result) };
    } catch {
      reply.code(502);
      return { error: 'Failed to fetch yfinance info' };
    }
  });

  fastify.get('/api/history/spy', async (request, reply) => {
    try {
      const yf = await runYf('SPY', 'history');
      const bars = Array.isArray(yf?.bars) ? yf.bars : [];
      const sorted = bars
        .map((b) => ({ date: String(b.date ?? ''), close: Number(b.close) }))
        .filter((b) => b.date && Number.isFinite(b.close) && b.close > 0)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      if (sorted.length < 20) {
        reply.code(502);
        return { error: 'No live SPY history (yfinance)', symbol: 'SPY', data: [], source: 'none' };
      }
      const data = [];
      for (let i = 0; i < sorted.length; i++) {
        const close = sorted[i].close;
        const prev = i > 0 ? sorted[i - 1].close : close;
        const ret = prev > 0 ? (close - prev) / prev : 0;
        let vix = null;
        if (i >= 20) {
          let sum = 0;
          let sum2 = 0;
          for (let j = i - 19; j <= i; j++) {
            const p0 = sorted[j - 1] ? sorted[j - 1].close : sorted[j].close;
            const r = p0 > 0 ? Math.log(sorted[j].close / p0) : 0;
            sum += r;
            sum2 += r * r;
          }
          const mean = sum / 20;
          const var_ = Math.max(0, sum2 / 20 - mean * mean);
          vix = Math.min(80, Math.max(8, Math.sqrt(var_ * 252) * 100));
        }
        data.push({
          date: sorted[i].date,
          close: Math.round(close * 100) / 100,
          return: Math.round(ret * 100000) / 100000,
          logReturn: Math.round(Math.log(1 + ret) * 100000) / 100000,
          // Derived realized-vol proxy (20d) — labelled derived at consumers; null until 20 observations.
          vix: vix != null ? Math.round(vix * 10) / 10 : null,
        });
      }
      return { symbol: 'SPY', data, source: 'yfinance' };
    } catch (err) {
      reply.code(502);
      return { error: 'Failed to fetch live SPY history', detail: err.message, symbol: 'SPY', data: [], source: 'none' };
    }
  });
}
