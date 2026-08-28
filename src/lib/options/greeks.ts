import type { BSResult } from './black-scholes';
import { normCdf, normPdf } from './black-scholes';

export interface GreeksResult extends BSResult {
  /** Second-order Greek: sensitivity of delta to volatility changes */
  vanna: number;
  /** Second-order Greek: sensitivity of delta to time decay */
  charm: number;
  /** Second-order Greek: sensitivity of vega to volatility changes (convexity) */
  volga: number;
  /** Third-order Greek: sensitivity of gamma to underlying price changes */
  speed: number;
  /** Second-order Greek: sensitivity of vega to time decay */
  veta: number;
  /** Third-order Greek: sensitivity of gamma to time decay */
  color: number;
  /** Third-order Greek: sensitivity of gamma to volatility changes */
  zomma: number;
  /** Third-order Greek: sensitivity of vega to volatility changes (higher order) */
  ultima: number;
}

/**
 * Calculates comprehensive option Greeks including first, second, and third order sensitivities
 * Extends the basic Black-Scholes model with higher-order Greeks for advanced risk analysis
 * 
 * @param type - Option type ('call' or 'put')
 * @param S - Current spot price of the underlying asset
 * @param K - Strike price of the option
 * @param T - Time to expiration in years
 * @param r - Risk-free interest rate (as decimal)
 * @param q - Dividend yield (as decimal)
 * @param vol - Implied volatility (as decimal)
 * @returns Object containing option price and all Greeks
 */
const ZERO_GREEKS: GreeksResult = {
  price: 0,
  delta: 0,
  gamma: 0,
  theta: 0,
  vega: 0,
  rho: 0,
  vanna: 0,
  charm: 0,
  volga: 0,
  speed: 0,
  veta: 0,
  color: 0,
  zomma: 0,
  ultima: 0,
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
  // Mirror MacroVol compute_greeks: refuse singular T/σ (avoid NaN → GEX pollution).
  if (
    !(S > 0)
    || !(K > 0)
    || !(T > 0)
    || !(vol > 0)
    || !Number.isFinite(S)
    || !Number.isFinite(K)
    || !Number.isFinite(T)
    || !Number.isFinite(vol)
    || !Number.isFinite(r)
    || !Number.isFinite(q)
  ) {
    // Intrinsic-ish price only when S,K finite; else full zeros.
    if (Number.isFinite(S) && Number.isFinite(K) && S > 0 && K > 0) {
      const intrinsic = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
      return { ...ZERO_GREEKS, price: intrinsic, delta: type === 'call' ? (S > K ? 1 : S === K ? 0.5 : 0) : (S < K ? -1 : S === K ? -0.5 : 0) };
    }
    return { ...ZERO_GREEKS };
  }

  const sqrtT = Math.sqrt(T);
  const volSqrtT = vol * sqrtT;
  const d1 = (Math.log(S / K) + (r - q + vol * vol / 2) * T) / volSqrtT;
  const d2 = d1 - volSqrtT;

  const pdf = normPdf(d1);
  const sign = type === 'call' ? 1 : -1;

  const eq = Math.exp(-q * T);
  const ert = Math.exp(-r * T);

  const delta = sign * eq * (type === 'call' ? normCdf(d1) : normCdf(-d1));
  const gamma = eq * pdf / (S * volSqrtT);
  // Raw mathematical vega (dV/dσ) and theta (dV/dT, T in years).
  const vegaRaw = S * eq * pdf * sqrtT;
  // BS θ (per year): diffusion term shared; r/q terms flip with call vs put.
  // put r-term is +rKe^{-rT}N(-d2) — not -rK·nd2 with put nd2 (that double-flips wrong).
  const thetaRaw = (-eq * S * pdf * vol / (2 * sqrtT)
    + (type === 'call'
      ? -r * K * ert * normCdf(d2) + q * S * eq * normCdf(d1)
      : +r * K * ert * normCdf(-d2) - q * S * eq * normCdf(-d1)));
  // Market convention used across the terminal:
  //   θ  → P&L per calendar day   (raw / 365)
  //   ν  → P&L per 1 volatility point (raw / 100)
  const vega = vegaRaw / 100;
  const theta = thetaRaw / 365;
  const rho = sign * K * T * ert * (type === 'call' ? normCdf(d2) : normCdf(-d2));

  const price = type === 'call'
    ? S * eq * normCdf(d1) - K * ert * normCdf(d2)
    : K * ert * normCdf(-d2) - S * eq * normCdf(-d1);

  // Higher-order greeks. Market desk convention (aligned with MacroVol / Greeks 1.0):
  //   charm → per calendar day (raw ∂Δ/∂T / 365) — same unit family as θ
  //   vanna → ∂²V/∂S∂σ on raw-σ scale
  //   volga / veta / color stay on mathematical year / raw-σ scale
  const vanna = -eq * pdf * d2 / vol;
  const charmCore = pdf * (2 * (r - q) * T - d2 * volSqrtT) / (2 * T * volSqrtT);
  const nd1Call = type === 'call' ? normCdf(d1) : normCdf(-d1);
  const charmAnnual = type === 'call'
    ? -eq * (charmCore - q * nd1Call)
    : -eq * (charmCore + q * nd1Call);
  const charm = charmAnnual / 365;
  const volga = vegaRaw * d1 * d2 / vol;
  const speed = -gamma * (d1 / volSqrtT + 1 / S);
  // Veta = ∂ν/∂T (year); includes full Haug terms
  const veta = -S * eq * pdf * sqrtT * (
    q + ((r - q) * d1) / volSqrtT - (1 + d1 * d2) / (2 * T)
  );
  const color = -eq * pdf / (S * volSqrtT) * (
    2 * q * T + 1
    + (2 * (r - q) * T - d2 * volSqrtT) * d1 / volSqrtT
  ) / (2 * T);
  const zomma = gamma * (d1 * d2 - 1) / vol;
  const ultima = -vegaRaw * (d1 * d2 * (1 - d1 * d2) + d1 * d1 + d2 * d2) / (vol * vol);

  return { price, delta, gamma, theta, vega, rho, vanna, charm, volga, speed, veta, color, zomma, ultima };
}
