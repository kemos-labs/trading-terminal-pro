import { describe, it, expect } from 'vitest';
import { svi, sviIv, fitSVI } from '../math/surface/sviFit';
import type { SVIParams } from './types';

const TRUE: SVIParams = { a: 0.04, b: 0.15, rho: -0.3, m: 0, sigma: 0.1 };
const SPOT = 100;
const STRIKES = [80, 85, 90, 95, 100, 105, 110, 115, 120];
/** Year fraction used for synthetic smile (total variance w = IV²·T). */
const T = 0.25;

function k(strike: number, spot = SPOT): number {
  return Math.log(strike / spot);
}

/** Market IVs from true SVI total variance: σ = √(w/T). */
function synthIV(params: SVIParams = TRUE, t = T): number[] {
  return STRIKES.map(s => sviIv(params, k(s), t));
}

describe('SVI pure evaluation', () => {
  it('svi() returns a finite positive total variance at the money', () => {
    const w = svi(TRUE, 0);
    expect(isFinite(w)).toBe(true);
    expect(w).toBeGreaterThan(0);
  });

  it('sviIv converts total variance to IV', () => {
    const iv = sviIv(TRUE, 0, T);
    expect(iv).toBeCloseTo(Math.sqrt(svi(TRUE, 0) / T), 6);
  });
});

describe('fitSVI round-trip (total variance)', () => {
  const iv = synthIV();
  const fit = fitSVI(STRIKES, iv, SPOT, T);

  it('returns a fit for a clean synthetic smile', () => {
    expect(fit).not.toBeNull();
  });

  it('recovers the curve within 1e-3 RMSE (total variance units)', () => {
    expect(fit).not.toBeNull();
    if (!fit) return;
    expect(fit.rmse).toBeLessThan(1e-3);
  });

  it('matches the true IV smile pointwise within 1e-3', () => {
    expect(fit).not.toBeNull();
    if (!fit) return;
    const maxDev = Math.max(
      ...STRIKES.map((s, i) => Math.abs(sviIv(fit.params, k(s), T) - iv[i]!)),
    );
    expect(maxDev).toBeLessThan(1e-3);
  });

  it('reports the sample count', () => {
    expect(fit).not.toBeNull();
    if (!fit) return;
    expect(fit.samples).toBe(STRIKES.length);
  });
});

describe('fitSVI no-arbitrage bounds', () => {
  const fit = fitSVI(STRIKES, synthIV(), SPOT, T)!;

  it('b is non-negative', () => {
    expect(fit.params.b).toBeGreaterThanOrEqual(0);
  });

  it('|rho| < 1', () => {
    expect(Math.abs(fit.params.rho)).toBeLessThan(1);
  });

  it('sigma is positive', () => {
    expect(fit.params.sigma).toBeGreaterThanOrEqual(1e-4);
  });

  it('satisfies the butterfly no-arb condition a + b*sigma*sqrt(1-rho^2) >= 0', () => {
    const { a, b, rho, sigma } = fit.params;
    expect(a + b * sigma * Math.sqrt(1 - rho * rho)).toBeGreaterThanOrEqual(-1e-9);
  });
});

describe('fitSVI degenerate input', () => {
  it('returns null when fewer than 5 valid points are provided', () => {
    expect(fitSVI([100], [0.2], SPOT, T)).toBeNull();
  });

  it('returns null when spot is non-positive', () => {
    expect(fitSVI(STRIKES, synthIV(), 0, T)).toBeNull();
  });
});

describe('fitSVI noise robustness', () => {
  it('achieves low RMSE under small deterministic perturbation', () => {
    const perturb = [1e-4, -1e-4, 1e-4, -1e-4, 0, -1e-4, 1e-4, -1e-4, 1e-4];
    const noisy = synthIV().map((v, i) => v + perturb[i]!);
    const fit = fitSVI(STRIKES, noisy, SPOT, T);
    expect(fit).not.toBeNull();
    if (!fit) return;
    // RMSE is on total variance; allow modest residual under IV noise.
    expect(fit.rmse).toBeLessThan(5e-3);
  });
});
