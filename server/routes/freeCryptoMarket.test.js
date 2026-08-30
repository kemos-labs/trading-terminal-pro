import Fastify from 'fastify';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { registerFreeCryptoMarketRoutes } from './freeCryptoMarket.js';
import { resetFreeCryptoMarketCache } from '../providers/freeCrypto/client.js';

const realFetch = global.fetch;
function fixture({ binance = true, bybit = true } = {}) {
  global.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('binance')) {
      if (!binance) throw new Error('unavailable');
      if (u.includes('ticker/24hr')) return { ok: true, json: async () => ({ lastPrice: '100' }) };
      if (u.includes('premiumIndex')) return { ok: true, json: async () => ({ markPrice: '101', indexPrice: '99' }) };
      return { ok: true, json: async () => ({ openInterest: '10' }) };
    }
    if (!bybit) throw new Error('unavailable');
    return { ok: true, json: async () => ({ retCode: 0, result: { list: [{ lastPrice: '100', markPrice: '101', indexPrice: '99' }] } }) };
  });
}

describe('free crypto Fastify route', () => {
  let app;
  beforeEach(async () => { resetFreeCryptoMarketCache(); app = Fastify(); await registerFreeCryptoMarketRoutes(app); });
  afterEach(async () => { await app.close(); global.fetch = realFetch; vi.useRealTimers(); });
  it.each(['BTC', 'ETH'])('returns strict %s snapshot with observed venue fields', async (currency) => {
    fixture(); const res = await app.inject({ method: 'GET', url: `/api/free-crypto/market/${currency}` });
    expect(res.statusCode).toBe(200); const body = res.json();
    expect(body.source).toBe('free-exchanges'); expect(body).not.toHaveProperty('index');
    expect(body.venues[0]).toMatchObject({ mark: 101, index: 99, last: 100 });
  });
  it('preserves partial failure for either venue', async () => {
    fixture({ binance: false }); expect((await app.inject('/api/free-crypto/market/BTC')).statusCode).toBe(200);
    resetFreeCryptoMarketCache(); fixture({ bybit: false }); expect((await app.inject('/api/free-crypto/market/BTC')).statusCode).toBe(200);
  });
  it('returns typed 502 for both unusable and 400 for unsupported currency', async () => {
    fixture({ binance: false, bybit: false }); const unavailable = await app.inject('/api/free-crypto/market/BTC');
    expect(unavailable.statusCode).toBe(502); expect(unavailable.json()).toEqual({ error: 'FREE_CRYPTO_UNAVAILABLE' });
    const bad = await app.inject('/api/free-crypto/market/DOGE'); expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'UNSUPPORTED_CURRENCY' });
  });
  it('does not make a second upstream request inside 15 seconds', async () => {
    vi.useFakeTimers(); fixture(); await app.inject('/api/free-crypto/market/BTC'); await app.inject('/api/free-crypto/market/BTC');
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });
});
