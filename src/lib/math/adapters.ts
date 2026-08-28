/**
 * Canonical market-unit adapters — the ONLY place raw mathematical derivatives
 * are converted to the terminal's display conventions:
 *
 *   θ    → P&L per calendar day   (raw/365)
 *   charm→ P&L per calendar day   (raw/365)
 *   ν    → P&L per 1 vol point    (raw/100)
 *   vanna→ raw ∂²V/∂S∂σ (1.0 vol scale)
 *
 * Internal math (src/lib/math/*) stays in raw year/1.0-vol units; consumers
 * that render market units import from here — never re-derive conversions.
 */
import { greeksEuropean } from './greeks';
import { priceEuropeanSpot } from './spotBsm';
import {
  asDecimalRate,
  asDecimalVol,
  asYearFraction,
  charmPerDay,
  thetaPerDay,
  vegaPerVolPoint,
} from './units';

export interface MarketGreeks {
  /** BS-Merton price (spot adapter, discounted dividend/risk terms). */
  price: number;
  /** dV/dS (dimensionless, e^{-qT}·N(±d1)). */
  delta: number;
  /** d²V/dS² (per spot unit). */
  gamma: number;
  /** P&L per calendar day (raw/365). */
  theta: number;
  /** P&L per 1 volatility point (raw/100). */
  vega: number;
  /** dV/dr per 1.0 rate — raw (use rhoPerPct/rhoPerBp for display). */
  rho: number;
  /** ∂²V/∂S∂σ on raw-σ scale. */
  vanna: number;
  /** ∂²V/∂σ² on raw-σ scale (vega convexity). */
  volga: number;
  /** -dΔ/dT per calendar day (raw/365). */
  charm: number;
  /** d³V/dS³ (per spot unit²). */
  speed: number;
  /** ∂ν/∂T on raw-year scale. */
  veta: number;
  /** dγ/dT on raw-year scale. */
  color: number;
  /** dγ/dσ on raw-σ scale. */
  zomma: number;
  /** d³V/dσ³ on raw-σ scale. */
  ultima: number;
}

/**
 * Price + Greeks in market units (the old `computeGreeks`/`blackScholes`
 * surface) composed ONLY from canonical raw math + named unit adapters.
 *
 * Boundary behavior (expiry, zero vol, invalid time):
 *  - T ≤ 0 or σ ≤ 0 → discounted intrinsic price; intrinsic delta; zero others.
 *  - non-finite S/K/T/r/q/σ → zero-price zero-Greeks (fail closed, never NaN).
 */
export function priceGreeksMarket(
  side: 'call' | 'put',
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  vol: number,
): MarketGreeks {
  const t = T as number;
  const finite = [S, K, T, r, q, vol].every(Number.isFinite);
  if (!finite || !(S > 0) || !(K > 0)) {
    return { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, vanna: 0, volga: 0, charm: 0, speed: 0, veta: 0, color: 0, zomma: 0, ultima: 0 };
  }
  const priceRes = priceEuropeanSpot(side, S, K, asYearFraction(t), asDecimalRate(r), asDecimalRate(q), asDecimalVol(vol));
  if (!(t > 0) || !(vol > 0)) {
    // Expiry / zero-vol boundary: discounted intrinsic + intrinsic delta.
    const discountedSpot = S * Math.exp(-q * t);
    const discountedStrike = K * Math.exp(-r * t);
    const atm = Math.abs(discountedSpot - discountedStrike) < 1e-12;
    const delta =
      side === 'call' ? (discountedSpot > discountedStrike ? Math.exp(-q * t) : atm ? 0.5 * Math.exp(-q * t) : 0) : (discountedSpot < discountedStrike ? -Math.exp(-q * t) : atm ? -0.5 * Math.exp(-q * t) : 0);
    return {
      price: priceRes.price,
      delta,
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
      vanna: 0,
      volga: 0,
      charm: 0,
      speed: 0,
      veta: 0,
      color: 0,
      zomma: 0,
      ultima: 0,
    };
  }
  const raw = greeksEuropean(side, S, K, asYearFraction(t), asDecimalRate(r), asDecimalRate(q), asDecimalVol(vol));
  // Higher-order Greeks on raw scales (Haug — same formulas as the Python oracle):
  //   volga = ∂²V/∂σ² = vegaRaw·d1·d2/σ, speed = -γ(d1/(σ√T) + 1/S),
  //   veta = ∂ν/∂T, color = ∂γ/∂T, zomma = ∂γ/∂σ, ultima = d³V/dσ³.
  const volSqrtT = vol * Math.sqrt(t);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * vol * vol) * t) / volSqrtT;
  const d2 = d1 - volSqrtT;
  const eq = Math.exp(-q * t);
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  const vegaRaw = raw.vega as unknown as number;
  const gammaRaw = raw.gamma as unknown as number;
  return {
    price: priceRes.price,
    delta: raw.delta,
    gamma: raw.gamma,
    theta: thetaPerDay(raw.theta as unknown as import('./units').RawThetaPerYear),
    vega: vegaPerVolPoint(raw.vega as unknown as import('./units').RawVegaPerVol),
    rho: raw.rho,
    vanna: raw.vanna,
    volga: vegaRaw * d1 * d2 / vol,
    charm: charmPerDay(raw.charm as unknown as import('./units').RawCharmPerYear),
    speed: -gammaRaw * (d1 / volSqrtT + 1 / S),
    veta: -S * eq * pdf * Math.sqrt(t) * (q + ((r - q) * d1) / volSqrtT - (1 + d1 * d2) / (2 * t)),
    color: (-eq * pdf / (S * volSqrtT)) * (2 * q * t + 1 + ((2 * (r - q) * t - d2 * volSqrtT) * d1) / volSqrtT) / (2 * t),
    zomma: gammaRaw * (d1 * d2 - 1) / vol,
    ultima: (-vegaRaw * (d1 * d2 * (1 - d1 * d2) + d1 * d1 + d2 * d2)) / (vol * vol),
  };
}
