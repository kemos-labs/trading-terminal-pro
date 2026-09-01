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
    expect(result.data.points[0].gex1PctUsd).toBeGreaterThan(0);
    expect(result.data.points[1]).toMatchObject({ openInterest: null, oiState: 'missing', gex1PctUsd: null });
    expect(result.data.points[2].gex1PctUsd).toBeNull();
    expect(result.coverage.missing).toContain('openInterest');
  });
});
