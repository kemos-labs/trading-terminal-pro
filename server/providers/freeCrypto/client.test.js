import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { fetchFreeCryptoMarket, resetFreeCryptoMarketCache } from './client.js';

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

  it('rejects unsupported currency before upstream access', async () => {
    global.fetch = vi.fn();
    await expect(fetchFreeCryptoMarket('DOGE')).rejects.toMatchObject({ status: 400 });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
