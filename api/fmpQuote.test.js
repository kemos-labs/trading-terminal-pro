/**
 * Shared FMP quote helper — quota + cache regression tests.
 * Guards against a repeat of the SSE stream bypassing the FMP daily budget
 * (~60 unbudgeted upstream calls/hour per open tab before this fix).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchFmpQuoteShared } from './_shared.js';
import { getBudgetUsed, peek, recordBudget, FMP_FREE_DAILY } from './upstreamCache.js';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function fmpRes(body) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

// Unique-ish key per run — module-level caches persist across test files.
const KEY = 'test-fmp-key-not-real';

describe('fetchFmpQuoteShared', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns no_api_key immediately without burning any call', async () => {
    const r = await fetchFmpQuoteShared(`NOKEY${Date.now()}`, null);
    expect(r.error).toBe('no_api_key');
    expect(r.quote).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('caches: repeated calls within TTL share one upstream fill', async () => {
    const sym = `TTL${Date.now()}`;
    mockFetch.mockResolvedValue(fmpRes([{ symbol: sym, price: 100 }]));

    const r1 = await fetchFmpQuoteShared(sym, KEY);
    const r2 = await fetchFmpQuoteShared(sym, KEY);
    const r3 = await fetchFmpQuoteShared(sym, KEY);

    expect(r1.quote.price).toBe(100);
    expect(r2.quote.price).toBe(100);
    expect(r3.quote.price).toBe(100);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('shares the cache entry with the /api/fmp/stable/* route key', async () => {
    const sym = `SHARE${Date.now()}`;
    mockFetch.mockResolvedValue(fmpRes([{ symbol: sym, price: 101 }]));

    await fetchFmpQuoteShared(sym, KEY);
    // The REST proxy reads peek(`fmp:<url>`) — must be warm now.
    const shared = peek(`fmp:quote?symbol=${sym}`);
    expect(shared).not.toBeNull();
    expect(shared.data.price).toBe(101);
  });

  it('records budget only on cold fills', async () => {
    const before = getBudgetUsed('fmp');
    const sym = `BUD${Date.now()}`;
    mockFetch.mockResolvedValue(fmpRes([{ symbol: sym, price: 102 }]));

    await fetchFmpQuoteShared(sym, KEY);
    await fetchFmpQuoteShared(sym, KEY);
    await fetchFmpQuoteShared(sym, KEY);

    expect(getBudgetUsed('fmp') - before).toBe(1); // one cold fill = one call
  });

  it('when the daily budget is exhausted, serves stale data — zero upstream calls', async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const sym = `EXH${start}`;
    mockFetch.mockResolvedValue(fmpRes([{ symbol: sym, price: 103 }]));

    // Cold fill succeeds.
    const r1 = await fetchFmpQuoteShared(sym, KEY);
    expect(r1.quote.price).toBe(103);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Exhaust the fmp daily budget…
    recordBudget('fmp', FMP_FREE_DAILY);

    // …and move past the quote TTL so a fresh load WOULD be attempted.
    vi.setSystemTime(start + 10 * 60_000);

    const r2 = await fetchFmpQuoteShared(sym, KEY);
    // Stale prior value served; no new upstream call burned.
    expect(r2.quote.price).toBe(103);
    expect(r2.stale).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
