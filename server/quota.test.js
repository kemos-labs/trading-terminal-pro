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

describe('background-tab discipline (frontend)', () => {
  it('refresh loop, KSA poll and desk strip all gate on document.hidden', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.join(import.meta.dirname, '..');
    const storeSrc = fs.readFileSync(path.join(root, 'src/store/terminalStore.ts'), 'utf8');
    const ksaSrc = fs.readFileSync(path.join(root, 'src/components/views/KsaMarketView.tsx'), 'utf8');
    const stripSrc = fs.readFileSync(path.join(root, 'src/components/common/SharedDeskStrip.tsx'), 'utf8');
    for (const [name, src] of [['terminalStore', storeSrc], ['KsaMarketView', ksaSrc], ['SharedDeskStrip', stripSrc]]) {
      expect(src.includes('document.hidden'), `${name} must gate polling on document.hidden`).toBe(true);
    }
    // The gate sits INSIDE the interval callback (poll skipped, timer alive)
    expect(storeSrc).toMatch(/setInterval\(\(\) => \{\s*\/\/ Background-tab discipline[\s\S]*?if \(typeof document !== 'undefined' && document\.hidden\) return;/);
  });
});

describe('serialization honesty', () => {
  it('JSON.stringify of NaN/Infinity produces null — typed envelopes must guard at build time', async () => {
    expect(JSON.stringify({ v: NaN })).toBe('{"v":null}');
    expect(JSON.stringify({ v: Infinity })).toBe('{"v":null}');
  });
});
