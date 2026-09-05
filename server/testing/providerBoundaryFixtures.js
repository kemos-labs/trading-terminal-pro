/**
 * Deterministic E2E fixtures installed at provider/process boundaries.
 * This module is reachable only when NODE_ENV=test and an explicit scenario is
 * selected. Browser requests still traverse the built UI and real Fastify routes.
 */
import { __testHooks as equityHooks } from '../routes/equityFeeds.js';

const FIXED_NOW = Date.UTC(2026, 8, 1, 1, 30);
const DAY = 86_400_000;
const MONTH_CODES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function deribitExpiryCode(timestamp) {
  const date = new Date(timestamp);
  return `${String(date.getUTCDate()).padStart(2, '0')}${MONTH_CODES[date.getUTCMonth()]}${String(date.getUTCFullYear()).slice(-2)}`;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function optionChain(symbol = 'SPY') {
  const spot = 500;
  const expirations = [30, 60, 90, 180].map((days) =>
    new Date(FIXED_NOW + days * DAY).toISOString().slice(0, 10));
  const strikes = [440, 460, 480, 490, 500, 510, 520, 540, 560];
  const quotes = expirations.flatMap((expiry, expiryIndex) => strikes.flatMap((strike) =>
    ['call', 'put'].map((type) => {
      const distance = Math.abs(strike - spot) / 10;
      const intrinsic = type === 'call' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
      const mid = intrinsic + Math.max(1.25, 12 - distance + expiryIndex * 1.5);
      return {
        strike,
        expiry,
        type,
        bid: Number((mid - 0.25).toFixed(2)),
        ask: Number((mid + 0.25).toFixed(2)),
        last: Number(mid.toFixed(2)),
        iv: Number((0.19 + expiryIndex * 0.012 + distance * 0.002).toFixed(4)),
        volume: 25 + expiryIndex * 5,
        openInterest: 100 + (strike % 37) * 10,
      };
    })));
  return { symbol, spot, expirations, quotes, timestamp: FIXED_NOW };
}

/**
 * Named failure-state scenarios for the representative RC gate.
 * Each scenario overrides the success baseline at exactly one boundary area;
 * everything else behaves exactly like `success`. Scenarios are process-wide
 * and switched at runtime via POST /api/__test/fixtures/scenario (test-only).
 */
export const FIXTURE_SCENARIOS = [
  'success',
  'home-partial', // sahmk down; all other providers succeed
  'chain-empty', // equity chain returns zero quotes (empty-state desks)
  'trade-loading', // equity chain resolves after ~6s (loading skeleton first)
  'rates-malformed', // rates worker answers 200 text/html (rejected, fail-closed)
  'crypto-partial', // Binance fails, Bybit succeeds (Partial venue badge)
  'crypto-down', // Deribit 503s, free venues succeed (independent fallback)
  'sahmk-down', // SAHMK 503s (Home partial + KSA stale/error paths)
  'ksa-entitlement', // success fixtures; billing gate enabled by the route
];

let activeScenario = 'success';
export function getFixtureScenario() {
  return activeScenario;
}
/** Test-only accessor for the equity execFile double (scenario assertions). */
export function __getEquityExecDoubleForTests() {
  return equityHooks.execFile;
}
export function setFixtureScenario(name) {
  if (!FIXTURE_SCENARIOS.includes(name)) {
    throw new Error(`Unsupported E2E fixture scenario: ${name}`);
  }
  activeScenario = name;
  return activeScenario;
}

const TRADE_LOADING_DELAY_MS = 6_000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function installEquityBoundary() {
  equityHooks.execFile = (_command, args, _options, callback) => {
    const script = String(args?.[0] ?? '');
    const symbol = String(args?.[1] ?? 'SPY').toUpperCase();
    if (script.endsWith('fetch_options.py')) {
      if (activeScenario === 'chain-empty') {
        callback(null, JSON.stringify({ symbol, spot: 500, expirations: [], quotes: [] }), '');
        return;
      }
      if (activeScenario === 'trade-loading') {
        // Slow boundary (route timeouts are 30-90s): UI must show loading first.
        void wait(TRADE_LOADING_DELAY_MS).then(() => callback(null, JSON.stringify(optionChain(symbol)), ''));
        return;
      }
      callback(null, JSON.stringify(optionChain(symbol)), '');
      return;
    }
    if (script.endsWith('fetch_yf.py') && args?.[2] === 'history') {
      const bars = Array.from({ length: 90 }, (_, index) => ({
        date: new Date(FIXED_NOW - (89 - index) * DAY).toISOString().slice(0, 10),
        open: 480 + index * 0.2,
        high: 482 + index * 0.2,
        low: 478 + index * 0.2,
        close: 480.5 + index * 0.2,
        volume: 1_000_000 + index * 1_000,
      }));
      callback(null, JSON.stringify({ symbol, bars, data: bars }), '');
      return;
    }
    callback(null, JSON.stringify({
      symbol,
      shortName: `${symbol} deterministic fixture`,
      regularMarketPrice: symbol.startsWith('BTC') ? 60_000 : 500,
      dividendYield: 0.012,
    }), '');
  };
}

function deribitPayload(url) {
  const currency = url.searchParams.get('currency') || 'BTC';
  const expiries = [30, 60, 90, 180].map((days) => FIXED_NOW + days * DAY);
  const strikes = [48_000, 54_000, 60_000, 66_000, 72_000];
  const catalogue = expiries.flatMap((expiry) => strikes.flatMap((strike) =>
    ['call', 'put'].map((right) => ({
      instrument_name: `${currency}-${deribitExpiryCode(expiry)}-${strike}-${right === 'call' ? 'C' : 'P'}`,
      kind: 'option', is_active: true, strike, expiration_timestamp: expiry, option_type: right,
      contract_size: 1, base_currency: currency, quote_currency: 'USD', settlement_currency: currency,
      is_inverse: true, tick_size: 0.0005, settlement_period: 'month', creation_timestamp: FIXED_NOW - DAY,
    }))));
  catalogue.push({
    instrument_name: `${currency}-PERPETUAL`, kind: 'future', is_active: true,
    expiration_timestamp: Date.UTC(3000, 0, 1), contract_size: 10, base_currency: currency,
    quote_currency: 'USD', settlement_currency: currency, is_inverse: true, tick_size: 0.5,
    settlement_period: 'perpetual', creation_timestamp: FIXED_NOW - DAY,
  });
  if (url.pathname.endsWith('/get_instruments')) return catalogue;
  if (url.pathname.endsWith('/get_book_summary_by_currency')) {
    if (url.searchParams.get('kind') === 'future') return [];
    return catalogue.filter((row) => row.kind === 'option').map((row, index) => ({
      instrument_name: row.instrument_name,
      mark_price: 0.04 + (index % 5) * 0.002,
      bid_price: 0.039 + (index % 5) * 0.002,
      ask_price: 0.041 + (index % 5) * 0.002,
      last_price: 0.04 + (index % 5) * 0.002,
      bid_iv: 49 + (index % 7), ask_iv: 51 + (index % 7), mark_iv: 50 + (index % 7),
      open_interest: 100 + index * 3, volume: 10 + index, underlying_price: 60_000,
      timestamp: FIXED_NOW,
    }));
  }
  if (url.pathname.endsWith('/ticker')) return {
    instrument_name: `${currency}-PERPETUAL`, mark_price: 60_010, best_bid_price: 60_005,
    best_ask_price: 60_015, last_price: 60_010, index_price: 60_000,
    open_interest: 25_000, funding_8h: 0.00005, timestamp: FIXED_NOW,
  };
  if (url.pathname.endsWith('/get_index_price')) return { index_price: 60_000 };
  if (url.pathname.endsWith('/get_funding_rate_history')) return Array.from({ length: 12 }, (_, index) => ({
    timestamp: FIXED_NOW - (11 - index) * 8 * 3_600_000,
    interest_8h: 0.00004 + index * 0.000001,
    index_price: 59_500 + index * 50,
  }));
  if (url.pathname.endsWith('/get_last_trades_by_currency_and_time')) return {
    trades: catalogue.filter((row) => row.kind === 'option').slice(0, 16).map((row, index) => ({
      instrument_name: row.instrument_name, timestamp: FIXED_NOW - index * 60_000,
      price: 0.04 + index * 0.0005, amount: 1 + (index % 3),
      direction: index % 2 ? 'sell' : 'buy', mark_iv: 50 + (index % 6), block_trade: false,
    })),
    has_more: false,
  };
  return null;
}

function ratesPayload(pathname) {
  const meta = { as_of: new Date(FIXED_NOW).toISOString(), source: 'deterministic-provider-fixture' };
  if (pathname.endsWith('/rates/summary')) return { ...meta, sofr: 4.53, effr: 4.32, usy2: 4.25, usy10: 4.55, spread_2s10s: 0.30, spread_3m10y: 0.18 };
  if (pathname.endsWith('/rates/curve')) return { ...meta, labels: ['1M','3M','6M','1Y','2Y','5Y','10Y','30Y'], yields: [4.4,4.42,4.39,4.31,4.25,4.36,4.55,4.7] };
  if (pathname.endsWith('/rates/curve-history')) return { ...meta, labels: ['1M','3M','6M','1Y','2Y','5Y','10Y','30Y'], today: [4.4,4.42,4.39,4.31,4.25,4.36,4.55,4.7], historical: [4.3,4.32,4.29,4.21,4.15,4.26,4.45,4.6] };
  if (pathname.endsWith('/rates/plumbing')) return { ...meta, sofr: 4.53, effr: 4.32, iorb: 4.4, rrp_rate: 4.30, rrp_volume_latest: 110, rrp_volume_history: [{ date: '2026-08-29', volume: 112 }, { date: '2026-08-30', volume: 111 }, { date: '2026-08-31', volume: 110 }], wresbal_history: [{ date: '2026-08-29', reserves: 3_240 }, { date: '2026-08-30', reserves: 3_245 }, { date: '2026-08-31', reserves: 3_250 }] };
  if (pathname.endsWith('/rates/basis-history')) return { ...meta, history: Array.from({ length: 60 }, (_, i) => ({ date: new Date(FIXED_NOW - (59 - i) * DAY).toISOString().slice(0,10), sofr: 4.47 + i * 0.001, effr: 4.28 + i * 0.0007, iorb: 4.40, sofr_effr_bps: 19 + i * 0.03, sofr_iorb_bps: 7 + i * 0.1, effr_iorb_bps: -12 + i * 0.07 })) };
  if (pathname.endsWith('/rates/basis')) return { ...meta, sofr: 4.53, effr: 4.32, iorb: 4.40, sofr_effr: 21, sofr_iorb: 13, effr_iorb: -8, unit: 'bps', regime: 'wide' };
  if (pathname.endsWith('/rates/shape')) return { ...meta, spreads: { '2s10s': { bps: 30 }, '5s30s': { bps: 34 }, '2s5s': { bps: 11 }, '5s10s': { bps: 19 }, '10s30s': { bps: 15 }, '3m10y': { bps: 13 }, 'fly_2s5s10s': { bps: -8 } }, history: {} };
  if (pathname.endsWith('/rates/correlations')) return { ...meta, labels: [], matrix: [] };
  if (pathname.endsWith('/stir/strip')) {
    const months = ['2029-03', '2029-06', '2029-09', '2029-12'];
    const sr3 = months.map((month, index) => ({ contract: `SR3${index + 1}`, ticker: `SR3${index + 1}`, month, implied_rate: 4.60 - index * 0.08, last_price: 95.40 + index * 0.08, settlement: 95.38 + index * 0.08, prev_close: 95.38 + index * 0.08, volume: 10_000 - index * 500, source: 'deterministic-provider-fixture' }));
    const sr1 = months.map((month, index) => ({ contract: `SR1${index + 1}`, ticker: `SR1${index + 1}`, month, implied_rate: 4.50 - index * 0.06, last_price: 95.50 + index * 0.06, settlement: 95.49 + index * 0.06, prev_close: 95.49 + index * 0.06, volume: 3_000 - index * 100, source: 'deterministic-provider-fixture' }));
    const zq = months.map((month, index) => ({ contract: `ZQ${index + 1}`, ticker: `ZQ${index + 1}`, month, implied_rate: 4.42 - index * 0.05, last_price: 95.58 + index * 0.05, settlement: 95.57 + index * 0.05, prev_close: 95.57 + index * 0.05, volume: 4_000 - index * 100, source: 'deterministic-provider-fixture' }));
    const serff_board = months.map((month, index) => {
      const rateBps = Number(((sr1[index].implied_rate - zq[index].implied_rate) * 100).toFixed(1));
      return { cc: month, name: `${sr1[index].ticker} − ${zq[index].ticker}`, description: 'Same delivery month One-Month SOFR minus 30-Day Federal Funds', last_bps: rateBps, price_spread: Number((-rateBps / 100).toFixed(3)), legs: [sr1[index].ticker, zq[index].ticker], ratio: '1:1', kind: 'serff' };
    });
    return {
      ...meta, sofr: 4.53, effr: 4.32, iorb: 4.40, sr3, sr1, zq,
      live_count: sr3.length, live_sr1: sr1.length, live_zq: zq.length,
      total_sr3: sr3.length, settled_count: 0, unavailable_count: 0,
      chart: sr3.map((row) => ({ x: row.month, implied_rate: row.implied_rate, prior_rate: 100 - row.prev_close, vs_sofr_bps: Number(((row.implied_rate - 4.53) * 100).toFixed(1)), source: row.source, contract: row.contract })),
      path: { points: sr3.map((row) => ({ contract: row.contract, month: row.month, implied_rate: row.implied_rate, source: row.source, vs_sofr_bps: Number(((row.implied_rate - 4.53) * 100).toFixed(1)) })), live_count: sr3.length, sofr: 4.53, path_change_bps: -24, approx_25bp_cuts_priced: 0.96, front_vs_sofr_bps: 7, front: { contract: sr3[0].contract, month: sr3[0].month, implied_rate: sr3[0].implied_rate }, back: { contract: sr3.at(-1).contract, month: sr3.at(-1).month, implied_rate: sr3.at(-1).implied_rate } },
      serff_board,
    };
  }
  if (pathname.endsWith('/rates/global-yields')) return { ...meta, points: [{ code: 'US', label: 'United States', yield_pct: 4.55 }, { code: 'DE', label: 'Germany', yield_pct: 2.55 }] };
  if (pathname.endsWith('/rates/fx')) return { ...meta, pairs: [{ pair: 'EURUSD', rate: 1.08 }, { pair: 'USDJPY', rate: 146.2 }] };
  if (pathname.endsWith('/rates/jgb-curve')) {
    const labels = ['2Y','5Y','10Y','20Y','30Y'];
    const today = [0.40,0.70,1.10,1.52,1.80];
    const historical = [0.30,0.60,1.00,1.42,1.70];
    return { ...meta, labels, today, historical, today_as_of: '2026-08-31', compare_as_of: '2025-08-31', points: labels.map((label, index) => ({ label, today: today[index], historical: historical[index], delta_bps: Number(((today[index] - historical[index]) * 100).toFixed(1)) })) };
  }
  if (pathname.endsWith('/rates/auctions')) return { ...meta, auctions: [{ security_type: 'Note', security_term: '2-Year', auction_date: '2029-01-20', offering_amt: 60_000_000_000 }], count: 1 };
  if (pathname.endsWith('/macro/summary')) return { ...meta, cpi_yoy: 2.7, core_cpi_yoy: 3.0, core_pce_yoy: 2.8, nfp_mom: 165, unemployment: 4.1, retail_sales: 0.4, housing_starts: 1_420, fed_balance_sheet: 6_650 };
  if (pathname.endsWith('/macro/stress')) return { ...meta, term_sofr_3m: 4.48, real_10y: 1.92, bei_5y: 2.25, bei_10y: 2.31, hy_oas: 3.18, ig_oas: 0.91, usd_broad: 121.4, nfci: -0.42, vix: 16.8 };
  if (pathname.endsWith('/macro/primary')) return { ...meta, bgcr: 4.35, tgcr: 4.34, sofr_ofr: 4.53, ecb_dfr: 2.25 };
  return { ...meta };
}

function sahmkPayload(pathname) {
  const movers = [
    { symbol: '2222', name_en: 'Saudi Aramco', price: 31.2, change_percent: 0.8, volume: 12_000_000 },
    { symbol: '1120', name_en: 'Al Rajhi Bank', price: 88.4, change_percent: 0.5, volume: 8_000_000 },
  ];
  if (pathname.includes('/market/summary/')) return { index_value: pathname.includes('NOMU') ? 25_100 : 12_150, index_change_percent: 0.42, advancing: 112, declining: 89, unchanged: 21, total_volume: 220_000_000 };
  if (pathname.includes('/market/gainers/')) return { gainers: movers };
  if (pathname.includes('/market/losers/')) return { losers: [{ ...movers[1], symbol: '2010', name_en: 'SABIC', change_percent: -0.7 }] };
  if (pathname.includes('/market/volume/')) return { stocks: movers };
  if (pathname.includes('/market/sectors/')) return { sectors: [{ sector_name: 'Banks', change_percent: 0.5, volume: 80_000_000, num_stocks: 12 }, { sector_name: 'Materials', change_percent: -0.2, volume: 50_000_000, num_stocks: 20 }] };
  return {};
}

function installFetchBoundary() {
  const realFetch = global.fetch;
  global.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.hostname === '127.0.0.1' && url.port !== '8765' && url.port !== '8766') {
      return realFetch(input, init);
    }
    if (url.hostname === 'www.deribit.com') {
      // crypto-down: Deribit 503s while free venues succeed (independent fallback).
      if (activeScenario === 'crypto-down') return new Response('deribit unavailable (fixture)', { status: 503 });
      return json({ jsonrpc: '2.0', result: deribitPayload(url) });
    }
    if (url.hostname === 'fapi.binance.com') {
      // crypto-partial: Binance fails, Bybit succeeds — Partial venue badge, never fabricated.
      if (activeScenario === 'crypto-partial') return new Response('binance unavailable (fixture)', { status: 500 });
      if (url.pathname.endsWith('/ticker/24hr')) return json({ symbol: 'BTCUSDT', lastPrice: '60000', quoteVolume: '900000000', priceChangePercent: '1.2' });
      if (url.pathname.endsWith('/premiumIndex')) return json({ symbol: 'BTCUSDT', markPrice: '60010', indexPrice: '60000', lastFundingRate: '0.00005' });
      return json({ symbol: 'BTCUSDT', openInterest: '25000' });
    }
    if (url.hostname === 'api.bybit.com') return json({ retCode: 0, result: { list: [{ symbol: 'BTCUSDT', lastPrice: '60005', markPrice: '60008', indexPrice: '60000', fundingRate: '0.00004', openInterest: '22000', turnover24h: '750000000', price24hPcnt: '0.011' }] } });
    if (url.hostname === 'finnhub.io') {
      if (url.pathname.endsWith('/quote')) return json({ c: 500, d: 2.5, dp: 0.5, h: 503, l: 496, o: 498, pc: 497.5 });
      return json([{ id: 1, datetime: Math.floor(FIXED_NOW / 1000), headline: 'Deterministic market fixture headline', summary: 'Adapter-boundary fixture.', source: 'fixture', url: 'https://example.invalid/fixture' }]);
    }
    if (url.hostname === 'app.sahmk.sa') {
      // home-partial + sahmk-down: SAHMK 503s while every other provider succeeds.
      if (activeScenario === 'home-partial' || activeScenario === 'sahmk-down') {
        return new Response('sahmk unavailable (fixture)', { status: 503 });
      }
      return json(sahmkPayload(url.pathname + url.search));
    }
    if (url.hostname === '127.0.0.1' && (url.port === '8765' || url.port === '8766')) {
      // rates-malformed: 200 with a non-JSON body — genuinely malformed, must be rejected.
      if (activeScenario === 'rates-malformed') {
        return new Response('<html>worker error page (fixture)</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return json(ratesPayload(url.pathname));
    }
    if (url.hostname === 'financialmodelingprep.com') {
      if (url.pathname.includes('treasury-rates')) return json([{ date: '2029-01-15', month1: 4.4, month3: 4.42, month6: 4.39, year1: 4.31, year2: 4.25, year5: 4.36, year10: 4.55, year30: 4.7 }]);
      if (url.pathname.includes('quote')) return json([{ symbol: 'SPY', price: 500, change: 2.5, changesPercentage: 0.5 }]);
      return json([]);
    }
    if (url.hostname === 'www.okx.com') return json({ code: '0', data: [] });
    return json({ error: `Unhandled deterministic provider fixture: ${url.origin}${url.pathname}` }, 599);
  };
}

export function installProviderBoundaryFixtures(scenario) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Provider fixtures require NODE_ENV=test');
  setFixtureScenario(scenario);
  process.env.FINNHUB_API_KEY ||= 'deterministic-e2e-fixture';
  process.env.SAHMK_API_KEY ||= 'deterministic-e2e-fixture';
  process.env.FMP_API_KEY ||= 'deterministic-e2e-fixture';
  installEquityBoundary();
  installFetchBoundary();
}

