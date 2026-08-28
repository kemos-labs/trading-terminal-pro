/**
 * Legacy black-scholes shim — delegates to canonical src/lib/math (Black76 + spotBsm + greeks).
 * Preserves API for existing consumers; new code should import from src/lib/math directly.
 */
import { priceEuropeanSpot } from '../math/spotBsm';
import { greeksEuropean } from '../math/greeks';
import { asDecimalRate, asDecimalVol, asYearFraction } from '../math/units';
import { normCdf as canonCdf, normPdf as canonPdf } from '../math/norm';

// Re-export normal helpers from canonical (same Abramowitz)
export function normCdf(x: number): number { return canonCdf(x); }
export function normPdf(x: number): number { return canonPdf(x); }

export interface BSResult {
  price: number;
  delta: number;
  gamma: number;
  theta: number; // per year raw (divide by 365 for per-day)
  vega: number; // per 1 vol (divide by 100 for per-point)
  rho: number;
}

/**
 * Black-Scholes-Merton via canonical spot adapter.
 * Uses exact forward F=S*exp((r-q)T) and canonical Greeks; no independent formula.
 */
export function blackScholes(
  type: 'call' | 'put',
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  vol: number,
): BSResult {
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(vol > 0) || !isFinite(vol) || !isFinite(S) || !isFinite(K) || !isFinite(T)) {
    const intrinsic = type === 'call' ? Math.max(S * Math.exp(-q * T) - K * Math.exp(-r * T), 0) : Math.max(K * Math.exp(-r * T) - S * Math.exp(-q * T), 0);
    return { price: intrinsic, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const priceRes = priceEuropeanSpot(type, S, K, asYearFraction(T), asDecimalRate(r), asDecimalRate(q), asDecimalVol(vol));
  const raw = greeksEuropean(type, S, K, asYearFraction(T), asDecimalRate(r), asDecimalRate(q), asDecimalVol(vol));
  return {
    price: priceRes.price,
    delta: raw.delta,
    gamma: raw.gamma,
    theta: raw.theta as unknown as number,
    vega: raw.vega as unknown as number,
    rho: raw.rho as unknown as number,
  };
}
