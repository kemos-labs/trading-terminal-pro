import { describe, expect, it } from 'vitest';
import { aggregateExposure, type PositionRow } from '../../lib/math/positioning/exposure';

const row = (oi: number | null, optionType: 'call' | 'put' = 'call'): PositionRow => ({
  optionType, strike: 100, expiryMs: 1, oi, gamma: 0.01, delta: 0.5,
  vannaRaw: 0, charmRaw: 0, spot: 100,
});

/** Coverage assertions exercise the production aggregator, not locally hardcoded labels. */
describe('Positioning OI coverage', () => {
  const sign = (r: PositionRow) => r.optionType === 'put' ? -1 as const : 1 as const;

  it('reports missing OI as missing and null exposure', () => {
    const result = aggregateExposure([row(null)], sign);
    expect(result.total.coverageState).toBe('missing');
    expect(result.total.coverage).toBe(0);
    expect(result.total.gex).toBeNull();
    expect(result.perRow[0]?.coverageState).toBe('missing');
  });

  it('reports actual zero OI as observed-zero', () => {
    const result = aggregateExposure([row(0)], sign);
    expect(result.total.coverageState).toBe('observed-zero');
    expect(result.total.coverage).toBe(1);
    expect(result.total.gex).toBe(0);
  });

  it('reports mixed observed and missing rows as partial', () => {
    const result = aggregateExposure([row(100), row(null, 'put')], sign);
    expect(result.total.coverageState).toBe('partial');
    expect(result.total.coverage).toBe(0.5);
    expect(result.total.gex).not.toBeNull();
  });

  it('does not silently change OI weighting to volume or unit weighting', () => {
    const result = aggregateExposure([row(null)], sign);
    expect(result.total.missingOiCount).toBe(1);
    expect(result.total.gex).toBeNull();
  });
});
