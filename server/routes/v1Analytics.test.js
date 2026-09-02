import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../app.js';
import { clearCacheForTests } from '../../api/upstreamCache.js';
import { resetDeribitClientState } from '../providers/deribit/client.js';
import { validateContract } from '../../packages/contracts/src/runtime.js';
import { resolveRatesWorkerUrl } from '../ratesWorkerUrl.js';

let app;

const json = (body) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

const WORKER = resolveRatesWorkerUrl();

// Minimal worker /api/stir/strip payload exercising true SERFF (SR1-ZQ) + proxies.
const STIR_STRIP = {
  as_of: '2026-01-05T12:00:00.000Z',
  sr3: [
    { contract: 'SR3Z6', label: 'SR3Z6', month: 'Dec 26', ref_start: '2026-12-16', ref_end: '2027-03-17', implied_rate: 3.7, last_price: 96.3, source: 'live' },
  ],
  sr1: [{ contract: 'SR1Z6', label: 'SR1Z6', implied_rate: 3.75, last_price: 96.25, source: 'live' }],
  zq: [{ contract: 'ZQZ6', label: 'ZQZ6', implied_rate: 3.62, last_price: 96.38, source: 'live' }],
  effr: 3.65,
  iorb: 4.4,
  spreads: {
    by_kind: {
      serff: [
        { name: 'SERFFZ6', kind: 'serff', legs: ['SR1Z6', 'ZQZ6'], ratio: '1:1', rate_bps: 13.0, price_spread: -0.13, note: 'CME SERFF same-month SR1 − ZQ' },
      ],
      'derived-proxy': [
        { name: 'SR3Z6−EFFR (proxy)', legs: ['SR3Z6', 'EFFR (cash)'], ratio: '1:1', rate_bps: 5.0, note: 'Derived, non-listed, non-executable proxy — not SERFF.' },
      ],
    },
  },
};

function deribitResult(result) {
  return json({ jsonrpc: '2.0', result });
}

