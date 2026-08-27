import type { DecimalRate, DecimalVol, YearFraction } from './units';

export type OptionSide = 'call' | 'put';
export type ModelKind = 'black76' | 'spot-bsm';

export interface EuropeanInputs {
  /** Forward price F (for Black76) or Spot S (for spot adapter) */
  forwardOrSpot: number;
  strike: number;
  /** Year fraction T = ACT/365F, exact */
  expiryYears: YearFraction;
  /** Risk-free rate r as decimal (e.g. 0.05) */
  rate: DecimalRate;
  /** Dividend / convenience yield q as decimal */
  dividendYield: DecimalRate;
  /** Volatility sigma as decimal */
  vol: DecimalVol;
  side: OptionSide;
}

export interface PriceResult {
  price: number;
  model: ModelKind;
  nativeCurrency: string;
  diagnostics: { d1: number; d2: number; forward: number; df: number };
}

export interface GreeksRaw {
  delta: number; // dV/dS
  gamma: number; // d2V/dS2
  theta: number; // per year
  vega: number; // per 1.0 vol
  rho: number; // per 1.0 rate
  vanna: number; // per 1.0 vol, d delta / d vol
  charm: number; // per year, -d delta / dT
}
