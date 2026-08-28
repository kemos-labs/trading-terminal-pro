/**
 * Canonical SVI calibration — Gatheral raw SVI w(k) = a + b·(ρ·(k−m) + √((k−m)² + σ²))
 * on forward log-moneyness k = ln(K/F) and total variance w = σ²·T.
 *
 * Levenberg–Marquardt fit with no-arbitrage projection. Single implementation —
 * consumers (yahoo, interpolate, surfaceTools, SmileView) import from here only.
 */
import { sviImpliedVol, sviTotalVariance, type SviParams } from './svi';

export type { SviParams };

export interface SviFitResult {
  params: SviParams;
  rmse: number;
  samples: number;
}

/** Pure SVI total variance evaluation (convenience for consumers). */
export function svi(param: SviParams, k: number): number {
  return sviTotalVariance(k, param);
}

/** Implied vol from SVI total variance: σ = √(max(w,0) / T). */
export function sviIv(param: SviParams, k: number, T: number): number {
  return sviImpliedVol(k, T, param);
}

const NO_ARB_EPS = 1e-9;
const PROJECT_B_MIN = 1e-4;
const PROJECT_SIGMA_MIN = 1e-4;
const PROJECT_RHO_BOUND = 0.999;

/**
 * Project SVI parameters onto the no-arbitrage (no-calendar + no-butterfly)
 * feasible set on total variance w(k).
 *
 * Constraints enforced:
 *   b >= 1e-4            (positive slope, no calendar arb)
 *   |rho| <= 0.999       (slope bounded by asymptotes)
 *   sigma >= 1e-4        (positive smile curvature)
 *   a + b * sigma * sqrt(1 - rho^2) >= 0   (no butterfly arbitrage)
 */
export function projectNoArb(p: SviParams): SviParams {
  const b = Math.max(p.b, PROJECT_B_MIN);
  const rho = Math.max(-PROJECT_RHO_BOUND, Math.min(PROJECT_RHO_BOUND, p.rho));
  const sigma = Math.max(p.sigma, PROJECT_SIGMA_MIN);
  let a = p.a;
  const butterfly = a + b * sigma * Math.sqrt(1 - rho * rho);
  if (butterfly < 0) {
    a = -b * sigma * Math.sqrt(1 - rho * rho) + NO_ARB_EPS;
  }
  return { a, b, rho, m: p.m, sigma };
}

/**
 * Jacobian of the SVI model w.r.t. {a, b, rho, m, sigma} at log-moneyness k.
 */
export function sviJacobian(p: SviParams, k: number): [number, number, number, number, number] {
  const { b, rho, m, sigma } = p;
  const dk = k - m;
  const dist = Math.sqrt(dk * dk + sigma * sigma);
  const term = rho * dk + dist;
  return [
    1,
    term,
    b * dk,
    b * (-rho - dk / dist),
    b * (sigma / dist),
  ];
}

function residual(p: SviParams, k: number, w: number): number {
  return svi(p, k) - w;
}

function sse(p: SviParams, samples: { k: number; w: number }[]): number {
  let s = 0;
  for (const { k, w } of samples) {
    const r = residual(p, k, w);
    s += r * r;
  }
  return s;
}

function solve5x5(A: number[][], rhs: number[]): number[] {
  const M: number[][] = A.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < 5; col++) {
    let pivot = col;
    let best = Math.abs(M[col]![col]!);
    for (let r = col + 1; r < 5; r++) {
      const v = Math.abs(M[r]![col]!);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (best < 1e-18) continue;
    if (pivot !== col) {
      const tmp = M[pivot]!;
      M[pivot] = M[col]!;
      M[col] = tmp;
    }
    const pivVal = M[col]![col]!;
    for (let r = 0; r < 5; r++) {
      if (r === col) continue;
      const factor = M[r]![col]! / pivVal;
      if (factor === 0) continue;
      for (let c = col; c <= 5; c++) {
        M[r]![c] = (M[r]![c] ?? 0) - factor * (M[col]![c] ?? 0);
      }
    }
  }
  const x: number[] = [0, 0, 0, 0, 0];
  for (let i = 0; i < 5; i++) {
    const piv = M[i]![i]!;
    x[i] = Math.abs(piv) < 1e-18 ? 0 : (M[i]![5]! ?? 0) / piv;
  }
  return x;
}

