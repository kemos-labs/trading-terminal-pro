export function forwardVol(sigma1: number, T1: number, sigma2: number, T2: number): number | null {
  if (!isFinite(sigma1) || !isFinite(sigma2) || !isFinite(T1) || !isFinite(T2)) return null;
  if (T2 <= T1) return null;
  const var1 = sigma1 * sigma1 * T1;
  const var2 = sigma2 * sigma2 * T2;
  const fwdVar = var2 - var1;
  if (fwdVar < -1e-12) return null;
  if (fwdVar < 0) return 0;
  return Math.sqrt(fwdVar / (T2 - T1));
}
