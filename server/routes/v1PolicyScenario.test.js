/**
 * REF-08/N3c policy-scenario route tests (math/route slice only; no UI).
 *
 * Exercises the REAL Fastify production composition via inject: Node body
 * validation before any worker call, envelope projection with finite-or-null
 * numerics, worker-400 mapping, and worker-down fail-closed behavior.
 * Worker payloads here are canned synthetic fixtures mirroring the real
 * calculator shape; the real worker↔Fastify capture lives in the tranche
 * evidence directory.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../app.js';
import { clearCacheForTests } from '../../api/upstreamCache.js';
import { validateContract } from '../../packages/contracts/src/runtime.js';
import { resolveRatesWorkerUrl } from '../ratesWorkerUrl.js';

let app;
const WORKER = resolveRatesWorkerUrl();
const workerPath = new URL(WORKER).origin;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

// Canned synthetic worker result (shape-identical to the real calculator).
function workerOk() {
  return {
    fixingLine: [
      { date: '2026-01-05', observedValue: 5.0, scenarioValue: 5.0, cumulativeStepBps: 0.0, provenance: 'observed' },
      { date: '2026-01-08', observedValue: null, scenarioValue: 5.1, cumulativeStepBps: 10.0, provenance: 'scenario' },
    ],
    sr3: {
      windowStart: '2026-01-05', windowEnd: '2026-01-09',
      currentRate: 4.9, currentSource: 'synthetic-fixture', currentDate: '2026-01-05',
      currentProvenance: 'observed-explicit-source-date',
      predictedRate: 5.0261, predictedProvenance: 'scenario-compound-sofr-rate',
      differenceBps: 12.61, status: 'ok', warnings: [],
    },
    sr1: null,
    policySpreadBps: null,
    policySpreadProvenance: 'unavailable-not-supplied',
    lastObservedDate: '2026-01-05',
    warnings: ['policy spread omitted: stays null/Unavailable (no default).'],
    assumptions: ['synthetic-fixture assumption'],
    as_of: '2026-01-09T00:00:00.000Z',
    source: 'caller-supplied-fixings-plus-scenario-steps',
  };
}

let workerMode = 'ok';
function installWorkerMock() {
  global.fetch = vi.fn(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === workerPath && url.pathname === '/api/rates/policy-scenario') {
      if (workerMode === 'down') throw new Error('connection refused (synthetic)');
      if (workerMode === 'bad') return json({ error: 'fixings must be a non-empty array (synthetic)' }, 400);
      if (workerMode === 'unavailable') {
        const payload = workerOk();
        payload.sr3 = {
          windowStart: '2026-01-05', windowEnd: '2026-01-09',
          currentRate: null, currentSource: null, currentDate: null,
          currentProvenance: 'unavailable-not-supplied',
          predictedRate: null, predictedProvenance: 'unavailable',
          differenceBps: null, status: 'unavailable',
          warnings: ['sr3: predicted Unavailable — missing required business-day fixing(s), e.g. 2026-01-06 (fail-closed, no substitution).'],
        };
        return json(payload);
      }
      if (workerMode === 'exact-zero') {
        const payload = workerOk();
        payload.sr3.predictedRate = 4.9;
        payload.sr3.differenceBps = 0.0;
        return json(payload);
      }
      return json(workerOk());
    }
    throw new Error(`unexpected fetch in policy-scenario test: ${String(input)}`);
  });
}

const REAL_FETCH = global.fetch;

function validBody() {
  return {
    fixings: [
      { date: '2026-01-05', value: 5.0 },
      { date: '2026-01-06', value: 5.0 },
    ],
    meetings: [{ date: '2026-01-08', stepBps: 10 }],
    sr3: {
      windowStart: '2026-01-05', windowEnd: '2026-01-09',
      currentRate: 4.9, currentSource: 'synthetic-fixture', currentDate: '2026-01-05',
    },
  };
}

function assertFiniteOrNull(value, path = 'root') {
  if (typeof value === 'number') expect(Number.isFinite(value), `${path} must be finite`).toBe(true);
  else if (Array.isArray(value)) value.forEach((v, i) => assertFiniteOrNull(v, `${path}[${i}]`));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertFiniteOrNull(v, `${path}.${k}`);
  }
}

describe('POST /api/v1/rates/policy-scenario', () => {
  beforeAll(async () => {
    app = await buildServer();
  });
  afterAll(async () => {
    global.fetch = REAL_FETCH;
    await app?.close();
  });
  beforeEach(() => {
    workerMode = 'ok';
    installWorkerMock();
    clearCacheForTests();
  });

  it('returns a validated scenario envelope with observed/scenario separation', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/rates/policy-scenario', payload: validBody() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(validateContract('policyScenarioResponse', body)).toMatchObject({ valid: true });
    expect(body.source).toContain('caller-supplied-fixings');
    expect(body.provenanceByField['data.fixingLine[].scenarioValue']).toMatch(/scenario/);
    expect(body.unitsByField['data.sr3.differenceBps']).toBe('basis-points');
    expect(body.unitsByField['data.sr3.predictedRate']).toBe('percent-100');
    const line = Object.fromEntries(body.data.fixingLine.map((r) => [r.date, r]));
    expect(line['2026-01-05'].provenance).toBe('observed');
    expect(line['2026-01-08'].provenance).toBe('scenario');
    expect(line['2026-01-08'].observedValue).toBeNull();
    expect(body.data.sr3.predictedRate).toBeCloseTo(5.0261, 4);
    expect(body.data.sr3.status).toBe('ok');
    expect(body.data.policySpreadBps).toBeNull();
    assertFiniteOrNull(body);
  });

  it('rejects malformed bodies with typed 400 before any worker call', async () => {
    const cases = [
      [{}, 'empty'],
      [{ fixings: [] }, 'empty fixings'],
      [{ fixings: [{ date: '01/05/2026', value: 5 }] }, 'bad date'],
      [{ fixings: [{ date: '2026-01-05', value: 'high' }] }, 'non-numeric value'],
      [{ fixings: [{ date: '2026-01-05', value: 5 }], meetings: [{ date: '2026-01-08', stepBps: 'ten' }] }, 'non-numeric step'],
      [{ fixings: [{ date: '2026-01-05', value: 5 }], sr3: { windowStart: '2026-01-09', windowEnd: '2026-01-05' } }, 'inverted window'],
      [{ fixings: [{ date: '2026-01-05', value: 5 }], policySpreadBps: 'wide' }, 'non-numeric spread'],
      [{ fixings: Array.from({ length: 501 }, (_, i) => ({ date: '2026-01-05', value: 5 + i * 0 })) }, 'over row limit'],
    ];
    for (const [payload, label] of cases) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/rates/policy-scenario', payload });
      expect(res.statusCode, label).toBe(400);
      expect(validateContract('errorResponse', res.json()), label).toMatchObject({ valid: true });
      expect(res.json().error.code, label).toBe('INVALID_REQUEST');
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects unknown top-level and nested keys before any worker call', async () => {
    const base = validBody();
    const cases = [
      [{ ...base, bogus: true }, 'top-level extra'],
      [{ ...base, fixings: [{ date: '2026-01-05', value: 5.0, venue: 'X' }] }, 'nested fixing extra'],
      [{ ...base, meetings: [{ date: '2026-01-08', stepBps: 10, note: 'hi' }] }, 'nested meeting extra'],
      [{ ...base, sr3: { ...base.sr3, extra: 1 } }, 'nested sr3 extra'],
      [{ ...base, sr1: { windowStart: '2026-01-05', windowEnd: '2026-01-06', bogus: 1 } }, 'nested sr1 extra'],
    ];
    for (const [payload, label] of cases) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/rates/policy-scenario', payload });
      expect(res.statusCode, label).toBe(400);
      expect(validateContract('errorResponse', res.json()), label).toMatchObject({ valid: true });
      expect(res.json().error.code, label).toBe('INVALID_REQUEST');
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('maps worker 400 to typed INVALID_REQUEST', async () => {
    workerMode = 'bad';
    const res = await app.inject({ method: 'POST', url: '/api/v1/rates/policy-scenario', payload: validBody() });
    expect(res.statusCode).toBe(400);
    expect(validateContract('errorResponse', res.json())).toMatchObject({ valid: true });
  });

  it('fails closed with 502 when the worker is down', async () => {
    workerMode = 'down';
    const res = await app.inject({ method: 'POST', url: '/api/v1/rates/policy-scenario', payload: validBody() });
    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(validateContract('errorResponse', body)).toMatchObject({ valid: true });
    expect(body.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('surfaces missing-fixing Unavailable with null predicted/difference', async () => {
    workerMode = 'unavailable';
    const res = await app.inject({ method: 'POST', url: '/api/v1/rates/policy-scenario', payload: validBody() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(validateContract('policyScenarioResponse', body)).toMatchObject({ valid: true });
    expect(body.data.sr3.status).toBe('unavailable');
    expect(body.data.sr3.predictedRate).toBeNull();
    expect(body.data.sr3.differenceBps).toBeNull();
    expect(body.coverage.missing).toContain('sr3-predicted-unavailable');
    assertFiniteOrNull(body);
  });

  it('keeps an exact computed zero difference (never null-filled)', async () => {
    workerMode = 'exact-zero';
    const res = await app.inject({ method: 'POST', url: '/api/v1/rates/policy-scenario', payload: validBody() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(validateContract('policyScenarioResponse', body)).toMatchObject({ valid: true });
    expect(body.data.sr3.differenceBps).toBe(0.0);
    expect(body.data.sr3.differenceBps).not.toBeNull();
  });
});
