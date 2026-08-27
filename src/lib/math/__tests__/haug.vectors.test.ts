import { describe, it, expect } from 'vitest';
import { priceEuropeanSpot } from '../spotBsm';
import { greeksEuropean } from '../greeks';
import type { DecimalRate, DecimalVol, YearFraction } from '../units';

function approx(a: number, b: number, eps = 1e-3) {
  return Math.abs(a - b) <= eps;
}

describe('Haug / QuantLib vectors (rounded, tolerance 1e-3)', () => {
  it('call price S60 K65 q0 r08 T025 sigma30 → 2.1334', () => {
    const { price } = priceEuropeanSpot('call', 60, 65, 0.25 as YearFraction, 0.08 as DecimalRate, 0 as DecimalRate, 0.30 as DecimalVol);
    expect(approx(price, 2.1334, 0.005)).toBe(true);
  });
  it('put price S100 K95 q05 r10 T05 sigma20 → 2.4648', () => {
    const { price } = priceEuropeanSpot('put', 100, 95, 0.5 as YearFraction, 0.10 as DecimalRate, 0.05 as DecimalRate, 0.20 as DecimalVol);
    expect(approx(price, 2.4648, 0.005)).toBe(true);
  });
  it('call/put S19 K19 q10 r10 T075 sigma28 → 1.7011 each', () => {
    const c = priceEuropeanSpot('call', 19, 19, 0.75 as YearFraction, 0.10 as DecimalRate, 0.10 as DecimalRate, 0.28 as DecimalVol);
    const p = priceEuropeanSpot('put', 19, 19, 0.75 as YearFraction, 0.10 as DecimalRate, 0.10 as DecimalRate, 0.28 as DecimalVol);
    expect(approx(c.price, 1.7011, 0.005)).toBe(true);
    expect(approx(p.price, 1.7011, 0.005)).toBe(true);
  });
  it('call delta S105 K100 q10 r10 T05 sigma36 → 0.5946', () => {
    const g = greeksEuropean('call', 105, 100, 0.5 as YearFraction, 0.10 as DecimalRate, 0.10 as DecimalRate, 0.36 as DecimalVol);
    expect(approx(g.delta, 0.5946, 0.005)).toBe(true);
  });
  it('put delta same → -0.3566', () => {
    const g = greeksEuropean('put', 105, 100, 0.5 as YearFraction, 0.10 as DecimalRate, 0.10 as DecimalRate, 0.36 as DecimalVol);
    expect(approx(g.delta, -0.3566, 0.005)).toBe(true);
  });
  it('gamma S55 K60 q0 r10 T075 sigma30 → 0.0278', () => {
    const g = greeksEuropean('call', 55, 60, 0.75 as YearFraction, 0.10 as DecimalRate, 0 as DecimalRate, 0.30 as DecimalVol);
    expect(approx(g.gamma, 0.0278, 0.001)).toBe(true);
  });
  it('raw vega same → 18.9358', () => {
    const g = greeksEuropean('call', 55, 60, 0.75 as YearFraction, 0.10 as DecimalRate, 0 as DecimalRate, 0.30 as DecimalVol);
    expect(approx(g.vega, 18.9358, 0.02)).toBe(true);
  });
  it('put theta/year S430 K405 q05 r07 T1/12 sigma20 → -31.1924', () => {
    const g = greeksEuropean('put', 430, 405, (1/12) as YearFraction, 0.07 as DecimalRate, 0.05 as DecimalRate, 0.20 as DecimalVol);
    expect(approx(g.theta, -31.1924, 0.05)).toBe(true);
    expect(approx(g.theta/365, -0.0855, 0.001)).toBe(true);
  });
  it('raw call rho S72 K75 q0 r09 T1 sigma19 → 38.7325', () => {
    const g = greeksEuropean('call', 72, 75, 1 as YearFraction, 0.09 as DecimalRate, 0 as DecimalRate, 0.19 as DecimalVol);
    expect(approx(g.rho, 38.7325, 0.05)).toBe(true);
  });
});
