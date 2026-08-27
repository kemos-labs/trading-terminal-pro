import { describe, it, expect } from 'vitest';
import { aggregateExposure } from '../positioning/exposure';

describe('positioning units', () => {
  it('GEX per 1% = gamma * Q * S^2 *0.01', () => {
    const rows=[{strike:50000, expiryMs:Date.now()+30*864e5, oi:10, gamma:0.0002, delta:0.5, vannaRaw:0.1, charmRaw:-0.2, spot:50000}];
    const { total } = aggregateExposure(rows, ()=>1);
    const expected=0.0002*10*50000*50000*0.01;
    expect(total.gex).toBeCloseTo(expected, 6);
  });
  it('missing OI returns null not fallback', () => {
    const rows=[{strike:50000, expiryMs:0, oi:null, gamma:0.0002, delta:0.5, vannaRaw:0, charmRaw:0, spot:50000}];
    const { total, perRow } = aggregateExposure(rows, ()=>1);
    expect(perRow[0]!.gex).toBeNull();
    expect(total.coverage).toBe(0);
    expect(total.missingOiCount).toBe(1);
  });
  it('DEX = delta*Q*S', () => {
    const rows=[{strike:50000, expiryMs:0, oi:5, gamma:0, delta:0.6, vannaRaw:0, charmRaw:0, spot:50000}];
    const { total } = aggregateExposure(rows, ()=>1);
    expect(total.dex).toBe(0.6*5*50000);
  });
});
