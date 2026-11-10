/**
 * REF-05 calendarized dollar-gamma tests (decisions 1–8).
 *
 * Real Fastify composition via inject with a mocked equity chain snapshot.
 * Covers: independent-gamma fixture (hand-rolled BSM vs route), exact expiry
 * exclusion, irregular-date mapping with reference-clock equality, exact-spot
 * current vs off-node grid values, deterministic peak ties (independent
 * re-scan), total-budget rejection, canonical snapshot identity, and
 * API validation (invalid/duplicate/rolled/first-date-mismatch dates).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../app.js';
import { clearCacheForTests } from '../../api/upstreamCache.js';
import { resetDeribitClientState } from '../providers/deribit/client.js';
import { validateContract } from '../../packages/contracts/src/runtime.js';

let mockSnapshot = null;

function defaultSnapshot() {
  return {
    symbol: 'TEST',
    spot: 100,
    timestamp: '2026-01-05T12:00:00.000Z',
    quotes: [
      { strike: 100, expiry: '2030-12-18', right: 'call', bid: 5, ask: 5.2, markIv: 0.25, openInterest: 50 },
      { strike: 100, expiry: '2030-12-18', right: 'put', bid: 4, ask: 4.2, markIv: 0.25, openInterest: 40 },
      { strike: 110, expiry: '2030-12-18', right: 'call', bid: 2, ask: 2.2, markIv: 0.3, openInterest: 0 },
    ],
  };
}

vi.mock('./equityFeeds.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    getOptionChainSnapshot: vi.fn(async () => mockSnapshot),
  };
});

const json = (body) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

let app;

beforeEach(async () => {
  mockSnapshot = defaultSnapshot();
  clearCacheForTests();
  resetDeribitClientState();
  global.fetch = vi.fn(async () => json({}));
  app = await buildServer();
  await app.ready();
});

afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

// Independent BSM gamma (hand-rolled here; NOT the shared engine): gamma =
// e^-qT φ(d1) / (S σ √T), signed +call/−put, dollarized S²·0.01·OI·mult.
function normPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}
function manualDollarGamma({ S, K, T, r, q, vol, right, oi, mult }) {
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * vol * vol) * T) / (vol * sqrtT);
  const gamma = Math.exp(-q * T) * normPdf(d1) / (S * vol * sqrtT);
  const sign = right === 'call' ? 1 : -1;
  return sign * gamma * S * S * 0.01 * oi * mult;
}
function manualCellTotal(S, tMs, expiryMs) {
  const Y = 365.25 * 24 * 3600 * 1000;
  const T = (expiryMs - tMs) / Y;
  if (!(T > 0)) return null;
  return manualDollarGamma({ S, K: 100, T, r: 0.04, q: 0.01, vol: 0.25, right: 'call', oi: 50, mult: 100 })
    + manualDollarGamma({ S, K: 100, T, r: 0.04, q: 0.01, vol: 0.25, right: 'put', oi: 40, mult: 100 });
  // strike-110 quote has OI 0 → contributes exactly 0.
}

const T0 = '2026-01-05T12:00:00.000Z';
const T1 = '2027-01-05T12:00:00.000Z';
const EXP = '2030-12-18T21:00:00.000Z';

function wbBody(over = {}) {
  return {
    symbol: 'TEST',
    prices: [90, 100, 110],
    times: [T0, T1],
    referenceTime: T0,
    scenario: {
      riskFreeRate: 0.04,
      carryRate: 0.01,
      model: 'spot-european',
      multiplier: 100,
      expiryOverrides: { '2030-12-18': EXP },
    },
    ...over,
  };
}

function postWb(payload) {
  return app.inject({ method: 'POST', url: '/api/v1/analytics/positioning/workbench', payload });
}

describe('REF-05 calendarized gamma', () => {
  it('scalar APIs preserved when no calendar requested; calendar null', async () => {
    const response = await postWb(wbBody());
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('exposureWorkbenchResponse', body)).toMatchObject({ valid: true });
    expect(body.data.gex.units).toBe('$/1% move');
    expect(body.data.charm.units).toBe('$Δ/day');
    expect(Array.isArray(body.data.profile)).toBe(true);
    expect(body.data.calendar).toBeNull();
  });

  it('independent-gamma fixture: calendar cells match hand-rolled BSM dollar gamma', async () => {
    const response = await postWb(wbBody({ calendar: { dates: ['2026-01-05', '2026-06-05'] } }));
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('exposureWorkbenchResponse', body)).toMatchObject({ valid: true });
    const cal = body.data.calendar;
    expect(cal.clock).toBe('12:00:00.000');
    expect(cal.instants[0]).toBe(T0);
    expect(cal.instantsMs[0]).toBe(Date.parse(T0));
    expect(cal.snapshotIdentity).toBe(body.data.frameId);
    const expiryMs = Date.parse(EXP);
    for (let pi = 0; pi < cal.prices.length; pi++) {
      for (let di = 0; di < cal.dates.length; di++) {
        const expected = manualCellTotal(cal.prices[pi], cal.instantsMs[di], expiryMs);
        const got = cal.cells[pi][di].value;
        expect(got).not.toBeNull();
        expect(Math.abs(got - expected) / Math.abs(expected)).toBeLessThan(0.02);
      }
    }
    // Exact-spot current equals the manual value at canonical spot (no substitution).
    const expectedSpot = manualCellTotal(100, Date.parse(T0), expiryMs);
    expect(Math.abs(cal.current.value - expectedSpot) / Math.abs(expectedSpot)).toBeLessThan(0.02);
    expect(cal.current.spot).toBe(100);
    expect(cal.current.instant).toBe(T0);
    expect(cal.current.unit).toBe('$/1% move');
  });

  it('exact expiry exclusion: column at/after expiry is null with expired reason', async () => {
    const response = await postWb(wbBody({
      calendar: { dates: ['2026-01-05', '2030-12-18', '2031-01-05'] },
    }));
    expect(response.statusCode).toBe(200);
    const cal = response.json().data.calendar;
    // 2030-12-18T12:00 clock is BEFORE the 21:00 expiry override → finite.
    expect(cal.cells[1][1].value).not.toBeNull();
    // 2031-01-05 is after expiry → null, expired reason, never zero-filled.
    expect(cal.cells[1][2].value).toBeNull();
    expect(cal.cells[1][2].reasons).toContain('expired');
    expect(cal.domain.min).not.toBeNull();
  });

  it('irregular dates map via the reference clock; first column equals reference exactly', async () => {
    const ref = '2026-01-05T07:34:56.789Z';
    const response = await postWb(wbBody({
      times: [ref, T1],
      referenceTime: ref,
      calendar: { dates: ['2026-01-05', '2026-01-07', '2026-03-20'] },
    }));
    expect(response.statusCode).toBe(200);
    const cal = response.json().data.calendar;
    expect(cal.clock).toBe('07:34:56.789');
    expect(cal.instants).toEqual([
      '2026-01-05T07:34:56.789Z',
      '2026-01-07T07:34:56.789Z',
      '2026-03-20T07:34:56.789Z',
    ]);
    expect(cal.instantsMs[0]).toBe(Date.parse(ref));
  });

  it('exact-spot current vs off-node grid: current is the true spot value, not interpolation', async () => {
    const response = await postWb(wbBody({
      prices: [90, 95, 105, 110],
      calendar: { dates: ['2026-01-05', '2026-02-05'] },
    }));
    expect(response.statusCode).toBe(200);
    const cal = response.json().data.calendar;
    const expiryMs = Date.parse(EXP);
    const expectedSpot = manualCellTotal(100, Date.parse(T0), expiryMs);
    expect(Math.abs(cal.current.value - expectedSpot) / Math.abs(expectedSpot)).toBeLessThan(0.02);
    // Grid has no 100 node; current must NOT equal any single grid cell nor a midpoint average.
    const col = cal.cells.map((row) => row[0].value);
    for (const v of col) expect(v).not.toBe(cal.current.value);
    const mid = (col[1] + col[2]) / 2;
    expect(Math.abs(cal.current.value - mid) / Math.abs(mid)).toBeGreaterThan(0.001);
  });

  it('peak is the deterministic max-abs node (earliest instant, then lowest price)', async () => {
    const response = await postWb(wbBody({ calendar: { dates: ['2026-01-05', '2026-06-05', '2027-06-05'] } }));
    expect(response.statusCode).toBe(200);
    const cal = response.json().data.calendar;
    // Independent re-scan with the documented tie-break.
    let expected = null;
    for (let pi = 0; pi < cal.prices.length; pi++) {
      for (let di = 0; di < cal.dates.length; di++) {
        const v = cal.cells[pi][di].value;
        if (v == null || !Number.isFinite(v)) continue;
        const abs = Math.abs(v);
        const best = expected == null ? -1 : Math.abs(expected.value);
        if (abs > best
          || (abs === best && expected != null
            && (cal.instantsMs[di] < expected.instantMs
              || (cal.instantsMs[di] === expected.instantMs && cal.prices[pi] < expected.price)))) {
          expected = {
            value: v, price: cal.prices[pi], date: cal.dates[di],
            instantMs: cal.instantsMs[di], instant: cal.instants[di],
          };
        }
      }
    }
    expect(cal.peak).toEqual(expected);
    expect(cal.domain.min).toBeLessThanOrEqual(cal.domain.max);
    expect(cal.domain.symmetricAuto).toBe(false);
  });

  it('total-budget rejection counts gex+charm+profile+exact-spot+calendar before evaluating', async () => {
    mockSnapshot = {
      ...defaultSnapshot(),
      quotes: Array.from({ length: 9 }, (_, i) => ({
        strike: 90 + i, expiry: '2030-12-18', right: i % 2 ? 'put' : 'call',
        bid: 1, ask: 1.2, markIv: 0.25, openInterest: 10,
      })),
    };
    const prices = Array.from({ length: 100 }, (_, i) => 50 + i);
    const times = Array.from({ length: 100 }, (_, i) => new Date(Date.parse(T0) + i * 86400000).toISOString());
    const dates = Array.from({ length: 100 }, (_, i) => new Date(Date.parse('2026-01-05T00:00:00.000Z') + i * 86400000).toISOString().slice(0, 10));
    const response = await postWb(wbBody({ prices, times, calendar: { dates } }));
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/budget exceeded/i);
  });

  it('snapshot identity: calendar proves the same bound quote set; maxRows changes the frame', async () => {
    const full = await postWb(wbBody({ calendar: { dates: ['2026-01-05'] } }));
    expect(full.statusCode).toBe(200);
    expect(full.json().data.calendar.snapshotIdentity).toBe(full.json().data.frameId);
    const narrow = await postWb(wbBody({ maxRows: 1, calendar: { dates: ['2026-01-05'] } }));
    expect(narrow.statusCode).toBe(200);
    expect(narrow.json().data.frameId).not.toBe(full.json().data.frameId);
    expect(narrow.json().data.calendar.snapshotIdentity).toBe(narrow.json().data.frameId);
    expect(narrow.json().data.rowSelection.usedContracts).toBe(1);
  });

  it('validation: rolled/duplicate/mismatched/malformed dates rejected; scalar workbench unaffected', async () => {
    expect((await postWb(wbBody({ calendar: { dates: ['2026-02-30'] } }))).statusCode).toBe(400);
    expect((await postWb(wbBody({ calendar: { dates: ['2026-01-05', '2026-01-05'] } }))).statusCode).toBe(400);
    expect((await postWb(wbBody({ calendar: { dates: ['2026-01-06', '2026-01-07'] } }))).statusCode).toBe(400);
    expect((await postWb(wbBody({ calendar: { dates: ['05-01-2026'] } }))).statusCode).toBe(400);
    expect((await postWb(wbBody({ calendar: { dates: ['2026-01-05', '2026-13-01'] } }))).statusCode).toBe(400);
    // Scalar path still 200 after calendar rejections.
    expect((await postWb(wbBody())).statusCode).toBe(200);
  });

  it('missing spot yields null current with a typed reason, never zero', async () => {
    mockSnapshot = { ...defaultSnapshot(), spot: null };
    const response = await postWb(wbBody({ calendar: { dates: ['2026-01-05'] } }));
    expect(response.statusCode).toBe(200);
    const cal = response.json().data.calendar;
    expect(cal.current.spot).toBeNull();
    expect(cal.current.value).toBeNull();
    expect(cal.current.reasons).toContain('missing-spot');
  });
});
