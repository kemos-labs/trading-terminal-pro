import { describe, it, expect } from 'vitest';
import { priceGreeksMarket } from '../adapters';
import { priceEuropeanSpot } from '../spotBsm';
import { greeksEuropean } from '../greeks';
import { solveImpliedVol } from '../impliedVol';
import { fitSVI } from '../surface/sviFit';
import type { DecimalRate, DecimalVol, YearFraction } from '../units';

describe('boundary: expiry / zero vol / invalid time', () => {
  it('T=0 prices discounted intrinsic and reports intrinsic delta', () => {
    const c = priceGreeksMarket('call', 100, 90, 0, 0.05, 0.01, 0.2);
    const p = priceGreeksMarket('put', 100, 110, 0, 0.05, 0.01, 0.2);
    // At expiry: intrinsic — no discounting survives T=0
    expect(c.price).toBeCloseTo(10, 10);
    expect(c.delta).toBe(1);
    expect(p.price).toBeCloseTo(10, 10);
    expect(p.delta).toBe(-1);
    expect(c.gamma).toBe(0);
    expect(c.vega).toBe(0);
    expect(p.gamma).toBe(0);
    expect(p.vega).toBe(0);
  });

  it('ATM at expiry uses 0.5 intrinsic delta convention', () => {
    const c = priceGreeksMarket('call', 100, 100, 0, 0.05, 0.01, 0.2);
    const p = priceGreeksMarket('put', 100, 100, 0, 0.05, 0.01, 0.2);
    expect(c.price).toBeCloseTo(0, 12);
    expect(c.delta).toBe(0.5);
    expect(p.delta).toBe(-0.5);
  });

  it('zero vol prices discounted intrinsic (not NaN)', () => {
    const S=100, K=95, T=0.5, r=0.05, q=0.02;
    const c = priceGreeksMarket('call', S, K, T, r, q, 0);
    const p = priceGreeksMarket('put', S, K, T, r, q, 0);
    const expC = Math.max(0, S * Math.exp(-q * T) - K * Math.exp(-r * T));
    const expP = Math.max(0, K * Math.exp(-r * T) - S * Math.exp(-q * T));
    expect(c.price).toBeCloseTo(expC, 10);
    expect(p.price).toBeCloseTo(expP, 10);
    expect(c.vega).toBe(0);
    expect(c.gamma).toBe(0);
  });

  it('invalid time / non-finite inputs fail closed to zeros, never NaN', () => {
    for (const g of [
      priceGreeksMarket('call', 100, 100, -1, 0.05, 0.01, 0.2),
      priceGreeksMarket('call', 100, 100, Number.NaN, 0.05, 0.01, 0.2),
      priceGreeksMarket('call', Number.NaN, 100, 0.25, 0.05, 0.01, 0.2),
      priceGreeksMarket('call', 100, 100, 0.25, Number.POSITIVE_INFINITY, 0.01, 0.2),
      priceGreeksMarket('call', -5, 100, 0.25, 0.05, 0.01, 0.2),
    ]) {
      for (const k of ['price','delta','gamma','theta','vega','rho','vanna','volga','charm','speed','veta','color','zomma','ultima'] as const) {
        expect(Number.isFinite(g[k])).toBe(true);
      }
    }
  });

  it('deep ITM call delta → 1, deep OTM call delta → 0', () => {
    const deepItm = priceGreeksMarket('call', 100, 1, 0.25, 0.05, 0.01, 0.2);
    const deepOtm = priceGreeksMarket('call', 100, 500, 0.25, 0.05, 0.01, 0.2);
    expect(deepItm.delta).toBeGreaterThan(0.99);
    expect(deepOtm.delta).toBeLessThan(0.01);
    // ITM price ≥ discounted intrinsic (no arbitrage)
    expect(deepItm.price).toBeGreaterThanOrEqual(100 * Math.exp(-0.01 * 0.25) - 1 * Math.exp(-0.05 * 0.25) - 1e-9);
  });
});

describe('boundary: implied vol solver', () => {
  it('expired (T<=0) returns expired reason — no proxy', () => {
    const res = solveImpliedVol('call', 100, 100, 0 as YearFraction, 0.05 as DecimalRate, 0 as DecimalRate, 5);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('expired');
  });

  it('price below intrinsic returns below_intrinsic', () => {
    const res = solveImpliedVol('call', 100, 90, 0.25 as YearFraction, 0.05 as DecimalRate, 0 as DecimalRate, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('below_intrinsic');
  });

  it('inversion round-trips exactly', () => {
    const S=100, K=100, T=0.3, r=0.05, q=0.01, vol=0.35;
    const price = priceEuropeanSpot('call', S, K, T as YearFraction, r as DecimalRate, q as DecimalRate, vol as DecimalVol).price;
    const res = solveImpliedVol('call', S, K, T as YearFraction, r as DecimalRate, q as DecimalRate, price);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.sigma as unknown as number).toBeCloseTo(vol, 8);
  });
});

describe('boundary: charm against finite difference and put/call dividend terms', () => {
  it('charm matches -dΔ/dT by central finite difference', () => {
    const S=105, K=100, T=0.5, r=0.06, q=0.02, vol=0.3;
    const h = 1e-4;
    const up = greeksEuropean('call', S, K, (T + h) as YearFraction, r as DecimalRate, q as DecimalRate, vol as DecimalVol).delta;
    const dn = greeksEuropean('call', S, K, (T - h) as YearFraction, r as DecimalRate, q as DecimalRate, vol as DecimalVol).delta;
    const fd = -(up - dn) / (2 * h);
    const charm = greeksEuropean('call', S, K, T as YearFraction, r as DecimalRate, q as DecimalRate, vol as DecimalVol).charm;
    expect(Math.abs(charm - fd)).toBeLessThan(1e-4);
  });

  it('put charm is finite and distinct from call charm with q>0', () => {
    const c = greeksEuropean('call', 100, 100, 0.25 as YearFraction, 0.05 as DecimalRate, 0.02 as DecimalRate, 0.25 as DecimalVol);
    const p = greeksEuropean('put', 100, 100, 0.25 as YearFraction, 0.05 as DecimalRate, 0.02 as DecimalRate, 0.25 as DecimalVol);
    expect(Number.isFinite(c.charm)).toBe(true);
    expect(Number.isFinite(p.charm)).toBe(true);
    // Haug: charm_call − charm_put = q·e^{−qT} (dividend term flips ± q N(±d1))
    const d = c.charm - p.charm;
    expect(d).toBeCloseTo(0.02 * Math.exp(-0.02 * 0.25), 6);
  });
});

describe('boundary: SVI fit under degenerate input', () => {
  it('fewer than 5 strikes → null', () => {
    expect(fitSVI([90, 100], [0.2, 0.22], 100, 0.25)).toBeNull();
  });

  it('non-positive spot → null', () => {
    expect(fitSVI([80, 85, 90, 95, 100, 105], [0.2,0.2,0.2,0.2,0.2,0.2], 0, 0.25)).toBeNull();
  });

  it('iv nulls are skipped and never poison the fit', () => {
    const fit = fitSVI([80, 85, 90, 95, 100, 105, 110], [null, 0.2, 0.2, 0.2, 0.2, 0.2, null], 100, 0.25);
    expect(fit).not.toBeNull();
    if (fit) {
      expect(fit.samples).toBe(5); // 5 valid — nulls skipped
      expect(fit.rmse).toBeLessThan(1e-3);
    }
  });
});