/** Dummy billing key used ONLY to flip the gate check in test mode.
 *  Never a real secret: no Stripe network call is made for gate checks
 *  (requestHasAccess reads the local entitlements map, which stays empty).
 *  Captured at module import so disable restores the exact prior environment.
 */
const DETERMINISTIC_BILLING_KEY = 'deterministic-e2e-fixture-no-network';
const ORIGINAL_BILLING_KEY = 'STRIPE_SECRET_KEY' in process.env ? process.env.STRIPE_SECRET_KEY : null;

/**
 * Test-only scenario switch route. Registered exclusively when provider
 * fixtures are installed (NODE_ENV=test + E2E_FIXTURE_SCENARIO); production
 * never mounts it, and no production path imports this module.
 *
 * POST /api/__test/fixtures/scenario { scenario, billingEnabled?, clearCache?, expire? }
 * - scenario: one of FIXTURE_SCENARIOS (400 otherwise).
 * - billingEnabled: true enables the desk gate with a dummy test key;
 *   false/absent restores the pre-test billing environment.
 * - clearCache (default true): reset upstream caches, Deribit client state,
 *   and provider circuits. Stale-serve tests pass false and expire keys.
 * - expire: { cacheKey: ageMs } — backdate entries so the next read treats
 *   them as expired and serves stale (or fails closed past the stale window).
 */