/**
 * Fit raw SVI to an implied-volatility smile on forward moneyness.
 *
 * Fits w(k) = IV²·T (canonical Gatheral raw SVI). Pass the year fraction T
 * for the expiry being fit. When T is omitted, defaults to 1 (fit on variance
 * units with unit time — only appropriate for synthetic/unit tests).
 *
 * @param strikes  strike prices
 * @param ivs      implied vols (decimal σ), parallel to strikes
 * @param spot     reference spot/forward for k = log(K/spot)
 * @param T        time to expiry in years (default 1)
 */
export function fitSVI(
  strikes: number[],
  ivs: (number | null)[],
  spot: number,
  T = 1,
): SviFitResult | null {
  if (spot <= 0 || !isFinite(spot)) return null;
  const yearFrac = Math.max(T, 1e-8);

  const samples: { k: number; w: number }[] = [];
  for (let i = 0; i < strikes.length; i++) {
    const iv = ivs[i];
    const strike = strikes[i];
    if (strike == null || iv == null) continue;
    if (!isFinite(strike) || !isFinite(iv)) continue;
    if (strike <= 0 || iv <= 0) continue;
    const k = Math.log(strike / spot);
    if (!isFinite(k)) continue;
    // Total variance w = σ² T
    samples.push({ k, w: iv * iv * yearFrac });
  }
  if (samples.length < 5) return null;

  const kVals = samples.map(s => s.k);
  const kMin = Math.min(...kVals);
  const kMax = Math.max(...kVals);
  const width = Math.max(kMax - kMin, 1e-6);

  const wMean = samples.reduce((acc, s) => acc + s.w, 0) / samples.length;
  const wMin = Math.min(...samples.map(s => s.w));
  // a ~ minimum total variance; b ~ vertical scale of w(k)
  const aEst = Math.max(wMin, 1e-6) * 0.5;
  const left = samples[0]!.w;
  const right = samples[samples.length - 1]!.w;
  const rhoEst = Math.max(-0.5, Math.min(0.5, (right - left) / Math.max(wMean, 1e-6)));
  const mEst = (kMin + kMax) / 2;
  const sigmaEst = Math.max(width / 4, 1e-2);
  const bEst = Math.max((wMean - aEst) / Math.max(sigmaEst, 1e-3), 1e-4);

  let params = projectNoArb({
    a: aEst,
    b: bEst,
    rho: rhoEst,
    m: mEst,
    sigma: sigmaEst,
  });

  const n = samples.length;
  const MAX_ITER = 100;
  const REL_TOL = 1e-10;
  let lambda = 1e-3;
  let prevSSE = sse(params, samples);

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const JtJ = [
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ];
    const Jtr = [0, 0, 0, 0, 0];
    for (const { k, w } of samples) {
      const jac = sviJacobian(params, k);
      const r = residual(params, k, w);
      for (let i = 0; i < 5; i++) {
        Jtr[i]! += jac[i]! * r;
        for (let j = 0; j < 5; j++) {
          JtJ[i]![j]! += jac[i]! * jac[j]!;
        }
      }
    }

    const A: number[][] = JtJ.map((row, i) => {
      const d = row[i]!;
      const diag = d <= 0 ? lambda : lambda * d;
      return row.map((v, j) => (i === j ? v + diag : v));
    });

    const delta = solve5x5(A, Jtr);
    if (!delta.every(isFinite)) {
      lambda *= 2;
      if (lambda > 1e12) break;
      continue;
    }

    const trial = projectNoArb({
      a: params.a - delta[0]!,
      b: params.b - delta[1]!,
      rho: params.rho - delta[2]!,
      m: params.m - delta[3]!,
      sigma: params.sigma - delta[4]!,
    });

    const trialSSE = sse(trial, samples);
    if (trialSSE < prevSSE) {
      const improvement = prevSSE - trialSSE;
      params = trial;
      lambda *= 0.7;
      if (improvement / Math.max(prevSSE, 1e-30) < REL_TOL) {
        prevSSE = trialSSE;
        break;
      }
      prevSSE = trialSSE;
    } else {
      lambda *= 2;
      if (lambda > 1e12) break;
    }
  }

  const finalSSE = sse(params, samples);
  // RMSE in total-variance units
  const rmse = Math.sqrt(finalSSE / n);
  return { params, rmse, samples: n };
}