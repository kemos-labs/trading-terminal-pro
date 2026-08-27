/**
 * Pure Black–Scholes–Merton math for the Option Calculator page.
 *
 * Self-contained and dependency-free: standard-normal helpers, per-option
 * price/Greeks, log-normal probability of exceeding a barrier, and pure
 * position-level aggregations (entry cost, intrinsic payoff, model value,
 * breakevens, extremes, probability of profit). No I/O, no React, no state —
 * every function is a deterministic mapping of its arguments.
 *
 * Unit conventions (matching src/lib/options/black-scholes.ts):
 *   - T      : years (365-day convention)
 *   - r, q   : continuous annual rates as decimals
 *   - vol/iv : annualized decimal (0.50 = 50 vols)
 *   - premium: quote-currency per contract (USD on Deribit BTC/ETH)
 */

export type OptionType = 'call' | 'put';
export type LegSide = 'buy' | 'sell';

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Standard normal PDF. */
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/** Standard normal CDF — Abramowitz & Stegun 26.2.17 (|ε| < 1.5e-7). */
export function normCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

export interface BsGreeks {
  /** Premium per unit underlying. */
  price: number;
  delta: number;
  gamma: number;
  /** ∂V/∂σ with σ decimal (divide by 100 for P&L per vol point). */
  vega: number;
  /** ∂V/∂T per year (divide by 365 for per-calendar-day θ; negative for long options). */
  theta: number;
}

function d1d2(
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  vol: number,
): { d1: number; d2: number; sqrtT: number } {
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (vol * vol) / 2) * T) / (vol * sqrtT);
  return { d1, d2: d1 - vol * sqrtT, sqrtT };
}

function intrinsic(type: OptionType, S: number, K: number): number {
  return type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
}

/** BSM premium. At/after expiry returns intrinsic; zero vol → discounted forward intrinsic. */
export function bsPrice(
  type: OptionType,
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  vol: number,
): number {
  if (!(S > 0) || !(K > 0)) return 0;
  if (!(T > 0)) return intrinsic(type, S, K);
  if (!(vol > 0) || !isFinite(vol)) {
    const fwdIntr = S * Math.exp(-q * T) - K * Math.exp(-r * T);
    return Math.max(0, type === 'call' ? fwdIntr : -fwdIntr);
  }
  const { d1, d2 } = d1d2(S, K, T, r, q, vol);
  if (type === 'call') {
    return S * Math.exp(-q * T) * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  }
  return K * Math.exp(-r * T) * normCdf(-d2) - S * Math.exp(-q * T) * normCdf(-d1);
}

/** BSM premium plus first-order Greeks (raw mathematical units — see header). */
export function bsGreeks(
  type: OptionType,
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  vol: number,
): BsGreeks {
  if (!(S > 0) || !(K > 0)) {
    return { price: 0, delta: 0, gamma: 0, vega: 0, theta: 0 };
  }
  if (!(T > 0)) {
    const px = intrinsic(type, S, K);
    let delta = 0;
    if (type === 'call') delta = S > K ? 1 : S < K ? 0 : 0.5;
    else delta = S < K ? -1 : S > K ? 0 : -0.5;
    return { price: px, delta, gamma: 0, vega: 0, theta: 0 };
  }
  if (!(vol > 0) || !isFinite(vol)) {
    return { price: bsPrice(type, S, K, T, r, q, vol), delta: 0, gamma: 0, vega: 0, theta: 0 };
  }
  const { d1, d2, sqrtT } = d1d2(S, K, T, r, q, vol);
  const dfQ = Math.exp(-q * T);
  const dfR = Math.exp(-r * T);
  const nd1 = normPdf(d1);
  const gamma = (dfQ * nd1) / (S * vol * sqrtT);
  const vega = S * dfQ * nd1 * sqrtT;
  if (type === 'call') {
    return {
      price: S * dfQ * normCdf(d1) - K * dfR * normCdf(d2),
      delta: dfQ * normCdf(d1),
      gamma,
      vega,
      theta:
        (-dfQ * S * nd1 * vol) / (2 * sqrtT)
        - r * K * dfR * normCdf(d2)
        + q * S * dfQ * normCdf(d1),
    };
  }
  return {
    price: K * dfR * normCdf(-d2) - S * dfQ * normCdf(-d1),
    delta: -dfQ * normCdf(-d1),
    gamma,
    vega,
    theta:
      (-dfQ * S * nd1 * vol) / (2 * sqrtT)
      + r * K * dfR * normCdf(-d2)
      - q * S * dfQ * normCdf(-d1),
  };
}

