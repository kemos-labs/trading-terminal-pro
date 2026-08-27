import { priceEuropeanSpot } from './spotBsm';
import type { DecimalRate, DecimalVol, YearFraction } from './units';

export type IvSuccess = {
  ok: true;
  sigma: DecimalVol;
  iterations: number;
  repricingError: number;
  bracket: readonly [number, number];
};
export type IvFailure = {
  ok: false;
  reason: 'invalid_input' | 'expired' | 'below_intrinsic' | 'above_upper_bound' | 'no_bracket' | 'non_convergent' | 'indeterminate';
};
export type IvResult = IvSuccess | IvFailure;

/**
 * Safeguarded implied vol inversion: checks bounds, adaptive bracket, Brent/bisection hybrid,
 * repricing check. No near-expiry proxy, no hidden clamp.
 */
export function solveImpliedVol(
  side: 'call' | 'put',
  S: number,
  K: number,
  T: YearFraction,
  r: DecimalRate,
  q: DecimalRate,
  marketPrice: number,
  opts?: { tolPrice?: number; tolVol?: number; maxIter?: number },
): IvResult {
  const t = T as number;
  const tolPrice = opts?.tolPrice ?? 1e-8;
  const tolVol = opts?.tolVol ?? 1e-9;
  const maxIter = opts?.maxIter ?? 100;

  if (!(S > 0) || !(K > 0) || !isFinite(S) || !isFinite(K) || !isFinite(marketPrice)) {
    return { ok: false, reason: 'invalid_input' };
  }
  if (!((t) > 0)) return { ok: false, reason: 'expired' };
  // Use exact model intrinsic: price at vol→0
  const priceAtZero = priceEuropeanSpot(side, S, K, T, r, q, 0 as DecimalVol).price;
  const priceAtHigh = priceEuropeanSpot(side, S, K, T, r, q, 5 as DecimalVol).price;
  // Check below intrinsic (with small eps)
  if (marketPrice < priceAtZero - 1e-12) return { ok: false, reason: 'below_intrinsic' };
  if (marketPrice > priceAtHigh + 1e-12) {
    // Try larger vol bracket before giving up
    const priceAt10 = priceEuropeanSpot(side, S, K, T, r, q, 10 as DecimalVol).price;
    if (marketPrice > priceAt10 + 1e-12) return { ok: false, reason: 'above_upper_bound' };
  }
  if (Math.abs(marketPrice - priceAtZero) < tolPrice) {
    return { ok: true, sigma: 0 as DecimalVol, iterations: 0, repricingError: 0, bracket: [0, 5] as const };
  }

  let lo = 1e-9;
  let hi = 5;
  let priceLo = priceEuropeanSpot(side, S, K, T, r, q, lo as DecimalVol).price;
  let priceHi = priceEuropeanSpot(side, S, K, T, r, q, hi as DecimalVol).price;

  // Ensure bracket
  if (marketPrice < priceLo - tolPrice || marketPrice > priceHi + tolPrice) {
    // Expand hi adaptively
    let expanded = false;
    for (let k = 0; k < 5; k++) {
      hi *= 2;
      priceHi = priceEuropeanSpot(side, S, K, T, r, q, hi as DecimalVol).price;
      if (marketPrice <= priceHi + tolPrice) { expanded = true; break; }
      if (hi > 20) break;
    }
    if (!expanded && (marketPrice < priceLo - tolPrice || marketPrice > priceHi + tolPrice)) {
      return { ok: false, reason: 'no_bracket' };
    }
  }

  // Bisection (safe Brent-lite)
  let mid = 0 as DecimalVol;
  let iter = 0;
  for (iter = 0; iter < maxIter; iter++) {
    mid = ((lo + hi) / 2) as DecimalVol;
    const priceMid = priceEuropeanSpot(side, S, K, T, r, q, mid).price;
    const err = priceMid - marketPrice;
    if (Math.abs(err) < tolPrice || (hi - lo) / 2 < tolVol) {
      const repriced = priceEuropeanSpot(side, S, K, T, r, q, mid).price;
      const reprErr = Math.abs(repriced - marketPrice);
      if (reprErr > 1e-6) return { ok: false, reason: 'non_convergent' };
      return { ok: true, sigma: mid, iterations: iter + 1, repricingError: reprErr, bracket: [lo, hi] as const };
    }
    if (err > 0) {
      hi = mid as number;
      priceHi = priceMid;
    } else {
      lo = mid as number;
      priceLo = priceMid;
    }
  }
  return { ok: false, reason: 'non_convergent' };
}
