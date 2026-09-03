/**
 * 3D Greeks geometry truth tests (pure data helper — no WebGL needed).
 * Proves: holes stay holes, observed nodes finite, diverging zero-centered
 * ramp, ATM nearest-strike ridge, no NaN/Infinity anywhere.
 */
import { describe, expect, it } from 'vitest';
import { buildGreekSurface3DData, buildGreekWireframeIndices, greekValueToHeight, rampTDiverging, GREEK3D_H } from './greeksSurface3dData';
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

describe('rampTDiverging signed normalization (P0 golden)', () => {
  it('maps negative values to the lower half (t < 0.5)', () => {
    expect(rampTDiverging(-1, 1)).toBeCloseTo(0, 9);
    expect(rampTDiverging(-0.5, 1)).toBeCloseTo(0.25, 9);
    expect(rampTDiverging(-0.2, 0.5)).toBeCloseTo(0.3, 9);
  });

  it('maps zero to the ramp midpoint (t = 0.5)', () => {
    expect(rampTDiverging(0, 1)).toBeCloseTo(0.5, 9);
    expect(rampTDiverging(0, 10)).toBeCloseTo(0.5, 9);
    expect(rampTDiverging(0, 0)).toBeCloseTo(0.5, 9);
  });

  it('maps positive values to the upper half (t > 0.5)', () => {
    expect(rampTDiverging(1, 1)).toBeCloseTo(1, 9);
    expect(rampTDiverging(0.5, 1)).toBeCloseTo(0.75, 9);
    expect(rampTDiverging(0.2, 0.5)).toBeCloseTo(0.7, 9);
  });

  it('handles asymmetric bounds via maxAbs without flipping sign', () => {
    // lo=-2, hi=10 -> maxAbs=10: -2 maps below midpoint, +10 maps to top.
    expect(rampTDiverging(-2, 10)).toBeCloseTo(0.4, 9);
    expect(rampTDiverging(10, 10)).toBeCloseTo(1, 9);
    expect(rampTDiverging(-10, 10)).toBeCloseTo(0, 9);
    // Asymmetric negative-heavy: lo=-8, hi=2 -> maxAbs=8
    expect(rampTDiverging(-8, 8)).toBeCloseTo(0, 9);
    expect(rampTDiverging(2, 8)).toBeCloseTo(0.625, 9);
  });

  it('handles all-zero domain (maxAbs fallback) without NaN', () => {
    const allZero: SurfaceGrid = {
      T_vals: [0.08, 0.16],
      K_vals: [95, 100],
      grid: [[0, 0], [0, 0]],
    };
    const d = buildGreekSurface3DData(allZero, 100, true);
    expect(d.hasObserved).toBe(true);
    expect(d.maxAbs).toBe(1);
    for (const p of d.points) {
      expect(p.z).toBeCloseTo(0.5 * GREEK3D_H, 9);
      expect(Number.isFinite(p.z)).toBe(true);
    }
    expect(rampTDiverging(0, 0)).toBeCloseTo(0.5, 9);
  });

  it('builds diverging node heights with correct sign ordering', () => {
    const signed: SurfaceGrid = {
      T_vals: [0.08],
      K_vals: [95, 100, 105],
      grid: [[-0.5, 0, 0.5]],
    };
    const d = buildGreekSurface3DData(signed, 100, true);
    const byValue = [...d.points].sort((a, b) => a.value - b.value);
    expect(byValue.map((p) => p.value)).toEqual([-0.5, 0, 0.5]);
    // Heights must be strictly increasing with value when diverging.
    expect(byValue[0]!.z).toBeLessThan(byValue[1]!.z);
    expect(byValue[1]!.z).toBeLessThan(byValue[2]!.z);
    expect(byValue[0]!.z).toBeCloseTo(0, 9);
    expect(byValue[1]!.z).toBeCloseTo(0.5 * GREEK3D_H, 9);
    expect(byValue[2]!.z).toBeCloseTo(GREEK3D_H, 9);
  });
});

describe('greek wireframe holes (P0 geometry)', () => {
  it('emits no triangles when a quad has any missing vertex', () => {
    // 2x2 with one hole -> zero triangles (would be 2 triangles if bridged).
    expect(buildGreekWireframeIndices([[1, 2], [3, null]])).toEqual([]);
    expect(buildGreekWireframeIndices([[1, null], [3, 4]])).toEqual([]);
    expect(buildGreekWireframeIndices([[null, 2], [3, 4]])).toEqual([]);
    expect(buildGreekWireframeIndices([[1, 2], [null, 4]])).toEqual([]);
  });

  it('emits both triangles only for a fully observed quad', () => {
    const idx = buildGreekWireframeIndices([[1, 2], [3, 4]]);
    expect(idx).toHaveLength(6);
    // Indices reference the four quad vertices exactly once per triangle.
    expect(new Set(idx).size).toBe(4);
  });

  it('preserves a central hole across a 3x3 grid', () => {
    const values: (number | null)[][] = [
      [1, 2, 3],
      [4, null, 6],
      [7, 8, 9],
    ];
    const idx = buildGreekWireframeIndices(values);
    // 4 quads touch the central hole -> all suppressed -> zero triangles.
    expect(idx).toHaveLength(0);
  });

  it('keeps intact quads while suppressing holed quads', () => {
    const values: (number | null)[][] = [
      [1, 2, 3],
      [4, 5, null],
      [7, 8, 9],
    ];
    const idx = buildGreekWireframeIndices(values);
    // Two quads remain fully observed: top-left (0,1,3,4) and bottom-left
    // (3,4,6,7). The two quads touching the (1,2) hole are suppressed.
    expect(idx).toHaveLength(12);
    expect(idx).toEqual([0, 1, 3, 1, 4, 3, 3, 4, 6, 4, 7, 6]);
  });

  it('uses the shared diverging ramp for wireframe heights (no z=0 fabrication)', () => {
    const lo = -0.5;
    const hi = 0.5;
    const maxAbs = 0.5;
    expect(greekValueToHeight(-0.5, true, lo, hi, maxAbs)).toBeCloseTo(0, 9);
    expect(greekValueToHeight(0, true, lo, hi, maxAbs)).toBeCloseTo(0.5 * GREEK3D_H, 9);
    expect(greekValueToHeight(0.5, true, lo, hi, maxAbs)).toBeCloseTo(GREEK3D_H, 9);
    expect(greekValueToHeight(null, true, lo, hi, maxAbs)).toBeNull();
    expect(greekValueToHeight(NaN, true, lo, hi, maxAbs)).toBeNull();
  });
});