/**
 * Deribit integration test — raw recorded fixtures → catalogue/quote join →
 * server endpoint (fastify inject) → browser contract → workflow consumption.
 *
 * Fixtures are recorded raw Deribit response bodies (jsonrpc + result wrapper),
 * matching actual public API shapes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');
const load = (name) => JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')).result;

import {
  normalizeCatalogueEntry,
  joinCatalogueWithQuotes,
  normalizeTrade,
  catalogueKind,
  ivPctToDecimal,
} from './normalize.js';

// Mock the HTTP client to serve recorded fixtures by method.
vi.mock('./client.js', () => ({
  deribitFetch: vi.fn(async (methodWithQuery) => {
    const method = methodWithQuery.split('?')[0];
    if (method === 'get_instruments') {
      // Route fetches the full active catalogue (options + futures + perp) in one call.
      return [...load('get_instruments.option.json'), ...load('get_instruments.future.json')];
    }
    if (method === 'get_book_summary_by_currency') {
      const kind = /kind=option/.test(methodWithQuery) ? 'option' : 'future';
      return load(kind === 'option' ? 'get_book_summary.option.json' : 'get_book_summary.future.json');
    }
    if (method === 'ticker') return load('ticker.perp.json');
    if (method === 'get_last_trades_by_currency_and_time') return load('get_last_trades.json');
    if (method === 'get_index_price') return { index_price: 60150.0, estimated_delivery_price: 60150.25 };
    throw new Error(`fixture route missing for: ${method}`);
  }),
}));

import { deribitFetch } from './client.js';
import { clearCacheForTests } from '../../../api/upstreamCache.js';

import { registerDeribitMarketRoutes } from '../../routes/deribitMarket.js';

const TS = 1735286400000;

describe('Deribit fixtures → catalogue/quote join', () => {
  it('classifies PERPETUAL as kind=perp (never future)', () => {
    const perp = load('get_instruments.future.json')[0];
    expect(perp.instrument_name).toBe('BTC-PERPETUAL');
    expect(perp.kind).toBe('future'); // Deribit reports perp under kind=future
    expect(catalogueKind(perp)).toBe('perp');
    const meta = normalizeCatalogueEntry(perp);
    expect(meta.kind).toBe('perp');
    expect(meta.expiryMs).toBeNull(); // year-3000 sentinel → no expiry
  });

  it('converts Deribit percentage-point IV to decimal exactly once', () => {
    expect(ivPctToDecimal(55.0)).toBe(0.55);
    expect(ivPctToDecimal(56.0)).toBe(0.56);
    expect(ivPctToDecimal(null)).toBeNull();
    expect(ivPctToDecimal('not-a-number')).toBeNull();
  });

  it('joins catalogue metadata with quotes; missing quotes stay null', () => {
    const catalogue = [
      ...load('get_instruments.option.json'),
      ...load('get_instruments.future.json'),
    ].map(normalizeCatalogueEntry).filter(Boolean);
    // Quotes exactly as loadQuotes assembles them: option + future summaries + perp ticker
    const perpTicker = load('ticker.perp.json');
    const quotes = [
      ...load('get_book_summary.option.json'),
      ...load('get_book_summary.future.json'),
      {
        instrument_name: perpTicker.instrument_name,
        mark_price: perpTicker.mark_price,
        last_price: perpTicker.last_price,
        best_bid_price: perpTicker.best_bid_price,
        best_ask_price: perpTicker.best_ask_price,
        index_price: perpTicker.index_price,
        open_interest: perpTicker.open_interest,
        funding_8h: perpTicker.funding_8h,
        timestamp: perpTicker.timestamp,
      },
    ];
    const { rows, coverage, catalogueCount, withQuotes } = joinCatalogueWithQuotes(catalogue, quotes, TS);

    expect(catalogueCount).toBe(6);
    expect(withQuotes).toBe(4); // 2 options + 1 dated future + perp
    expect(coverage).toBeCloseTo(4 / 6, 6); // against ACTIVE CATALOGUE count, not /50

    const call = rows.find((r) => r.instrument === 'BTC-27DEC24-80000-C');
    // Metadata from authoritative catalogue
    expect(call.strike).toBe(80000);
    expect(call.expiryMs).toBe(1735286400000);
    expect(call.optionType).toBe('call');
    expect(call.contractSize).toBe(1);
    expect(call.baseCurrency).toBe('BTC');
    expect(call.quoteCurrency).toBe('USD');
    expect(call.settlementCurrency).toBe('BTC');
    expect(call.isInverse).toBe(true);
    // Quote layers — IV decimal
    expect(call.bidPrice).toBe(0.0508);
    expect(call.askPrice).toBe(0.0516);
    expect(call.markPrice).toBe(0.0512);
    expect(call.bidIv).toBeCloseTo(0.552, 8);
    expect(call.askIv).toBeCloseTo(0.568, 8);
    expect(call.markIv).toBeCloseTo(0.56, 8);
    expect(call.openInterest).toBe(123.5); // base units, not ×100
    expect(call.volumeUsd).toBe(736500.25); // raw Deribit volume_usd preserved
    expect(call.hasQuote).toBe(true);

    const put = rows.find((r) => r.instrument === 'BTC-27DEC24-80000-P');
    expect(put.bidIv).toBeNull(); // venue reported null → stays null
    expect(put.bidPrice).toBeNull(); // never a plausible default
    expect(put.markIv).toBeCloseTo(0.548, 8);

    // Catalogue row with no quote: metadata intact, market fields null
    const orphan = rows.find((r) => r.instrument === 'BTC-28MAR25-60000-C');
    expect(orphan.strike).toBe(60000);
    expect(orphan.markPrice).toBeNull();
    expect(orphan.markIv).toBeNull();
    expect(orphan.openInterest).toBeNull();
    expect(orphan.hasQuote).toBe(false);

    const perp = rows.find((r) => r.instrument === 'BTC-PERPETUAL');
    expect(perp.kind).toBe('perp');
    expect(perp.funding8h).toBe(0.0001);
  });
});

describe('Deribit endpoint → browser contract', () => {
  let app;
  beforeEach(async () => {
    app = Fastify({ logger: false });
    await registerDeribitMarketRoutes(app);
  });

  it('GET /api/deribit/market/BTC returns the browser contract', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/deribit/market/BTC' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Contract shape (src/api/deribit.ts DeribitMarketBundle)
    expect(body.source).toBe('deribit');
    expect(body.currency).toBe('BTC');
    expect(body.indexPrice).toBe(60150.0);
    expect(typeof body.fetchedAt).toBe('number');
    expect(Array.isArray(body.instruments)).toBe(true);
    expect(body.coverage).toBeCloseTo(4 / 6, 6);
    expect(body.funding8h).toBe(0.0001);

    const perp = body.instruments.find((r) => r.instrument === 'BTC-PERPETUAL');
    expect(perp.kind).toBe('perp');
    const call = body.instruments.find((r) => r.instrument === 'BTC-27DEC24-80000-C');
    expect(call.markIv).toBeCloseTo(0.56, 8); // decimal
  });

  it('GET /api/deribit/trades/BTC normalizes native premium and decimal IV', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/deribit/trades/BTC' });
    expect(res.statusCode).toBe(200);
    const { trades } = res.json();
    expect(trades).toHaveLength(2);
    const buy = trades[0];
    expect(buy.side).toBe('buy');
    expect(buy.markIv).toBeCloseTo(0.561, 8); // 56.1 pct-points → decimal
    // Native premium: price × amount × contract_size = 0.052 × 2.5 × 1 BTC
    expect(buy.premiumNative).toBeCloseTo(0.13, 8);
    expect(buy.nativeCurrency).toBe('BTC');
    expect(buy.contractSize).toBe(1);
    const block = trades[1];
    expect(block.blockTrade).toBe(true);
  });

  it('rejects invalid currency and invalid index names', async () => {
    expect((await app.inject({ url: '/api/deribit/market/DOGE' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/deribit/index/sol_usd' })).statusCode).toBe(400);
  });
});

describe('Workflow consumption of the contract', () => {
  it('renders 55.0 Deribit IV as 55%, not 5,500%', () => {
    // Volatility view format: (iv * 100).toFixed(1) + '%'
    const markIvDecimal = ivPctToDecimal(56.0);
    expect((markIvDecimal * 100).toFixed(1) + '%').toBe('56.0%');
    const atmIv = ivPctToDecimal(55.0);
    expect((atmIv * 100).toFixed(1) + '%').toBe('55.0%');
  });

  it('volatility term building uses joined real expiries/strikes (no fabricated rows)', () => {
    const catalogue = [
      ...load('get_instruments.option.json'),
      ...load('get_instruments.future.json'),
    ].map(normalizeCatalogueEntry).filter(Boolean);
    const quotes = [...load('get_book_summary.option.json'), ...load('get_book_summary.future.json')];
    const { rows } = joinCatalogueWithQuotes(catalogue, quotes, TS);
    // atmIvAtExpiry: nearest strike to spot with markIv
    const spot = 60150;
    const atExpiry = rows.filter((t) => t.expiryMs === 1735286400000 && t.markIv != null && t.strike != null);
    atExpiry.sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
    expect(atExpiry.length).toBeGreaterThan(0);
    // Only observed rows participate — no synthetic ATM fill
    expect(atExpiry.every((t) => t.hasQuote)).toBe(true);
  });

  it('trade premium stays in native currency (not quote USD)', () => {
    const raw = load('get_last_trades.json').trades[0];
    const meta = normalizeCatalogueEntry(load('get_instruments.option.json')[0]);
    const t = normalizeTrade(raw, meta);
    // 0.052 BTC price × 2.5 contracts × 1 = 0.13 BTC — NOT 0.13 × 60150 USD
    expect(t.premiumNative).toBeCloseTo(0.13, 8);
    expect(t.nativeCurrency).toBe('BTC');
  });
});

describe('Deribit legacy routes: full cache envelope and error redaction', () => {
  let app;
  beforeEach(async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    clearCacheForTests();
    app = Fastify({ logger: false });
    await registerDeribitMarketRoutes(app);
  });
  afterEach(() => {
    vi.useRealTimers();
    return app.close();
  });

  it('exposes full sanitized cache envelope on cold miss and fresh hit', async () => {
    const cold = await app.inject('/api/deribit/market/BTC');
    expect(cold.statusCode).toBe(200);
    expect(cold.json().cache).toEqual({
      state: 'miss', hit: false, ageMs: expect.any(Number),
      stale: false, coalesced: false, providerError: null,
    });
    const fresh = await app.inject('/api/deribit/market/BTC');
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().cache).toMatchObject({ state: 'fresh', hit: true });
    expect(fresh.json().indexPrice).toBe(60150.0); // data fields unchanged
  });

  it('serves labelled stale last-good data when all quote fetches fail, and redacts internals', async () => {
    await app.inject('/api/deribit/market/BTC'); // primes catalogue + market snapshot
    vi.advanceTimersByTime(20_001); // market TTL expired; catalogue still fresh
    const baseImpl = deribitFetch.getMockImplementation();
    deribitFetch.mockImplementation(() => Promise.reject(new Error('SECRET-BOOK-TRACE')));
    try {
      // Zero-coverage fill throws insufficient_coverage → last-good stale serve.
      const stale = await app.inject('/api/deribit/market/BTC');
      expect(stale.statusCode).toBe(200);
      expect(stale.json().cache).toMatchObject({ state: 'stale', stale: true, providerError: 'insufficient_coverage' });
      expect(stale.json().indexPrice).toBe(60150.0); // last-good data, labelled stale
      expect(stale.body).not.toContain('SECRET-BOOK-TRACE');
    } finally {
      deribitFetch.mockImplementation(baseImpl);
    }
  });

  it('fails closed on cold failure with a sanitized typed error', async () => {
    deribitFetch.mockImplementationOnce(() => Promise.reject(new Error('SECRET-INTERNAL-TRACEBACK')));
    const res = await app.inject('/api/deribit/market/ETH');
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'Deribit market bundle failed', detail: 'upstream-error' });
    expect(res.body).not.toContain('SECRET-INTERNAL-TRACEBACK');
  });

  it('labels stale index price and redacts internal errors', async () => {
    await app.inject('/api/deribit/index/btc_usd');
    vi.advanceTimersByTime(20_001);
    deribitFetch.mockImplementationOnce(() => Promise.reject(new Error('SECRET-INTERNAL')));
    const stale = await app.inject('/api/deribit/index/btc_usd');
    expect(stale.statusCode).toBe(200);
    expect(stale.json().cache).toMatchObject({ state: 'stale', stale: true, providerError: 'upstream-error' });
    expect(stale.body).not.toContain('SECRET-INTERNAL');
  });
});
