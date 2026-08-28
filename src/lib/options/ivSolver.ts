/**
 * Legacy ivSolver shim — delegates to canonical src/lib/math/impliedVol.ts
 * No 0.99 tolerance, no near-expiry proxy, exact bounds via Black76/spotBsm.
 * Kept for compatibility until last consumer migrates to canonical.
 */
import { solveImpliedVol } from '../math/impliedVol';
import { asDecimalRate, asYearFraction } from '../math/units';

export function impliedVol(
  type: 'call' | 'put',
  marketPrice: number,
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
): number | null {
  if (!isFinite(marketPrice) || !isFinite(S) || !isFinite(K) || !isFinite(T) || !isFinite(r) || !isFinite(q)) return null;
  if (marketPrice <= 0 || T <= 0 || S <= 0 || K <= 0) return null;
  // Canonical exact bounds check is inside solveImpliedVol — no 0.99 tolerance
  const res = solveImpliedVol(type, S, K, asYearFraction(T), asDecimalRate(r), asDecimalRate(q), marketPrice);
  if (!res.ok) return null;
  const iv = res.sigma as unknown as number;
  return isFinite(iv) && iv > 0 ? iv : null;
}
