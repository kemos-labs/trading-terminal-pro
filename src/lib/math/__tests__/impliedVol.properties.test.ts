import { describe, it, expect } from 'vitest';
import { solveImpliedVol } from '../impliedVol';
import { priceEuropeanSpot } from '../spotBsm';
import type { DecimalRate, DecimalVol, YearFraction } from '../units';

describe('implied vol properties', () => {
  it('round-trip', () => {
    const S=100, K=100, T=0.5 as YearFraction, r=0.05 as DecimalRate, q=0 as DecimalRate, vol=0.25 as DecimalVol;
    const price=priceEuropeanSpot('call', S,K,T,r,q,vol).price;
    const iv=solveImpliedVol('call', S,K,T,r,q,price);
    expect(iv.ok).toBe(true);
    if(iv.ok) expect(Math.abs((iv.sigma as number)-0.25)).toBeLessThan(1e-6);
  });
  it('below intrinsic -> failure', () => {
    const res=solveImpliedVol('call', 100,90,0.5 as YearFraction,0.01 as DecimalRate,0 as DecimalRate, 0.1);
    // 0.1 may be below discounted intrinsic ~10? Actually call intrinsic ~10 discounted ~9.95, so 0.1 below
    expect(res.ok).toBe(false);
    if(!res.ok) expect(['below_intrinsic','invalid_input','expired'].includes(res.reason)).toBe(true);
  });
  it('expired returns expired', () => {
    const res=solveImpliedVol('call', 100,100,0 as YearFraction,0.05 as DecimalRate,0 as DecimalRate,5);
    expect(res.ok).toBe(false);
    if(!res.ok) expect(res.reason).toBe('expired');
  });
  it('repricing error within tolerance', () => {
    const S=100,K=110,T=1 as YearFraction,r=0.02 as DecimalRate,q=0 as DecimalRate,vol=0.3 as DecimalVol;
    const price=priceEuropeanSpot('put', S,K,T,r,q,vol).price;
    const iv=solveImpliedVol('put', S,K,T,r,q,price);
    expect(iv.ok).toBe(true);
    if(iv.ok) expect(iv.repricingError).toBeLessThan(1e-6);
  });
});
