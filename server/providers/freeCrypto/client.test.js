import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { fetchFreeCryptoMarket, fetchFreeCryptoMarketResult, resetFreeCryptoMarketCache } from './client.js';

const realFetch = global.fetch;
const payload = (price = '100') => ({
  binance: [{ lastPrice: price, quoteVolume: '10', priceChangePercent: '1' }, { markPrice: price, indexPrice: price, lastFundingRate: '0.01' }, { openInterest: '2' }],
  bybit: { retCode: 0, result: { list: [{ lastPrice: price, markPrice: price, indexPrice: price, fundingRate: '0.01', openInterest: '2', turnover24h: '10', price24hPcnt: '0.01' }] } },
});

function mockFetch(data) {
  global.fetch = vi.fn(async (url) => {
    const u = String(url);
    const body = u.includes('binance') ? data.binance?.shift?.() : data.bybit;
    if (body instanceof Error) throw body;
    return { ok: true, json: async () => body };
  });
}

describe('free crypto provider normalization', () => {
  beforeEach(() => { resetFreeCryptoMarketCache(); });
  afterEach(() => { global.fetch = realFetch; vi.restoreAllMocks(); });

  it('accepts both venues, preserves observed fields, and has no aggregate', async () => {
    mockFetch(payload());
    const result = await fetchFreeCryptoMarket('BTC');
    expect(result.source).toBe('free-exchanges');
    expect(result.venues).toHaveLength(2);
    expect(result).not.toHaveProperty('index');
    expect(result.venues[0].mark).toBe(100);
  });

  it.each(['BTC', 'ETH'])('supports %s', async (currency) => {
    mockFetch(payload());
    expect((await fetchFreeCryptoMarket(currency)).currency).toBe(currency);
  });

  it('keeps one venue when the other is unavailable', async () => {
    const p = payload(); p.binance[0] = new Error('down');
    mockFetch(p);
    const result = await fetchFreeCryptoMarket('BTC');
    expect(result.venues.map(v => v.venue)).toEqual(['Bybit Linear']);
  });

  it('rejects both unavailable and malformed/all-null payloads', async () => {
    const p = payload(); p.binance = [{}, {}, {}]; p.bybit = { retCode: 0, result: { list: [{}] } };
    mockFetch(p);
    await expect(fetchFreeCryptoMarket('BTC')).rejects.toMatchObject({ status: 502 });
  });

  it('never converts null, empty, booleans, arrays, or objects to zero', async () => {
    const p = payload();
    p.binance = [{ lastPrice: null }, { markPrice: '', indexPrice: '  ' }, { openInterest: false }];
    p.bybit = { retCode: 0, result: { list: [{ lastPrice: [], markPrice: {}, indexPrice: null }] } };
    mockFetch(p);
    await expect(fetchFreeCryptoMarket('BTC')).rejects.toMatchObject({ status: 502 });
  });

  it('uses the 15 second cache', async () => {
    vi.useFakeTimers();
    mockFetch(payload());
    await fetchFreeCryptoMarket('BTC');
    await fetchFreeCryptoMarket('BTC');
    expect(global.fetch).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(15_001);
    mockFetch(payload());
    await fetchFreeCryptoMarket('BTC');
    expect(global.fetch).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it('preserves miss, fresh-hit, and single-flight metadata for canonical consumers', async () => {
    mockFetch(payload());
    const [first, joined] = await Promise.all([
      fetchFreeCryptoMarketResult('BTC'),
      fetchFreeCryptoMarketResult('BTC'),
    ]);
    expect(first).toMatchObject({ fromCache: false, stale: false, coalesced: false });
    expect(joined).toMatchObject({ fromCache: false, stale: false, coalesced: true });
    const hit = await fetchFreeCryptoMarketResult('BTC');
    expect(hit).toMatchObject({ fromCache: true, stale: false, coalesced: false });
    expect(hit.ageMs).toBeGreaterThanOrEqual(0);
  });

  it('preserves a bounded stale-on-error state instead of relabelling it live', async () => {
    vi.useFakeTimers();
    mockFetch(payload());
    await fetchFreeCryptoMarketResult('BTC');
    await vi.advanceTimersByTimeAsync(15_001);
    mockFetch({ binance: [new Error('down'), new Error('down'), new Error('down')], bybit: new Error('down') });
    const stale = await fetchFreeCryptoMarketResult('BTC');
    expect(stale).toMatchObject({ fromCache: true, stale: true, coalesced: false, providerError: 'http-502' });
    expect(stale.ageMs).toBeGreaterThanOrEqual(15_001);
    vi.useRealTimers();
  });

  it.each([0, -1, Infinity, 'Infinity'])('rejects invalid Binance prices independently (%s)', async (bad) => {
    const p = payload(); p.binance = [{ lastPrice: bad }, { markPrice: bad, indexPrice: bad }, { openInterest: '2' }]; mockFetch(p);
    const result = await fetchFreeCryptoMarket('BTC'); expect(result.venues).toHaveLength(1); expect(result.venues[0].venue).toBe('Bybit Linear');
  });

  it.each([0, -1, Infinity, 'Infinity'])('rejects invalid Bybit prices independently (%s)', async (bad) => {
    const p = payload(); p.bybit.result.list[0].lastPrice = bad; p.bybit.result.list[0].markPrice = bad; p.bybit.result.list[0].indexPrice = bad; mockFetch(p);
    const result = await fetchFreeCryptoMarket('BTC'); expect(result.venues).toHaveLength(1); expect(result.venues[0].venue).toBe('Binance Futures');
  });

  it('rejects mismatched symbols and Bybit error retCode independently', async () => {
    const p = payload(); p.binance[0].symbol = 'ETHUSDT'; p.bybit.result.list[0].symbol = 'ETHUSDT'; mockFetch(p);
    await expect(fetchFreeCryptoMarket('BTC')).rejects.toMatchObject({ status: 502 });
    resetFreeCryptoMarketCache(); const q = payload(); q.bybit.retCode = 10001; mockFetch(q);
    const result = await fetchFreeCryptoMarket('BTC'); expect(result.venues).toHaveLength(1); expect(result.venues[0].venue).toBe('Binance Futures');
  });

  it('aborts a hanging venue at 8 seconds while preserving the valid venue', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn((url, options) => String(url).includes('bybit')
      ? Promise.resolve({ ok: true, json: async () => ({ retCode: 0, result: { list: [{ lastPrice: '100', markPrice: '100', indexPrice: '100' }] } }) })
      : new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })));
    const pending = fetchFreeCryptoMarket('BTC'); const assertion = expect(pending).resolves.toMatchObject({ venues: [{ venue: 'Bybit Linear' }] }); await vi.advanceTimersByTimeAsync(8_000);
    await assertion; expect(global.fetch).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it('aborts both hanging venues at 8 seconds and returns typed 502', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })));
    const pending = fetchFreeCryptoMarket('BTC'); const assertion = expect(pending).rejects.toMatchObject({ status: 502 }); await vi.advanceTimersByTimeAsync(8_000);
    await assertion; expect(global.fetch).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it('rejects unsupported currency before upstream access', async () => {
    global.fetch = vi.fn();
    await expect(fetchFreeCryptoMarket('DOGE')).rejects.toMatchObject({ status: 400 });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
