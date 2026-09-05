import { ivRamp01 } from '../../lib/options/color';

/**
 * Pure 3D-surface scene math (no WebGL) — shared by IvSurface3D and its
 * golden tests. Restores the richness of the original pre-cleanup surface
 * (shaded solid mesh, IV color ramp, moneyness axis, camera presets) on top
 * of the current honest-data architecture (observed holes stay holes).
 */

export const SURF3D_WIDTH = 3.6;
export const SURF3D_DEPTH = 2.6;
export const SURF3D_HEIGHT = 1.6;

export type Surf3DXMode = 'strike' | 'moneyness';
export type Surf3DPreset = 'home' | 'top' | 'side';

export const SURF3D_PRESET_CAMERA: Record<Surf3DPreset, [number, number, number]> = {
  home: [3.2, 2.4, 4.2],
  top: [0, 6.2, 0.01],
  side: [5.4, 1.1, 0.01],
};

export interface Surf3DDomain {
  kMin: number;
  kMax: number;
  tMin: number;
  tMax: number;
  ivLo: number;
  ivHi: number;
  /** Log-moneyness bounds (needed when xMode is moneyness). */
  mMin: number;
  mMax: number;
}

export function surf3dDomain(
  strikes: number[],
  dtes: number[],
  iv: (number | null)[][],
  spot: number,
): Surf3DDomain {
  const kMin = strikes[0] ?? 0;
  const kMax = strikes[strikes.length - 1] ?? 1;
  const tMin = dtes[0] ?? 0;
  const tMax = dtes[dtes.length - 1] ?? 1;
  let ivLo = Infinity;
  let ivHi = -Infinity;
  for (const row of iv) {
    for (const v of row) {
      if (v != null && Number.isFinite(v)) {
        if (v < ivLo) ivLo = v;
        if (v > ivHi) ivHi = v;
      }
    }
  }
  if (!Number.isFinite(ivLo)) {
    ivLo = 0.1;
    ivHi = 0.5;
  }
  const safeSpot = spot > 0 ? spot : 1;
  return {
    kMin,
    kMax,
    tMin,
    tMax,
    ivLo,
    ivHi,
    mMin: Math.log(Math.max(kMin, 1e-9) / safeSpot),
    mMax: Math.log(Math.max(kMax, 1e-9) / safeSpot),
  };
}

/** X position for a strike under the active axis mode. Moneyness wings are
 *  symmetric about ATM so the ridge always centers exactly. */
export function surf3dX(strike: number, spot: number, domain: Surf3DDomain, mode: Surf3DXMode): number {
  if (mode === 'moneyness') {
    const m = Math.log(Math.max(strike, 1e-9) / Math.max(spot, 1e-9));
    const bound = Math.max(-domain.mMin, domain.mMax, 1e-9);
    return Math.max(-1, Math.min(1, m / bound)) * (SURF3D_WIDTH / 2);
  }
  const span = domain.kMax - domain.kMin;
  return span !== 0
    ? ((strike - domain.kMin) / span) * SURF3D_WIDTH - SURF3D_WIDTH / 2
    : 0;
}

/** Y position for a DTE value. */
export function surf3dY(dte: number, domain: Surf3DDomain): number {
  const span = domain.tMax - domain.tMin;
  return span !== 0
    ? ((dte - domain.tMin) / span) * SURF3D_DEPTH - SURF3D_DEPTH / 2
    : 0;
}

/** Z position for an IV value (vol points). */
export function surf3dZ(iv: number, domain: Surf3DDomain): number {
  const span = domain.ivHi - domain.ivLo;
  return ((iv - domain.ivLo) / (span || 1)) * SURF3D_HEIGHT;
}

/** IV color-ramp position in [0, 1] for mesh vertex colors and node tints. */
export function surf3dRampT(iv: number, domain: Surf3DDomain): number {
  const span = domain.ivHi - domain.ivLo;
  if (span <= 0) return 0.5;
  return Math.max(0, Math.min(1, (iv - domain.ivLo) / span));
}

/** Per-vertex RGB colors for a shaded model mesh, from SVI-implied IVs. */
export function surf3dVertexColors(ivs: number[], domain: Surf3DDomain): number[] {
  const out: number[] = [];
  for (const iv of ivs) {
    const [r, g, b] = ivRamp01(surf3dRampT(iv, domain));
    out.push(r, g, b);
  }
  return out;
}

/** CSS gradient stops for the DOM legend (exact min/max labelled by the caller). */
export function surf3dLegendGradient(): string {
  return [0, 0.2, 0.4, 0.6, 0.8, 1]
    .map((t) => {
      const [r, g, b] = ivRamp01(t);
      return `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0}) ${(t * 100).toFixed(0)}%`;
    })
    .join(', ');
}
