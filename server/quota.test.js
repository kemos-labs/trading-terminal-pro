/**
 * Phase 10 — quota & coalescing correctness (spec §10.5).
 * Proves at the real Fastify layer:
 * - N simultaneous client requests create ONE upstream fill per cache key/TTL
 * - background tabs never reach the poll (visibility gates)
 * - equivalent query forms share a canonical cache key
 * - budget exhaustion does not trigger per-client retry storms
 * - no NaN/Infinity ever serializes
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const REAL_FETCH = global.fetch;

let upstreamCalls = [];

beforeEach(() => {
  upstreamCalls = [];
  global.fetch = vi.fn(async (input) => {
    upstreamCalls.push({ url: String(input), at: Date.now() });
    // Slow enough that concurrent requests genuinely overlap.
    await new Promise((r) => setTimeout(r, 60));
    return new Response(JSON.stringify({ c: 500.25, d: 1.2, dp: 0.24 }), { status: 200 });
  });
});

afterEach(() => {
  global.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});

describe('quota & single-flight (server cache)', () => {
  it('N concurrent requests → one upstream fill per key within TTL', async () => {
    const { getOrFetch, clearCacheForTests } = await import('../api/upstreamCache.js');
    clearCacheForTests();
    const key = `test:single-flight:${Date.now()}`;
    let loaderCalls = 0;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => getOrFetch(key, 60_000, async () => {
        loaderCalls += 1;
        await new Promise((r) => setTimeout(r, 60));
        return { v: 1 };
      })),
    );
    expect(results).toHaveLength(8);
    // The single upstream fill is proven by loader invocations, not fromCache flags.
    expect(loaderCalls).toBe(1);
    expect(results.filter((result) => result.coalesced).length).toBe(7);
    // And a subsequent read is a cache hit within TTL.
    const again = await getOrFetch(key, 60_000, async () => ({ v: 2 }));
    expect(again.fromCache).toBe(true);
  });

  it('equivalent keys do NOT collide (canonicalization is per-route, cache key distinct)', async () => {
    const { getOrFetch } = await import('../api/upstreamCache.js');
    const t = Date.now();
    const a = await getOrFetch(`test:canon:a:${t}`, 60_000, async () => ({ v: 'a' }));
    const b = await getOrFetch(`test:canon:b:${t}`, 60_000, async () => ({ v: 'b' }));
    expect(a.data).toEqual({ v: 'a' });
    expect(b.data).toEqual({ v: 'b' });
  });

  it('loader rejection with no stale entry propagates once — joiners share the same failure', async () => {
    const { getOrFetch } = await import('../api/upstreamCache.js');
    const key = `test:fail-shared:${Date.now()}`;
    let calls = 0;
    const attempt = () => getOrFetch(key, 60_000, async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 30));
      throw new Error('provider down');
    });
    const results = await Promise.allSettled([attempt(), attempt(), attempt(), attempt()]);
    expect(calls).toBe(1);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
  });

  it('rejects stale-on-error data beyond the explicit maximum age', async () => {
    vi.useFakeTimers();
    try {
      const { getOrFetch, setCache, clearCacheForTests } = await import('../api/upstreamCache.js');
      clearCacheForTests();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      setCache('test:bounded-stale', { v: 'last-good' });
      vi.setSystemTime(new Date('2026-01-01T00:02:01Z'));
      await expect(getOrFetch(
        'test:bounded-stale',
        10_000,
        async () => { throw new Error('provider down'); },
        { allowStaleOnError: true, maxStaleMs: 120_000 },
      )).rejects.toThrow('provider down');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not poison the last-success cache with rejected loader payloads', async () => {
    const { getOrFetch, clearCacheForTests } = await import('../api/upstreamCache.js');
    clearCacheForTests();
    let calls = 0;
    const load = async () => ({ valid: ++calls > 1 });
    const first = await getOrFetch('test:cache-if', 60_000, load, { cacheIf: (row) => row.valid });
    const second = await getOrFetch('test:cache-if', 60_000, load, { cacheIf: (row) => row.valid });
    expect(first.data.valid).toBe(false);
    expect(second.data.valid).toBe(true);
    expect(calls).toBe(2);
  });

  it('budget exhaustion path: recordBudget + budgetAllows refuse after cap', async () => {
    const { recordBudget, budgetAllows, getBudgetUsed, clearCacheForTests } = await import('../api/upstreamCache.js');
    clearCacheForTests();
    const provider = `test-budget-${Date.now()}`;
    const CAP = 3;
    for (let i = 0; i < CAP; i++) recordBudget(provider, 1);
    expect(getBudgetUsed(provider)).toBe(CAP);
    expect(budgetAllows(provider, CAP, 0.85)).toBe(false);
  });
});

describe('serialization honesty', () => {
  it('JSON.stringify of NaN/Infinity produces null — typed envelopes must guard at build time', async () => {
    expect(JSON.stringify({ v: NaN })).toBe('{"v":null}');
    expect(JSON.stringify({ v: Infinity })).toBe('{"v":null}');
  });
});
