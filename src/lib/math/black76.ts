import { normCdf } from './norm';
import type { DecimalRate, DecimalVol, YearFraction } from './units';

export interface Black76Inputs {
  forward: number;
  strike: number;
  expiryYears: YearFraction;
  rate: DecimalRate;
  vol: DecimalVol;
  side: 'call' | 'put';
}

export interface Black76Price {
  price: number;
  model: 'black76';
  forward: number;
  df: number;
  d1: number;
  d2: number;
}

/**
 * Canonical forward Black price: discounted expectation under forward measure.
 * F, K >0, T>=0, vol>=0.  r is discount rate (not drift).
 */
export function priceEuropeanBlack76(inp: Black76Inputs): Black76Price {
  const { forward: F, strike: K, expiryYears: T, rate: r, vol, side } = inp;
  const df = Math.exp(-(r as number) * (T as number));
  if (!(F > 0) || !(K > 0)) return { price: 0, model: 'black76', forward: F, df, d1: 0, d2: 0 };
  if (!((T as number) > 0)) {
    const intr = side === 'call' ? Math.max(0, F - K) : Math.max(0, K - F);
    return { price: df * intr, model: 'black76', forward: F, df, d1: 0, d2: 0 };
  }
  if (!((vol as number) > 0) || !isFinite(vol as number)) {
    const intr = side === 'call' ? Math.max(0, F - K) : Math.max(0, K - F);
    return { price: df * intr, model: 'black76', forward: F, df, d1: 0, d2: 0 };
  }
  const sigma = vol as number;
  const t = T as number;
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * t) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  let price: number;
  if (side === 'call') price = df * (F * normCdf(d1) - K * normCdf(d2));
  else price = df * (K * normCdf(-d2) - F * normCdf(-d1));
  return { price, model: 'black76', forward: F, df, d1, d2 };
}

export function deltaBlack76(inp: Black76Inputs & { spotForDelta: number }): number {
  // delta wrt spot: df * N(d1) * (dF/dS) but for forward model, dV/dS = df * N(d1) * (F/S) ??? For inverse we expose raw forward delta separately.
  // Here we expose forward delta dV/dF
  const { forward: F, strike: K, expiryYears: T, vol, side } = inp;
  const t = T as number;
  if (!((t) > 0) || !((vol as number) > 0)) {
    if (side === 'call') return F > K ? 1 : 0;
    return F < K ? -1 : 0;
  }
  const sigma = vol as number;
  const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * t) / (sigma * Math.sqrt(t));
  const df = Math.exp(-(inp.rate as number) * t);
  if (side === 'call') return df * normCdf(d1);
  return -df * normCdf(-d1);
}
