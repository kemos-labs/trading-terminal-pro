import { afterEach, describe, expect, it } from 'vitest';
import {
  installProviderBoundaryFixtures,
  setFixtureScenario,
  getFixtureScenario,
  FIXTURE_SCENARIOS,
  __getEquityExecDoubleForTests,
} from './providerBoundaryFixtures.js';
import {
  ageCacheEntryForTests,
  clearCacheForTests,
  getOrFetch,
} from '../../api/upstreamCache.js';

const realFetch = global.fetch;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  global.fetch = realFetch;
  process.env.NODE_ENV = originalNodeEnv;
});

describe('provider-boundary E2E fixtures', () => {
  it('fails closed outside the test environment', () => {
    process.env.NODE_ENV = 'production';
    expect(() => installProviderBoundaryFixtures('success')).toThrow(/NODE_ENV=test/);
  });

  it('serves populated, finite rates and exact listed SERFF fixtures', async () => {
    process.env.NODE_ENV = 'test';
    installProviderBoundaryFixtures('success');

    const history = await fetch('http://127.0.0.1:8765/api/rates/basis-history').then((response) => response.json());
    expect(history.history).toHaveLength(60);
    expect(history.history.every((row) => [row.sofr, row.effr, row.iorb].every(Number.isFinite))).toBe(true);

    const stir = await fetch('http://127.0.0.1:8765/api/stir/strip').then((response) => response.json());
    expect(stir.sr1).toHaveLength(4);
    expect(stir.zq).toHaveLength(4);
    expect(stir.serff_board).toHaveLength(4);
    for (const row of stir.serff_board) {
      expect(row).toMatchObject({ kind: 'serff', ratio: '1:1' });
      expect(row.legs[0]).toMatch(/^SR1/);
      expect(row.legs[1]).toMatch(/^ZQ/);
      expect(row.price_spread).toBeCloseTo(-row.last_bps / 100, 8);
    }

    const jgb = await fetch('http://127.0.0.1:8765/api/rates/jgb-curve').then((response) => response.json());
    expect(jgb.points).toHaveLength(5);
    expect(jgb.points.every((row) => Number.isFinite(row.today) && Number.isFinite(row.historical))).toBe(true);
  });
});

