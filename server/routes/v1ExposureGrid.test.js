/**
 * Exposure-grid REST/MCP integration tests (REF-03/04 API node).
 *
 * Exercises the REAL Fastify production composition via inject (owned-server
 * runtime, bundled shared engine — not vitest-only TS), canonical contract
 * validators, OpenAPI parity, and MCP same-numerical-result parity over a
 * real owned HTTP server + real MCP stdio child process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { buildServer } from '../app.js';
import { clearCacheForTests } from '../../api/upstreamCache.js';
import { resetDeribitClientState } from '../providers/deribit/client.js';
import { validateContract } from '../../packages/contracts/src/runtime.js';
import { buildExposureGrid } from '../../src/lib/options/exposureGrid.js';

vi.mock('./equityFeeds.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    getOptionChainSnapshot: vi.fn(async () => ({
    symbol: 'TEST',
    spot: 100,
    timestamp: '2026-01-05T12:00:00.000Z',
    quotes: [
      { strike: 100, expiry: '2030-12-18', right: 'call', bid: 5, ask: 5.2, markIv: 0.25, openInterest: 50 },
      { strike: 100, expiry: '2030-12-18', right: 'put', bid: 4, ask: 4.2, markIv: 0.25, openInterest: 40 },
      { strike: 110, expiry: '2030-12-18', right: 'call', bid: 2, ask: 2.2, markIv: 0.3, openInterest: 0 },
    ],
  })),
  };
});

let app;

const json = (body) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

function deribitResult(result) {
  return json({ jsonrpc: '2.0', result });
}

function installDeribitMock() {
  const expiry = Date.UTC(2030, 11, 30, 8);
  const timestamp = Date.now();
  global.fetch = vi.fn(async (input) => {
    const url = new URL(String(input));
    if (url.hostname.includes('binance.com')) {
      if (url.pathname.includes('/premiumIndex')) return json({ symbol: 'BTCUSDT', markPrice: '60050', indexPrice: '60000', lastFundingRate: '0.0001' });
      if (url.pathname.includes('/openInterest')) return json({ symbol: 'BTCUSDT', openInterest: '100000' });
      return json({ symbol: 'BTCUSDT', lastPrice: '60050', quoteVolume: '1e9', priceChangePercent: '0.5' });
    }
    if (url.hostname.includes('bybit.com')) {
      return json({ retCode: 0, result: { list: [{ symbol: 'BTCUSDT', lastPrice: '60040', markPrice: '60050', indexPrice: '60000', fundingRate: '0.0001', openInterest: '90000', turnover24h: '2e9', price24hPcnt: '0.005' }] } });
    }
    if (url.pathname.endsWith('/get_instruments')) {
      return deribitResult([
        { instrument_name: 'BTC-30DEC30-60000-C', kind: 'option', is_active: true, strike: 60000, expiration_timestamp: expiry, option_type: 'call', contract_size: 1, base_currency: 'BTC', quote_currency: 'USD', settlement_currency: 'BTC', is_inverse: true, tick_size: 0.0005, settlement_period: 'month', creation_timestamp: timestamp },
        { instrument_name: 'BTC-PERPETUAL', kind: 'future', is_active: true, expiration_timestamp: Date.UTC(3000, 0, 1), contract_size: 10, base_currency: 'BTC', quote_currency: 'USD', settlement_currency: 'BTC', is_inverse: true, tick_size: 0.5, settlement_period: 'perpetual', creation_timestamp: timestamp },
      ]);
    }
    if (url.pathname.endsWith('/get_book_summary_by_currency') && url.searchParams.get('kind') === 'option') {
      return deribitResult([{ instrument_name: 'BTC-30DEC30-60000-C', mark_price: 0.05, bid_price: 0.049, ask_price: 0.051, last_price: 0.05, bid_iv: 54, ask_iv: 56, mark_iv: 55, open_interest: 100, volume: 5, underlying_price: 60000, timestamp }]);
    }
    if (url.pathname.endsWith('/get_book_summary_by_currency') && url.searchParams.get('kind') === 'future') {
      return deribitResult([
        { instrument_name: 'BTC-PERPETUAL', mark_price: 60001, bid_price: 60000, ask_price: 60002, last_price: 60001, underlying_price: 60000, timestamp },
      ]);
    }
    if (url.pathname.endsWith('/get_index_price')) return deribitResult({ index_price: 60000 });
    return json({});
  });
}

beforeEach(async () => {
  clearCacheForTests();
  resetDeribitClientState();
  installDeribitMock();
  app = await buildServer();
  await app.ready();
});

afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

const SCENARIO_BODY = {
  symbol: 'TEST',
  metric: 'gex',
  prices: [90, 100, 110],
  times: ['2026-01-05T12:00:00.000Z', '2027-01-05T12:00:00.000Z'],
  scenario: {
    riskFreeRate: 0.04,
    carryRate: 0.01,
    model: 'spot-european',
    multiplier: 100,
    expiryOverrides: { '2030-12-18': '2030-12-18T21:00:00.000Z' },
  },
};

function postGrid(payload) {
  return app.inject({ method: 'POST', url: '/api/v1/analytics/positioning/exposure-grid', payload });
}

describe('exposure-grid REST integration (shared bundled engine)', () => {
  it('computes a scenario grid, validates the contract, and matches the TS engine directly', async () => {
    const response = await postGrid(SCENARIO_BODY);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('exposureGridResponse', body)).toMatchObject({ valid: true });
    expect(body.data.units).toBe('$/1% move');
    expect(body.data.quoteBasis).toBe('observed-snapshot+scenario-overrides');
    expect(body.data.scenario).toMatchObject({ riskFreeRate: 0.04, carryRate: 0.01, model: 'spot-european', multiplier: 100 });
    expect(body.data.rowSelection).toMatchObject({ totalContracts: 3, eligibleContracts: 3, usedContracts: 3, omittedContracts: 0, truncated: false });
    expect(body.data.gridCells).toMatchObject({ computed: 6, total: 6 });
    expect(body.data.multiplierBasis).toContain('scenario-multiplier (100');
    expect(body.data.positionBasisAt).toBe('2026-01-05T12:00:00.000Z');
    expect(body.provenanceByField['data.cells[].value']).toContain('scenario');
    const values = body.data.cells.flat().map((c) => c.value);
    expect(values.every((v) => typeof v === 'number' && Number.isFinite(v))).toBe(true);
    expect(body.coverage).toMatchObject({ numerator: 6, denominator: 6, state: 'complete' });

    // Direct-vs-route parity against the accepted TS engine within tolerance.
    const expected = buildExposureGrid({
      quotes: [
        { type: 'call', strike: 100, expiryMs: Date.parse('2030-12-18T21:00:00.000Z'), modelId: 'spot-european', openInterest: 50, multiplier: 100, iv: 0.25, ivProvenance: 'venue-mark', r: 0.04, q: 0.01 },
        { type: 'put', strike: 100, expiryMs: Date.parse('2030-12-18T21:00:00.000Z'), modelId: 'spot-european', openInterest: 40, multiplier: 100, iv: 0.25, ivProvenance: 'venue-mark', r: 0.04, q: 0.01 },
        { type: 'call', strike: 110, expiryMs: Date.parse('2030-12-18T21:00:00.000Z'), modelId: 'spot-european', openInterest: 0, multiplier: 100, iv: 0.3, ivProvenance: 'venue-mark', r: 0.04, q: 0.01 },
      ],
      prices: [90, 100, 110],
      timesMs: [Date.parse('2026-01-05T12:00:00.000Z'), Date.parse('2027-01-05T12:00:00.000Z')],
      metric: 'gex',
      positionBasisAt: '2026-01-05T12:00:00.000Z',
      settlementRule: 'parity-check',
    });
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        const actual = body.data.cells[i][j].value;
        const want = expected.cells[i][j].value;
        expect(Math.abs(actual - want) / Math.max(1, Math.abs(want))).toBeLessThan(1e-9);
      }
    }
  });

  it('rejects the 20:00 hardcode: rates+model without expiry overrides stays missing-expiry', async () => {
    const response = await postGrid({
      symbol: 'TEST',
      metric: 'gex',
      prices: [90, 100, 110],
      times: ['2026-01-05T12:00:00.000Z'],
      scenario: { riskFreeRate: 0.04, carryRate: 0.01, model: 'spot-european' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('exposureGridResponse', body)).toMatchObject({ valid: true });
    expect(body.data.cells.flat().every((c) => c.value == null)).toBe(true);
    expect(body.data.cells.flat().flatMap((c) => c.reasons)).toContain('missing-expiry');
    expect(body.coverage.state).toBe('unavailable');
    expect(body.data.scenario).toMatchObject({ model: 'spot-european' });
  });

  it('crypto futures-style options surface typed unsupported-model partials, never substitution', async () => {
    const response = await postGrid({
      symbol: 'BTC',
      metric: 'charm',
      prices: [59000, 60000, 61000],
      times: ['2026-01-05T12:00:00.000Z'],
      scenario: { riskFreeRate: 0.04, carryRate: 0 },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('exposureGridResponse', body)).toMatchObject({ valid: true });
    expect(body.data.units).toBe('$Δ/day');
    expect(body.data.cells.flat().every((c) => c.value == null)).toBe(true);
    expect(body.data.cells.flat().flatMap((c) => c.reasons)).toContain('unsupported-model');
    expect(body.coverage.missing).toContain('unsupported-model');
    expect(body.data.quoteBasis).toBe('observed-snapshot');
  });

  it('truth: missing multiplier never computes with a silent 100 — invalid-multiplier nulls', async () => {
    const { multiplier: _dropped, ...scenarioNoMult } = SCENARIO_BODY.scenario;
    const response = await postGrid({ ...SCENARIO_BODY, scenario: scenarioNoMult });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('exposureGridResponse', body)).toMatchObject({ valid: true });
    // Every quote lacks a verified multiplier and no scenario multiplier was
    // supplied: all cells null, never computed with a silent 100.
    expect(body.data.cells.flat().every((c) => c.value == null)).toBe(true);
    expect(body.data.cells.flat().flatMap((c) => c.reasons)).toContain('invalid-multiplier');
    expect(body.data.multiplierBasis).toContain('unavailable');
    expect(body.data.scenario.multiplier).toBeNull();
    expect(body.coverage.state).toBe('unavailable');
  });

  it('truth: explicit scenario multiplier scales linearly, is echoed, and is labelled scenario', async () => {
    const half = await postGrid({
      ...SCENARIO_BODY,
      scenario: { ...SCENARIO_BODY.scenario, multiplier: 50 },
    }).then((r) => r.json());
    const full = await postGrid(SCENARIO_BODY).then((r) => r.json());
    expect(validateContract('exposureGridResponse', half)).toMatchObject({ valid: true });
    expect(half.data.scenario.multiplier).toBe(50);
    expect(half.data.multiplierBasis).toContain('scenario-multiplier (50, caller-supplied assumption, not observed)');
    expect(half.data.multiplierBasis).not.toContain('observed venue-provided');
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        expect(half.data.cells[i][j].value).toBeCloseTo(full.data.cells[i][j].value * 0.5, 10);
      }
    }
    expect(half.data.quoteBasis).toBe('observed-snapshot+scenario-overrides');
  });

  it('truth: strict UTC instants reject date-only/timezone-less/offset/rollover/non-finite epochs; fractional UTC accepted', async () => {
    const badTimes = [
      ['2030-12-18'], // date-only
      ['2026-01-05 12:00:00'], // timezone-less
      ['2026-01-05T12:00:00+02:00'], // numeric offset
      ['2026-02-30T12:00:00.000Z'], // calendar rollover
      ['2026-01-05T24:00:00.000Z'], // hour rollover
      [Number.NaN],
      [Number.POSITIVE_INFINITY],
      [2 ** 60], // out of JS Date range
      [0],
      [-1000],
    ];
    for (const times of badTimes) {
      const res = await postGrid({ ...SCENARIO_BODY, times });
      expect(res.statusCode).toBe(400);
      expect(validateContract('errorResponse', res.json())).toMatchObject({ valid: true });
    }
    // Rollover inside expiry overrides is rejected, not regex-accepted.
    const rollover = await postGrid({
      ...SCENARIO_BODY,
      scenario: { ...SCENARIO_BODY.scenario, expiryOverrides: { '2030-12-18': '2030-02-30T21:00:00.000Z' } },
    });
    expect(rollover.statusCode).toBe(400);
    // Boundary-valid fractional UTC instants are accepted.
    for (const times of [[ '2026-01-05T12:00:00.500Z' ], [ '2026-01-05T12:00:00.5Z' ], [Date.parse('2026-01-05T12:00:00.000Z')]]) {
      const res = await postGrid({ ...SCENARIO_BODY, times });
      expect(res.statusCode).toBe(200);
    }
  });

  it('truth: maxRows=1 over 3 contracts reports truncation counts and forces partial coverage', async () => {
    const response = await postGrid({ ...SCENARIO_BODY, maxRows: 1 });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('exposureGridResponse', body)).toMatchObject({ valid: true });
    expect(body.data.rowSelection).toMatchObject({
      totalContracts: 3,
      eligibleContracts: 3,
      usedContracts: 1,
      omittedContracts: 2,
      truncated: true,
    });
    expect(body.data.rowSelection.truncationReason).toContain('maxRows (1)');
    expect(body.data.gridCells).toMatchObject({ computed: 6, total: 6 });
    // All grid cells computed, yet the response is partial: the snapshot was truncated.
    expect(body.coverage.state).toBe('partial');
    expect(body.coverage.missing.some((m) => m.includes('truncated-2-contract-rows-omitted'))).toBe(true);
  });

  it('truth: crypto rejects silently-ignored scenario model/expiryOverrides as not applicable; verified contractSize honored', async () => {
    const withModel = await postGrid({
      symbol: 'BTC',
      metric: 'charm',
      prices: [59000, 60000, 61000],
      times: ['2026-01-05T12:00:00.000Z'],
      scenario: { model: 'spot-european' },
    });
    expect(withModel.statusCode).toBe(400);
    expect(validateContract('errorResponse', withModel.json())).toMatchObject({ valid: true });
    const withOverrides = await postGrid({
      symbol: 'BTC',
      metric: 'charm',
      prices: [59000, 60000, 61000],
      times: ['2026-01-05T12:00:00.000Z'],
      scenario: { expiryOverrides: { '2030-12-30': '2030-12-30T08:00:00.000Z' } },
    });
    expect(withOverrides.statusCode).toBe(400);
    // Rates-only crypto scenario still binds the verified venue contractSize (1 in fixtures).
    const ratesOnly = await postGrid({
      symbol: 'BTC',
      metric: 'charm',
      prices: [59000, 60000, 61000],
      times: ['2026-01-05T12:00:00.000Z'],
      scenario: { riskFreeRate: 0.04, carryRate: 0 },
    });
    expect(ratesOnly.statusCode).toBe(200);
    const cryptoBody = ratesOnly.json();
    expect(validateContract('exposureGridResponse', cryptoBody)).toMatchObject({ valid: true });
    expect(cryptoBody.data.multiplierBasis).toContain('observed venue-provided per-contract multiplier');
    expect(cryptoBody.data.multiplierBasis).not.toContain('scenario-multiplier');
  });

  it('DEX metric: valid dex grid with $Δ notional units, and unknown metrics stay typed 400', async () => {
    const dex = await postGrid({ ...SCENARIO_BODY, metric: 'dex' });
    expect(dex.statusCode).toBe(200);
    const body = dex.json();
    expect(validateContract('exposureGridResponse', body)).toMatchObject({ valid: true });
    expect(body.data.metric).toBe('dex');
    expect(body.data.units).toBe('$Δ notional');
    expect(body.data.methodology.dexUnits).toMatch(/signed kernel/);
    const values = body.data.cells.flat().map((c) => c.value);
    expect(values.every((v) => v == null || (typeof v === 'number' && Number.isFinite(v)))).toBe(true);
    expect(body.data.cells.flat().some((c) => c.value != null)).toBe(true);
    expect(body.provenanceByField['data.cells[].value']).toContain('derived-exposure-grid');
    expect(body.unitsByField['data.cells[].value']).toBe('$Δ notional');
    // DEX put cells carry the negative kernel delta (no side negation): recompute
    // the expected sign from the bundled engine directly.
    const expected = buildExposureGrid({
      quotes: [
        { type: 'call', strike: 100, expiryMs: Date.parse('2030-12-18T21:00:00.000Z'), modelId: 'spot-european', openInterest: 50, multiplier: 100, iv: 0.25, ivProvenance: 'venue-mark', r: 0.04, q: 0.01 },
        { type: 'put', strike: 100, expiryMs: Date.parse('2030-12-18T21:00:00.000Z'), modelId: 'spot-european', openInterest: 40, multiplier: 100, iv: 0.25, ivProvenance: 'venue-mark', r: 0.04, q: 0.01 },
        { type: 'call', strike: 110, expiryMs: Date.parse('2030-12-18T21:00:00.000Z'), modelId: 'spot-european', openInterest: 0, multiplier: 100, iv: 0.3, ivProvenance: 'venue-mark', r: 0.04, q: 0.01 },
      ],
      prices: [90, 100, 110],
      timesMs: [Date.parse('2026-01-05T12:00:00.000Z'), Date.parse('2027-01-05T12:00:00.000Z')],
      metric: 'dex',
      positionBasisAt: '2026-01-05T12:00:00.000Z',
      settlementRule: 'parity-check',
    });
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        expect(body.data.cells[i][j].value).toBeCloseTo(expected.cells[i][j].value, 6);
      }
    }
    for (const bad of ['vanna', 'DEX', '', 'gex,charm']) {
      const res = await postGrid({ ...SCENARIO_BODY, metric: bad });
      expect(res.statusCode).toBe(400);
      expect(validateContract('errorResponse', res.json())).toMatchObject({ valid: true });
    }
  });

  it('returns typed 4xx for malformed, non-finite, oversize, and unknown-enum inputs before compute', async () => {
    const cases = [
      { ...SCENARIO_BODY, metric: 'vanna' },
      { ...SCENARIO_BODY, prices: [100, 90] },
      { ...SCENARIO_BODY, prices: [100, Number.POSITIVE_INFINITY] },
      { ...SCENARIO_BODY, times: ['not-a-time'] },
      { ...SCENARIO_BODY, times: ['2026-01-05T12:00:00.000Z', '2026-01-05T12:00:00.000Z'] },
      { ...SCENARIO_BODY, prices: Array.from({ length: 150 }, (_, i) => 50 + i), times: Array.from({ length: 150 }, (_, i) => Date.parse('2026-01-05T12:00:00.000Z') + (i + 1) * 86_400_000) },
      { ...SCENARIO_BODY, scenario: { riskFreeRate: 0.04 } },
      { ...SCENARIO_BODY, scenario: { ...SCENARIO_BODY.scenario, model: 'american' } },
      { ...SCENARIO_BODY, scenario: { ...SCENARIO_BODY.scenario, expiryOverrides: { '2030-12-18': 'tomorrow at noon' } } },
      { symbol: 'bad symbol!', metric: 'gex', prices: [90, 100], times: ['2026-01-05T12:00:00.000Z'] },
    ];
    for (const payload of cases) {
      const res = await postGrid(JSON.parse(JSON.stringify(payload)));
      expect(res.statusCode).toBe(400);
      expect(validateContract('errorResponse', res.json())).toMatchObject({ valid: true });
    }
  });

  it('MCP returns the same numerical grid over a real owned server', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : null;
    expect(port).toBeTruthy();
    const rest = await postGrid(SCENARIO_BODY).then((r) => r.json());
    const child = spawn('node', ['mcp/mcp-server.js'], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const send = (id, method, params) => new Promise((resolve, reject) => {
      const onData = (chunk) => {
        for (const line of String(chunk).split('\n')) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.id === id) {
              child.stdout.off('data', onData);
              resolve(msg);
            }
          } catch { /* handshake noise */ }
        }
      };
      child.stdout.on('data', onData);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      setTimeout(() => { child.stdout.off('data', onData); reject(new Error(`mcp timeout ${method}`)); }, 20_000);
    });
    try {
      await send(1, 'initialize', {});
      const result = await send(2, 'tools/call', {
        name: 'terminal.get_exposure_grid',
        arguments: SCENARIO_BODY,
      });
      expect(result.result.isError).toBeFalsy();
      const structured = result.result.structuredContent;
      expect(validateContract('exposureGridResponse', structured)).toMatchObject({ valid: true });
      expect(structured.data.cells).toEqual(rest.data.cells);
      expect(structured.data.methodology.version).toBe('exposure-grid/v1');
    } finally {
      child.kill('SIGKILL');
    }
  }, 60_000);
});
