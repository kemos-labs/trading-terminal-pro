import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCacheForTests } from '../../api/upstreamCache.js';
import { TTL } from '../../api/upstreamCache.js';
import { resetDeribitClientState } from '../providers/deribit/client.js';
import { validateContract } from '../../packages/contracts/src/runtime.js';

const REAL_FETCH = global.fetch;

function deribitResponse(result) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function installDeribitBoundary() {
  const expiry = Date.UTC(2030, 11, 30, 8);
  const timestamp = Date.now();
  global.fetch = vi.fn(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/get_instruments')) {
      return deribitResponse([
        {
          instrument_name: 'BTC-30DEC30-60000-C', kind: 'option', is_active: true,
          strike: 60000, expiration_timestamp: expiry, option_type: 'call',
          contract_size: 1, base_currency: 'BTC', quote_currency: 'USD', settlement_currency: 'BTC',
          is_inverse: true, tick_size: 0.0005, settlement_period: 'month', creation_timestamp: timestamp,
        },
        {
          instrument_name: 'BTC-30DEC30-60000-P', kind: 'option', is_active: true,
          strike: 60000, expiration_timestamp: expiry, option_type: 'put',
          contract_size: 1, base_currency: 'BTC', quote_currency: 'USD', settlement_currency: 'BTC',
          is_inverse: true, tick_size: 0.0005, settlement_period: 'month', creation_timestamp: timestamp,
        },
        {
          instrument_name: 'BTC-30DEC30', kind: 'future', is_active: true,
          expiration_timestamp: expiry, contract_size: 10, base_currency: 'BTC', quote_currency: 'USD',
          settlement_currency: 'BTC', is_inverse: true, tick_size: 0.5, settlement_period: 'month', creation_timestamp: timestamp,
        },
        {
          instrument_name: 'BTC-PERPETUAL', kind: 'future', is_active: true,
          expiration_timestamp: Date.UTC(3000, 0, 1), contract_size: 10, base_currency: 'BTC', quote_currency: 'USD',
          settlement_currency: 'BTC', is_inverse: true, tick_size: 0.5, settlement_period: 'perpetual', creation_timestamp: timestamp,
        },
      ]);
    }
    if (url.pathname.endsWith('/get_book_summary_by_currency') && url.searchParams.get('kind') === 'option') {
      return deribitResponse([
        { instrument_name: 'BTC-30DEC30-60000-C', mark_price: 0.05, bid_price: 0.049, ask_price: 0.051, last_price: 0.05, bid_iv: 54, ask_iv: 56, mark_iv: 55, open_interest: 100, volume: 5, underlying_price: 60000, timestamp },
        { instrument_name: 'BTC-30DEC30-60000-P', mark_price: 0.048, bid_price: null, ask_price: 0.049, last_price: null, bid_iv: null, ask_iv: 57, mark_iv: 56, open_interest: null, volume: null, underlying_price: 60000, timestamp },
      ]);
    }
    if (url.pathname.endsWith('/get_book_summary_by_currency') && url.searchParams.get('kind') === 'future') {
      return deribitResponse([
        { instrument_name: 'BTC-30DEC30', mark_price: 62000, bid_price: 61990, ask_price: 62010, last_price: 62000, open_interest: 200, volume: 20, underlying_price: 60000, timestamp },
      ]);
    }
    if (url.pathname.endsWith('/ticker')) {
      return deribitResponse({ instrument_name: 'BTC-PERPETUAL', mark_price: 60001, best_bid_price: 60000, best_ask_price: 60002, last_price: 60001, index_price: 60000, open_interest: null, funding_8h: null, timestamp });
    }
    if (url.pathname.endsWith('/get_index_price')) return deribitResponse({ index_price: 60000 });
    if (url.pathname.endsWith('/get_funding_rate_history')) {
      return deribitResponse([
        { timestamp: timestamp - 8 * 3600_000, interest_8h: 0.00005, index_price: 59900 },
        { timestamp, interest_8h: 0.00006, index_price: 60000 },
      ]);
    }
    if (url.pathname.endsWith('/get_last_trades_by_currency_and_time')) {
      return deribitResponse({
        trades: [
          { instrument_name: 'BTC-30DEC30-60000-C', timestamp, price: 0.05, amount: 2, direction: 'buy', mark_iv: 55, block_trade: false },
          { instrument_name: 'BTC-31FEB30-60000-P', timestamp, price: 0.04, amount: 1, direction: 'sell', mark_iv: 54, block_trade: false },
        ],
        has_more: false,
      });
    }
    return new Response(JSON.stringify({ error: 'unexpected test URL' }), { status: 404, headers: { 'content-type': 'application/json' } });
  });
}

