import { describe, it, expect } from 'vitest';
import {
  surf3dDomain,
  surf3dX,
  surf3dY,
  surf3dZ,
  surf3dRampT,
  surf3dVertexColors,
  surf3dLegendGradient,
  SURF3D_PRESET_CAMERA,
  SURF3D_WIDTH,
  SURF3D_DEPTH,
  SURF3D_HEIGHT,
} from './surface3dModel';

const STRIKES = [600, 650, 700];
const DTES = [7, 30];
const IV = [
  [0.2, 0.18, 0.22],
  [0.25, 0.22, 0.28],
];
const SPOT = 650;

describe('surface3dModel', () => {
  it('derives finite domains from observed IV (never NaN)', () => {
    const d = surf3dDomain(STRIKES, DTES, IV, SPOT);
    for (const v of [d.kMin, d.kMax, d.tMin, d.tMax, d.ivLo, d.ivHi, d.mMin, d.mMax]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(d.ivLo).toBeCloseTo(0.18, 10);
    expect(d.ivHi).toBeCloseTo(0.28, 10);
  });

  it('falls back to a finite domain on all-missing IV', () => {
    const d = surf3dDomain(STRIKES, DTES, [[null, null]], SPOT);
    expect(Number.isFinite(d.ivLo) && Number.isFinite(d.ivHi)).toBe(true);
    expect(d.ivHi).toBeGreaterThan(d.ivLo);
  });

  it('strike mode spans the full width with ATM inside', () => {
    const d = surf3dDomain(STRIKES, DTES, IV, SPOT);
    expect(surf3dX(600, SPOT, d, 'strike')).toBeCloseTo(-SURF3D_WIDTH / 2, 10);
    expect(surf3dX(700, SPOT, d, 'strike')).toBeCloseTo(SURF3D_WIDTH / 2, 10);
    const atm = surf3dX(SPOT, SPOT, d, 'strike');
    expect(atm).toBeGreaterThan(-SURF3D_WIDTH / 2);
    expect(atm).toBeLessThan(SURF3D_WIDTH / 2);
  });

  it('moneyness mode centers ATM at zero inside symmetric wings', () => {
    const d = surf3dDomain(STRIKES, DTES, IV, SPOT);
    expect(surf3dX(SPOT, SPOT, d, 'moneyness')).toBeCloseTo(0, 10);
    // Wider wing (|ln(600/650)| > ln(700/650)) pins the edge; narrower sits inside.
    expect(surf3dX(600, SPOT, d, 'moneyness')).toBeCloseTo(-SURF3D_WIDTH / 2, 10);
    const up = surf3dX(700, SPOT, d, 'moneyness');
    expect(up).toBeGreaterThan(0);
    expect(up).toBeLessThanOrEqual(SURF3D_WIDTH / 2);
  });

  it('maps DTE and IV across their full ranges', () => {
    const d = surf3dDomain(STRIKES, DTES, IV, SPOT);
    expect(surf3dY(7, d)).toBeCloseTo(-SURF3D_DEPTH / 2, 10);
    expect(surf3dY(30, d)).toBeCloseTo(SURF3D_DEPTH / 2, 10);
    expect(surf3dZ(0.18, d)).toBeCloseTo(0, 10);
    expect(surf3dZ(0.28, d)).toBeCloseTo(SURF3D_HEIGHT, 10);
  });

  it('clamps the color ramp to [0, 1] and emits finite vertex RGB', () => {
    const d = surf3dDomain(STRIKES, DTES, IV, SPOT);
    expect(surf3dRampT(0.18, d)).toBe(0);
    expect(surf3dRampT(0.28, d)).toBe(1);
    expect(surf3dRampT(-5, d)).toBe(0);
    expect(surf3dRampT(99, d)).toBe(1);
    const colors = surf3dVertexColors([0.18, 0.23, 0.28], d);
    expect(colors).toHaveLength(9);
    for (const c of colors) {
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('emits a six-stop CSS legend gradient', () => {
    const g = surf3dLegendGradient();
    expect(g.split('%').length - 1).toBeGreaterThanOrEqual(6);
    expect(g).toMatch(/^rgb\(/);
  });

  it('defines three distinct finite camera presets', () => {
    const seen = new Set<string>();
    for (const p of ['home', 'top', 'side'] as const) {
      const cam = SURF3D_PRESET_CAMERA[p];
      expect(cam).toHaveLength(3);
      for (const v of cam) expect(Number.isFinite(v)).toBe(true);
      seen.add(cam.join(','));
    }
    expect(seen.size).toBe(3);
  });
});
