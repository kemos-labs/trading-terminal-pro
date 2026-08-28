/**
 * Legacy greeks shim — delegates to canonical src/lib/math/greeks + spotBsm + units.
 * Preserves computeGreeks API (per-day theta, per-point vega, raw vanna/charm scaled).
 * New code should import from src/lib/math/greeks directly.
 */
import type { BSResult } from './black-scholes';
import { greeksEuropean } from '../math/greeks';
import { priceEuropeanSpot } from '../math/spotBsm';
import { asDecimalRate, asDecimalVol, asYearFraction } from '../math/units';
import { normPdf } from './black-scholes';

export interface GreeksResult extends BSResult {
  vanna: number;
  charm: number;
  volga: number;
  speed: number;
  veta: number;
  color: number;
  zomma: number;
  ultima: number;
}

const ZERO_GREEKS: GreeksResult = {
  price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0,
  vanna: 0, charm: 0, volga: 0, speed: 0, veta: 0, color: 0, zomma: 0, ultima: 0,
};

export function computeGreeks(
  type: 'call' | 'put',
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  vol: number,
): GreeksResult {
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(vol > 0) || !isFinite(S) || !isFinite(K) || !isFinite(T) || !isFinite(vol) || !isFinite(r) || !isFinite(q)) {
    if (isFinite(S) && isFinite(K) && S > 0 && K > 0) {
      const intrinsic = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
      return { ...ZERO_GREEKS, price: intrinsic, delta: type === 'call' ? (S > K ? 1 : S === K ? 0.5 : 0) : (S < K ? -1 : S === K ? -0.5 : 0) };
    }
    return { ...ZERO_GREEKS };
  }
  // Canonical per-year/per-1-vol
  const raw = greeksEuropean(type, S, K, asYearFraction(T), asDecimalRate(r), asDecimalRate(q), asDecimalVol(vol));
  const price = priceEuropeanSpot(type, S, K, asYearFraction(T), asDecimalRate(r), asDecimalRate(q), asDecimalVol(vol)).price;
  // Display adapters: theta per day, vega per vol point, vanna per vol point, charm per day
  const theta = (raw.theta as unknown as number) / 365;
  const vega = (raw.vega as unknown as number) / 100;
  const vanna = (raw.vanna as unknown as number) * 0.01;
  const charm = (raw.charm as unknown as number) / 365;
  // Higher-order remain as legacy formulas but derived from raw where possible (use raw where available)
  const sqrtT = Math.sqrt(T);
  const volSqrtT = vol * sqrtT;
  const d1 = (Math.log(S / K) + (r - q + 0.5*vol*vol)*T)/volSqrtT;
  const d2 = d1 - volSqrtT;
  const pdf = normPdf(d1);
  const eq = Math.exp(-q*T);
  const vegaRaw = S * eq * pdf * sqrtT;
  const volga = vegaRaw * d1 * d2 / vol;
  const speed = -raw.gamma * (d1 / volSqrtT + 1 / S);
  const veta = -S * eq * pdf * sqrtT * (q + ((r - q) * d1) / volSqrtT - (1 + d1*d2)/(2*T));
  const color = -eq * pdf / (S * volSqrtT) * (2*q*T + 1 + (2*(r - q)*T - d2*volSqrtT)*d1/volSqrtT)/(2*T);
  const zomma = raw.gamma * (d1*d2 - 1)/vol;
  const ultima = -vegaRaw * (d1*d2*(1 - d1*d2) + d1*d1 + d2*d2)/(vol*vol);
  return { price, delta: raw.delta, gamma: raw.gamma, theta, vega, rho: raw.rho as unknown as number, vanna, charm, volga, speed, veta, color, zomma, ultima };
}