/**
 * P(S_T > K) under the risk-neutral log-normal terminal distribution.
 * Reduces to the deterministic forward comparison at zero vol / zero time.
 */
export function probAbove(
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  vol: number,
): number {
  if (!(S > 0) || !(K > 0)) return 0;
  if (!(T > 0)) return S > K ? 1 : S < K ? 0 : 0.5;
  if (!(vol > 0) || !isFinite(vol)) {
    const f = S * Math.exp((r - q) * T);
    return f > K ? 1 : f < K ? 0 : 0.5;
  }
  const d2 = (Math.log(S / K) + (r - q - (vol * vol) / 2) * T) / (vol * Math.sqrt(T));
  return normCdf(d2);
}

// ---------------------------------------------------------------------------
// Position-level primitives
// ---------------------------------------------------------------------------

/** One calculator leg. `premium` is the ENTRY premium locked at trade time. */
export interface CalcLeg {
  id: string;
  side: LegSide;
  /** Contracts (≥ 0). Deribit BTC/ETH options have a 1-underlying contract size. */
  qty: number;
  type: OptionType;
  strike: number;
  /** Entry implied vol, decimal. */
  iv: number;
  /** Entry premium paid (buy) or received (sell), per contract. */
  premium: number;
}

/**
 * A leg resolved onto an evaluation horizon: `T` is the years remaining used
 * for BSM repricing (caller scales it for "now", "1 DTE before", … views).
 */
export interface PositionedLeg extends CalcLeg {
  T: number;
}

export function legSign(side: LegSide): number {
  return side === 'buy' ? 1 : -1;
}

/** Signed net entry cost: > 0 debit paid, < 0 credit received. */
export function entryCost(legs: CalcLeg[]): number {
  let c = 0;
  for (const l of legs) {
    if (!(l.qty > 0)) continue;
    c += legSign(l.side) * l.qty * l.premium;
  }
  return c;
}

/** Position value at expiry (intrinsic only, premiums excluded). */
export function intrinsicValue(legs: CalcLeg[], S: number): number {
  let v = 0;
  for (const l of legs) {
    if (!(l.qty > 0)) continue;
    v += legSign(l.side) * l.qty * intrinsic(l.type, S, l.strike);
  }
  return v;
}

/** P&L at expiry relative to entry premiums. */
export function pnlAtExpiry(legs: CalcLeg[], S: number): number {
  return intrinsicValue(legs, S) - entryCost(legs);
}

/** BSM value of the position at spot `S` on each leg's horizon `l.T`. */
export function positionModelValue(
  legs: PositionedLeg[],
  S: number,
  r: number,
  q: number,
  ivShift = 0,
): number {
  let v = 0;
  for (const l of legs) {
    if (!(l.qty > 0)) continue;
    v += legSign(l.side) * l.qty * bsPrice(l.type, S, l.strike, l.T, r, q, Math.max(1e-4, l.iv + ivShift));
  }
  return v;
}

/** Mark-to-model P&L now = model value − entry cost. */
export function positionPnl(
  legs: PositionedLeg[],
  S: number,
  r: number,
  q: number,
  ivShift = 0,
): number {
  return positionModelValue(legs, S, r, q, ivShift) - entryCost(legs);
}

// ---------------------------------------------------------------------------
// Payoff analysis over a spot range
// ---------------------------------------------------------------------------

