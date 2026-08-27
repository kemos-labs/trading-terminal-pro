/**
 * Perpetual funding — preserves native interval rate and labels annualizations explicitly.
 * Deribit: premium = (mark - index)/index, damper ±0.025%, caps per instrument.
 */

export interface FundingSnapshot {
  venue: string;
  instrument: string;
  rawRate8h: number; // native 8h decimal (e.g. 0.0001 = 1bp)
  rawRate1h?: number;
  premium?: number; // (mark-index)/index if supplied
  cap?: number;
  damperApplied?: boolean;
  direction: 'longs_pay_shorts' | 'shorts_pay_longs' | 'none';
  timestamp: number;
  simpleAnnualizedRunRate: number; // rate8h * 1095  (365*3)
}

export function toFundingSnapshot(
  venue: string,
  instrument: string,
  rate8h: number,
  timestamp: number,
  opts?: { rate1h?: number; premium?: number; cap?: number; damperApplied?: boolean },
): FundingSnapshot {
  const direction = rate8h > 0 ? 'longs_pay_shorts' : rate8h < 0 ? 'shorts_pay_longs' : 'none';
  const simpleAnnualizedRunRate = rate8h * 1095; // 3*365
  return {
    venue,
    instrument,
    rawRate8h: rate8h,
    rawRate1h: opts?.rate1h,
    premium: opts?.premium,
    cap: opts?.cap,
    damperApplied: opts?.damperApplied,
    direction,
    timestamp,
    simpleAnnualizedRunRate,
  };
}
