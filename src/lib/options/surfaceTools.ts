import type { SurfaceGrid, SVIParams, SVIFit } from './types';
import { fitSVI } from '../math/surface/sviFit';
import { yearFractionFromSlice } from './time';

export interface SmileSlice {
  expiry: string;
  strikes: number[];
  ivs: number[];
}

export interface TermSlice {
  strike: number;
  expiries: string[];
  dtes: number[];
  ivs: number[];
}

export interface SVIReadout {
  expiry: string;
  params: SVIParams;
  rmse: number;
  samples: number;
}

function dteFromExpiry(expiry: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry);
  exp.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
}

/**
 * Extract the smile slice (IV vs strike) for a single expiry row.
 */
export function smileSlice(grid: SurfaceGrid, expiryIndex: number): SmileSlice | null {
  if (expiryIndex < 0 || expiryIndex >= grid.iv.length) return null;
  const expiry = grid.expiries[expiryIndex];
  if (!expiry) return null;
  const row = grid.iv[expiryIndex]!;
  const strikes: number[] = [];
  const ivs: number[] = [];
  for (let c = 0; c < grid.strikes.length; c++) {
    const iv = row[c];
    if (iv != null && isFinite(iv)) {
      strikes.push(grid.strikes[c]!);
      ivs.push(iv);
    }
  }
  if (strikes.length === 0) return null;
  return { expiry, strikes, ivs };
}

/**
 * Extract the term-structure slice (IV vs DTE) for a single strike.
 */
export function termSlice(grid: SurfaceGrid, strike: number): TermSlice | null {
  const col = grid.strikes.indexOf(strike);
  if (col < 0) return null;
  const expiries: string[] = [];
  const dtes: number[] = [];
  const ivs: number[] = [];
  for (let r = 0; r < grid.iv.length; r++) {
    const iv = grid.iv[r]![col];
    if (iv != null && isFinite(iv)) {
      const expiry = grid.expiries[r]!;
      expiries.push(expiry);
      dtes.push(dteFromExpiry(expiry));
      ivs.push(iv);
    }
  }
  if (expiries.length === 0) return null;
  return { strike, expiries, dtes, ivs };
}

/**
 * Fit SVI to the best-populated expiry row and return a readout with
 * parameters and RMSE. Returns null when no expiry has enough valid points.
 */
export function sviReadout(grid: SurfaceGrid, spot: number): SVIReadout | null {
  let best: SVIFit & { expiry: string } | null = null;
  for (let r = 0; r < grid.iv.length; r++) {
    const dte = grid.dtes?.[r] ?? dteFromExpiry(grid.expiries[r]!);
    const T = yearFractionFromSlice({ expiry: grid.expiries[r]!, dte });
    // RMSE is in total-variance units; prefer denser near-term smiles by sample count then RMSE.
    const fit = fitSVI(grid.strikes, grid.iv[r]!, spot, T);
    if (fit && (!best || fit.samples > best.samples || (fit.samples === best.samples && fit.rmse < best.rmse))) {
      best = { ...fit, expiry: grid.expiries[r]! };
    }
  }
  if (!best) return null;
  return {
    expiry: best.expiry,
    params: best.params,
    rmse: best.rmse,
    samples: best.samples,
  };
}

/**
 * Per-expiry SVI fits — the MODEL layer for 3D surfaces (never fills observed cells).
 * Returns one readout per expiry row that had enough samples to fit.
 */
export function sviReadoutsByExpiry(grid: SurfaceGrid, spot: number): SVIReadout[] {
  const out: SVIReadout[] = [];
  for (let r = 0; r < grid.iv.length; r++) {
    const dte = grid.dtes?.[r] ?? dteFromExpiry(grid.expiries[r]!);
    const T = yearFractionFromSlice({ expiry: grid.expiries[r]!, dte });
    const fit = fitSVI(grid.strikes, grid.iv[r]!, spot, T);
    if (fit) {
      out.push({ expiry: grid.expiries[r]!, params: fit.params, rmse: fit.rmse, samples: fit.samples });
    }
  }
  return out;
}

/**
 * Export the surface grid as CSV.
 * Header: expiry,strike1,strike2,...
 * Rows: YYYY-MM-DD,iv1,iv2,...
 */
export function exportSurfaceToCSV(grid: SurfaceGrid): string {
  if (grid.strikes.length === 0) return '';
  const header = ['expiry', ...grid.strikes.map(s => s.toFixed(2))].join(',');
  const lines = [header];
  for (let r = 0; r < grid.iv.length; r++) {
    const expiry = grid.expiries[r]!;
    const row = grid.iv[r]!.map(iv => (iv == null ? '' : iv.toFixed(6)));
    lines.push([expiry, ...row].join(','));
  }
  return lines.join('\n');
}

/**
 * Export the surface grid as a stable JSON object.
 */
export function exportSurfaceToJSON(grid: SurfaceGrid): object {
  return {
    schema: 'volaterm-surface-v1',
    generatedAt: new Date().toISOString(),
    expiries: grid.expiries,
    strikes: grid.strikes,
    iv: grid.iv,
  };
}
