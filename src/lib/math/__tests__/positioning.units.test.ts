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

  it('rejects negative OI and applies a contracts multiplier exactly once when OI is absent', () => {
    const sign = () => 1 as const;
    expect(aggregateExposure([row('call', -1)], sign).total).toMatchObject({ coverageState: 'missing', gex: null });
    const converted = aggregateExposure([row('call', null, { contracts: 4, multiplier: 25 })], sign).total;
    expect(converted).toMatchObject({ coverageState: 'observed', coverage: 1 });
    expect(converted.gex).toBeCloseTo(0.01 * 100 * 100 * 100 * 0.01, 10);
    const observedWins = aggregateExposure([row('call', 3, { contracts: 4, multiplier: 25 })], sign).total;
    expect(observedWins.gex).toBeCloseTo(0.01 * 3 * 100 * 100 * 0.01, 10);
  });

  it('fails closed when spot is zero or negative', () => {
    const sign = () => 1 as const;
    for (const spot of [0, -100]) {
      expect(aggregateExposure([row('call', 10, { spot })], sign).total)
        .toMatchObject({ coverageState: 'missing', gex: null, dex: null });
    }
  });

  it('GEX satisfies the dollar-delta finite-difference identity', () => {
    // GEX (per 1% move) equals the change in delta-notional for a +1% spot move:
    // (delta + gamma*0.01*S)*Q*S - delta*Q*S = gamma*Q*S^2*0.01
    const r = row('call', 25, { gamma: 0.00012, delta: 0.42, spot: 60000 });
    const { total } = aggregateExposure([r], () => 1);
    const deltaNotionalAfter = (r.delta + r.gamma * 0.01 * r.spot) * 25 * r.spot;
    const deltaNotionalBefore = r.delta * 25 * r.spot;
    expect(total.gex).toBeCloseTo(deltaNotionalAfter - deltaNotionalBefore, 6);
    expect(total.dex).toBeCloseTo(r.delta * 25 * r.spot, 6);
  });

  it('vanna is per 1 vol point and charm is per day (raw → display adapters)', () => {
    const r = row('call', 10, { vannaRaw: 0.8, charmRaw: -7.3, spot: 50000 });
    const { total } = aggregateExposure([r], () => 1);
    // vannaRaw is per 1.0 vol → per vol point = *0.01, dollarized *Q*S
    expect(total.vanna).toBeCloseTo(0.8 * 0.01 * 10 * 50000, 6);
    // charmRaw is per year → per day = /365, dollarized *Q*S
    expect(total.charm).toBeCloseTo(-7.3 / 365 * 10 * 50000, 6);
  });

  it('all exposure outputs are finite numbers or null (never NaN/Infinity)', () => {
    const rows = [
      row('call', null), row('put', 0, { available: false }), row('call', 5, { gamma: 0.01 }),
      row('put', 7, { vannaRaw: NaN }), row('call', 3, { delta: Infinity }),
    ];
    const { total, perRow } = aggregateExposure(rows, r => (r.optionType === 'put' ? -1 : 1));
    const walk = (v: unknown): void => {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(perRow);
    walk(total);
  });

  it('required observed inputs missing do not become zero exposure', () => {
    const result = aggregateExposure([row('call', 10, { available: false })], r => r.optionType === 'put' ? -1 : 1);
    expect(result.total.gex).toBeNull();
    expect(result.total.coverageState).toBe('missing');
  });
});