export interface PayoffExtremes {
  min: number;
  max: number;
  minAt: number;
  maxAt: number;
  /** Payoff still rising at the right scan edge → gain is unbounded above. */
  risingAtRight: boolean;
  /** Payoff still falling at the left scan edge → loss is unbounded below. */
  fallingAtLeft: boolean;
}

/** Scan a payoff function over [sMin, sMax] for extremes and edge behavior. */
export function scanExtremes(
  f: (s: number) => number,
  sMin: number,
  sMax: number,
  steps = 900,
): PayoffExtremes {
  let min = Infinity;
  let max = -Infinity;
  let minAt = sMin;
  let maxAt = sMin;
  const n = Math.max(2, Math.floor(steps));
  for (let i = 0; i <= n; i++) {
    const x = sMin + ((sMax - sMin) * i) / n;
    const y = f(x);
    if (y < min) { min = y; minAt = x; }
    if (y > max) { max = y; maxAt = x; }
  }
  // Edge behavior: slope over a small probe just inside each boundary.
  const probe = Math.max((sMax - sMin) * 1e-4, 1e-9);
  const risingAtRight = sMax - probe > sMin && f(sMax) - f(sMax - probe) > 1e-9;
  const fallingAtLeft = sMin + probe < sMax && f(sMin + probe) - f(sMin) < -1e-9;
  return { min, max, minAt, maxAt, risingAtRight, fallingAtLeft };
}

/**
 * Roots of the payoff function in [sMin, sMax] via grid scan + bisection
 * (80 iterations per bracket). Deduped within 1e-6 of the scanned span.
 */
export function findBreakevens(
  f: (s: number) => number,
  sMin: number,
  sMax: number,
  steps = 1600,
): number[] {
  const roots: number[] = [];
  const n = Math.max(2, Math.floor(steps));
  const dedup = (span: number) => span * 1e-6;
  let lo = sMin;
  let fLo = f(lo);
  for (let i = 1; i <= n; i++) {
    const hi = sMin + ((sMax - sMin) * i) / n;
    const fHi = f(hi);
    if (fLo === 0) pushRoot(roots, lo, dedup(sMax - sMin));
    else if (fLo * fHi < 0) {
      let a = lo;
      let b = hi;
      let fa = fLo;
      for (let k = 0; k < 80; k++) {
        const m = 0.5 * (a + b);
        const fm = f(m);
        if (fa * fm <= 0) b = m;
        else { a = m; fa = fm; }
      }
      pushRoot(roots, 0.5 * (a + b), dedup(sMax - sMin));
    }
    lo = hi;
    fLo = fHi;
  }
  return roots;

  function pushRoot(arr: number[], x: number, eps: number): void {
    if (!arr.some((v) => Math.abs(v - x) <= eps)) arr.push(x);
  }
}

/**
 * Probability that a payoff function is positive at expiry, integrating the
 * indicator over the risk-neutral log-normal terminal density of S_T
 * (z-grid ±6σ, pdf-weighted and renormalized over the grid).
 */
export function probProfitLognormal(
  pnlFn: (s: number) => number,
  S: number,
  T: number,
  r: number,
  q: number,
  vol: number,
  n = 481,
): number {
  if (!(S > 0)) return NaN;
  if (!(T > 0) || !(vol > 0) || !isFinite(vol)) {
    // Deterministic terminal price.
    const st = S * Math.exp((r - q) * Math.max(0, T));
    return pnlFn(st) > 0 ? 1 : 0;
  }
  const sig = vol * Math.sqrt(T);
  const drift = (r - q - (vol * vol) / 2) * T;
  let hits = 0;
  let wSum = 0;
  const steps = Math.max(17, Math.floor(n));
  for (let i = 0; i < steps; i++) {
    const z = -6 + (12 * i) / (steps - 1);
    const w = normPdf(z);
    const st = S * Math.exp(drift + z * sig);
    if (st > 0 && pnlFn(st) > 0) hits += w;
    wSum += w;
  }
  return wSum > 0 ? hits / wSum : NaN;
}