function installBoundaryMock() {
  const expiry = Date.UTC(2030, 11, 30, 8);
  const timestamp = Date.now();
  global.fetch = vi.fn(async (input, _init) => {
    const url = new URL(String(input));
    // Worker endpoints
    if (url.hostname === new URL(WORKER).hostname) {
      if (url.pathname === '/api/stir/strip') return json(STIR_STRIP);
      if (url.pathname === '/api/rates/term-structure') {
        return json({ T: 0.25, r: null, r_pct: null, available: false, r_source: 'unavailable', curve_points: [], curve_coverage: { points: 0, state: 'unavailable' }, warnings: ['treasury_curve_unavailable'], sofr: null });
      }
      return json({});
    }
    // Free crypto (Binance/Bybit)
    if (url.hostname.includes('binance.com')) {
      if (url.pathname.includes('/premiumIndex')) return json({ symbol: 'BTCUSDT', markPrice: '60050', indexPrice: '60000', lastFundingRate: '0.0001' });
      if (url.pathname.includes('/openInterest')) return json({ symbol: 'BTCUSDT', openInterest: '100000' });
      return json({ symbol: 'BTCUSDT', lastPrice: '60050', quoteVolume: '1e9', priceChangePercent: '0.5' });
    }
    if (url.hostname.includes('bybit.com')) {
      return json({ retCode: 0, result: { list: [{ symbol: 'BTCUSDT', lastPrice: '60040', markPrice: '60050', indexPrice: '60000', fundingRate: '0.0001', openInterest: '90000', turnover24h: '2e9', price24hPcnt: '0.005' }] } });
    }
    // Deribit
    if (url.pathname.endsWith('/get_instruments')) {
      return deribitResult([
        { instrument_name: 'BTC-30DEC30-60000-C', kind: 'option', is_active: true, strike: 60000, expiration_timestamp: expiry, option_type: 'call', contract_size: 1, base_currency: 'BTC', quote_currency: 'USD', settlement_currency: 'BTC', is_inverse: true, tick_size: 0.0005, settlement_period: 'month', creation_timestamp: timestamp },
        { instrument_name: 'BTC-30DEC30', kind: 'future', is_active: true, expiration_timestamp: expiry, contract_size: 10, base_currency: 'BTC', quote_currency: 'USD', settlement_currency: 'BTC', is_inverse: true, tick_size: 0.5, settlement_period: 'month', creation_timestamp: timestamp },
        { instrument_name: 'BTC-PERPETUAL', kind: 'future', is_active: true, expiration_timestamp: Date.UTC(3000, 0, 1), contract_size: 10, base_currency: 'BTC', quote_currency: 'USD', settlement_currency: 'BTC', is_inverse: true, tick_size: 0.5, settlement_period: 'perpetual', creation_timestamp: timestamp },
      ]);
    }
    if (url.pathname.endsWith('/get_book_summary_by_currency') && url.searchParams.get('kind') === 'option') {
      return deribitResult([{ instrument_name: 'BTC-30DEC30-60000-C', mark_price: 0.05, bid_price: 0.049, ask_price: 0.051, last_price: 0.05, bid_iv: 54, ask_iv: 56, mark_iv: 55, open_interest: 100, volume: 5, underlying_price: 60000, timestamp }]);
    }
    if (url.pathname.endsWith('/get_book_summary_by_currency') && url.searchParams.get('kind') === 'future') {
      return deribitResult([
        { instrument_name: 'BTC-30DEC30', mark_price: 62000, bid_price: 61990, ask_price: 62010, last_price: 62000, open_interest: 200, volume: 20, underlying_price: 60000, timestamp },
        { instrument_name: 'BTC-PERPETUAL', mark_price: 60001, bid_price: 60000, ask_price: 60002, last_price: 60001, underlying_price: 60000, timestamp },
      ]);
    }
    if (url.pathname.endsWith('/get_index_price')) return deribitResult({ index_price: 60000 });
    if (url.pathname.endsWith('/get_funding_rate_history')) {
      return deribitResult({ history: [{ timestamp: timestamp - 86_400_000, index_price: 60000, interest_8h: 0, fee_8h: 0.0001, open_interest: 100 }], has_more: false });
    }
    if (url.pathname.endsWith('/get_last_trades_by_currency_and_time')) {
      return deribitResult({
        trades: [
          { trade_id: 'a', instrument_name: 'BTC-30DEC30-60000-C', timestamp: timestamp - 1000, price: 0.05, amount: 10, index_price: 60000, mark_price: 0.051, direction: 'buy', block_trade: false, tick_direction: 2, iv: 55 },
          { trade_id: 'bad-date', instrument_name: 'BTC-31FEB30-60000-P', timestamp, price: 0.04, amount: 1, index_price: 60000, direction: 'sell', block_trade: false, iv: 54 },
        ],
        has_more: false,
      });
    }
    return json({});
  });
}

beforeEach(async () => {
  clearCacheForTests();
  resetDeribitClientState();
  installBoundaryMock();
  app = await buildServer();
  await app.ready();
});

afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