let equityShouldFail = false;
let equityWait = false;
let releaseEquity;
const equityDouble = vi.fn((_cmd, args, _opts, callback) => {
  const symbol = String(args?.[1] ?? 'SPY');
  const finish = () => {
    if (equityShouldFail) {
      callback(new Error('options provider unavailable'), '', '');
      return;
    }
    callback(null, JSON.stringify({
      symbol,
      spot: 500,
      timestamp: Date.now(),
      expirations: ['2030-12-30'],
      quotes: [
        { strike: 500, expiry: '2030-12-30', type: 'call', bid: 10, ask: 11, lastPrice: 10.5, impliedVolatility: 0.2, volume: 20, openInterest: 100 },
        { strike: 500, expiry: '2030-12-30', type: 'put', bid: 9, ask: 10, lastPrice: 9.5, impliedVolatility: null, volume: null, openInterest: null },
      ],
    }), '');
  };
  if (equityWait) {
    return new Promise((resolve) => { releaseEquity = () => { finish(); resolve(); }; });
  }
  finish();
});

async function makeApp() {
  vi.resetModules();
  process.env.LOG_LEVEL = 'silent';
  const { __testHooks } = await import('./equityFeeds.js');
  __testHooks.execFile = equityDouble;
  const { buildServer } = await import('../app.js');
  return buildServer();
}

