/**
 * 3D Greeks geometry truth tests (pure data helper — no WebGL needed).
 * Proves: holes stay holes, observed nodes finite, diverging zero-centered
 * ramp, ATM nearest-strike ridge, no NaN/Infinity anywhere.
 */
import { describe, expect, it } from 'vitest';
import { buildGreekSurface3DData } from './greeksSurface3dData';
import type { SurfaceGrid } from '../../lib/macrovol/api';

const grid: SurfaceGrid = {
  T_vals: [0.08, 0.16, 0.33],
  K_vals: [95, 100, 105, 110],
  grid: [
    [-0.4, -0.2, 0.3, null],       // hole at 110
    [null, -0.1, 0.1, 0.4],        // hole at 95
    [-0.3, 0.0, 0.2, 0.5],         // 0.0 present for diverging midpoint
  ],
};

describe('buildGreekSurface3DData', () => {
  it('preserves holes: null cells never become nodes', () => {
    const d = buildGreekSurface3DData(grid, 100, true);
    // 3x4 grid has 12 cells; two nulls → 10 observed nodes.
    expect(d.points).toHaveLength(10);
    expect(d.points.every((p) => Number.isFinite(p.value))).toBe(true);
    // Nulls remain null in the values layout.
    expect(d.values[0]?.[3]).toBeNull();
    expect(d.values[1]?.[0]).toBeNull();
  });

  it('outputs no NaN or Infinity anywhere', () => {
    const d = buildGreekSurface3DData(grid, 100, true);
    const json = JSON.stringify(d);
    expect(json).not.toContain('NaN');
    expect(json).not.toContain('Infinity');
    expect(d.points.every((p) => [p.x, p.y, p.z].every(Number.isFinite))).toBe(true);
  });

  it('uses a zero-centered t for diverging Greeks (v=0 at ramp midpoint)', () => {
    const d = buildGreekSurface3DData(grid, 100, true);
    const zero = d.points.find((p) => p.value === 0);
    expect(zero).toBeDefined();
    // v=0 → t=0.5 → z = 0.5 * GREEK3D_H (0.8)
    expect(zero!.z).toBeCloseTo(d.rampMidpoint * 1.6, 6);
    // color at midpoint is the near-white center of the ramp
    expect(zero!.color[0]).toBeGreaterThan(0.9);
    expect(zero!.color[1]).toBeGreaterThan(0.9);
  });

  it('sequential Greeks map over observed [lo, hi]', () => {
    const d = buildGreekSurface3DData(grid, 100, false);
    expect(d.zTicks.every((t) => t >= d.lo - 1e-9 && t <= d.hi + 1e-9)).toBe(true);
    const minNode = d.points.reduce((a, b) => (a.value < b.value ? a : b));
    // min maps to t=0 → z=0
    expect(minNode.z).toBeCloseTo(0, 6);
  });

  it('ATM ridge takes the nearest-strike observed node per expiry', () => {
    const d = buildGreekSurface3DData(grid, 100, true);
    expect(d.atmRidge).toHaveLength(d.dtes.length);
    // Every expiry has strike 100 observed and spot is 100 → ridge strike is 100.
    expect(d.atmRidge.every((p) => p.x === d.atmX)).toBe(true);
  });

  it('returns hasObserved false only when every cell is missing', () => {
    const empty: SurfaceGrid = {
      T_vals: [0.08, 0.16],
      K_vals: [95, 100],
      grid: [[null, null], [null, null]],
    };
    const d = buildGreekSurface3DData(empty, 100, true);
    expect(d.hasObserved).toBe(false);
    expect(d.points).toHaveLength(0);
    expect(d.atmRidge).toHaveLength(0);
  });
});