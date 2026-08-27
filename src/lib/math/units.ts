/**
 * Branded units — prevents accidental mixing of decimal vs percent vs day-scaled values.
 * Internal math uses decimals for rates/vols and years for time; display adapters convert.
 */

export type DecimalRate = number & { readonly __brand: 'DecimalRate' };
export type DecimalVol = number & { readonly __brand: 'DecimalVol' };
export type YearFraction = number & { readonly __brand: 'YearFraction' };
export type QuotePrice = number & { readonly __brand: 'QuotePrice' };

export type RawThetaPerYear = number & { readonly __brand: 'RawThetaPerYear' };
export type RawVegaPerVol = number & { readonly __brand: 'RawVegaPerVol' };
export type RawRhoPerRate = number & { readonly __brand: 'RawRhoPerRate' };
export type RawVannaPerVol = number & { readonly __brand: 'RawVannaPerVol' };
export type RawCharmPerYear = number & { readonly __brand: 'RawCharmPerYear' };

export function asDecimalRate(v: number): DecimalRate { return v as DecimalRate; }
export function asDecimalVol(v: number): DecimalVol { return v as DecimalVol; }
export function asYearFraction(v: number): YearFraction { return v as YearFraction; }
export function asQuotePrice(v: number): QuotePrice { return v as QuotePrice; }

export function thetaPerDay(thetaPerYear: RawThetaPerYear): number { return (thetaPerYear as number) / 365; }
export function vegaPerVolPoint(vegaRaw: RawVegaPerVol): number { return (vegaRaw as number) / 100; }
export function rhoPerPct(rhoRaw: RawRhoPerRate): number { return (rhoRaw as number) / 100; }
export function rhoPerBp(rhoRaw: RawRhoPerRate): number { return (rhoRaw as number) / 10000; }
export function vannaPerVolPoint(vannaRaw: RawVannaPerVol): number { return (vannaRaw as number) * 0.01; }
export function charmPerDay(charmRaw: RawCharmPerYear): number { return (charmRaw as number) / 365; }

/** ACT/365F year fraction for 24/7 crypto (exact calendar days). */
export function yearFractionAct365(fromMs: number, toMs: number): YearFraction {
  const msPerYear = 365 * 24 * 3600 * 1000;
  return ((toMs - fromMs) / msPerYear) as YearFraction;
}
