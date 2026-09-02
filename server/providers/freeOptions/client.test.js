import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearCacheForTests } from '../../../api/upstreamCache.js';
import { resetProviderCircuitsForTests } from '../../../api/providerCircuitBreaker.js';
import { fetchBybitOptionsSummary, fetchOkxOptionsSummary } from './client.js';

const realFetch = global.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = realFetch;
  clearCacheForTests();
  resetProviderCircuitsForTests();
});

const okx = { code: '0', data: [{ volCcy24h: '2', volUsd24h: '100', openInt: '3' }] };
const bybit = { retCode: 0, result: { list: [{ volume24h: '4', openInterest: '5' }] } };
const response = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('free options provider adapters', () => {
  it('single-flights concurrent BTC fills independently per provider', async () => {
    global.fetch = vi.fn(async (url) => String(url).includes('open-interest') ? response({ code: '0', data: [] }) : String(url).includes('okx') ? response(okx) : response(bybit));
    const [a, b] = await Promise.all([fetchOkxOptionsSummary('BTC'), fetchOkxOptionsSummary('BTC')]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(a.data.venue).toBe('OKX');
    expect(b.data.venue).toBe('OKX');
  });

  it('preserves a valid venue when the other is malformed or down', async () => {
    global.fetch = vi.fn(async (url) => String(url).includes('okx')
      ? new Response('bad', { status: 502, headers: { 'content-type': 'text/plain' } })
      : response(bybit));
    const [okxResult, bybitResult] = await Promise.allSettled([fetchOkxOptionsSummary('ETH'), fetchBybitOptionsSummary('ETH')]);
    expect(okxResult.status).toBe('rejected');
    expect(bybitResult.status).toBe('fulfilled');
    expect(bybitResult.value.data.venue).toBe('Bybit');
  });

  it.each(['SOL', 'BTC?secret=1', ''])('rejects unsupported or query-derived currency %s', async (currency) => {
    await expect(fetchOkxOptionsSummary(currency)).rejects.toMatchObject({ status: 400 });
    await expect(fetchBybitOptionsSummary(currency)).rejects.toMatchObject({ status: 400 });
  });

  it('fails truthfully when all provider payloads are invalid', async () => {
    global.fetch = vi.fn(async () => response({ code: '0', data: [] }));
    await expect(fetchOkxOptionsSummary('BTC')).rejects.toMatchObject({ code: 'insufficient_coverage' });
  });

  it('prefers OKX public open-interest oiCcy and falls back to ticker openInt', async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('open-interest')) return response({ code: '0', data: [{ oiCcy: '7' }, { oiCcy: '8' }] });
      return response(okx);
    });
    await expect(fetchOkxOptionsSummary('BTC')).resolves.toMatchObject({ data: { openInterestBaseCcy: 15 } });

    clearCacheForTests();
    global.fetch = vi.fn(async (url) => String(url).includes('open-interest')
      ? new Response('{}', { status: 502, headers: { 'content-type': 'application/json' } })
      : response(okx));
    await expect(fetchOkxOptionsSummary('BTC')).resolves.toMatchObject({ data: { openInterestBaseCcy: null, openInterestNative: 3 } });
  });

  it('rejects provider-declared errors even when HTTP succeeds', async () => {
    global.fetch = vi.fn(async (url) => String(url).includes('okx')
      ? response({ code: '50001', data: [] })
      : response({ retCode: 10001, result: { list: [] } }));
    await expect(fetchOkxOptionsSummary('BTC')).rejects.toMatchObject({ code: 'provider_unavailable' });
    await expect(fetchBybitOptionsSummary('BTC')).rejects.toMatchObject({ code: 'provider_unavailable' });
  });

  it('rejects an oversized body even without a Content-Length header', async () => {
    const oversized = JSON.stringify({ code: '0', data: ['x'.repeat(2 * 1024 * 1024)] });
    global.fetch = vi.fn(async () => new Response(oversized, { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(fetchOkxOptionsSummary('BTC')).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('cancels an oversized streamed body before reading remaining chunks', async () => {
    let readCalls = 0;
    let cancelCalls = 0;
    const reader = {
      async read() {
        readCalls += 1;
        if (readCalls === 1) return { done: false, value: new Uint8Array(2 * 1024 * 1024 + 1) };
        throw new Error('remaining chunk was consumed');
      },
      async cancel() { cancelCalls += 1; },
      releaseLock() {},
    };
    global.fetch = vi.fn(async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: { getReader: () => reader },
    }));
    await expect(fetchOkxOptionsSummary('BTC')).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(readCalls).toBe(1);
    expect(cancelCalls).toBe(1);
  });
});
