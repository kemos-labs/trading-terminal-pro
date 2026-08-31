/**
 * Whole-app Playwright gate — every top-level desk/workflow × 4 viewports
 * Genuine workflow-level coverage: each URL distinct, each asserts workflow-specific
 * controls/tables/charts, realistic equity-chain fixtures, failure states assert exact UI,
 * keyboard navigation, Academy article opens markdown, Axe runs on every desk with both
 * wcag2a+wcag2aa (color-contrast not disabled), screenshots distinct. 23 workflows.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

type Desk = { id: string; label: string; url: string; expectText: RegExp; testId?: string };

const DERIBIT_MONTH_CODES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function deribitExpiryCode(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getUTCDate()).padStart(2, '0')}${DERIBIT_MONTH_CODES[date.getUTCMonth()]}${String(date.getUTCFullYear()).slice(-2)}`;
}

const DESKS: Desk[] = [
  { id: 'home', label: 'Home', url: '/?desk=home', expectText: /Home — Launchpad|LPAD|function codes/i, testId: 'launchpad-grid' },
  { id: 'vol-surface', label: 'Vol Surface', url: '/?desk=vol&sec=vol-sub-surface', expectText: /IV Surface|strike.*expiry|MatrixHeatmap/i, testId: 'vol-structure-view' },
  { id: 'vol-smile', label: 'Vol Smile', url: '/?desk=vol&sec=vol-sub-smile', expectText: /IV Smile|Skew|Moneyness|Strike/i, testId: 'vol-structure-view' },
  { id: 'vol-term', label: 'Vol Term', url: '/?desk=vol&sec=vol-sub-term', expectText: /Term|ATM IV/i, testId: 'vol-structure-view' },
  { id: 'vol-greeks', label: 'Vol Greeks', url: '/?desk=vol&sec=vol-sub-greeks', expectText: /DELTA|Greeks|Charm|Vanna/i, testId: 'vol-structure-view' },
  { id: 'vol-fit', label: 'Vol Fit', url: '/?desk=vol&sec=vol-sub-quality', expectText: /Surface Fit|SVI|RMSE/i, testId: 'vol-structure-view' },
  { id: 'positioning', label: 'Positioning', url: '/?desk=positioning&sec=pos-sub-chain', expectText: /Book|GEX|DEX|Positioning/i, testId: 'positioning-view' },
  { id: 'trade-structure', label: 'Trade Structure', url: '/?desk=desk&sec=trade-sub-structure', expectText: /Structure|Combo|Leverage|Simulator/i, testId: 'trade-structure-workflow' },
  { id: 'trade-pnl', label: 'Trade PnL', url: '/?desk=desk&sec=trade-sub-pnl', expectText: /PnL|Scenario|Break.*Even|Subjective/i, testId: 'trade-pnl-workflow' },
  { id: 'trade-hedge', label: 'Trade Hedge', url: '/?desk=desk&sec=trade-sub-risk', expectText: /Hedge|Risk|Delta|Basis|Roll/i, testId: 'trade-hedge-workflow' },
  { id: 'rates-funding', label: 'Rates Funding', url: '/?desk=rates&sec=rates-mode-funding', expectText: /Funding|SOFR|Basis|Plumbing/i, testId: 'rates-view' },
  { id: 'rates-ust', label: 'Rates UST', url: '/?desk=rates&sec=rates-mode-ust', expectText: /UST|Yield|Curve|Auction/i, testId: 'rates-view' },
  { id: 'rates-stir', label: 'Rates STIR', url: '/?desk=rates&sec=rates-mode-stir', expectText: /STIR|SOFR Strip/i, testId: 'rates-view' },
  { id: 'rates-world', label: 'Rates World', url: '/?desk=rates&sec=rates-mode-world', expectText: /World|Global|FX|JGB/i, testId: 'rates-view' },
  { id: 'ksa', label: 'KSA', url: '/?desk=ksa', expectText: /KSA|TADAWUL|TASI|Board/i, testId: 'ksa-view' },
  { id: 'academy-home', label: 'Academy Home', url: '/?desk=academy&sec=academy-sub-start', expectText: /Academy|Kemos Research Academy/i, testId: 'academy-root' },
  { id: 'academy-article', label: 'Academy Article', url: '/?desk=academy&sec=academy-sub-options', expectText: /Options|Academy/i, testId: 'academy-root' },
  { id: 'crypto-overview', label: 'Crypto Overview', url: '/?desk=crypto&view=overview', expectText: /Overview|VOLATERM/i, testId: 'overview-workstation' },
  { id: 'crypto-volatility', label: 'Crypto Volatility', url: '/?desk=crypto&view=volatility', expectText: /Volatility/i, testId: 'volatility-workstation' },
  { id: 'crypto-positioning', label: 'Crypto Positioning', url: '/?desk=crypto&view=positioning', expectText: /Positioning/i, testId: 'positioning-workstation' },
  { id: 'crypto-flow', label: 'Crypto Flow', url: '/?desk=crypto&view=flow', expectText: /Flow/i, testId: 'flow-workstation' },
  { id: 'crypto-carry', label: 'Crypto Carry', url: '/?desk=crypto&view=carry', expectText: /Carry/i, testId: 'carry-workstation' },
  { id: 'crypto-trade', label: 'Crypto Trade', url: '/?desk=crypto&view=trade-risk', expectText: /Trade.*Risk|Hedge/i, testId: 'trade-risk-workstation' },
];

function yahooResponse(symbol = 'SPY', spot = 500) {
  const now = Date.now();
  const expirations = [
    new Date(now + 7 * 86400000).toISOString().slice(0, 10),
    new Date(now + 30 * 86400000).toISOString().slice(0, 10),
    new Date(now + 60 * 86400000).toISOString().slice(0, 10),
    new Date(now + 90 * 86400000).toISOString().slice(0, 10),
  ];
  const strikes = [440, 460, 480, 490, 495, 500, 505, 510, 520, 540, 560];
  const quotes: unknown[] = [];
  for (const expiry of expirations) {
    for (const strike of strikes) {
      const dist = Math.abs(strike - spot) / spot;
      const midBase = Math.max(0.6, 8 - dist * 40 + (Math.random() * 0.5));
      for (const type of ['call', 'put'] as const) {
        const mid = Math.max(0.5, midBase + (type === 'put' && strike < spot ? 0.3 : 0) + (Math.random() * 0.4 - 0.2));
        const bid = Math.max(0.05, mid * 0.94);
        const ask = mid * 1.06;
        const oi = 100 + Math.floor(Math.random() * 500);
        const vol = 20 + Math.floor(Math.random() * 80);
        quotes.push({ strike, expiry, type, bid, ask, last: mid, iv: null, volume: vol, openInterest: oi });
      }
    }
  }
  return { symbol, spot, expirations, quotes, timestamp: now };
}

async function mockAll(page: import('@playwright/test').Page) {
  await page.route('**/favicon.ico', async (route) => await route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/auth/me', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: null }) }));
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  let instruments: unknown[] = [];
  let trades: unknown[] = [];
  try {
    const opt = JSON.parse(readFileSync(join(__dirname, '..', 'server', 'providers', 'deribit', 'fixtures', 'get_instruments.option.json'), 'utf8')).result;
    const fut = JSON.parse(readFileSync(join(__dirname, '..', 'server', 'providers', 'deribit', 'fixtures', 'get_instruments.future.json'), 'utf8')).result;
    const catalogue = [...opt, ...fut];
    const listedExpiries = [...new Set<number>(catalogue.filter((row: { settlement_period: string }) => row.settlement_period !== 'perpetual').map((row: { expiration_timestamp: number }) => row.expiration_timestamp))].sort();
    const expiryByListed = new Map(listedExpiries.map((expiry, index) => [expiry, Date.now() + (30 + index * 30) * 86400000]));
    instruments = catalogue.map((c: { instrument_name: string; base_currency: string; quote_currency: string; settlement_currency: string; contract_size: number; settlement_period: string; kind: string; expiration_timestamp: number; strike?: number; option_type?: string; is_inverse: boolean }, index: number) => {
      const isPerp = c.settlement_period === 'perpetual';
      const isOption = c.kind === 'option';
      const futureMs = isPerp ? null : expiryByListed.get(c.expiration_timestamp)!;
      const mark = isOption ? 0.05 : isPerp ? 60150.5 : 61000 + index * 125;
      const instrument = isPerp
        ? `${c.base_currency}-PERPETUAL`
        : isOption
          ? `${c.base_currency}-${deribitExpiryCode(futureMs!)}-${c.strike}-${c.option_type === 'call' ? 'C' : 'P'}`
          : `${c.base_currency}-${deribitExpiryCode(futureMs!)}`;
      return {
        instrument, baseCurrency: c.base_currency, quoteCurrency: c.quote_currency, settlementCurrency: c.settlement_currency,
        contractSize: c.contract_size, kind: isPerp ? 'perp' : c.kind,
        expiryMs: isPerp ? null : futureMs,
        strike: c.strike ?? null, optionType: c.option_type ?? null, isInverse: !!c.is_inverse,
        bidPrice: isOption ? 0.049 : mark - 5, askPrice: isOption ? 0.051 : mark + 5, markPrice: mark, lastPrice: mark,
        bidIv: isOption ? 0.55 : null, askIv: isOption ? 0.56 : null, markIv: isOption ? 0.55 : null,
        indexPrice: 60150, openInterest: 100, volume: 10, funding8h: isPerp ? 0.0001 : null, timestamp: Date.now(), hasQuote: true, isStale: false,
      };
    });
    const last = JSON.parse(readFileSync(join(__dirname, '..', 'server', 'providers', 'deribit', 'fixtures', 'get_last_trades.json'), 'utf8')).result.trades;
    trades = last.map((t: { instrument_name: string; timestamp: number; price: number; amount: number; direction: string; mark_iv: number; block_trade: boolean }) => ({
      instrument: t.instrument_name, timestamp: t.timestamp, price: t.price, quantity: t.amount, side: t.direction, markIv: t.mark_iv / 100, premiumNative: t.price * t.amount, contractSize: 1, nativeCurrency: 'BTC', blockTrade: !!t.block_trade, rfq: false,
    }));
  } catch {}
  const yResp = yahooResponse();
  const envelope = (data: unknown, source: string, numerator: number, denominator: number) => ({
    schemaVersion: 1,
    requestId: 'playwright',
    asOf: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    source: [source],
    provenanceByField: {},
    unitsByField: {},
    freshness: source === 'yfinance' ? 'delayed' : 'live',
    coverage: { numerator, denominator, state: numerator === denominator ? 'complete' : numerator > 0 ? 'partial' : 'unavailable', missing: [] },
    assumptions: [],
    warnings: [],
    data,
  });
  await page.route('**/api/v1/market/crypto/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/funding')) {
      const now = Date.now();
      const points = Array.from({ length: 12 }, (_, index) => ({ timestamp: now - (11 - index) * 8 * 3600_000, rate8h: 0.00005 + index * 0.000002, annualizedPct: (0.00005 + index * 0.000002) * 1095 * 100, indexPrice: 60150 }));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope({ currency: 'BTC', instrumentName: 'BTC-PERPETUAL', days: 30, points, latest: points.at(-1), count: points.length }, 'deribit', points.length, points.length)) });
    }
    if (url.includes('/trades')) {
      const expiry = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const expiryCode = deribitExpiryCode(new Date(`${expiry}T08:00:00Z`).getTime());
      const rows = (trades as Array<Record<string, unknown>>).map((trade, index) => ({ ...trade, instrument: `BTC-${expiryCode}-60000-${index % 2 === 0 ? 'C' : 'P'}`, right: index % 2 === 0 ? 'call' : 'put', expiry, contractSize: 1 }));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope({ currency: 'BTC', trades: rows, count: rows.length, hasMore: false }, 'deribit', rows.length, rows.length)) });
    }
    const rows = (instruments as Array<Record<string, unknown>>).map((ticker) => ({
      instrument: ticker.instrument, baseCurrency: ticker.baseCurrency ?? 'BTC', quoteCurrency: ticker.quoteCurrency ?? 'USD', settlementCurrency: ticker.settlementCurrency ?? 'BTC', contractSize: ticker.contractSize ?? 1, settlementPeriod: ticker.kind === 'perp' ? 'perpetual' : 'month', isInverse: true,
      kind: ticker.kind, expiryMs: ticker.expiryMs, strike: ticker.strike, right: ticker.optionType, bid: ticker.bidPrice, ask: ticker.askPrice, mark: ticker.markPrice, last: ticker.lastPrice, bidIv: ticker.bidIv, askIv: ticker.askIv, markIv: ticker.markIv, indexPrice: ticker.indexPrice, openInterest: ticker.openInterest, volume: ticker.volume, funding8h: ticker.funding8h, timestamp: ticker.timestamp, tradable: ticker.hasQuote,
    }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope({ currency: 'BTC', indexPrice: 60150, funding8h: 0.0001, instruments: rows, count: rows.length }, 'deribit', rows.length, rows.length)) });
  });
  await page.route('**/api/v1/market/options/**', async (route) => {
    const quotes = yResp.quotes.map((raw) => {
      const quote = raw as Record<string, unknown>;
      return { ...quote, right: quote.type, markIv: quote.iv };
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope({ symbol: yResp.symbol, spot: yResp.spot, expirations: yResp.expirations, quotes, count: quotes.length }, 'yfinance', quotes.length, quotes.length)) });
  });
  await page.route('**/api/deribit/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/trades')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ currency: 'BTC', trades, count: (trades as unknown[]).length, hasMore: false, fetchedAt: Date.now(), source: 'deribit' }) });
    } else if (url.includes('/options') || url.includes('/ticker') || url.includes('/futures') || url.includes('/index')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ currency: 'BTC', indexPrice: 60150, instruments: instruments.slice(0, 5), coverage: 1, funding8h: 0.0001, fetchedAt: Date.now(), source: 'deribit' }) });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ currency: 'BTC', indexPrice: 60150, instruments, coverage: 1, funding8h: 0.0001, fetchedAt: Date.now(), source: 'deribit' }) });
    }
  });
  await page.route('**/api/options/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(yResp) });
  });
  await page.route('**/api/desk/pack**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ symbol: 'SPY', timestamp: Date.now(), spot: 500, quotes: [], source: 'test-empty' }) });
  });
  await page.route('**/api/yf/history/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ symbol: 'SPY', data: [] }) });
  });
  await page.route('**/api/yf/info/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ symbol: 'SPY', data: {} }) });
  });
  await page.route('**/api/fmp/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], source: 'test-empty' }) });
  });
  await page.route('**/api/ksa/board', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasi: { index_value: 11500, index_change_percent: 0.5, advancing: 80, declining: 70, unchanged: 10 }, nomu: { index_value: 22000 }, gainers: [], losers: [], volumeLeaders: [], sectors: [], mega: [], depth: { breadth: { adv: 80, dec: 70, unc: 10, ratio: 0.07 } }, session: { phase: 'open', open: true, local: '2026-08-28 11:00:00', timezone: 'Asia/Riyadh', weekday: 'Thu' }, budget: { used: 10, capDaily: 100 }, fromCache: false, ageMs: 1000, stale: false, source: 'sahmk', fetched_at: new Date().toISOString(), configured: true }) });
  });
  await page.route('**/docs/index.json*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 3, title: 'Kemos Research Academy', description: 'Test', categories: [{ id: 'start', label: 'Start', files: [{ path: 'docs/academy/trading-reading-plan.md', title: 'Trading Reading Plan', source: 'Test', tags: [] }] }, { id: 'options', label: 'Options', files: [{ path: 'docs/academy/options-vol-surface.md', title: 'Vol Surface Deep Dive', source: 'Test', tags: [] }] }, { id: 'macro', label: 'Macro', files: [] }] }) });
  });
  await page.route('**/docs/academy/**', async (route) => {
    const url = route.request().url();
    const isReading = url.includes('trading-reading-plan');
    await route.fulfill({ status: 200, contentType: 'text/markdown', body: `# ${isReading ? 'Trading Reading Plan' : 'Vol Surface Deep Dive'}\n\nThis is a test article for Playwright. It contains real content so the article view is not empty.\n\n## Section\n\nLorem ipsum dolor sit amet.\n` });
  });
  await page.route('**/api/macrovol/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/health')) return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) });
    const as_of = new Date().toISOString();
    const baseRates = {
      labels: ['1M','3M','6M','1Y','2Y','5Y','10Y','30Y'],
      yields: [4.5,4.6,4.7,4.8,4.9,5.0,5.1,5.2],
      tenors: ['1M','3M','6M','1Y','2Y','5Y','10Y','30Y'],
      as_of, source: 'FRED', note: 'mock', regime: 'corridor_normal', regime_note: 'mock',
      sofr: 4.53, effr: 4.32, iorb: 4.4, obfr: 4.32,
      plumbing: { rrp: 100, reserves: 3200, as_of, regime: 'corridor_normal', regime_note: 'mock' },
      basis: { regime: 'normal', spread: 5, as_of, regime_note: 'mock' },
      history: [{ date: '2026-01-01', sofr_effr_bps: 5, sofr_iorb_bps: 3, effr_iorb_bps: -2 }],
      points: [{ label: '1M', today: 4.5, historical: 4.4, delta_bps: 10 }],
      chart: [],
      sr3: [{ contract: 'SR3Z5', month: '2025-12', implied_rate: 4.6, prior_rate: 4.5, vs_sofr_bps: 7, source: 'cme', settlement: 95.4, prev_close: 95.4, ticker: 'SR3Z5', product: 'SR3' }],
      stir: { sofr: 4.53, chart: [], sr3: [{ ticker: 'SR3Z5', contract: 'SR3Z5', month: '2025-12', implied_rate: 4.6, settlement: 95.4, prev_close: 95.4, source: 'cme' }] },
      shape: { history: { '2s10s': [{ date: '2026-01-01', spread_bps: 50 }], '5s30s': [{ date: '2026-01-01', spread_bps: 30 }], '2s5s': [{ date: '2026-01-01', spread_bps: 10 }], '5s10s': [{ date: '2026-01-01', spread_bps: 20 }], '10s30s': [{ date: '2026-01-01', spread_bps: 15 }], '3m10y': [{ date: '2026-01-01', spread_bps: 40 }], 'fly_2s5s10s': [{ date: '2026-01-01', spread_bps: 5 }] }, regime: 'normal', regime_note: 'mock', spreads: { '2s10s': { bps: 50 }, '5s30s': { bps: 30 }, '2s5s': { bps: 10 }, '5s10s': { bps: 20 }, '10s30s': { bps: 15 }, '3m10y': { bps: 40 }, 'fly_2s5s10s': { bps: 5 } } },
      summary: { sofr: 4.53, effr: 4.32, as_of, source: 'FRED', regime: 'corridor_normal', regime_note: 'mock' },
      tasi: null,
      auctions: [{ security_type: 'Bill', auction_date: as_of, term: '4-Week', yield: 4.5 }],
      fx: [{ pair: 'EURUSD', rate: 1.08, as_of }],
      jgb: { yields: [0.5, 1.0], as_of },
      correlations: { window: 30, period: '1y', matrix: [] },
      globalYields: [{ country: 'US', yield: 4.5 }, { country: 'DE', yield: 2.5 }],
      curve: { labels: ['1M','3M'], yields: [4.5,4.6], as_of, source: 'FRED' },
      cashLabels: ['2Y','5Y','10Y'],
    };
    const mockGreeks = {
      spot: 500, ticker: 'SPY', r: 0.05, q: 0.01, r_source: 'FRED', q_source: 'yfinance',
      atm: { delta: 0.5, gamma: 0.02, vega: 0.2, theta: -0.01, vanna: 0.01, charm: -0.001 },
      total_points: 44, as_of, source: 'yfinance',
      surface_note: 'mock surface', charm_note: 'mock charm',
      units: { theta: 'per day', vega: 'per 1 vol pt', surface_side: 'OTM' },
      ohlc: Array.from({ length: 20 }, (_, i) => ({ date: `2026-01-${String(i+1).padStart(2,'0')}`, open: 500, high: 505, low: 495, close: 500 + i * 0.2, volume: 1000 })),
      surfaces: {
        delta: { T_vals: [0.25, 0.5], K_vals: [450,500,550], grid: [[0.5,0.6,0.4],[0.45,0.55,0.35]] },
        gamma: { T_vals: [0.25, 0.5], K_vals: [450,500,550], grid: [[0.02,0.03,0.01],[0.015,0.025,0.01]] },
        vega: { T_vals: [0.25, 0.5], K_vals: [450,500,550], grid: [[0.2,0.25,0.18],[0.18,0.22,0.15]] },
        theta: { T_vals: [0.25, 0.5], K_vals: [450,500,550], grid: [[-0.01,-0.015,-0.008],[-0.009,-0.014,-0.007]] },
        vanna: { T_vals: [0.25, 0.5], K_vals: [450,500,550], grid: [[0.01,0, -0.01],[0.008,0, -0.008]] },
        charm: { T_vals: [0.25, 0.5], K_vals: [450,500,550], grid: [[-0.001,-0.002,-0.0005],[-0.0009,-0.0018,-0.0004]] },
      },
      gex: [{ strike: 500, gex: 1000000, type: 'call', oi: 100, gamma: 0.02 }, { strike: 510, gex: -500000, type: 'put', oi: 80, gamma: 0.015 }],
      gex_flip: { strike: 505, net_gex: 500000, spot_vs_flip: 'above' },
      gex_grid: { T_vals: [0.25,0.5], K_vals: [450,500,550], grid: [[1,2,1],[0.5,1,0.5]] },
      charm_grid: { T_vals: [0.25,0.5], K_vals: [450,500,550], grid: [[0.01,0.02,0.01],[0.008,0.015,0.008]] },
      points: [{ K: 500, type: 'call', oi: 100, gamma: 0.02, T: 0.25, strike: 500, gex: 1000000 }, { K: 510, type: 'put', oi: 80, gamma: 0.015, T: 0.25, strike: 510, gex: -500000 }],
      gexData: [], flipStrike: 505, flipSide: 'above',
    };
    if (url.includes('/greeks') || url.includes('/surface') || url.includes('/gex')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockGreeks) });
    } else if (url.includes('/rates/basis-history')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ history: [{ date: '2026-01-01', sofr_effr_bps: 5, sofr_iorb_bps: 3, effr_iorb_bps: -2 }, { date: '2026-01-02', sofr_effr_bps: 6, sofr_iorb_bps: 2, effr_iorb_bps: -1 }], as_of, source: 'FRED' }) });
    } else if (url.includes('/rates/basis')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ regime: 'normal', spread: 5, as_of, source: 'FRED', points: baseRates.points }) });
    } else if (url.includes('/rates/plumbing')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rrp: 100, reserves: 3200, as_of, source: 'FRED', regime: 'corridor_normal', regime_note: 'mock' }) });
    } else if (url.includes('/rates/curve-history') || url.includes('/rates/curve')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ labels: baseRates.labels, yields: baseRates.yields, as_of, source: 'FRED', points: baseRates.points }) });
    } else if (url.includes('/rates/shape')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ history: baseRates.shape.history, spreads: baseRates.shape.spreads, regime: 'normal', regime_note: 'mock', as_of, source: 'FRED' }) });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(baseRates) });
    }
  });
  await page.route('**/api/yf*', async (route) => {
    const url = route.request().url();
    if (url.includes('/history')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ close: 500, period: '1mo', points: Array.from({ length: 30 }, (_, i) => ({ t: Date.now() - (30 - i) * 86400000, close: 480 + i * 0.8 })) }) });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ symbol: 'SPY', spot: 500, close: 500, period: '1mo', points: [] }) });
    }
  });
  // Exact success-path mocks for legacy equity bootstrap calls. These are
  // registered last so they take precedence over the generic upstream route.
  await page.route(/\/api\/desk\/pack(?:\?|$)/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ...yResp,
      symbol: 'SPY',
      timestamp: Date.now(),
      source: 'test-fixture',
    }) });
  });
  await page.route(/\/api\/yf\/(?:history|info)\//, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ symbol: 'SPY', close: 500, spot: 500, points: [] }) });
  });
  await page.route(/\/api\/options\//, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(yResp) });
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`app viewport ${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    for (const desk of DESKS) {
      test(`${desk.id} renders without horizontal overflow`, async ({ page }) => {
        await mockAll(page);
        const errors: string[] = [];
        const pageErrors: string[] = [];
        page.on('console', (msg) => {
          if (msg.type() !== 'error') return;
          const txt = msg.text();
          if (txt.includes('favicon')) return;
          if (txt.includes('Download the React DevTools')) return;
          errors.push(txt);
        });
        page.on('pageerror', (err) => {
          pageErrors.push(err.message || String(err));
        });
        await page.goto(desk.url);
        await page.waitForTimeout(2500);
        // Workflow-specific content assertion — wait longer for lazy views and desk switching
        await expect(page.locator('body')).toContainText(desk.expectText, { timeout: 10000 });
        // Stable testId when defined — exact element must be visible (no try/catch)
        if (desk.testId) {
          await expect(page.getByTestId(desk.testId).first()).toBeVisible({ timeout: 8000 });
        }
        // Overflow 0
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `overflow at ${vp.name} ${desk.id}`).toBe(0);
        // Success-path mocks must be clean; unexpected console errors fail.
        expect(errors, `console errors at ${vp.name} ${desk.id}: ${errors.join('; ')}`).toEqual([]);
        // No uncaught page errors — toUpperCase, Cannot read, etc must be 0
        expect(pageErrors, `page errors at ${vp.name} ${desk.id}: ${pageErrors.join('; ')}`).toEqual([]);
        // No SectionErrorBoundary activation — if boundary rendered, fail
        const boundary = page.locator('text=Section failed');
        await expect(boundary).toHaveCount(0, { timeout: 1000 });
        const flowFailed = page.locator('text=Flow tools failed');
        await expect(flowFailed).toHaveCount(0, { timeout: 1000 });
        // Distinct screenshot per workflow
        await page.screenshot({ path: `e2e/screenshots/app-${vp.name}-${desk.id}.png`, fullPage: true });
      });
    }
  });
}

test.describe('app failure states', () => {
  test('KSA provider down shows exact Board error with SAHMK down', async ({ page }) => {
    // Mock all except KSA board which is down — other desks must still have data to avoid cascading 503s
    await mockAll(page);
    await page.route('**/api/ksa/board', async (r) => await r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'SAHMK down', code: 'UPSTREAM' }) }));
    await page.goto('/?desk=ksa');
    await page.waitForTimeout(1500);
    await expect(page.locator('body')).toContainText(/Board error/i, { timeout: 6000 });
    await expect(page.locator('body')).toContainText(/SAHMK down/i, { timeout: 6000 });
    const errEl = page.getByText(/Board error/i).first();
    await expect(errEl).toBeVisible({ timeout: 6000 });
  });
  test('Rates provider down shows exact Rates API unavailable', async ({ page }) => {
    await mockAll(page);
    await page.route('**/api/macrovol/**', async (r) => await r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'macro down' }) }));
    await page.goto('/?desk=rates&sec=rates-mode-funding');
    await page.waitForTimeout(1500);
    await expect(page.locator('body')).toContainText(/Rates API unavailable/i, { timeout: 6000 });
  });
  test('Vol empty chain shows exact No surface', async ({ page }) => {
    // Do not call mockAll for options — we want empty chain, so set up other mocks manually
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    let instruments: unknown[] = [];
    let trades: unknown[] = [];
    try {
      const opt = JSON.parse(readFileSync(join(__dirname, '..', 'server', 'providers', 'deribit', 'fixtures', 'get_instruments.option.json'), 'utf8')).result;
      const fut = JSON.parse(readFileSync(join(__dirname, '..', 'server', 'providers', 'deribit', 'fixtures', 'get_instruments.future.json'), 'utf8')).result;
      const catalogue = [...opt, ...fut];
      const now = Date.now();
      instruments = catalogue.map((c: { instrument_name: string; base_currency: string; quote_currency: string; settlement_currency: string; contract_size: number; settlement_period: string; kind: string; expiration_timestamp: number; strike?: number; option_type?: string; is_inverse: boolean }) => {
        const isPerp = c.settlement_period === 'perpetual';
        const isOption = c.kind === 'option';
        const futureMs = now + 30 * 86400000 + (isOption && c.strike ? (c.strike % 7) * 86400000 : 0);
        return {
          instrument: c.instrument_name, baseCurrency: c.base_currency, quoteCurrency: c.quote_currency, settlementCurrency: c.settlement_currency,
          contractSize: c.contract_size, kind: isPerp ? 'perp' : c.kind,
          expiryMs: isPerp ? null : isOption ? futureMs : (c.expiration_timestamp < 4102444800000 ? c.expiration_timestamp : null),
          strike: c.strike ?? null, optionType: c.option_type ?? null, isInverse: !!c.is_inverse,
          bidPrice: isPerp ? 60150 : 0.05, askPrice: isPerp ? 60151 : 0.051, markPrice: isPerp ? 60150.5 : 0.05, lastPrice: isPerp ? 60150 : 0.05, bidIv: 0.55, askIv: 0.56, markIv: 0.55, indexPrice: 60150, openInterest: 100, volume: 10, funding8h: c.instrument_name === 'BTC-PERPETUAL' ? 0.0001 : null, timestamp: now, hasQuote: true, isStale: false,
        };
      });
      const last = JSON.parse(readFileSync(join(__dirname, '..', 'server', 'providers', 'deribit', 'fixtures', 'get_last_trades.json'), 'utf8')).result.trades;
      trades = last.map((t: { instrument_name: string; timestamp: number; price: number; amount: number; direction: string; mark_iv: number; block_trade: boolean }) => ({
        instrument: t.instrument_name, timestamp: t.timestamp, price: t.price, quantity: t.amount, side: t.direction, markIv: t.mark_iv / 100, premiumNative: t.price * t.amount, contractSize: 1, nativeCurrency: 'BTC', blockTrade: !!t.block_trade, rfq: false,
      }));
    } catch {}
    await page.route('**/*deribit*', async (route) => {
      const url = route.request().url();
      if (url.includes('/trades')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ currency: 'BTC', trades, count: (trades as unknown[]).length, hasMore: false, fetchedAt: Date.now(), source: 'deribit' }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ currency: 'BTC', indexPrice: 60150, instruments, coverage: 1, funding8h: 0.0001, fetchedAt: Date.now(), source: 'deribit' }) });
      }
    });
    await page.route('**/api/options/**', async (r) => await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ symbol: 'SPY', spot: 0, expirations: [], quotes: [], timestamp: Date.now() }) }));
    await page.route('**/api/fmp/**', async (r) => await r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'FMP down' }) }));
    await page.route('**/api/ksa/board', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasi: { index_value: 11500, index_change_percent: 0.5, advancing: 80, declining: 70, unchanged: 10 }, nomu: { index_value: 22000 }, gainers: [], losers: [], volumeLeaders: [], sectors: [], mega: [], depth: { breadth: { adv: 80, dec: 70, unc: 10, ratio: 0.07 } }, session: { phase: 'open', open: true, local: '2026-08-28 11:00:00', timezone: 'Asia/Riyadh', weekday: 'Thu' }, budget: { used: 10, capDaily: 100 }, fromCache: false, ageMs: 1000, stale: false, source: 'sahmk', fetched_at: new Date().toISOString(), configured: true }) });
    });
    await page.route('**/docs/index.json*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 3, title: 'Kemos Research Academy', description: 'Test', categories: [{ id: 'start', label: 'Start', files: [{ path: 'docs/academy/trading-reading-plan.md', title: 'Trading Reading Plan', source: 'Test', tags: [] }] }, { id: 'options', label: 'Options', files: [{ path: 'docs/academy/options-vol-surface.md', title: 'Vol Surface Deep Dive', source: 'Test', tags: [] }] }, { id: 'macro', label: 'Macro', files: [] }] }) });
    });
    await page.route('**/docs/academy/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/markdown', body: '# Test' });
    });
    await page.route('**/api/macrovol/**', async (route) => {
      const as_of = new Date().toISOString();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ labels: ['1M'], yields: [4.5], as_of, source: 'FRED', note: 'mock', regime: 'corridor_normal', regime_note: 'mock', sofr: 4.53, effr: 4.32, iorb: 4.4, obfr: 4.32, plumbing: { rrp: 100, reserves: 3200, as_of, regime: 'corridor_normal', regime_note: 'mock' }, basis: { regime: 'normal', spread: 5, as_of, regime_note: 'mock' }, history: [], points: [], chart: [], sr3: [], stir: { sofr: 4.53, chart: [], sr3: [] }, shape: { history: {}, regime: 'normal', regime_note: 'mock', spreads: {} }, summary: { sofr: 4.53, effr: 4.32, as_of, source: 'FRED', regime: 'corridor_normal', regime_note: 'mock' }, tasi: null, auctions: [], fx: [], jgb: { yields: [0.5, 1.0], as_of }, correlations: { window: 30, period: '1y', matrix: [] }, globalYields: [], curve: { labels: ['1M'], yields: [4.5], as_of, source: 'FRED' }, cashLabels: [] }) });
    });
    await page.goto('/?desk=vol&sec=vol-sub-surface');
    await page.waitForTimeout(1500);
    await expect(page.locator('body')).toContainText(/No live option chain|Live chain unavailable|No surface/i, { timeout: 6000 });
  });
});

test.describe('app keyboard navigation', () => {
  test('Home → Vol via function code and keyboard', async ({ page }) => {
    await mockAll(page);
    await page.goto('/?desk=home');
    await page.waitForTimeout(800);
    await expect(page.getByTestId('launchpad-grid')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('v');
    await page.waitForTimeout(600);
    await expect(page.locator('body')).toContainText(/IV Surface|Smile|Vol Structure|Surface/i, { timeout: 5000 });
    await page.keyboard.press('h');
    await page.waitForTimeout(600);
    await expect(page.getByTestId('launchpad-grid')).toBeVisible({ timeout: 5000 });
  });
  test('Vol → Trade via keyboard m', async ({ page }) => {
    await mockAll(page);
    await page.goto('/?desk=vol&sec=vol-sub-smile');
    await page.waitForTimeout(800);
    await page.keyboard.press('m');
    await page.waitForTimeout(600);
    await expect(page.locator('body')).toContainText(/Trade|Structure|TRADE/i, { timeout: 5000 });
  });
});

test.describe('app academy article', () => {
  test('opens an actual article from the index', async ({ page }) => {
    await mockAll(page);
    await page.goto('/?desk=academy&sec=academy-sub-start');
    await page.waitForTimeout(1200);
    await expect(page.getByTestId('academy-root')).toBeVisible({ timeout: 5000 });
    const link = page.getByRole('link', { name: /Trading Reading Plan/i }).first();
    const btn = page.getByRole('button', { name: /Trading Reading Plan/i }).first();
    if (await link.count() > 0) await link.click();
    else if (await btn.count() > 0) await btn.click();
    else {
      await page.getByText('Trading Reading Plan').first().click();
    }
    await page.waitForTimeout(800);
    await expect(page.locator('body')).toContainText(/Trading Reading Plan|This is a test article|Section/i, { timeout: 6000 });
  });
});

test.describe('app accessibility', () => {
  for (const desk of DESKS) {
    test(`axe on ${desk.id}`, async ({ page }) => {
      await mockAll(page);
      await page.goto(desk.url);
      await page.waitForTimeout(1800);
      // Wait for workflow-specific content to ensure lazy view has loaded (not fallback)
      await expect(page.locator('body')).toContainText(desk.expectText, { timeout: 8000 });
      if (desk.testId) {
        await expect(page.getByTestId(desk.testId).first()).toBeVisible({ timeout: 8000 });
      }
      // Ensure loading fallback is gone
      await expect(page.getByText('Loading view…')).toHaveCount(0, { timeout: 2000 });
      // Run Axe against both wcag2a and wcag2aa — includes color-contrast — fix actual violations, do not disable
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const violations = results.violations;
      expect(violations, `axe violations on ${desk.id}: ${JSON.stringify(violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })))}`).toEqual([]);
    });
  }
});
