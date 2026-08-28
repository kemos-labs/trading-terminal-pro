import { describe, it, expect } from 'vitest';
import { priceGreeksMarket } from '../math/adapters';

/**
 * Unit matrix — Terminal TS `priceGreeksMarket` vs MacroVol Python `compute_greeks`
 * (canonical math/greeks + named adapters in math/adapters.ts).
 *
 * | Quantity | Terminal TS | MacroVol Python | Required |
 * |----------|-------------|-----------------|----------|
 * | θ        | /365 day    | /365 day        | match    |
 * | charm    | /365 day    | /365 day        | match    |
 * | ν        | /100 (1vol) | /100            | match    |
 * | side     | OTM put K&lt;S, call K≥S | otm_points | match |
 * | vanna    | raw ∂²V/∂S∂σ | same          | match    |
 *
 * Golden values generated from Python `services.greeks_calculator.compute_greeks`
 * (rounded as the API returns). TS is full-precision; compare within round tol.
 */

/** Fixtures from MacroVol Python (rounded output of compute_greeks). */
const PYTHON_GOLDEN = [
  {
    type: 'call' as const,
    S: 100, K: 100, T: 0.25, r: 0.05, q: 0.01, sigma: 0.2,
    greeks: { delta: 0.5582, gamma: 0.039349, vega: 0.1967, theta: -0.0271, vanna: -0.0984, charm: -0.000308 },
  },
  {
    type: 'put' as const,
    S: 100, K: 95, T: 0.5, r: 0.04, q: 0.02, sigma: 0.25,
    greeks: { delta: -0.3284, gamma: 0.020325, vega: 0.2541, theta: -0.0151, vanna: -0.3713, charm: 0.000125 },
  },
  {
    type: 'call' as const,
    S: 450, K: 460, T: 30 / 365, r: 0.045, q: 0.012, sigma: 0.18,
    greeks: { delta: 0.3637, gamma: 0.016157, vega: 0.484, theta: -0.1593, vanna: 0.832, charm: -0.003141 },
  },
  {
    type: 'put' as const,
    S: 450, K: 440, T: 60 / 365, r: 0.045, q: 0.012, sigma: 0.22,
    greeks: { delta: -0.3597, gamma: 0.009306, vega: 0.6815, theta: -0.109, vanna: -0.4553, charm: 0.000444 },
  },
  {
    type: 'call' as const,
    S: 100, K: 110, T: 1.0, r: 0.03, q: 0.0, sigma: 0.3,
    greeks: { delta: 0.473, gamma: 0.013268, vega: 0.398, theta: -0.0195, vanna: 0.4879, charm: -0.00031 },
  },
];

describe('greeks unit matrix (TS ↔ MacroVol Python)', () => {
  it.each(PYTHON_GOLDEN)(
    'matches Python golden for $type S=$S K=$K',
    (c) => {
      const g = priceGreeksMarket(c.type, c.S, c.K, c.T, c.r, c.q, c.sigma);
      // Python rounds delta/vega/theta/vanna to 4 dp; gamma/charm to 6 dp
      expect(g.delta).toBeCloseTo(c.greeks.delta, 3);
      expect(g.gamma).toBeCloseTo(c.greeks.gamma, 5);
      expect(g.vega).toBeCloseTo(c.greeks.vega, 3);
      expect(g.theta).toBeCloseTo(c.greeks.theta, 3);
      expect(g.vanna).toBeCloseTo(c.greeks.vanna, 3);
      expect(g.charm).toBeCloseTo(c.greeks.charm, 5);
    },
  );

  it('scales θ and charm as calendar-day (raw/365), not annual', () => {
    const g = priceGreeksMarket('call', 100, 100, 0.25, 0.05, 0.01, 0.2);
    // Annual θ would be ~10× larger magnitude than typical daily θ
    expect(Math.abs(g.theta)).toBeLessThan(1);
    expect(Math.abs(g.charm)).toBeLessThan(0.01);
    // θ is negative for long ATM call
    expect(g.theta).toBeLessThan(0);
  });

  it('scales ν per 1 vol point (raw/100)', () => {
    const g = priceGreeksMarket('call', 100, 100, 0.25, 0.05, 0.01, 0.2);
    // Raw vega S·φ·√T ~ 20 for these inputs; /100 → ~0.2
    expect(g.vega).toBeGreaterThan(0.05);
    expect(g.vega).toBeLessThan(2);
  });

  it('returns finite zeros (not NaN) for T<=0 or vol<=0', () => {
    for (const g of [
      priceGreeksMarket('call', 100, 100, 0, 0.05, 0.01, 0.2),
      priceGreeksMarket('put', 100, 100, 0.25, 0.05, 0.01, 0),
      priceGreeksMarket('call', 100, 100, -1, 0.05, 0.01, 0.2),
      priceGreeksMarket('call', NaN, 100, 0.25, 0.05, 0.01, 0.2),
    ]) {
      expect(Number.isFinite(g.delta)).toBe(true);
      expect(Number.isFinite(g.gamma)).toBe(true);
      expect(Number.isFinite(g.vega)).toBe(true);
      expect(g.gamma).toBe(0);
      expect(g.vega).toBe(0);
    }
  });

  it('vanna is raw ∂²V/∂S∂σ (not /100)', () => {
    const g = priceGreeksMarket('call', 100, 100, 0.25, 0.05, 0.01, 0.2);
    // ATM vanna near 0; finite and not volga-scale
    expect(Number.isFinite(g.vanna)).toBe(true);
    expect(Math.abs(g.vanna)).toBeLessThan(5);
  });
});

/** OTM market convention — mirrors Python otm_points. */
export function otmSide(type: 'call' | 'put', K: number, spot: number): boolean {
  if (type === 'put') return K < spot;
  return K >= spot;
}

describe('OTM side convention', () => {
  it('put wing K < S, call wing K ≥ S', () => {
    const spot = 100;
    expect(otmSide('put', 90, spot)).toBe(true);
    expect(otmSide('put', 100, spot)).toBe(false);
    expect(otmSide('call', 100, spot)).toBe(true);
    expect(otmSide('call', 110, spot)).toBe(true);
    expect(otmSide('call', 90, spot)).toBe(false);
  });
});
