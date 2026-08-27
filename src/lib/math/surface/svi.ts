/**
 * Raw SVI evaluation — w(k) = a + b*( rho*(k-m) + sqrt((k-m)^2 + sigma^2) )
 * k = ln(K/F), w = sigma_BS^2 * T
 */

export interface SviParams {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
}

export function sviTotalVariance(k: number, p: SviParams): number {
  const { a, b, rho, m, sigma } = p;
  return a + b * (rho * (k - m) + Math.sqrt((k - m) * (k - m) + sigma * sigma));
}

export function sviImpliedVol(k: number, T: number, p: SviParams): number {
  if (T <= 0) return 0;
  const w = sviTotalVariance(k, p);
  if (w <= 0) return 0;
  return Math.sqrt(w / T);
}
