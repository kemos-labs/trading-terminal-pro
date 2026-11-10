/**
 * Positioning workbench REST tests (REF-01–04 core slice + GLM M1/M2 closure).
 *
 * Real Fastify composition via inject with the mocked equity chain snapshot.
 * Covers: one-frame identity (gex/charm/profile share frameId + asOf),
 * M1 8-digit date-like rejection with epochs preserved, upstream-partial
 * never upgraded, missing scenario fields rejected (no silent unapplied
 * inputs), referenceTime frame membership, and crypto inapplicability.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../app.js';
import { clearCacheForTests } from '../../api/upstreamCache.js';
import { resetDeribitClientState } from '../providers/deribit/client.js';
import { validateContract } from '../../packages/contracts/src/runtime.js';
import { strictInstantMs } from './v1ExposureGrid.js';

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

const T0 = '2026-01-05T12:00:00.000Z';
const T1 = '2027-01-05T12:00:00.000Z';

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
      expiryOverrides: { '2030-12-18': '2030-12-18T21:00:00.000Z' },
    },
    ...over,
  };
}

function postWb(payload) {
  return app.inject({ method: 'POST', url: '/api/v1/analytics/positioning/workbench', payload });
}

describe('positioning workbench (one snapshot frame)', () => {
  it('returns gex+charm+profile from one frame with contract validation', async () => {
    const response = await postWb(wbBody());
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('exposureWorkbenchResponse', body)).toMatchObject({ valid: true });
    const { data } = body;
    expect(data.frameId).toContain('TEST');
    expect(data.frameId).toContain('2026-01-05T12:00:00.000Z');
    // SAME frame: gex, charm, and profile share positionBasisAt + snapshot source.
    expect(data.gex.positionBasisAt).toBe(data.positionBasisAt);
    expect(data.charm.positionBasisAt).toBe(data.positionBasisAt);
    expect(data.gex.timesMs).toEqual(data.charm.timesMs);
    expect(data.gex.prices).toEqual(data.charm.prices);
    expect(data.gex.units).toBe('$/1% move');
    expect(data.charm.units).toBe('$Δ/day');
    // Distinct units, zero is valid: OI=0 strike-110 profile row is a number (0), not null.
    const byStrike = new Map(data.profile.map((p) => [p.strike, p]));
    expect(byStrike.get(100)?.value).toEqual(expect.any(Number));
    expect(byStrike.get(110)?.value).toBe(0);
    expect(byStrike.get(100)?.basis).toContain('not observed dealer inventory');
    expect(data.spotRef).toBe(100);
    expect(data.rowSelection).toMatchObject({ totalContracts: 3, eligibleContracts: 3, usedContracts: 3, truncated: false });
    expect(body.coverage.state).toBe('complete');
  });

  it('M1: rejects 8-digit date-like strings in times, keeps real epochs', async () => {
    expect(strictInstantMs('20260101')).toBeNull();
    expect(strictInstantMs('20301218')).toBeNull();
    expect(strictInstantMs(1767225600000)).toBe(1767225600000);
    expect(strictInstantMs('1767225600000')).toBe(1767225600000);
    const response = await postWb(wbBody({ times: ['20260101', T1] }));
    expect(response.statusCode).toBe(400);
    const ok = await postWb(wbBody({ times: [Date.parse(T0), Date.parse(T1)], referenceTime: Date.parse(T0) }));
    expect(ok.statusCode).toBe(200);
  });

  it('M2: upstream partial coverage is merged and never upgraded; no fabricated asOf', async () => {
    mockSnapshot = {
      ...defaultSnapshot(),
      quotes: [
        ...defaultSnapshot().quotes,
        { strike: -5, expiry: 'not-a-date', right: 'call', bid: 1, ask: 1.1, markIv: 0.2, openInterest: 10 },
        { strike: 105, expiry: '2030-12-18', right: 'weird', bid: 1, ask: 1.1, markIv: 0.2, openInterest: 10 },
      ],
    };
    const response = await postWb(wbBody());
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('exposureWorkbenchResponse', body)).toMatchObject({ valid: true });
    expect(body.coverage.missing.some((m) => m.startsWith('snapshot-'))).toBe(true);
    expect(body.coverage.state).not.toBe('complete');
    // asOf is the real snapshot event time, never a fabricated placeholder.
    expect(String(body.asOf)).toContain('2026');
    expect(body.data.positionBasisAt).toBe('2026-01-05T12:00:00.000Z');
    expect(body.data.frameId).toContain('2026-01-05T12:00:00.000Z');
  });

  it('rejects missing scenario legs (no silent unapplied inputs) and off-frame referenceTime', async () => {
    const { riskFreeRate: _r, ...noR } = wbBody().scenario;
    const missing = await postWb(wbBody({ scenario: noR }));
    expect(missing.statusCode).toBe(400);
    const offFrame = await postWb(wbBody({ referenceTime: '2028-06-01T12:00:00.000Z' }));
    expect(offFrame.statusCode).toBe(400);
  });

  it('crypto snapshots stay Unavailable for the spot-european workbench, never substituted', async () => {
    const response = await postWb(wbBody({
      symbol: 'BTC',
      prices: [59000, 60000, 61000],
      times: [T0],
      referenceTime: T0,
    }));
    // No Deribit fixture here: the canonical crypto snapshot is unavailable
    // (502), which must stay Unavailable — never a fabricated substitution.
    expect(response.statusCode).toBe(502);
    expect(['PROVIDER_UNAVAILABLE', 'INSUFFICIENT_COVERAGE']).toContain(response.json().error.code);
  });

  it('truncation forces at most partial and is stated', async () => {
    const response = await postWb(wbBody({ maxRows: 1 }));
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('exposureWorkbenchResponse', body)).toMatchObject({ valid: true });
    expect(body.data.rowSelection.truncated).toBe(true);
    expect(body.coverage.state).not.toBe('complete');
    expect(body.coverage.missing.some((m) => m.startsWith('truncated-'))).toBe(true);
  });

  it('T1 linkGroup: absent echoes null; valid hint echoes verbatim with contract validity', async () => {
    const absent = await postWb(wbBody());
    expect(absent.statusCode).toBe(200);
    expect(absent.json().data.linkGroup).toBeNull();
    expect(validateContract('exposureWorkbenchResponse', absent.json())).toMatchObject({ valid: true });
    const hint = { id: 'wb-a', symbol: true, expiry: true, time: true, priceRange: false };
    const linked = await postWb(wbBody({ linkGroup: hint }));
    expect(linked.statusCode).toBe(200);
    const linkedBody = linked.json();
    expect(linkedBody.data.linkGroup).toEqual(hint);
    expect(validateContract('exposureWorkbenchResponse', linkedBody)).toMatchObject({ valid: true });
    // Empty object is a valid no-op group; echo preserves it.
    const noop = await postWb(wbBody({ linkGroup: {} }));
    expect(noop.statusCode).toBe(200);
    expect(noop.json().data.linkGroup).toEqual({});
  });

describe('positioning workbench REF-02 T2 (profile units + call/put split)', () => {
  it('T2-C1: absent profileUnits stays contract-valid; enriched rows absent for old frames is still valid', async () => {
    const response = await postWb(wbBody());
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('exposureWorkbenchResponse', body)).toMatchObject({ valid: true });
    expect(body.data.profileUnits ?? null).toBeNull();
    // New rows always carry the additive nullable splits (finite-or-null).
    for (const row of body.data.profile) {
      for (const key of ['contracts', 'contractsCall', 'contractsPut', 'callGex', 'putGex']) {
        expect(row[key] === null || typeof row[key] === 'number').toBe(true);
      }
    }
    // An old client row without the splits still validates (additive optional).
    const legacy = JSON.parse(JSON.stringify(body));
    for (const row of legacy.data.profile) {
      delete row.contracts; delete row.contractsCall; delete row.contractsPut;
      delete row.callGex; delete row.putGex;
    }
    delete legacy.data.profileUnits;
    expect(validateContract('exposureWorkbenchResponse', legacy)).toMatchObject({ valid: true });
  });

  it('T2-C2: enriched row arithmetic vector — contracts pinned to signed OI, callGex+putGex=value', async () => {
    mockSnapshot = {
      symbol: 'TEST',
      spot: 100,
      timestamp: '2026-01-05T12:00:00.000Z',
      quotes: [
        { strike: 90, expiry: '2030-12-18', right: 'call', bid: 5, ask: 5.2, markIv: 0.25, openInterest: 10 },
        { strike: 100, expiry: '2030-12-18', right: 'put', bid: 4, ask: 4.2, markIv: 0.25, openInterest: 6 },
        { strike: 110, expiry: '2030-12-18', right: 'call', bid: 2, ask: 2.2, markIv: 0.3, openInterest: 4 },
        { strike: 110, expiry: '2030-12-18', right: 'put', bid: 3, ask: 3.2, markIv: 0.3, openInterest: 4 },
      ],
    };
    const response = await postWb(wbBody());
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('exposureWorkbenchResponse', body)).toMatchObject({ valid: true });
    expect(JSON.stringify(body).includes('NaN')).toBe(false);
    const byStrike = new Map(body.data.profile.map((p) => [p.strike, p]));
    // contractsCall=+callOI, contractsPut=-putOI, contracts=call+put (exact integer arithmetic).
    expect(byStrike.get(90)).toMatchObject({ contracts: 10, contractsCall: 10, contractsPut: 0 });
    expect(byStrike.get(100)).toMatchObject({ contracts: -6, contractsCall: 0, contractsPut: -6 });
    // Balanced strike: valid zero stays numeric zero (never null, never em-dash).
    expect(byStrike.get(110)).toMatchObject({ contracts: 0, contractsCall: 4, contractsPut: -4 });
    expect(byStrike.get(110)?.value).toBe(0);
    expect(byStrike.get(110)?.callGex).toBeGreaterThan(0);
    expect(byStrike.get(110)?.putGex).toBeLessThan(0);
    for (const row of body.data.profile) {
      expect(row.contracts).toBe(row.contractsCall + row.contractsPut);
      for (const key of ['value', 'contracts', 'contractsCall', 'contractsPut', 'callGex', 'putGex']) {
        expect(row[key] === null || Number.isFinite(row[key])).toBe(true);
      }
      if (row.value != null && row.callGex != null && row.putGex != null) {
        // Single engine call per strike + same-group per-quote walk: ulp-level agreement only.
        expect(Math.abs((row.callGex + row.putGex) - row.value)).toBeLessThan(1e-9 * Math.max(1, Math.abs(row.value)));
      }
    }
    // `value` keeps its combined signed-GEX meaning for old clients.
    expect(typeof byStrike.get(90)?.value).toBe('number');
    expect(byStrike.get(90)?.callGex).toBeGreaterThan(0);
    expect(byStrike.get(90)?.putGex).toBe(0);
    expect(byStrike.get(100)?.putGex).toBeLessThan(0);
    expect(byStrike.get(100)?.callGex).toBe(0);
  });

  it('T2-C3: missing rows stay null — quotes without valid IV yield null splits, never zero', async () => {
    mockSnapshot = {
      symbol: 'TEST',
      spot: 100,
      timestamp: '2026-01-05T12:00:00.000Z',
      quotes: [
        { strike: 100, expiry: '2030-12-18', right: 'call', bid: 5, ask: 5.2, markIv: 0.25, openInterest: 50 },
        // K=120 carries OI but no venue-mark IV: the engine excludes it, so the row is missing.
        { strike: 120, expiry: '2030-12-18', right: 'call', bid: 1, ask: 1.1, openInterest: 5 },
      ],
    };
    const response = await postWb(wbBody());
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('exposureWorkbenchResponse', body)).toMatchObject({ valid: true });
    const byStrike = new Map(body.data.profile.map((p) => [p.strike, p]));
    expect(byStrike.get(120)?.value).toBeNull();
    expect(byStrike.get(120)?.contracts).toBeNull();
    expect(byStrike.get(120)?.contractsCall).toBeNull();
    expect(byStrike.get(120)?.contractsPut).toBeNull();
    expect(byStrike.get(120)?.callGex).toBeNull();
    expect(byStrike.get(120)?.putGex).toBeNull();
    expect(byStrike.get(100)?.value).toEqual(expect.any(Number));
  });

  it('T2-C4: profileUnits echoes verbatim when sent, absent when not; T1 linkGroup guard unchanged', async () => {
    const echoed = await postWb(wbBody({ profileUnits: 'gex' }));
    expect(echoed.statusCode).toBe(200);
    expect(echoed.json().data.profileUnits).toBe('gex');
    expect(validateContract('exposureWorkbenchResponse', echoed.json())).toMatchObject({ valid: true });
    const toggled = await postWb(wbBody({ profileUnits: 'contracts' }));
    expect(toggled.json().data.profileUnits).toBe('contracts');
    // Same frame for both hints: the toggle is presentation-only, never a recompute selector.
    expect(toggled.json().data.frameId).toBe(echoed.json().data.frameId);
    expect(toggled.json().data.positionBasisAt).toBe(echoed.json().data.positionBasisAt);
    const absent = await postWb(wbBody());
    expect(absent.json().data.profileUnits ?? null).toBeNull();
    // profileUnits is a free-form echo hint: no new 400, and T1 still rejects unknown linkGroup keys.
    const freeform = await postWb(wbBody({ profileUnits: 'custom-view' }));
    expect(freeform.statusCode).toBe(200);
    expect(freeform.json().data.profileUnits).toBe('custom-view');
    const unknown = await postWb(wbBody({ linkGroup: { id: 'wb-a', spot: true } }));
    expect(unknown.statusCode).toBe(400);
  });
});

  it('T1 broken-link isolation: invalid id, coerced flags, and unknown keys are typed 400s', async () => {
    const badId = await postWb(wbBody({ linkGroup: { id: 'bad!id', time: true } }));
    expect(badId.statusCode).toBe(400);
    expect(badId.json().error.code).toBe('INVALID_REQUEST');
    const coerced = await postWb(wbBody({ linkGroup: { id: 'wb-a', time: 'true' } }));
    expect(coerced.statusCode).toBe(400);
    const unknown = await postWb(wbBody({ linkGroup: { id: 'wb-a', spot: true } }));
    expect(unknown.statusCode).toBe(400);
    // Survivor isolation: the server holds no panel state, so a valid request
    // immediately after the 400s still returns the full frame.
    const survivor = await postWb(wbBody({ linkGroup: { id: 'wb-a', time: true } }));
    expect(survivor.statusCode).toBe(200);
    expect(survivor.json().data.frameId).toContain('TEST');
  });
});

describe('positioning workbench REF-04 T4a (DEX delta-pressure grid)', () => {
  it('T4a-D1: dex grid shares the same frame/axes with distinct $Δ notional units', async () => {
    const response = await postWb(wbBody());
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('exposureWorkbenchResponse', body)).toMatchObject({ valid: true });
    const { data } = body;
    // Same frame: identical axes, shared frameId and frozen-OI as-of.
    expect(data.dex.prices).toEqual(data.gex.prices);
    expect(data.dex.timesMs).toEqual(data.gex.timesMs);
    expect(data.dex.positionBasisAt).toBe(data.positionBasisAt);
    expect(data.dex.rowSelection).toEqual(data.gex.rowSelection);
    expect(data.dex.units).toBe('$Δ notional');
    expect(data.dex.methodology.dexUnits).toMatch(/signed kernel/);
    // Distinct quantity: dex cells differ from gex cells where computed.
    const gexVals = data.gex.cells.flat().map((c) => c.value);
    const dexVals = data.dex.cells.flat().map((c) => c.value);
    expect(dexVals.some((v) => v != null && Number.isFinite(v))).toBe(true);
    const bothFinite = gexVals.map((g, i) => [g, dexVals[i]]).filter(([g, d]) => g != null && d != null);
    expect(bothFinite.length).toBeGreaterThan(0);
    expect(bothFinite.some(([g, d]) => Math.abs(g - d) > 1e-9)).toBe(true);
    // Budget accounts the dex grid; coverage denominator covers three grids.
    expect(body.coverage.denominator).toBe(data.gridCells.total);
    expect(data.gridCells.total).toBe(3 * data.gex.gridCells.total);
    expect(data.gridCells.computed).toBe(
      data.gex.gridCells.computed + data.dex.gridCells.computed + data.charm.gridCells.computed,
    );
    expect(body.provenanceByField['data.dex.cells[].value']).toContain('signed kernel delta');
    expect(body.unitsByField['data.dex.cells[].value']).toBe('$Δ notional');
  });

  it('T4a-D2: dex null semantics — quotes without valid IV yield null dex cells, never zero', async () => {
    mockSnapshot = {
      symbol: 'TEST',
      spot: 100,
      timestamp: '2026-01-05T12:00:00.000Z',
      quotes: [
        { strike: 100, expiry: '2030-12-18', right: 'call', bid: 5, ask: 5.2, markIv: null, openInterest: 50 },
      ],
    };
    const response = await postWb(wbBody());
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(validateContract('exposureWorkbenchResponse', body)).toMatchObject({ valid: true });
    expect(body.data.dex.cells.flat().every((c) => c.value == null)).toBe(true);
    expect(body.data.dex.cells.flat().flatMap((c) => c.reasons)).toContain('missing-iv');
    expect(body.coverage.state).not.toBe('complete');
  });
});
