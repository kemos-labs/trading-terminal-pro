/**
 * GBM path simulator for multi-leg combinations (Thalex Simulator).
 */

import { evaluateCombo, type PortfolioLeg } from './portfolio';
import type { VolSnapshot } from './types';

export interface PathSimConfig {
  /** Annualized drift μ */
  drift: number;
  /** Annualized realized vol σ (not IV) */
  vol: number;
  /** Horizon in calendar days */
  days: number;
  /** Steps per path */
  steps: number;
  /** Number of Monte Carlo paths */
  paths: number;
  /** RNG seed for reproducibility */
  seed?: number;
}

export interface PathResult {
  available: boolean;
  reason?: string;
  /** Time axis in days */
  t: number[];
  /** Percentile bands of spot: p5, p25, p50, p75, p95 */
  spotBands: { p5: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] };
  /** Percentile bands of combo mark PnL */
  pnlBands: { p5: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] };
  /** Mean terminal PnL */
  meanTerminalPnl: number | null;
  /** Prob PnL > 0 */
  winRate: number | null;
  /** Sample paths (spot) for cloud viz — subset */
  sampleSpots: number[][];
  samplePnls: number[][];
}

/** Mulberry32 PRNG */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boxMuller(rand: () => number): number {
  const u = Math.max(1e-12, rand());
  const v = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! * (hi - idx) + sorted[hi]! * (idx - lo);
}

function bandAtStep(matrix: number[][], step: number): { p5: number; p25: number; p50: number; p75: number; p95: number } {
  const col = matrix.map(row => row[step]!).sort((a, b) => a - b);
  return {
    p5: percentile(col, 0.05),
    p25: percentile(col, 0.25),
    p50: percentile(col, 0.5),
    p75: percentile(col, 0.75),
    p95: percentile(col, 0.95),
  };
}

/**
 * Simulate GBM paths and mark multi-leg portfolio along each path.
 * Vol used for marking is snapshot IV (sticky-strike smile); path uses realized vol.
 * Time decays with the path so theta is reflected in mark PnL.
 */
export function simulatePaths(
  legs: PortfolioLeg[],
  snap: VolSnapshot,
  cfg: PathSimConfig,
): PathResult {
  const unavailable = (reason: string): PathResult => ({ available: false, reason, t: [], spotBands: { p5: [], p25: [], p50: [], p75: [], p95: [] }, pnlBands: { p5: [], p25: [], p50: [], p75: [], p95: [] }, meanTerminalPnl: null, winRate: null, sampleSpots: [], samplePnls: [] });
  const rand = rng(cfg.seed ?? 42);
  const S0 = snap.spot;
  const dt = (cfg.days / 365) / cfg.steps;
  const drift = cfg.drift;
  const sig = cfg.vol;
  const n = cfg.paths;
  const steps = cfg.steps;

  const t: number[] = [];
  for (let i = 0; i <= steps; i++) t.push((cfg.days * i) / steps);

  const spotPaths: number[][] = [];
  const pnlPaths: number[][] = [];
  const entry = evaluateCombo(legs, snap, { spot: S0, daysElapsed: 0 });
  if (entry.unavailable || entry.mark == null) {
    return unavailable('unavailable-mark');
  }

  for (let p = 0; p < n; p++) {
    const spots: number[] = [S0];
    const pnls: number[] = [0];
    let S = S0;
    for (let i = 1; i <= steps; i++) {
      const z = boxMuller(rand);
      S = S * Math.exp((drift - 0.5 * sig * sig) * dt + sig * Math.sqrt(dt) * z);
      spots.push(S);
      const daysElapsed = t[i]!;
      const m = evaluateCombo(legs, snap, { spot: S, daysElapsed });
      if (m.unavailable || m.mark == null) return unavailable('unavailable-mark');
      pnls.push(m.mark - entry.mark);
    }
    spotPaths.push(spots);
    pnlPaths.push(pnls);
  }

  const spotBands = { p5: [] as number[], p25: [] as number[], p50: [] as number[], p75: [] as number[], p95: [] as number[] };
  const pnlBands = { p5: [] as number[], p25: [] as number[], p50: [] as number[], p75: [] as number[], p95: [] as number[] };

  for (let i = 0; i <= steps; i++) {
    const sb = bandAtStep(spotPaths, i);
    const pb = bandAtStep(pnlPaths, i);
    spotBands.p5.push(sb.p5); spotBands.p25.push(sb.p25); spotBands.p50.push(sb.p50);
    spotBands.p75.push(sb.p75); spotBands.p95.push(sb.p95);
    pnlBands.p5.push(pb.p5); pnlBands.p25.push(pb.p25); pnlBands.p50.push(pb.p50);
    pnlBands.p75.push(pb.p75); pnlBands.p95.push(pb.p95);
  }

  const terminals = pnlPaths.map(p => p[p.length - 1]!);
  const meanTerminalPnl = terminals.reduce((a, b) => a + b, 0) / terminals.length;
  const winRate = terminals.filter(x => x > 0).length / terminals.length;

  // Subsample for UI cloud
  const sampleN = Math.min(12, n);
  const sampleSpots = spotPaths.slice(0, sampleN);
  const samplePnls = pnlPaths.slice(0, sampleN);

  return { available: true, t, spotBands, pnlBands, meanTerminalPnl, winRate, sampleSpots, samplePnls };
}
