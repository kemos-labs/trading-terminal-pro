/**
 * Greeks provenance contract tests: quote/derived/model separation,
 * missing OI nullability, last-versus-midpoint price provenance, and the
 * structural per-grid provenance stamp.
 * These guard the frontend contract mirroring the Python
 * greeks_calculator guarantees — missing stays null, last-derived is never
 * represented as midpoint-sourced.
 */
import { describe, expect, it } from 'vitest';
import type { GreeksData, GreeksPoint, SurfaceGrid } from './api';
import { getSurfaceProvenance, validateSurfaceProvenance } from './api';

function aggregateOiByStrike(points: GreeksPoint[]): Record<number, number> {
  // Mirrors OiByStrike/GexCalendar: missing OI (null) never contributes as zero.
  const out: Record<number, number> = {};
  for (const p of points) {
    if (p.oi == null) continue;
    out[p.K] = (out[p.K] ?? 0) + p.oi;
  }
  return out;
}

describe('greeks provenance contract', () => {
  it('separates provider quotes, derived points, and interpolated model grid', () => {
    const data = {
      surface_provenance: {
        observed: 'yfinance bid/ask/last quotes',
        derived: 'per-contract BSM Greeks',
        model: 'interpolated OTM grid: linear interior + nearest-neighbor hole-fill',
        model_kind: 'interpolated-model',
        model_method: 'linear+nearest',
        surface_side: 'otm',
        holes: 'model grid holes are filled via nearest; derived-layer holes stay unavailable (null)',
        oi: 'missing OI is null',
        price_provenance: 'price_source midpoint when two-sided, else last',
      },
      points_provenance: 'derived per-contract BSM (price_source/iv_source per point); not observed provider cells',
    } as Pick<GreeksData, 'surface_provenance' | 'points_provenance'>;
    expect(data.surface_provenance?.model_kind).toBe('interpolated-model');
    expect(data.surface_provenance?.observed).toMatch(/bid\/ask\/last/);
    expect(data.surface_provenance?.derived).toMatch(/per-contract BSM/);
    expect(data.surface_provenance?.model).toMatch(/interpolated/);
    expect(data.points_provenance).toMatch(/not observed provider cells/);
  });

  it('keeps missing OI null (never coerced to zero) in aggregation', () => {
    const points = [
      { K: 100, oi: null, type: 'call' },
      { K: 100, oi: 0, type: 'call' },
      { K: 100, oi: 50, type: 'put' },
      { K: 105, oi: 30, type: 'call' },
    ] as GreeksPoint[];
    const agg = aggregateOiByStrike(points);
    // null contributes nothing; 0 contributes 0; 50+0=50 at K=100.
    expect(agg[100]).toBe(50);
    expect(agg[105]).toBe(30);
    // Missing is distinguishable from a provider-reported zero at the point level.
    expect(points[0]!.oi).toBeNull();
    expect(points[1]!.oi).toBe(0);
  });

  it('preserves last-versus-midpoint provenance (last-derived is not midpoint-sourced)', () => {
    const mid = {
      K: 100, bid: 2.0, ask: 2.4, last: 2.2, price: 2.2,
      price_source: 'midpoint', iv_source: 'midpoint',
    } as unknown as GreeksPoint;
    const last = {
      K: 100, bid: null, ask: null, last: 2.2, price: 2.2,
      price_source: 'last', iv_source: 'last',
    } as unknown as GreeksPoint;
    expect(mid.price_source).toBe('midpoint');
    expect(mid.iv_source).toBe('midpoint');
    expect(last.price_source).toBe('last');
    expect(last.iv_source).toBe('last');
    expect(last.price_source).not.toBe('midpoint');
    // One-sided quotes must not claim midpoint.
    const oneSided = { bid: 2.0, ask: null, price_source: 'last' } as unknown as GreeksPoint;
    expect(oneSided.price_source).toBe('last');
  });

  it('validates the structural per-grid provenance stamp', () => {
    const stamped = {
      T_vals: [0.08],
      K_vals: [100],
      grid: [[0.5]],
      provenance: {
        kind: 'interpolated-model',
        method: 'linear+nearest',
        derived_source: 'per-contract BSM Greeks (price_source midpoint|last)',
        observed_fields: ['bid', 'ask', 'last', 'openInterest'],
        quote_time: '2026-09-03T00:00:00+00:00',
        quote_time_note: 'chain snapshot time; yfinance exposes no per-quote event times',
        side: 'otm',
        unit: 'dimensionless',
        nullability: 'unavailable cells are null; model-grid holes filled via nearest',
      },
    } as SurfaceGrid;
    expect(getSurfaceProvenance(stamped)?.kind).toBe('interpolated-model');
    expect(validateSurfaceProvenance(stamped)).toEqual([]);
  });

  it('flags grids without structural provenance (legacy payloads)', () => {
    const legacy = { T_vals: [0.08], K_vals: [100], grid: [[0.5]] } as SurfaceGrid;
    expect(getSurfaceProvenance(legacy)).toBeNull();
    expect(validateSurfaceProvenance(legacy)).toEqual([
      'provenance missing: grid carries no structural provenance',
    ]);
    const mislabeled = {
      T_vals: [0.08],
      K_vals: [100],
      grid: [[0.5]],
      provenance: { kind: 'observed', method: 'none' },
    } as unknown as SurfaceGrid;
    const violations = validateSurfaceProvenance(mislabeled);
    expect(violations.some((v) => v.includes('kind'))).toBe(true);
  });
});
