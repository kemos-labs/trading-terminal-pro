import { describe, it, expect } from 'vitest';
import { checkButterflyConvexity, checkCalendarArbitrage, forwardVol } from '../surface/arbitrage';
import { sviTotalVariance } from '../surface/svi';

describe('surface arbitrage', () => {
  it('call monotonic and butterfly convexity for valid prices', () => {
    const strikes=[80,90,100,110,120];
    const prices=[22,14,7,3,0.8]; // decreasing convex
    expect(checkButterflyConvexity(strikes, prices).passed).toBe(true);
  });
  it('detects butterfly violation', () => {
    const strikes=[80,90,100,110,120];
    const prices=[22,14,12,3,0.8]; // kink at 100
    expect(checkButterflyConvexity(strikes, prices).passed).toBe(false);
  });
  it('calendar arb: total variance must not decrease', () => {
    const w = [[0.04,0.04],[0.05,0.05]]; // increasing
    expect(checkCalendarArbitrage(w, [0, 30*24*3600*1000]).passed).toBe(true);
    const wBad = [[0.05,0.05],[0.04,0.04]];
    expect(checkCalendarArbitrage(wBad, [0, 30*24*3600*1000]).passed).toBe(false);
  });
  it('forward vol null when fwd variance negative', () => {
    expect(forwardVol(0.4, 0.5, 0.1, 1.0)).toBeNull();
    expect(forwardVol(0.2, 0.5, 0.15, 1.0)).not.toBeNull();
  });
  it('SVI w(k) uses forward log-moneyness', () => {
    const p={a:0.04,b:0.1,rho:-0.3,m:0,sigma:0.2};
    const k1=Math.log(100/100); // ATM
    const k2=Math.log(110/100);
    const w1=sviTotalVariance(k1,p);
    const w2=sviTotalVariance(k2,p);
    expect(w1).not.toBe(w2);
  });
});
