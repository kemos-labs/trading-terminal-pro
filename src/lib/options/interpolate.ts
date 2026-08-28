import { fitSVI, sviIv } from '../math/surface/sviFit';
import type { SVIFit } from './types';

/**
 * Fill null/missing IVs in a surface grid so no cell becomes 0.
 *
 * Three-stage approach:
 * 1. Per-expiry: fit SVI total variance w=IV²·T, sample σ=√(w/T) onto strikes.
 * 2. Temporal: for rows that couldn't be fit (<5 valid points), interpolate
 *    from neighboring fitted expiries using log-linear term-structure
 *    interpolation weighted by DTE.
 * 3. Safety: remaining nulls inherit a real grid IV when one exists; never invent a constant (e.g. 20%).
 */
export function interpolateSurface(
  strikes: number[],
  spot: number,
  ivRows: (number | null)[][],
  dtes: number[],
): { iv: (number | null)[][]; fits: (SVIFit | null)[] } {
  const nExp = ivRows.length;
  if (nExp === 0) return { iv: [], fits: [] };
  const nStrike = strikes.length;

  // Stage 1: per-expiry SVI fit on total variance + sample as IV.
  const fits: (SVIFit | null)[] = [];
  const filled: (number | null)[][] = ivRows.map((row, e) => {
    if (!row || row.length !== nStrike) {
      fits.push(null);
      return strikes.map(() => null);
    }
    const T = Math.max((dtes[e] ?? 30) / 365, 1e-8);
    const fit = fitSVI(strikes, row, spot, T);
    if (!fit) {
      fits.push(null);
      return strikes.map(() => null);
    }
    fits.push(fit);
    return strikes.map(strike => {
      if (strike <= 0 || spot <= 0) return null;
      const k = Math.log(strike / spot);
      if (!isFinite(k)) return null;
      const iv = sviIv(fit.params, k, T);
      return iv > 0 && isFinite(iv) ? iv : null;
    });
  });

  // Stage 2: temporal interpolation for unfit rows.
  for (let e = 0; e < nExp; e++) {
    if (fits[e] !== null) continue;

    let lo = -1, hi = -1;
    for (let j = e - 1; j >= 0; j--) {
      if (fits[j] !== null) { lo = j; break; }
    }
    for (let j = e + 1; j < nExp; j++) {
      if (fits[j] !== null) { hi = j; break; }
    }

    const dteE = dtes[e] ?? 0;

    if (lo >= 0 && hi >= 0) {
      const dteLo = dtes[lo] ?? 0;
      const dteHi = dtes[hi] ?? 0;
      const span = Math.max(dteHi - dteLo, 1);
      const t = Math.max(0, Math.min(1, (dteE - dteLo) / span));
      filled[e] = strikes.map((_, x) => {
        const vLo = filled[lo]![x]!;
        const vHi = filled[hi]![x]!;
        if (vLo == null || vHi == null || vLo <= 0 || vHi <= 0) return null;
        return Math.exp((1 - t) * Math.log(vLo) + t * Math.log(vHi));
      });
    } else if (lo >= 0) {
      filled[e] = strikes.map((_, x) => filled[lo]![x] ?? null);
    } else if (hi >= 0) {
      filled[e] = strikes.map((_, x) => filled[hi]![x] ?? null);
    }
  }

  // Stage 3: fill remaining holes only from real grid IVs (never invent 20% vol).
  // If the surface has zero valid cells, leave nulls — callers treat holes as incomplete.
  let globalFallback: number | null = null;
  for (let e = 0; e < nExp && globalFallback === null; e++) {
    for (let x = 0; x < nStrike; x++) {
      const v = filled[e]?.[x];
      if (v != null && v > 0) { globalFallback = v; break; }
    }
  }

  if (globalFallback != null) {
    for (let e = 0; e < nExp; e++) {
      for (let x = 0; x < nStrike; x++) {
        const v = filled[e]![x];
        if (v == null || v <= 0) {
          filled[e]![x] = globalFallback;
        }
      }
    }
  }

  return { iv: filled, fits };
}