describe('canonical /api/v1 analytical operations (C2)', () => {
  it('provider/status validates and shows cache + provider modes', async () => {
    const response = await app.inject('/api/v1/provider/status');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('providerStatusResponse', body)).toMatchObject({ valid: true });
    expect(body.data.cache.entries).toBeTypeOf('number');
    expect(body.data.cache.hits).toBeTypeOf('number');
    expect(body.data.cache.misses).toBeTypeOf('number');
    expect(body.data.cache.inflight).toBe(0);
    expect(body.data.quota).toMatchObject({ scope: 'process-local', persistent: false, healthy: false });
    const fmpQuota = body.data.quota.providers.find((row) => row.provider === 'fmp');
    expect(fmpQuota).toMatchObject({ period: 'day', cap: 250 });
    expect(fmpQuota.remaining).toBe(Math.max(0, fmpQuota.cap - fmpQuota.used));
    expect(JSON.stringify(body.data.quota)).not.toMatch(/(path|key|query|token|secret)/i);
    expect(body.data.providerModes.crypto?.mode).toBeTruthy();
    expect(body.data.providerModes.crypto).not.toHaveProperty('veloCredentialPresent');
    expect(body.data.providerModes.crypto).not.toHaveProperty('veloConfigured');
    expect(body.data.circuits).toHaveLength(5);
    expect(body.data.circuits.map((row) => row.provider)).toEqual(['deribit', 'binance-futures', 'bybit-linear', 'bybit-options', 'okx-options']);
    for (const row of body.data.circuits) {
      expect(row).toEqual({
        provider: row.provider,
        status: 'closed',
        failures: 0,
        cooldownRemainingMs: 0,
        probeInFlight: false,
      });
      expect(row).not.toHaveProperty('openedAt');
      expect(JSON.stringify(row)).not.toMatch(/(secret|token|query|error)/i);
    }
    const duplicate = structuredClone(body);
    duplicate.data.circuits[1] = { ...duplicate.data.circuits[0] };
    expect(validateContract('providerStatusResponse', duplicate).valid).toBe(false);
  });

  it('rates/stir surfaces exact same-month SR1-ZQ SERFF rows and separate proxies', async () => {
    const response = await app.inject('/api/v1/rates/stir');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('ratesStirResponse', body)).toMatchObject({ valid: true });
    expect(body.cache).toMatchObject({ hit: false, stale: false });
    expect(body.cache.providerError).toBeNull();
    expect(body.data.serff).toHaveLength(1);
    expect(body.data.serff[0]).toMatchObject({ name: 'SERFFZ6', ratio: '1:1', legs: ['SR1Z6', 'ZQZ6'], rate_bps: 13 });
    expect(body.data.derivedProxies[0].name).toContain('proxy');
  });

  it('rates/term-structure keeps r null and carries coverage/warnings when curve is unavailable', async () => {
    const response = await app.inject('/api/v1/rates/term-structure?T=0.25');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('ratesTermStructureResponse', body)).toMatchObject({ valid: true });
    expect(body.data.r).toBeNull();
    expect(body.cache).toHaveProperty('state');
    expect(body.data.available).toBe(false);
    expect(body.data.curveCoverage.state).toBe('unavailable');
    expect(body.warnings.length).toBeGreaterThan(0);
  });

  it('crypto/carry composes funding, perp premium and free-exchange source flags', async () => {
    const response = await app.inject('/api/v1/crypto/carry/BTC');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('cryptoCarryResponse', body)).toMatchObject({ valid: true });
    expect(body.data.sources).toMatchObject({ deribitFunding: true, freeExchanges: true });
    expect(body.data.indexPrice).toBe(60000);
    expect(body.cache).toMatchObject({ state: 'miss', hit: false, stale: false });
    const cached = await app.inject('/api/v1/crypto/carry/BTC');
    expect(cached.json().cache).toMatchObject({ state: 'fresh', hit: true, stale: false });
  });

  it('crypto/flow aggregates buy/sell call/put and validates the contract', async () => {
    const response = await app.inject('/api/v1/crypto/flow/BTC?hours=24&count=100');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('cryptoFlowResponse', body)).toMatchObject({ valid: true });
    expect(body.data.aggregates.calls.buy.count).toBe(1);
    expect(body.data.count).toBe(1);
    expect(body.coverage).toMatchObject({ state: 'partial', missing: ['invalid-trades-dropped'] });
    expect(body.cache).toMatchObject({ state: 'miss', hit: false, stale: false });
    expect((await app.inject('/api/v1/crypto/flow/BTC?hours=24&count=100')).json().cache)
      .toMatchObject({ state: 'fresh', hit: true, stale: false });
    // invalid hours → typed 400
    const bad = await app.inject('/api/v1/crypto/flow/BTC?hours=7');
    expect(bad.statusCode).toBe(400);
    expect(validateContract('errorResponse', bad.json())).toMatchObject({ valid: true });
  });

  it('surface analytics returns observed IV nodes and no fabricated model mesh', async () => {
    const response = await app.inject('/api/v1/analytics/volatility-surface/BTC');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('volatilitySurfaceResponse', body)).toMatchObject({ valid: true });
    expect(body.data.observedNodes).toEqual([
      expect.objectContaining({ strike: 60000, right: 'call', bidIv: 0.54, askIv: 0.56, venueMarkIv: 0.55 }),
    ]);
    expect(body.data.modelLayer).toEqual({ status: 'unavailable', name: null, calibratedAt: null, nodes: [] });
    expect(body.provenanceByField['data.modelLayer']).toBe('unavailable-no-calibration');
    const oversized = await app.inject('/api/v1/analytics/volatility-surface/BTC?maxRows=5001');
    expect(oversized.statusCode).toBe(400);
  });

  it('Greeks require explicit paired rates and remain model-labelled', async () => {
    const missingRates = await app.inject('/api/v1/analytics/greeks/BTC');
    expect(missingRates.statusCode).toBe(200);
    expect(missingRates.json().data.points[0].delta).toBeNull();

    const oneRate = await app.inject('/api/v1/analytics/greeks/BTC?riskFreeRate=0.04');
    expect(oneRate.statusCode).toBe(400);
    expect(validateContract('errorResponse', oneRate.json())).toMatchObject({ valid: true });

    const response = await app.inject('/api/v1/analytics/greeks/BTC?riskFreeRate=0.04&carryRate=0');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('greeksResponse', body)).toMatchObject({ valid: true });
    expect(body.data.points[0]).toMatchObject({
      iv: 0.55,
      ivBasis: 'venue-mark',
      delta: expect.any(Number),
      gamma: expect.any(Number),
      vega: expect.any(Number),
      theta: expect.any(Number),
      vanna: expect.any(Number),
      charm: expect.any(Number),
    });
    expect(body.assumptions.join(' ')).toContain('no rate is defaulted');
  });

  it('inverse crypto positioning fails closed instead of applying an equity multiplier', async () => {
    const response = await app.inject('/api/v1/analytics/positioning/BTC?riskFreeRate=0.04&carryRate=0');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('positioningResponse', body)).toMatchObject({ valid: true });
    expect(body.data.contractMultiplier).toBeNull();
    expect(body.data.points[0]).toMatchObject({ openInterest: 100, oiState: 'observed', gex1PctUsd: null });
    expect(body.coverage.missing).toContain('inverse-contract-normalization');
  });

  it('academy/index validates from the real docs catalog', async () => {
    const response = await app.inject('/api/v1/academy/index');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('academyIndexResponse', body)).toMatchObject({ valid: true });
    expect(body.data.title).toBeTruthy();
    expect(Array.isArray(body.data.children)).toBe(true);
    expect(body.data.children.length).toBeGreaterThan(10);
    expect(body.data.children[0]).toMatchObject({ title: expect.any(String), path: expect.stringMatching(/^docs\//) });
  });

  it('ksa/board fails closed with ENTITLEMENT_MISSING without a server key', async () => {
    const prev = process.env.SAHMK_API_KEY;
    delete process.env.SAHMK_API_KEY;
    const response = await app.inject('/api/v1/ksa/board');
    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(validateContract('errorResponse', body)).toMatchObject({ valid: true });
    expect(body.error.code).toBe('ENTITLEMENT_MISSING');
    if (prev !== undefined) process.env.SAHMK_API_KEY = prev;
  });

  it('ksa/board applies the same billing gate as the legacy endpoint', async () => {
    const oldKey = process.env.SAHMK_API_KEY;
    const oldStripe = process.env.STRIPE_SECRET_KEY;
    process.env.SAHMK_API_KEY = 'configured-only-for-test';
    process.env.STRIPE_SECRET_KEY = 'sk_test_configured';
    try {
      const response = await app.inject('/api/v1/ksa/board');
      expect(response.statusCode).toBe(402);
      const body = response.json();
      expect(validateContract('errorResponse', body)).toMatchObject({ valid: true });
      expect(body.error.code).toBe('ENTITLEMENT_MISSING');
    } finally {
      if (oldKey === undefined) delete process.env.SAHMK_API_KEY; else process.env.SAHMK_API_KEY = oldKey;
      if (oldStripe === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = oldStripe;
    }
  });
});
