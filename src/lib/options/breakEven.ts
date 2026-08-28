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
  ].filter(qt => qt.iv != null && qt.iv > 0 && ((qt.mid != null && qt.mid > 0) || (qt.last != null && qt.last > 0)));

  return list.map(qt => {
    const midRaw = (qt.mid != null && qt.mid > 0 ? qt.mid : qt.last) as number | null;
    const mid = midRaw ?? 0;
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
  breakEvens: number[];
  payoffCurve: { spot: number; pnl: number }[];
  maxLoss: number;
  maxGain: number | null;
}

export function analyzeComboBreakEven(
  legs: PortfolioLeg[],
  spot: number,
  pct = 0.25,
  n = 120,
): ComboBeAnalysis {
  const lo = spot * (1 - pct);
  const hi = spot * (1 + pct);
  const payoffCurve: { spot: number; pnl: number }[] = [];
  let maxLoss = 0;
  let maxGain = -Infinity;
  for (let i = 0; i <= n; i++) {
    const S = lo + (hi - lo) * (i / n);
    const pnl = comboPayoffAtExpiry(legs, S);
    payoffCurve.push({ spot: S, pnl });
    maxLoss = Math.min(maxLoss, pnl);
    maxGain = Math.max(maxGain, pnl);
  }
  const breakEvens = breakEvenSpots(legs, spot, 1 - pct, 1 + pct, 400);
  return {
    breakEvens,
    payoffCurve,
    maxLoss,
    maxGain: Number.isFinite(maxGain) ? maxGain : null,
  };
}
