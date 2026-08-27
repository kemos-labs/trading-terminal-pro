import { describe, it, expect } from 'vitest';
import { toFundingSnapshot } from '../carry/funding';
import { computeBasis } from '../carry/basis';
import { forwardVol } from '../carry/forwardVol';

describe('carry vectors', () => {
  it('funding simple annualized = rate8h *1095', () => {
    const snap=toFundingSnapshot('Deribit','BTC-PERP',0.0001,Date.now());
    expect(snap.simpleAnnualizedRunRate).toBeCloseTo(0.1095,5);
    expect(snap.direction).toBe('longs_pay_shorts');
  });
  it('basis simple vs log', () => {
    const spot=50000, fut=50100, now=Date.now(), exp=now+30*24*3600*1000;
    const b=computeBasis(spot,fut,exp,now)!;
    expect(b.absolute).toBe(100);
    expect(b.percentage).toBeCloseTo(0.002,4);
    expect(b.simpleAnnualized).not.toBe(b.logAnnualized);
  });
  it('forward vol valid and null cases', () => {
    expect(forwardVol(0.5,0.25,0.6,0.5) !== null).toBe(true);
    expect(forwardVol(0.6,0.5,0.1,1.0)).toBeNull();
  });
});
