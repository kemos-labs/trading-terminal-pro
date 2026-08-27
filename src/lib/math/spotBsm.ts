import type { DecimalRate, DecimalVol, YearFraction } from './units';
import { priceEuropeanBlack76 } from './black76';

/**
 * Spot adapter: F = S * exp((r-q)T). Delegates to canonical forward Black.
 * No second formula — single source of truth.
 */
export function priceEuropeanSpot(
  side: 'call' | 'put',
  S: number,
  K: number,
  T: YearFraction,
  r: DecimalRate,
  q: DecimalRate,
  vol: DecimalVol,
): { price: number; forward: number; df: number } {
  const t = T as number;
  const forward = S * Math.exp(((r as number) - (q as number)) * t);
  const res = priceEuropeanBlack76({ forward, strike: K, expiryYears: T, rate: r, vol, side });
  return { price: res.price, forward, df: res.df };
}
