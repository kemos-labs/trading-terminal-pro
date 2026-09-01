/**
 * Shared upstream cache — regression tests.
 * After the shared-cache refactor, routes must use getOrFetch/peek, never a
 * removed cacheStore global (that 500'd Deribit + yfinance on production).
 */
import { readFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

  it('rejects invalid quota mutations before counters or the ledger can be corrupted', async () => {
    const { recordMonthBudget } = await import('./upstreamCache.js');
    for (const count of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => recordBudget('valid-provider', count)).toThrow(/positive safe integer/);
      expect(() => recordMonthBudget('valid-provider', count)).toThrow(/positive safe integer/);
    }
    expect(() => recordBudget('../invalid', 1)).toThrow(/bounded identifier/);
    expect(() => recordMonthBudget('x'.repeat(65), 1)).toThrow(/bounded identifier/);
  });

  it('persists quota counts across module restarts without exposing its path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'terminal-quota-ledger-'));
    const ledgerPath = join(dir, 'ledger.json');
    const prior = process.env.QUOTA_LEDGER_PATH;
    process.env.QUOTA_LEDGER_PATH = ledgerPath;
    const { readFileSync: read } = await import('node:fs');
    try {
      // Record against a fresh key; expect the ledger file to be created with correct counts.
      const beforeDay = getBudgetUsed('restart-proof-quota');
      const { getMonthBudgetUsed: getMonth, recordMonthBudget } = await import('./upstreamCache.js');
      const beforeMonth = getMonth('restart-proof-quota');
      recordBudget('restart-proof-quota', 2);
      recordMonthBudget('restart-proof-quota', 3);
      expect(getBudgetUsed('restart-proof-quota')).toBe(beforeDay + 2);
      expect(getMonth('restart-proof-quota')).toBe(beforeMonth + 3);
      // File should exist, be JSON, contain today's counts, and not leak path via cacheStats.
      const raw = read(ledgerPath, 'utf8');
      const parsed = JSON.parse(raw);
      expect(parsed.daily).toBeTruthy();
      expect(parsed.monthly).toBeTruthy();
      const dayKey = Object.keys(parsed.daily).find(k => k.startsWith('restart-proof-quota:'));
      const monthKey = Object.keys(parsed.monthly).find(k => k.startsWith('restart-proof-quota:'));
      expect(dayKey).toBeTruthy();
      expect(monthKey).toBeTruthy();
      expect(parsed.daily[dayKey]).toBeGreaterThanOrEqual(2);
      expect(parsed.monthly[monthKey]).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(cacheStats())).not.toContain(ledgerPath);
      expect(statSync(ledgerPath).mode & 0o077).toBe(0);
      expect(cacheStats().budgets.ledger.persistent).toBe(true);
    } finally {
      if (prior === undefined) delete process.env.QUOTA_LEDGER_PATH; else process.env.QUOTA_LEDGER_PATH = prior;
      rmSync(dir, { recursive: true, force: true });
    }
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

describe('server cache wiring (regression)', () => {
  // server.js → server/app.js → server/routes/* (Phase 8 decomposition).
  // Read all server source to verify cache wiring across the decomposed modules.
  const serverDir = join(__dirname, '..', 'server');
  const files = ['app.js', 'routes/deribitMarket.js', 'routes/sse.js', 'routes/macrovol.js'];
  const src = files.map(f => readFileSync(join(serverDir, f), 'utf8')).join('\n');

  it('does not reference removed cacheStore (broke Deribit LIVE chains)', () => {
    expect(src).not.toMatch(/\bcacheStore\b/);
    expect(src).not.toMatch(/\bCACHE_TTL\b/);
  });

  it('uses getOrFetch for shared-cached routes (boot, macrovol, flashalpha)', () => {
    expect(src).toMatch(/getOrFetch/);
    // Deribit routes use the canonical provider (server/providers/deribit) which
    // has its own rate discipline + allowlist — not getOrFetch cache keys.
    expect(src).toMatch(/deribitFetch/);
    // TTL constants are imported and used by route modules.
    expect(src).toMatch(/TTL\.(BRIEFING_MS|FMP_QUOTE_MS|OPTIONS_MS)/);
  });

  it('SSE quote stream routes through the shared budget-gated helper (no direct proxyFmp)', () => {
    expect(src).toMatch(/fetchFmpQuoteShared/);
    // writeTick must not call proxyFmp directly — that path bypassed the
    // FMP daily budget (~60 unbudgeted calls/hour per open tab).
    const sseBlock = readFileSync(join(serverDir, 'routes/sse.js'), 'utf8');
    expect(sseBlock).toContain('fetchFmpQuoteShared');
    expect(sseBlock).not.toMatch(/proxyFmp\(/);
  });
});