describe('canonical /api/v1 contracts', () => {
  let app;

  beforeEach(async () => {
    equityDouble.mockClear();
    equityShouldFail = false;
    equityWait = false;
    releaseEquity = null;
    clearCacheForTests();
    resetDeribitClientState();
    installDeribitBoundary();
    app = await makeApp();
  });

  afterEach(async () => {
    equityShouldFail = false;
    equityWait = false;
    releaseEquity?.();
    releaseEquity = null;
    global.fetch = REAL_FETCH;
    await app?.close();
  });

  it('serves validated health and workflow envelopes', async () => {
    const health = await app.inject('/api/v1/system/health');
    expect(health.statusCode).toBe(200);
    expect(validateContract('healthResponse', health.json())).toMatchObject({ valid: true });

    const workflows = await app.inject('/api/v1/workflows');
    expect(workflows.statusCode).toBe(200);
    expect(workflows.json().data.desks).toHaveLength(8);
    expect(validateContract('workflowsResponse', workflows.json())).toMatchObject({ valid: true });
  });

  it('sanitizes a delayed equity chain and preserves missing values as null', async () => {
    const response = await app.inject('/api/v1/market/options/SPY');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('optionsResponse', body)).toMatchObject({ valid: true });
    expect(body.freshness).toBe('delayed');
    expect(body.data.quotes[1]).toMatchObject({ markIv: null, volume: null, openInterest: null });
  });

  it('propagates option-chain stale metadata and fails closed after stale expiry', async () => {
    vi.useFakeTimers();
    try {
      const fresh = await app.inject('/api/v1/market/options/SPY');
      expect(fresh.statusCode).toBe(200);
      expect(fresh.json().cache).toMatchObject({ state: 'miss', hit: false, stale: false, coalesced: false, providerError: null });

      equityShouldFail = true;
      vi.advanceTimersByTime(TTL.OPTIONS_MS + 1);
      const stale = await app.inject('/api/v1/market/options/SPY');
      expect(stale.statusCode).toBe(200);
      expect(stale.json().cache).toMatchObject({ state: 'stale', hit: true, stale: true, providerError: 'upstream-error' });

      vi.advanceTimersByTime(TTL.OPTIONS_MS * 10 + 1);
      const expired = await app.inject('/api/v1/market/options/SPY');
      expect(expired.statusCode).toBe(502);
      expect(expired.json().error.code).toBe('PROVIDER_UNAVAILABLE');
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks a concurrent canonical option-chain join as coalesced', async () => {
    equityWait = true;
    const first = app.inject('/api/v1/market/options/MSFT');
    await Promise.resolve();
    const second = app.inject('/api/v1/market/options/MSFT');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(equityDouble).toHaveBeenCalledTimes(1);
    releaseEquity?.();
    const [a, b] = await Promise.all([first, second]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json().cache).toMatchObject({ hit: false, coalesced: false });
    expect(b.json().cache).toMatchObject({ hit: false, coalesced: true });
  });

  it('returns active Deribit instruments without coercing missing funding or OI to zero', async () => {
    const response = await app.inject('/api/v1/market/crypto/BTC');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('cryptoMarketResponse', body)).toMatchObject({ valid: true });
    const perpetual = body.data.instruments.find((row) => row.kind === 'perp');
    expect(perpetual).toMatchObject({ funding8h: null, openInterest: null });
    expect(body.data.instruments.every((row) => row.expiryMs == null || row.expiryMs > Date.now())).toBe(true);
    expect(body.cache).toMatchObject({ state: 'miss', hit: false, stale: false });
    const upstreamCalls = global.fetch.mock.calls.length;
    const cached = await app.inject('/api/v1/market/crypto/BTC');
    expect(cached.json().cache).toMatchObject({ state: 'fresh', hit: true, stale: false });
    expect(global.fetch).toHaveBeenCalledTimes(upstreamCalls);
  });

  it('labels funding units and preserves observed history through the v1 contract', async () => {
    const response = await app.inject('/api/v1/market/crypto/BTC/funding?days=30');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('cryptoFundingResponse', body)).toMatchObject({ valid: true });
    expect(body.data.points).toHaveLength(2);
    expect(body.data.points[1].rate8h).toBe(0.00006);
    expect(body.data.points[1].annualizedPct).toBeCloseTo(6.57, 10);
    expect(body.unitsByField['data.points[].rate8h']).toBe('decimal-per-8h');
    expect(body.cache).toMatchObject({ state: 'miss', hit: false });
    expect((await app.inject('/api/v1/market/crypto/BTC/funding?days=30')).json().cache)
      .toMatchObject({ state: 'fresh', hit: true });
  });

  it('parses Deribit trade right and expiry at the contract boundary', async () => {
    const response = await app.inject('/api/v1/market/crypto/BTC/trades?hours=24&count=100');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('cryptoTradesResponse', body)).toMatchObject({ valid: true });
    expect(body.data.trades[0]).toMatchObject({ right: 'call', expiry: '2030-12-30', side: 'buy' });
    expect(body.data.count).toBe(1);
    expect(body.coverage).toMatchObject({ state: 'partial', missing: ['invalid-trades'] });
    expect(body.cache).toMatchObject({ state: 'miss', hit: false });
    expect((await app.inject('/api/v1/market/crypto/BTC/trades?hours=24&count=100')).json().cache)
      .toMatchObject({ state: 'fresh', hit: true });
  });

  it('returns strict typed errors and rejects additional response properties', async () => {
    const response = await app.inject('/api/v1/market/crypto/DOGE');
    expect(response.statusCode).toBe(400);
    expect(validateContract('errorResponse', response.json())).toMatchObject({ valid: true });
    expect(response.json().error.code).toBe('UNSUPPORTED_CURRENCY');

    const invalid = response.json();
    invalid.secret = 'must-not-serialize';
    expect(validateContract('errorResponse', invalid).valid).toBe(false);
  });

  it('rejects invalid funding days with a typed 400 (never silently defaults)', async () => {
    for (const days of ['2', '5', 'abc', '-1', '7.5', '100']) {
      const response = await app.inject(`/api/v1/market/crypto/BTC/funding?days=${days}`);
      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(validateContract('errorResponse', body)).toMatchObject({ valid: true });
    }
  });

  it('rejects invalid trade hours/count with typed 400s (never silently clamps)', async () => {
    for (const qs of ['hours=3', 'hours=0', 'hours=abc', 'count=10', 'count=2000', 'count=1.5']) {
      const response = await app.inject(`/api/v1/market/crypto/BTC/trades?${qs}`);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_REQUEST');
    }
    // Valid extremes still pass the schema boundary.
    const ok = await app.inject('/api/v1/market/crypto/BTC/trades?hours=1&count=50');
    expect(ok.statusCode).toBe(200);
  });
});
