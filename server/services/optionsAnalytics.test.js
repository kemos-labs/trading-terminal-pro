import { describe, expect, it } from 'vitest';
import { buildGreeks, buildPositioning, buildVolatilitySurface } from './optionsAnalytics.js';

const EQUITY = {
  asOf: '2026-09-01T12:00:00.000Z',
  data: {
    symbol: 'SPY',
    spot: 500,
    quotes: [
      { expiry: '2027-09-01', strike: 500, right: 'call', markIv: 0.2, openInterest: 100 },
      { expiry: '2027-09-01', strike: 500, right: 'put', markIv: 0.2, openInterest: null },
      { expiry: '2027-09-01', strike: 550, right: 'call', markIv: null, openInterest: 50 },
    ],
  },
};

describe('canonical option analytics', () => {
  it('preserves observed holes in the surface', () => {
    const result = buildVolatilitySurface(EQUITY, 'SPY');
    expect(result.data.observedNodes).toHaveLength(3);
    expect(result.data.observedNodes[2].venueMarkIv).toBeNull();
    expect(result.data.modelLayer.nodes).toEqual([]);
    expect(result.coverage).toMatchObject({ numerator: 2, denominator: 3, missing: ['observed-iv'] });
    const bounded = buildVolatilitySurface(EQUITY, 'SPY', { maxRows: 1 });
    expect(bounded.data.observedNodes).toHaveLength(1);
    expect(bounded.coverage).toMatchObject({ denominator: 3, missing: ['row-limit'] });
  });

  it('computes finite BSM Greeks only with explicit rates', () => {
    const unavailable = buildGreeks(EQUITY, 'SPY', { riskFreeRate: null, carryRate: null });
    expect(unavailable.data.computedCount).toBe(0);
    expect(unavailable.data.points.every((point) => point.delta == null)).toBe(true);

    const result = buildGreeks(EQUITY, 'SPY', { riskFreeRate: 0.04, carryRate: 0.01 });
    expect(result.data.computedCount).toBe(2);
    expect(result.data.points[0].delta).toBeGreaterThan(0);
    expect(result.data.points[1].delta).toBeLessThan(0);
    for (const point of result.data.points.slice(0, 2)) {
      for (const key of ['delta', 'gamma', 'vega', 'theta', 'vanna', 'charm']) {
        expect(Number.isFinite(point[key]), key).toBe(true);
      }
    }
  });

  it('matches the canonical one-year ATM Black-Scholes golden vector', () => {
    const envelope = {
      asOf: '2026-09-01T20:00:00.000Z',
      data: {
        symbol: 'TEST',
        spot: 100,
        quotes: [{ expiry: '2027-09-01', strike: 100, right: 'call', markIv: 0.2, openInterest: 1 }],
      },
    };
    const point = buildGreeks(envelope, 'TEST', { riskFreeRate: 0.05, carryRate: 0 }).data.points[0];
    expect(point.delta).toBeCloseTo(0.63683065, 6);
    expect(point.gamma).toBeCloseTo(0.01876202, 6);
    expect(point.vega).toBeCloseTo(0.37524035, 6);
    expect(point.theta).toBeCloseTo(-0.01757, 4);
    expect(point.vanna).toBeCloseTo(-0.28143026, 6);
    expect(point.charm).toBeLessThan(0);
  });

  it('keeps missing OI unavailable in the positioning proxy', () => {
    const result = buildPositioning(EQUITY, 'SPY', { riskFreeRate: 0.04, carryRate: 0.01 });
    expect(result.data.signModel).toBe('signed-greek-oi-proxy');
    expect(result.data.points[0].gex1PctUsd).toBeGreaterThan(0);
    expect(result.data.points[1]).toMatchObject({ openInterest: null, oiState: 'missing', gex1PctUsd: null });
    expect(result.data.points[2].gex1PctUsd).toBeNull();
    expect(result.coverage.missing).toContain('openInterest');
  });

  it('applies the mixed per-metric signed-Greek OI convention (call GEX positive, put GEX negative)', () => {
    const envelope = {
      asOf: '2026-09-01T12:00:00.000Z',
      data: {
        symbol: 'SPY',
        spot: 500,
        quotes: [
          { expiry: '2027-09-01', strike: 500, right: 'call', markIv: 0.2, openInterest: 100 },
          { expiry: '2027-09-01', strike: 500, right: 'put', markIv: 0.2, openInterest: 100 },
        ],
      },
    };
    const inputs = { riskFreeRate: 0.04, carryRate: 0.01 };
    const result = buildPositioning(envelope, 'SPY', inputs);
    const greeks = buildGreeks(envelope, 'SPY', inputs);
    const [call, put] = result.data.points;
    // GEX: +gamma for calls, -gamma for puts.
    expect(call.gex1PctUsd).toBeGreaterThan(0);
    expect(put.gex1PctUsd).toBeLessThan(0);
    expect(call.gex1PctUsd).toBeCloseTo(-put.gex1PctUsd, 6);
    // DEX/Vanna/Charm: signed model Greek with no right multiplier.
    expect(call.dexUsd).toBeGreaterThan(0);
    expect(put.dexUsd).toBeLessThan(0);
    expect(call.dexUsd).toBeCloseTo(greeks.data.points[0].delta * 500 * 100 * 100, 6);
    expect(put.dexUsd).toBeCloseTo(greeks.data.points[1].delta * 500 * 100 * 100, 6);
    expect(call.vannaUsdPerUnitVol).toBeCloseTo(greeks.data.points[0].vanna * 500 * 100 * 100, 6);
    expect(put.charmUsdPerDay).toBeCloseTo(greeks.data.points[1].charm * 500 * 100 * 100, 6);
    expect(result.data.computedCount).toBe(2);
    expect(result.coverage).toMatchObject({ numerator: 2, denominator: 2 });
    expect(result.warnings.join(' ')).toMatch(/not customer-long across all metrics|not observed dealer inventory/);
  });

  it('preserves valid zero OI as zero while missing OI stays null', () => {
    const envelope = {
      asOf: '2026-09-01T12:00:00.000Z',
      data: {
        symbol: 'SPY',
        spot: 500,
        quotes: [
          { expiry: '2027-09-01', strike: 500, right: 'call', markIv: 0.2, openInterest: 0 },
          { expiry: '2027-09-01', strike: 500, right: 'put', markIv: 0.2, openInterest: null },
        ],
      },
    };
    const result = buildPositioning(envelope, 'SPY', { riskFreeRate: 0.04, carryRate: 0.01 });
    const zero = result.data.points[0];
    expect(zero.openInterest).toBe(0);
    expect(zero.oiState).toBe('observed');
    for (const key of ['gex1PctUsd', 'dexUsd', 'vannaUsdPerUnitVol', 'charmUsdPerDay']) {
      expect(zero[key] === 0, key).toBe(true);
    }
    expect(result.data.points[1]).toMatchObject({ openInterest: null, oiState: 'missing', gex1PctUsd: null });
  });

  it('maps finite-input overflow to null with incomplete coverage instead of non-finite outputs', () => {
    const envelope = {
      asOf: '2026-09-01T12:00:00.000Z',
      data: {
        symbol: 'BIG',
        spot: 1e150,
        quotes: [
          { expiry: '2027-09-01', strike: 1e150, right: 'call', markIv: 0.2, openInterest: 1e200 },
        ],
      },
    };
    const result = buildPositioning(envelope, 'BIG', { riskFreeRate: 0.04, carryRate: 0.01 });
    const point = result.data.points[0];
    expect(point.oiState).toBe('observed');
    for (const key of ['gex1PctUsd', 'dexUsd', 'vannaUsdPerUnitVol', 'charmUsdPerDay']) {
      expect(point[key] === null || Number.isFinite(point[key]), key).toBe(true);
    }
    expect(point.gex1PctUsd).toBeNull();
    expect(result.data.computedCount).toBe(0);
    expect(result.coverage).toMatchObject({ numerator: 0, denominator: 1 });
    expect(result.coverage.missing).toContain('non-finite-exposure-overflow');
    expect(result.warnings.join(' ')).toMatch(/non-finite exposure/);
  });

  it('counts Vanna-only overflow while preserving finite GEX/DEX/Charm', () => {
    // Deterministic reachable case: far-OTM call where |vanna| >> GEX scaling
    // (|vanna| ~ |gamma| * spot * sqrtT * |d2|). Raw vanna*spot*oi overflows
    // past 1.79e308 while GEX/DEX/Charm stay finite — no mocked result.
    const envelope = {
      asOf: '2026-09-01T12:00:00.000Z',
      data: {
        symbol: 'X',
        spot: 1e150,
        quotes: [
          { expiry: '2027-09-01', strike: 2e150, right: 'call', markIv: 0.2, openInterest: 1e158 },
        ],
      },
    };
    const result = buildPositioning(envelope, 'X', { riskFreeRate: 0.04, carryRate: 0.01 });
    const point = result.data.points[0];
    expect(Number.isFinite(point.gex1PctUsd)).toBe(true);
    expect(Number.isFinite(point.dexUsd)).toBe(true);
    expect(Number.isFinite(point.charmUsdPerDay)).toBe(true);
    expect(point.vannaUsdPerUnitVol).toBeNull();
    // GEX computedCount stays the GEX count; partial coverage disclosed.
    expect(result.data.computedCount).toBe(1);
    expect(result.coverage).toMatchObject({ numerator: 1, denominator: 1 });
    expect(result.coverage.missing).toContain('non-finite-exposure-overflow');
    expect(result.warnings.join(' ')).toMatch(/at least one metric.*preserved/);
  });

  it('keeps zero OI an exact valid zero under extreme spot that overflows intermediates', () => {
    // Failing-before case: spot=1e308 with short-dated expiry makes the
    // gamma*spot*spot*0.01 intermediate overflow to Infinity before the *0
    // OI factor applies (Infinity * 0 = NaN -> null + false overflow warning).
    const envelope = {
      asOf: '2026-09-01T12:00:00.000Z',
      data: {
        symbol: 'Z',
        spot: 1e308,
        quotes: [
          { expiry: '2026-09-08', strike: 1e308, right: 'call', markIv: 0.01, openInterest: 0 },
        ],
      },
    };
    const inputs = { riskFreeRate: 0.04, carryRate: 0.01 };
    const greeks = buildGreeks(envelope, 'Z', inputs);
    // Scale eligibility holds and all Greeks are finite, so all four zeros apply.
    expect(greeks.data.points[0].delta).not.toBeNull();
    expect(greeks.data.points[0].gamma).not.toBeNull();
    const result = buildPositioning(envelope, 'Z', inputs);
    const point = result.data.points[0];
    for (const key of ['gex1PctUsd', 'dexUsd', 'vannaUsdPerUnitVol', 'charmUsdPerDay']) {
      expect(point[key] === 0, key).toBe(true);
    }
    expect(result.data.computedCount).toBe(1);
    expect(result.coverage.missing).not.toContain('non-finite-exposure-overflow');
  });

  it('fails negative OI at the contract boundary instead of scaling it', async () => {
    const envelope = {
      asOf: '2026-09-01T12:00:00.000Z',
      data: {
        symbol: 'SPY',
        spot: 500,
        quotes: [
          { expiry: '2027-09-01', strike: 500, right: 'call', markIv: 0.2, openInterest: -5 },
        ],
      },
    };
    const result = buildPositioning(envelope, 'SPY', { riskFreeRate: 0.04, carryRate: 0.01 });
    expect(result.data.points[0].gex1PctUsd).toBeNull();
    expect(result.coverage.missing).toContain('invalid-open-interest');
    const { validateContract } = await import('../../packages/contracts/src/runtime.js');
    // Negative openInterest violates the canonical schema (minimum 0): boundary failure, not a silent default.
    expect(validateContract('positioningResponse', {
      schemaVersion: 1,
      requestId: 'test',
      asOf: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      source: ['test'],
      provenanceByField: {},
      unitsByField: {},
      freshness: 'live',
      coverage: { numerator: 0, denominator: 1, state: 'partial', missing: ['invalid-open-interest'] },
      cache: { state: 'miss', hit: false, ageMs: 0, stale: false, coalesced: false, providerError: null },
      assumptions: [],
      warnings: [],
      data: result.data,
    }).valid).toBe(false);
  });
});