export async function registerFixtureScenarioRoute(fastify) {
  const { clearCacheForTests, ageCacheEntryForTests } = await import('../../api/upstreamCache.js');
  const { resetDeribitClientState } = await import('../providers/deribit/client.js');
  const { resetProviderCircuitsForTests } = await import('../../api/providerCircuitBreaker.js');
  fastify.post('/api/__test/fixtures/scenario', async (request, reply) => {
    const body = (request.body ?? {}) || {};
    const scenario = String(body.scenario ?? 'success');
    try {
      setFixtureScenario(scenario);
    } catch {
      reply.code(400);
      return { error: 'unknown-fixture-scenario', scenario, supported: FIXTURE_SCENARIOS };
    }
    if (body.billingEnabled === true) {
      process.env.STRIPE_SECRET_KEY = DETERMINISTIC_BILLING_KEY;
    } else if (ORIGINAL_BILLING_KEY == null) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = ORIGINAL_BILLING_KEY;
    }
    if (body.clearCache !== false) {
      clearCacheForTests();
      resetDeribitClientState();
      resetProviderCircuitsForTests();
    }
    const expired = [];
    for (const [key, ageMs] of Object.entries(body.expire ?? {})) {
      if (ageCacheEntryForTests(key, Number(ageMs))) expired.push(key);
    }
    return {
      scenario: getFixtureScenario(),
      billingEnabled: process.env.STRIPE_SECRET_KEY === DETERMINISTIC_BILLING_KEY,
      cleared: body.clearCache !== false,
      expired,
    };
  });
}
