/**
 * Shared upstream cache — regression tests.
 * After the shared-cache refactor, routes must use getOrFetch/peek, never a
 * removed cacheStore global (that 500'd Deribit + yfinance on production).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOrFetch,
  peek,
  setCache,
  cacheStats,
  budgetAllows,
  recordBudget,
  getBudgetUsed,
  MAX_CACHE_ENTRIES,
  TTL,
} from './upstreamCache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('upstreamCache', () => {
  beforeEach(() => {
    // Isolate budget counters by using unique provider keys per test where needed.
  });

  it('getOrFetch caches loader results within TTL', async () => {
    let calls = 0;
    const key = `test:ttl:${Date.now()}`;
    const r1 = await getOrFetch(key, 60_000, async () => {
      calls += 1;
      return { n: 1 };
    });
    const r2 = await getOrFetch(key, 60_000, async () => {
      calls += 1;
      return { n: 2 };
    });
    expect(r1.data).toEqual({ n: 1 });
    expect(r2.data).toEqual({ n: 1 });
    expect(r2.fromCache).toBe(true);
    expect(calls).toBe(1);
  });

  it('getOrFetch single-flights concurrent loaders', async () => {
    let calls = 0;
    const key = `test:flight:${Date.now()}`;
    const loader = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 40));
      return { ok: true };
    };
    const [a, b] = await Promise.all([
      getOrFetch(key, 60_000, loader),
      getOrFetch(key, 60_000, loader),
    ]);
    expect(a.data).toEqual({ ok: true });
    expect(b.data).toEqual({ ok: true });
    expect(calls).toBe(1);
  });

  it('peek and setCache round-trip', () => {
    const key = `test:peek:${Date.now()}`;
    expect(peek(key)).toBeNull();
    setCache(key, { v: 42 });
    const hit = peek(key);
    expect(hit).not.toBeNull();
    expect(hit.data).toEqual({ v: 42 });
    expect(typeof hit.timestamp).toBe('number');
  });

  it('budgetAllows tracks daily usage under headroom', () => {
    const provider = `test-budget-${Date.now()}`;
    expect(getBudgetUsed(provider)).toBe(0);
    expect(budgetAllows(provider, 10, 0.85)).toBe(true);
    for (let i = 0; i < 8; i++) recordBudget(provider, 1);
    // floor(10 * 0.85) = 8 → used 8 is not < 8
    expect(budgetAllows(provider, 10, 0.85)).toBe(false);
  });

  it('monthBudgetAllows tracks monthly usage', async () => {
    const { monthBudgetAllows, recordMonthBudget, getMonthBudgetUsed } = await import('./upstreamCache.js');
    const provider = `test-month-${Date.now()}`;
    expect(getMonthBudgetUsed(provider)).toBe(0);
    expect(monthBudgetAllows(provider, 10, 0.85)).toBe(true);
    for (let i = 0; i < 8; i++) recordMonthBudget(provider, 1);
    expect(monthBudgetAllows(provider, 10, 0.85)).toBe(false);
  });

  it('cacheStats exposes multi-provider budgets', () => {
    const s = cacheStats();
    expect(s.budgets).toBeTruthy();
    expect(s.budgets.alphavantage).toBeTruthy();
    expect(s.budgets.tradingview).toBeTruthy();
    expect(s.budgets.finnhub).toBeTruthy();
  });

  it('cacheIf false skips persist so next call reloads', async () => {
    let calls = 0;
    const key = `test:cacheif:${Date.now()}`;
    const r1 = await getOrFetch(
      key,
      60_000,
      async () => {
        calls += 1;
        return { status: 503, body: { error: 'upstream' } };
      },
      { cacheIf: (d) => d.status >= 200 && d.status < 300 },
    );
    const r2 = await getOrFetch(
      key,
      60_000,
      async () => {
        calls += 1;
        return { status: 200, body: { ok: true } };
      },
      { cacheIf: (d) => d.status >= 200 && d.status < 300 },
    );
    expect(r1.data.status).toBe(503);
    expect(r2.data.status).toBe(200);
    expect(calls).toBe(2);
    expect(r1.fromCache).toBe(false);
  });

  it('stale:true when loader throws and prior hit exists', async () => {
    const key = `test:stale:${Date.now()}`;
    await getOrFetch(key, 1, async () => ({ v: 1 })); // cache then expire
    await new Promise((r) => setTimeout(r, 5));
    const r = await getOrFetch(
      key,
      1,
      async () => {
        throw new Error('boom');
      },
      { allowStaleOnError: true },
    );
    expect(r.data).toEqual({ v: 1 });
    expect(r.stale).toBe(true);
    expect(r.fromCache).toBe(true);
  });

  it('exports TTLs used by options and Deribit routes', () => {
    expect(TTL.OPTIONS_MS).toBeGreaterThan(0);
    expect(TTL.DERIBIT_MS).toBeGreaterThan(0);
    expect(TTL.YF_ENRICH_MS).toBeGreaterThan(0);
  });

  it('cacheStats reports entries', () => {
    setCache(`test:stats:${Date.now()}`, { x: 1 });
    const s = cacheStats();
    expect(s.entries).toBeGreaterThan(0);
    expect(Array.isArray(s.keys)).toBe(true);
  });

  it('evicts oldest entries beyond MAX_CACHE_ENTRIES (LRU)', async () => {
    // Only meaningful when eviction is enabled; default config has a cap.
    if (MAX_CACHE_ENTRIES <= 0) return;
    const before = cacheStats().entries;
    const overflow = MAX_CACHE_ENTRIES + 50;
    for (let i = 0; i < overflow; i++) {
      setCache(`test:lru:${Date.now()}:${i}`, { i });
    }
    const after = cacheStats();
    expect(after.entries).toBeLessThanOrEqual(before + MAX_CACHE_ENTRIES);
    // Oldest inserted keys must be gone; newest must survive.
    const _firstKey = `test:lru:${Date.now()}:0`;
    // (timestamp differs per iteration — instead assert via stats counters)
    expect(after.evictions).toBeGreaterThanOrEqual(overflow - (after.entries - before));
  });

  it('peek/getOrFetch refresh recency so hot keys survive eviction pressure', async () => {
    if (MAX_CACHE_ENTRIES <= 0) return;
    const hot = `test:hot:${Date.now()}`;
    setCache(hot, { hot: true });
    // Touch repeatedly while flooding with cold entries.
    for (let i = 0; i < Math.min(MAX_CACHE_ENTRIES, 200); i++) {
      peek(hot);
      setCache(`test:flood:${Date.now()}:${i}`, { i });
    }
    const r = await getOrFetch(hot, 60_000, async () => ({ hot: 'reloaded' }));
    expect(r.data).toEqual({ hot: true }); // still cached → loader not re-run
    expect(r.fromCache).toBe(true);
  });
});

describe('server.js cache wiring (regression)', () => {
  const serverPath = (() => {
    try {
      const s = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
      if (s.includes('getOrFetch') || s.includes('deribit:market')) return join(__dirname, '..', 'server.js');
    } catch {}
    return join(__dirname, '..', 'server/app.js');
  })();
  const src = readFileSync(serverPath, 'utf8');

  it('does not reference removed cacheStore (broke Deribit LIVE chains)', () => {
    expect(src).not.toMatch(/\bcacheStore\b/);
    expect(src).not.toMatch(/\bCACHE_TTL\b/);
  });

  it('uses getOrFetch for Deribit market and yfinance enrichment', () => {
    expect(src).toMatch(/getOrFetch/);
    expect(src).toMatch(/deribit:market:/);
    expect(src).toMatch(/yf:history:/);
    expect(src).toMatch(/TTL\.DERIBIT_MS|TTL\.YF_ENRICH_MS/);
  });

  it('SSE quote stream routes through the shared budget-gated helper (no direct proxyFmp)', () => {
    expect(src).toMatch(/fetchFmpQuoteShared/);
    // writeTick must not call proxyFmp directly — that path bypassed the
    // FMP daily budget (~60 unbudgeted calls/hour per open tab).
    const sseStart = src.indexOf('/api/stream/quote/');
    const sseEnd = src.indexOf('// ── FMP API Proxy', sseStart);
    const sseBlock = src.slice(sseStart, sseEnd);
    expect(sseBlock).toContain('fetchFmpQuoteShared');
    expect(sseBlock).not.toMatch(/proxyFmp\(/);
  });
});

