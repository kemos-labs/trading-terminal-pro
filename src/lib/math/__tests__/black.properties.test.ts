import { describe, it, expect } from 'vitest';
import { priceEuropeanSpot } from '../spotBsm';
import { greeksEuropean } from '../greeks';
import type { DecimalRate, DecimalVol, YearFraction } from '../units';

describe('Black properties', () => {
  it('put-call parity', () => {
    const S=100, K=95, T=0.5 as YearFraction, r=0.05 as DecimalRate, q=0.02 as DecimalRate, vol=0.2 as DecimalVol;
    const c = priceEuropeanSpot('call', S,K,T,r,q,vol).price;
    const p = priceEuropeanSpot('put', S,K,T,r,q,vol).price;
    const fwd = S*Math.exp(((r as number)-(q as number))*(T as number));
    const df = Math.exp(-(r as number)*(T as number));
    // C - P = df*(F-K)
    expect(Math.abs((c-p) - df*(fwd-K))).toBeLessThan(1e-10);
  });
  it('price bounds', () => {
    const S=100, K=100, T=0.5 as YearFraction, r=0.05 as DecimalRate, q=0 as DecimalRate, vol=0.3 as DecimalVol;
    const c = priceEuropeanSpot('call', S,K,T,r,q,vol).price;
    const p = priceEuropeanSpot('put', S,K,T,r,q,vol).price;
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(S);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(K*Math.exp(-(r as number)*(T as number)));
  });
  it('call price decreasing in K, convex', () => {
    const S=100, T=0.5 as YearFraction, r=0.05 as DecimalRate, q=0 as DecimalRate, vol=0.3 as DecimalVol;
    const Ks=[80,90,100,110,120];
    const prices=Ks.map(K=>priceEuropeanSpot('call', S,K,T,r,q,vol).price);
    for(let i=1;i<prices.length;i++) expect(prices[i]!).toBeLessThanOrEqual(prices[i-1]!+1e-12);
    // convexity: second diff >=0
    for(let i=1;i<prices.length-1;i++) {
      const left=prices[i-1]!, mid=prices[i]!, right=prices[i+1]!;
      expect(mid - left).toBeLessThanOrEqual(right - mid + 1e-12 + 1e-10);
    }
  });
  it('gamma/vega positive and call/put equality', () => {
    const gC=greeksEuropean('call', 100,100,0.5 as YearFraction,0.05 as DecimalRate,0 as DecimalRate,0.3 as DecimalVol);
    const gP=greeksEuropean('put', 100,100,0.5 as YearFraction,0.05 as DecimalRate,0 as DecimalRate,0.3 as DecimalVol);
    expect(gC.gamma).toBeGreaterThan(0);
    expect(gC.vega).toBeGreaterThan(0);
    expect(Math.abs(gC.gamma - gP.gamma)).toBeLessThan(1e-12);
    expect(Math.abs(gC.vega - gP.vega)).toBeLessThan(1e-12);
  });
  it('finite difference delta vs bump', () => {
    const S=100, K=100, T=0.5 as YearFraction, r=0.05 as DecimalRate, q=0 as DecimalRate, vol=0.3 as DecimalVol;
    const g=greeksEuropean('call', S,K,T,r,q,vol);
    const eps=0.5;
    const up=priceEuropeanSpot('call', S+eps,K,T,r,q,vol).price;
    const dn=priceEuropeanSpot('call', S-eps,K,T,r,q,vol).price;
    const fd=(up-dn)/(2*eps);
    expect(Math.abs(fd - g.delta)).toBeLessThan(1e-3);
  });
});
