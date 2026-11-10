/**
 * api.ts cache-envelope passthrough — stale metadata tranche 01.
 *
 * The server (`GET /api/macrovol/*` light/heavy paths) spreads
 * `{...body, cache: {state, hit, ageMs, stale, coalesced, providerError}}`.
 * `fetchJson` must preserve that envelope verbatim while leaving every numeric
 * response field byte-identical. Staleness is ONLY `cache.stale`; a missing
 * envelope is unknown (never stale); cold/expired failures throw fail-closed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { macrovolApi } from './api';

const BASE_SUMMARY = {
  sofr: 4.53,
  effr: 4.32,
  usy2: 4.25,
  usy10: 4.55,
  spread_2s10s: 0.3,
  spread_3m10y: 0.18,
  as_of: '2026-09-01',
  source: 'fixture',
};

function mockFetchOnce(body: unknown, opts?: { ok?: boolean; status?: number }) {
  const res = {
    ok: opts?.ok ?? true,
    status: opts?.status ?? 200,
    json: async () => body,
  } as unknown as Response;
  vi.stubGlobal('fetch', vi.fn(async () => res));
}

function assertNumericsExact(result: typeof BASE_SUMMARY) {
  // Numeric fields are preserved exactly — never coerced, defaulted, or NaN.
  expect(result.sofr).toBe(4.53);
  expect(result.effr).toBe(4.32);
  expect(result.usy2).toBe(4.25);
  expect(result.usy10).toBe(4.55);
  expect(result.spread_2s10s).toBe(0.3);
  expect(result.spread_3m10y).toBe(0.18);
  for (const v of [result.sofr, result.effr, result.usy2, result.usy10]) {
    expect(v === null || Number.isFinite(v)).toBe(true);
  }
}

describe('macrovol api cache envelope', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes a fresh envelope through without touching numerics', async () => {
    mockFetchOnce({
      ...BASE_SUMMARY,
      cache: { state: 'fresh', hit: true, ageMs: 120, stale: false, coalesced: false, providerError: null },
    });
    const result = await macrovolApi.ratesSummary();
    assertNumericsExact(result);
    expect(result.cache?.stale).toBe(false);
    expect(result.cache?.state).toBe('fresh');
    expect(result.cache?.hit).toBe(true);
    expect(result.cache?.ageMs).toBe(120);
    expect(result.cache?.providerError).toBeNull();
  });

  it('passes a stale envelope through with numerics byte-identical', async () => {
    mockFetchOnce({
      ...BASE_SUMMARY,
      cache: { state: 'stale', hit: true, ageMs: 350_000, stale: true, coalesced: false, providerError: 'upstream-error' },
    });
    const result = await macrovolApi.ratesSummary();
    assertNumericsExact(result);
    expect(result.cache?.stale).toBe(true);
    expect(result.cache?.state).toBe('stale');
    expect(result.cache?.ageMs).toBe(350_000);
    expect(Number.isFinite(result.cache?.ageMs ?? NaN)).toBe(true);
    expect(result.cache?.providerError).toBe('upstream-error');
  });

  it('treats a missing envelope as unknown (cache nullish, never stale)', async () => {
    mockFetchOnce({ ...BASE_SUMMARY });
    const result = await macrovolApi.ratesSummary();
    assertNumericsExact(result);
    expect(result.cache ?? null).toBeNull();
    expect(result.cache?.stale ?? false).toBe(false);
  });

  it('fails closed on expired/cold 502 without fabricating values', async () => {
    mockFetchOnce({ error: 'UPSTREAM_ERROR' }, { ok: false, status: 502 });
    await expect(macrovolApi.ratesSummary()).rejects.toThrow('UPSTREAM_ERROR');
  });

  it('fails closed on a 200 error body without returning a partial envelope', async () => {
    mockFetchOnce({ error: 'WORKER_FAIL' }, { ok: true, status: 200 });
    await expect(macrovolApi.ratesSummary()).rejects.toThrow('WORKER_FAIL');
  });

  it('never surfaces NaN or Infinity in a stale body', async () => {
    const body = {
      ...BASE_SUMMARY,
      cache: { state: 'stale', hit: true, ageMs: 400_000, stale: true, coalesced: true, providerError: null },
    };
    mockFetchOnce(body);
    const result = await macrovolApi.ratesSummary();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/NaN/);
    // JSON.stringify maps Infinity -> null; assert the live values are finite instead.
    expect(serialized).not.toMatch(/Infinity/);
    assertNumericsExact(result);
  });
});
