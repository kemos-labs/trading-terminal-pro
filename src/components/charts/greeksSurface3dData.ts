/**
 * Pure 3D Greeks geometry data — no three/r3f imports, unit-testable in jsdom.
 * Encodes the observed-truth rules:
 * - null/NaN cells are true holes (never rendered, never interpolated);
 * - signed (diverging) Greeks use a zero-centered t in [0,1] so v=0 maps to the
 *   ramp midpoint; sequential Greeks map over observed [lo, hi];
 * - ATM ridge takes the nearest-strike observed node per expiry;
 * - outputs contain no NaN/Infinity.
 */
import type { SurfaceGrid } from '../../lib/macrovol/api';
import { greekRamp01 } from '../views/greekRamp';

export const GREEK3D_W = 3.6;
export const GREEK3D_D = 2.6;
export const GREEK3D_H = 1.6;

export interface GreeK3DNode {
  x: number;
  y: number;
  z: number;
  strike: number;
  dte: number;
  value: number;
  color: [number, number, number];
}

export interface GreekSurface3DData {
  strikes: number[];
  dtes: number[];
  kMin: number;
  kMax: number;
  tMin: number;
  tMax: number;
  /** finite observed nodes; holes omitted */
  points: GreeK3DNode[];
  /** [tIdx][kIdx] layout of observed values (null holes preserved) */
  values: (number | null)[][];
  atmRidge: { x: number; y: number; z: number }[];
  atmX: number;
  lo: number;
  hi: number;
  maxAbs: number;
  zTicks: number[];
  rampMidpoint: number;
  hasObserved: boolean;
}

export function rampTDiverging(v: number, maxAbs: number): number {
  const safeMax = Number.isFinite(maxAbs) && maxAbs > 0 ? maxAbs : 1;
  const t = 0.5 + 0.5 * (v / safeMax);
  return Math.max(0, Math.min(1, t));
}

function rampT(v: number, diverging: boolean, lo: number, hi: number, maxAbs: number): number {
  const range = (hi - lo) || 1;
  const t = diverging
    ? rampTDiverging(v, maxAbs)
    : (v - lo) / range;
  return Math.max(0, Math.min(1, t));
}

export function greekValueToHeight(
  v: number | null,
  diverging: boolean,
  lo: number,
  hi: number,
  maxAbs: number,
): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const t = rampT(v, diverging, lo, hi, maxAbs);
  const z = t * GREEK3D_H;
  return Number.isFinite(z) ? z : null;
}

/**
 * Wireframe triangle indices for a sparse values layout.
 * A quad contributes two triangles ONLY when all four corners are present
 * (finite observed values). Any hole suppresses both triangles, so real
 * holes remain holes instead of being bridged with z=0 fabrications.
 */
export function buildGreekWireframeIndices(values: (number | null)[][]): number[] {
  const idx: number[] = [];
  if (!values.length) return idx;
  const nCols = Math.max(...values.map((r) => r?.length ?? 0));
  if (!Number.isFinite(nCols) || nCols < 2) return idx;
  for (let ti = 0; ti + 1 < values.length; ti++) {
    const rowA = values[ti];
    const rowB = values[ti + 1];
    if (!rowA || !rowB) continue;
    for (let ki = 0; ki + 1 < nCols; ki++) {
      const a = rowA[ki];
      const b = rowA[ki + 1];
      const c = rowB[ki];
      const d = rowB[ki + 1];
      if (a == null || b == null || c == null || d == null) continue;
      const aIdx = ti * nCols + ki;
      const bIdx = ti * nCols + ki + 1;
      const cIdx = (ti + 1) * nCols + ki;
      const dIdx = (ti + 1) * nCols + ki + 1;
      idx.push(aIdx, bIdx, cIdx, bIdx, dIdx, cIdx);
    }
  }
  return idx;
}

export function buildGreekSurface3DData(
  grid: SurfaceGrid,
  spot: number,
  diverging: boolean,
): GreekSurface3DData {
  const strikes = grid.K_vals;
  const dtes = grid.T_vals.map((T) => Math.max(0, Math.round(T * 365)));
  const kMin = strikes[0] ?? 0;
  const kMax = strikes[strikes.length - 1] ?? 1;
  const tMin = dtes[0] ?? 0;
  const tMax = dtes[dtes.length - 1] ?? 1;

  const normX = (k: number) => (kMax > kMin ? ((k - kMin) / (kMax - kMin)) * GREEK3D_W - GREEK3D_W / 2 : 0);
  const normY = (t: number) => (tMax > tMin ? ((t - tMin) / (tMax - tMin)) * GREEK3D_D - GREEK3D_D / 2 : 0);

  let lo = Infinity;
  let hi = -Infinity;
  for (const row of grid.grid) {
    if (!row) continue;
    for (const v of row) {
      if (v == null || !Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const maxAbs = Number.isFinite(lo) ? Math.max(Math.abs(lo), Math.abs(hi)) || 1 : 1;
  const hasObserved = Number.isFinite(lo);

  const values: (number | null)[][] = grid.grid.map((row) =>
    (row ?? []).slice(0, strikes.length).map((v) => (v != null && Number.isFinite(v) ? v : null)),
  );

  const points: GreeK3DNode[] = [];
  if (hasObserved) {
    for (let ti = 0; ti < grid.T_vals.length; ti++) {
      const row = values[ti];
      if (!row) continue;
      for (let ki = 0; ki < strikes.length; ki++) {
        const v = row[ki];
        if (v == null) continue;
        const t = rampT(v, diverging, lo, hi, maxAbs);
        points.push({
          x: normX(strikes[ki]!),
          y: normY(dtes[ti]!),
          z: t * GREEK3D_H,
          strike: strikes[ki]!,
          dte: dtes[ti]!,
          value: v,
          color: greekRamp01(t),
        });
      }
    }
  }

  const atmRidge: { x: number; y: number; z: number }[] = [];
  if (hasObserved) {
    for (let ti = 0; ti < grid.T_vals.length; ti++) {
      const row = values[ti];
      if (!row) continue;
      let best: { k: number; v: number } | null = null;
      for (let ki = 0; ki < strikes.length; ki++) {
        const v = row[ki];
        if (v == null) continue;
        const k = strikes[ki]!;
        if (!best || Math.abs(k - spot) < Math.abs(best.k - spot)) best = { k, v };
      }
      if (best) {
        atmRidge.push({
          x: normX(best.k),
          y: normY(dtes[ti]!),
          z: rampT(best.v, diverging, lo, hi, maxAbs) * GREEK3D_H,
        });
      }
    }
  }

  const zTicks: number[] = [];
  if (hasObserved) {
    for (const t of [-1, -0.5, 0, 0.5, 1]) {
      if (!diverging && t < 0) continue;
      const v = diverging ? t * maxAbs : lo + ((t + 1) / 2) * (hi - lo || 1);
      if (Number.isFinite(v)) zTicks.push(v);
    }
  }

  return {
    strikes,
    dtes,
    kMin,
    kMax,
    tMin,
    tMax,
    points,
    values,
    atmRidge,
    atmX: normX(spot),
    lo: hasObserved ? lo : 0,
    hi: hasObserved ? hi : 0,
    maxAbs,
    zTicks,
    rampMidpoint: 0.5,
    hasObserved,
  };
}