/**
 * Break-even analysis + N(d2) for selected maturity (Thalex Break Even).
 */

import { priceGreeksMarket } from '../math/adapters';
import { normCdf } from '../math/norm';
import { yearFractionFromSlice } from './time';
import type { VolSnapshot } from './types';
import { breakEvenSpots, comboPayoffAtExpiry, type PortfolioLeg } from './portfolio';

export interface BreakEvenRow {
  strike: number;
  type: 'call' | 'put';
  mid: number;
  /** Long option break-even at expiry */
  beLong: number;
  /** Short option break-even at expiry */
  beShort: number;
  nd2: number;
  /** Distance of long BE from spot (pct) */
  beDistPct: number;
  delta: number;
  iv: number;
}

export function breakEvenTable(
  snap: VolSnapshot,
  expiryIdx: number,
  type: 'call' | 'put' | 'both' = 'both',
): BreakEvenRow[] {
  const slice = snap.expiries[expiryIdx];
  if (!slice) return [];
  const T = yearFractionFromSlice(slice);
  const S = snap.spot;
  const r = snap.riskFreeRate;
  const div = snap.dividendYield;

  const list = [
    ...(type !== 'put' ? slice.calls : []),
    ...(type !== 'call' ? slice.puts : []),
  ].filter(qt => qt.iv != null && qt.iv > 0 && qt.mid != null && qt.mid > 0 && Number.isFinite(qt.mid));

  return list.map(qt => {
    const mid = qt.mid as number;
    const beLong = qt.type === 'call' ? qt.strike + mid : qt.strike - mid;
    const beShort = beLong; // same strike-crossing for single-leg
    const g = priceGreeksMarket(qt.type, S, qt.strike, T, r, div, qt.iv!);
    const d2 = (Math.log(S / qt.strike) + (r - div - 0.5 * qt.iv! * qt.iv!) * T) / (qt.iv! * Math.sqrt(T));
    const nd2 = qt.type === 'call' ? normCdf(d2) : normCdf(-d2);
    return {
      strike: qt.strike,
      type: qt.type,
      mid,
      beLong,
      beShort,
      nd2,
      beDistPct: (beLong - S) / S,
      delta: g.delta,
      iv: qt.iv!,
    };
  }).sort((a, b) => a.strike - b.strike);
}

export interface ComboBeAnalysis {
  available: boolean;
  reason?: string;
  breakEvens: number[];
  payoffCurve: { spot: number; pnl: number | null }[];
  maxLoss: number | null;
  maxGain: number | null;
}

export function analyzeComboBreakEven(
  legs: PortfolioLeg[],
  spot: number,
  pct = 0.25,
  n = 120,
): ComboBeAnalysis {
  if (legs.some(l => l.entryPrice == null || !Number.isFinite(l.entryPrice as number))) {
    return { available: false, reason: 'missing entryPrice', breakEvens: [], payoffCurve: [], maxLoss: null, maxGain: null };
  }
  if (!Number.isFinite(spot) || spot <= 0) return { available: false, reason: 'invalid spot', breakEvens: [], payoffCurve: [], maxLoss: null, maxGain: null };
  const lo = spot * (1 - pct);
  const hi = spot * (1 + pct);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { available: false, reason: 'invalid range', breakEvens: [], payoffCurve: [], maxLoss: null, maxGain: null };
  const payoffCurve: { spot: number; pnl: number | null }[] = [];
  let maxLoss: number | null = null;
  let maxGain: number | null = null;
  for (let i = 0; i <= n; i++) {
    const S = lo + (hi - lo) * (i / n);
    const pnl = comboPayoffAtExpiry(legs, S);
    payoffCurve.push({ spot: S, pnl });
    if (pnl != null && Number.isFinite(pnl)) {
      maxLoss = maxLoss == null ? Math.min(0, pnl) : Math.min(maxLoss, pnl);
      maxGain = maxGain == null ? pnl : Math.max(maxGain, pnl);
    }
  }
  const beRes = breakEvenSpots(legs, spot, 1 - pct, 1 + pct, 400);
  if (!beRes.available) return { available: false, reason: beRes.reason, breakEvens: [], payoffCurve: [], maxLoss: null, maxGain: null };
  // Filter out any non-finite from curve (shouldn't happen)
  const cleanCurve = payoffCurve.filter(p => p.pnl == null || Number.isFinite(p.pnl as number));
  return {
    available: true,
    breakEvens: beRes.breakEvens,
    payoffCurve: cleanCurve,
    maxLoss,
    maxGain: maxGain != null && Number.isFinite(maxGain) ? maxGain : null,
  };
}
