import Fastify from 'fastify';
import Ajv from 'ajv';
import { describe, expect, it, afterEach } from 'vitest';
import { registerFreeCryptoMarketRoutes } from './freeCryptoMarket.js';
import { buildOpenApiDocument } from './openapi.js';
import { resetFreeCryptoMarketCache } from '../providers/freeCrypto/client.js';

const realFetch = global.fetch;
const ok = (url) => ({ ok: true, json: async () => String(url).includes('bybit')
  ? { retCode: 0, result: { list: [{ symbol: 'BTCUSDT', lastPrice: '100', markPrice: '101', indexPrice: '99' }] } }
  : String(url).includes('premiumIndex') ? { symbol: 'BTCUSDT', markPrice: '101', indexPrice: '99' }
    : String(url).includes('openInterest') ? { symbol: 'BTCUSDT', openInterest: '1' }
      : { symbol: 'BTCUSDT', lastPrice: '100', quoteVolume: '1', priceChangePercent: '0' } });

afterEach(() => { global.fetch = realFetch; resetFreeCryptoMarketCache(); });

describe('free crypto OpenAPI response contracts', () => {
  it('validates actual 200, 400, and 502 responses against documented schemas', async () => {
    const app = Fastify(); await registerFreeCryptoMarketRoutes(app);
    const doc = buildOpenApiDocument().paths['/api/free-crypto/market/{currency}'].get;
    const ajv = new Ajv({ strict: false });
    const success = ajv.compile(doc.responses[200].content['application/json'].schema);
    const badSchema = ajv.compile(doc.responses[400].content['application/json'].schema);
    const unavailableSchema = ajv.compile(doc.responses[502].content['application/json'].schema);
    global.fetch = async (url) => ok(url);
    const good = await app.inject('/api/free-crypto/market/BTC'); expect(good.statusCode).toBe(200); expect(success(good.json())).toBe(true);
    const bad = await app.inject('/api/free-crypto/market/DOGE'); expect(bad.statusCode).toBe(400); expect(badSchema(bad.json())).toBe(true); expect(bad.json().error).toBe('UNSUPPORTED_CURRENCY');
    resetFreeCryptoMarketCache(); global.fetch = async () => { throw new Error('down'); }; const unavailable = await app.inject('/api/free-crypto/market/BTC');
    expect(unavailable.statusCode).toBe(502); expect(unavailableSchema(unavailable.json())).toBe(true); expect(unavailable.json().error).toBe('FREE_CRYPTO_UNAVAILABLE');
    await app.close();
  });
});
