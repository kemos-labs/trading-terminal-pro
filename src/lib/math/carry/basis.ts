/**
 * Dated future basis — distinct fields for absolute/percentage/simple/log annualizations.
 * T = ACT/365F exact.
 */

export interface BasisPoint {
  instrument: string;
  spot: number;
  futurePrice: number;
  expiryMs: number;
  asOfMs: number;
  absolute: number; // F - S
  percentage: number; // F/S -1
  simpleAnnualized: number; // (F/S -1)/T
  logAnnualized: number; // ln(F/S)/T
  dte: number;
  isModelled: boolean;
}

export function computeBasis(
  spot: number,
  futurePrice: number,
  expiryMs: number,
  asOfMs: number,
  opts?: { isModelled?: boolean; instrument?: string },
): BasisPoint | null {
  if (!isFinite(spot) || !isFinite(futurePrice) || spot <= 0 || futurePrice <= 0) return null;
  const T = (expiryMs - asOfMs) / (365 * 24 * 3600 * 1000);
  if (T <= 0) return null;
  const absolute = futurePrice - spot;
  const percentage = futurePrice / spot - 1;
  const simpleAnnualized = percentage / T;
  const logAnnualized = Math.log(futurePrice / spot) / T;
  const dte = T * 365;
  return {
    instrument: opts?.instrument ?? 'FUT',
    spot,
    futurePrice,
    expiryMs,
    asOfMs,
    absolute,
    percentage,
    simpleAnnualized,
    logAnnualized,
    dte,
    isModelled: !!opts?.isModelled,
  };
}
