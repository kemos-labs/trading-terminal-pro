import type { SviParams } from './svi';

/**
 * Static arbitrage checks in price space and calendar.
 * Per Gatheral/Jacquier, raw SVI positivity is not sufficient.
 */

export interface ArbitrageCheck {
  kind: 'call-price-monotonic' | 'butterfly-convex' | 'calendar' | 'svi-constraints';
  passed: boolean;
  detail?: string;
}

export function checkCallMonotonicity(strikes: number[], callPrices: number[]): ArbitrageCheck {
  for (let i = 1; i < callPrices.length; i++) {
    if (callPrices[i]! > callPrices[i-1]! + 1e-12) {
      return { kind: 'call-price-monotonic', passed: false, detail: `call price increased at strike index ${i}` };
    }
    if (callPrices[i]! < -1e-12) return { kind: 'call-price-monotonic', passed: false, detail: 'negative call price' };
  }
  return { kind: 'call-price-monotonic', passed: true };
}

export function checkButterflyConvexity(strikes: number[], callPrices: number[]): ArbitrageCheck {
  // Discrete convexity: second difference >=0 (butterfly spread >=0)
  for (let i = 1; i < callPrices.length - 1; i++) {
    const left = callPrices[i-1]!, mid = callPrices[i]!, right = callPrices[i+1]!;
    const d1 = strikes[i]! - strikes[i-1]!;
    const d2 = strikes[i+1]! - strikes[i]!;
    if (d1 <=0 || d2 <=0) continue;
    // Weighted convexity check via three-point second derivative
    const slope1 = (mid - left) / d1;
    const slope2 = (right - mid) / d2;
    if (slope2 - slope1 < -1e-10) {
      return { kind: 'butterfly-convex', passed: false, detail: `convexity violation at ${i}` };
    }
  }
  return { kind: 'butterfly-convex', passed: true };
}

export function checkCalendarArbitrage(totalVariances: number[][], _expiriesMs: number[]): ArbitrageCheck {
  // At fixed k, total variance must not decrease with T
  if (totalVariances.length < 2) return { kind: 'calendar', passed: true };
  const strikes = totalVariances[0]!.length;
  for (let k = 0; k < strikes; k++) {
    for (let t = 1; t < totalVariances.length; t++) {
      const prev = totalVariances[t-1]![k];
      const cur = totalVariances[t]![k];
      if (isFinite(prev!) && isFinite(cur!) && cur! + 1e-12 < prev!) {
        return { kind: 'calendar', passed: false, detail: `calendar arb at k=${k} t=${t}` };
      }
    }
  }
  return { kind: 'calendar', passed: true };
}

export function checkSviParams(p: SviParams): ArbitrageCheck {
  if (!(p.b >= 0) || !(p.sigma > 0) || !(Math.abs(p.rho) < 1)) {
    return { kind: 'svi-constraints', passed: false, detail: 'raw positivity violated' };
  }
  // Note: raw positivity alone is NOT labelled arbitrage-free (Gatheral/Jacquier)
  return { kind: 'svi-constraints', passed: true, detail: 'raw positivity only — not sufficient for arb-free' };
}

export function forwardVol(vol1: number, T1: number, vol2: number, T2: number): number | null {
  const var1 = vol1 * vol1 * T1;
  const var2 = vol2 * vol2 * T2;
  const fwdVar = var2 - var1;
  if (fwdVar < -1e-12) return null; // invalid forward variance → unavailable, never clamped
  if (fwdVar < 0) return 0;
  const dT = T2 - T1;
  if (dT <= 0) return null;
  return Math.sqrt(fwdVar / dT);
}
