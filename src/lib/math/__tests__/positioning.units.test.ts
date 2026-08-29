import { describe, it, expect } from 'vitest';
import { aggregateExposure, type PositionRow } from '../positioning/exposure';

const row = (optionType: 'call' | 'put', oi: number | null, overrides: Partial<PositionRow> = {}): PositionRow => ({
  optionType, strike: 100, expiryMs: 1, oi, gamma: 0.01, delta: optionType === 'call' ? 0.5 : -0.5,
  vannaRaw: 0.1, charmRaw: -0.2, spot: 100, ...overrides,
});

describe('positioning units and provenance', () => {
  it('GEX per 1% = gamma * Q * S^2 * 0.01', () => {
    const { total } = aggregateExposure([row('call', 10, { gamma: 0.0002, spot: 50000 })], r => r.optionType === 'put' ? -1 : 1);
    expect(total.gex).toBeCloseTo(0.0002 * 10 * 50000 * 50000 * 0.01, 6);
  });

  it('applies the sign to each actual duplicate strike/expiry call and put row', () => {
    const rows = [row('call', 10), row('put', 10)];
    const { total } = aggregateExposure(rows, r => r.optionType === 'put' ? -1 : 1);
    expect(total.gex).toBe(0);
    expect(total.dex).toBe(1000);
    expect(total.coverageState).toBe('observed');
    expect(aggregateExposure(rows, r => r.optionType === 'put' ? -1 : 1).perRow.map(r => r.gex)).toEqual([10, -10]);
    expect(total.vanna).toBe(0);
    expect(total.charm).toBe(0);
  });

  it('missing OI is unavailable while observed zero remains observed-zero', () => {
    const sign = (r: PositionRow) => r.optionType === 'put' ? -1 as const : 1 as const;
    expect(aggregateExposure([row('call', null)], sign).total).toMatchObject({ coverage: 0, missingOiCount: 1, coverageState: 'missing', gex: null });
    expect(aggregateExposure([row('call', 0)], sign).total).toMatchObject({ coverage: 1, missingOiCount: 0, coverageState: 'observed-zero', gex: 0 });
    expect(aggregateExposure([row('call', null), row('put', 5)], sign).total.coverageState).toBe('partial');
  });

  it('required observed inputs missing do not become zero exposure', () => {
    const result = aggregateExposure([row('call', 10, { available: false })], r => r.optionType === 'put' ? -1 : 1);
    expect(result.total.gex).toBeNull();
    expect(result.total.coverageState).toBe('missing');
  });
});