describe('failure-state fixture scenarios (representative RC gate)', () => {
  it('accepts the twelve documented scenarios and rejects unknown names', () => {
    process.env.NODE_ENV = 'test';
    installProviderBoundaryFixtures('success');
    expect(FIXTURE_SCENARIOS).toEqual([
      'success',
      'home-partial',
      'chain-empty',
      'trade-loading',
      'rates-malformed',
      'crypto-partial',
      'crypto-down',
      'sahmk-down',
      'ksa-entitlement',
      'vol-stale',
      'rates-stale',
      'pos-stale',
    ]);
    for (const name of FIXTURE_SCENARIOS) {
      expect(setFixtureScenario(name)).toBe(name);
      expect(getFixtureScenario()).toBe(name);
    }
    expect(() => setFixtureScenario('nope')).toThrow(/Unsupported E2E fixture scenario/);
    expect(() => installProviderBoundaryFixtures('nope')).toThrow(/Unsupported E2E fixture scenario/);
    setFixtureScenario('success');
  });

  it('chain-empty returns a zero-quote chain (empty states, never fabricated rows)', async () => {
    process.env.NODE_ENV = 'test';
    installProviderBoundaryFixtures('success');
    setFixtureScenario('chain-empty');
    const exec = __getEquityExecDoubleForTests();
    const body = await new Promise((resolve, reject) => {
      exec('python3', ['fetch_options.py', 'SPY'], {}, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
    const chain = JSON.parse(body);
    expect(chain.expirations).toEqual([]);
    expect(chain.quotes).toEqual([]);
    setFixtureScenario('success');
  });

  it('sahmk-down fails SAHMK while Deribit still succeeds (partial independence)', async () => {
    process.env.NODE_ENV = 'test';
    installProviderBoundaryFixtures('success');
    setFixtureScenario('sahmk-down');
    const sahmk = await fetch('https://app.sahmk.sa/market/summary/MAIN');
    expect(sahmk.status).toBe(503);
    const deribit = await fetch('https://www.deribit.com/api/v2/public/ticker?instrument_name=BTC-PERPETUAL');
    expect(deribit.status).toBe(200);
    setFixtureScenario('success');
  });

  it('crypto-down fails Deribit while free venues succeed', async () => {
    process.env.NODE_ENV = 'test';
    installProviderBoundaryFixtures('success');
    setFixtureScenario('crypto-down');
    const deribit = await fetch('https://www.deribit.com/api/v2/public/ticker?instrument_name=BTC-PERPETUAL');
    expect(deribit.status).toBe(503);
    const bybit = await fetch('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT');
    expect(bybit.status).toBe(200);
    setFixtureScenario('success');
  });

  it('crypto-partial fails Binance while Bybit succeeds', async () => {
    process.env.NODE_ENV = 'test';
    installProviderBoundaryFixtures('success');
    setFixtureScenario('crypto-partial');
    const binance = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT');
    expect(binance.status).toBe(500);
    const bybit = await fetch('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT');
    expect(bybit.status).toBe(200);
    setFixtureScenario('success');
  });

  it('vol-stale proves a true fresh→stale transition (warm fresh, expired entry + upstream down serves stale with bounded age)', async () => {
    process.env.NODE_ENV = 'test';
    installProviderBoundaryFixtures('success');
    clearCacheForTests();
    // Same TTL the equity route uses (TTL.OPTIONS_MS = 180s); same
    // allowStaleOnError semantics; loader hits the same equity execFile
    // boundary the route loader uses.
    const TTL_MS = 180_000;
    const key = `test:vol-stale-transition:${Date.now()}`;
    const exec = __getEquityExecDoubleForTests();
    const loadChain = () => new Promise((resolve, reject) => {
      exec('python3', ['fetch_options.py', 'SPY'], {}, (err, stdout) => {
        if (err) return reject(err);
        try {
          resolve(JSON.parse(stdout));
        } catch (parseErr) {
          reject(parseErr);
        }
      });
    });
    // Warm under success: fresh, non-stale, bounded age, populated quotes.
    const warm = await getOrFetch(key, TTL_MS, loadChain, { allowStaleOnError: true });
    expect(warm.stale).toBe(false);
    expect(warm.fromCache).toBe(false);
    expect(warm.ageMs).toBeLessThan(30_000);
    expect(Array.isArray(warm.data?.quotes) && warm.data.quotes.length > 0).toBe(true);
    const warmCount = warm.data.quotes.length;
    // Expire that exact entry, then fail upstream: must serve last-good stale.
    expect(ageCacheEntryForTests(key, 300_000)).toBe(true);
    expect(ageCacheEntryForTests('test:vol-stale-transition:missing', 300_000)).toBe(false);
    setFixtureScenario('vol-stale');
    const stale = await getOrFetch(key, TTL_MS, loadChain, { allowStaleOnError: true });
    expect(stale.stale).toBe(true);
    expect(stale.fromCache).toBe(true);
    expect(stale.ageMs).toBeGreaterThan(200_000);
    expect(stale.ageMs).toBeLessThan(600_000);
    expect(stale.providerError).toBe('upstream-error');
    expect(stale.data?.quotes?.length).toBe(warmCount);
    setFixtureScenario('success');
  });

  it('pos-stale throws at the equity boundary exactly like vol-stale (stale-matrix)', async () => {
    process.env.NODE_ENV = 'test';
    installProviderBoundaryFixtures('success');
    setFixtureScenario('pos-stale');
    const exec = __getEquityExecDoubleForTests();
    await expect(new Promise((resolve, reject) => {
      exec('python3', ['fetch_options.py', 'SPY'], {}, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    })).rejects.toThrow(/equity upstream unavailable \(fixture pos-stale\)/);
    // Success baseline is untouched: the same boundary succeeds again.
    setFixtureScenario('success');
    const body = await new Promise((resolve, reject) => {
      exec('python3', ['fetch_options.py', 'SPY'], {}, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
    expect(JSON.parse(body).quotes.length).toBeGreaterThan(0);
  });

  it('rates-stale 503s only the worker /rates/summary path (other worker paths stay live)', async () => {
    process.env.NODE_ENV = 'test';
    installProviderBoundaryFixtures('success');
    setFixtureScenario('rates-stale');
    const summary = await fetch('http://127.0.0.1:8765/api/rates/summary');
    expect(summary.status).toBe(503);
    const curve = await fetch('http://127.0.0.1:8765/api/rates/curve');
    expect(curve.status).toBe(200);
    expect((await curve.json()).yields.length).toBeGreaterThan(0);
    // Success baseline is untouched.
    setFixtureScenario('success');
    const ok = await fetch('http://127.0.0.1:8765/api/rates/summary');
    expect(ok.status).toBe(200);
    expect((await ok.json()).sofr).toBe(4.53);
  });

  it('rates-malformed answers 200 text/html (genuinely malformed, must be rejected)', async () => {
    process.env.NODE_ENV = 'test';
    installProviderBoundaryFixtures('success');
    setFixtureScenario('rates-malformed');
    const res = await fetch('http://127.0.0.1:8765/api/rates/summary');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    setFixtureScenario('success');
  });
});
