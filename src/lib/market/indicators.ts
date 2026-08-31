/**
 * Technical indicators computed locally from a price series.
 *
 * These run client-side so we don't burn FMP quota on per-indicator API
 * calls (Free plan = 250 req/day). All functions take/return arrays aligned
 * to the input. Warm-up values are `null` (Unavailable) — never NaN — so a
 * missing indicator value cannot cross a rendering or serialization boundary
 * as NaN/Infinity.
 */

export interface PricePoint {
  date: string;
  close: number;
}

/** A numeric series aligned to the input; null = warm-up / unavailable. */
export type IndicatorSeriesValues = Array<number | null>;

function sma(values: number[], period: number): IndicatorSeriesValues {
  const out: IndicatorSeriesValues = Array.from({ length: values.length }, () => null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values: number[], period: number): IndicatorSeriesValues {
  const out: IndicatorSeriesValues = Array.from({ length: values.length }, () => null);
  const k = 2 / (period + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (i < period - 1) continue;
    if (isNaN(prev)) {
      // seed with the SMA of the first `period` values
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += values[j]!;
      prev = s / period;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI. */
function rsi(values: number[], period = 14): IndicatorSeriesValues {
  const out: IndicatorSeriesValues = Array.from({ length: values.length }, () => null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i]! - values[i - 1]!;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i]! - values[i - 1]!;
    const g = diff >= 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function bollinger(
  values: number[],
  period = 20,
  mult = 2,
): { mid: IndicatorSeriesValues; upper: IndicatorSeriesValues; lower: IndicatorSeriesValues } {
  const mid = sma(values, period);
  const upper: IndicatorSeriesValues = Array.from({ length: values.length }, () => null);
  const lower: IndicatorSeriesValues = Array.from({ length: values.length }, () => null);
  for (let i = period - 1; i < values.length; i++) {
    const m = mid[i];
    if (m == null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (values[j]! - m) ** 2;
    const sd = Math.sqrt(variance / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

export interface IndicatorSeries {
  sma20: IndicatorSeriesValues;
  sma50: IndicatorSeriesValues;
  ema20: IndicatorSeriesValues;
  rsi14: IndicatorSeriesValues;
  bollinger: { mid: IndicatorSeriesValues; upper: IndicatorSeriesValues; lower: IndicatorSeriesValues };
}

export function computeIndicators(prices: PricePoint[]): IndicatorSeries {
  const closes = prices.map((p) => p.close);
  return {
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    ema20: ema(closes, 20),
    rsi14: rsi(closes, 14),
    bollinger: bollinger(closes, 20, 2),
  };
}
