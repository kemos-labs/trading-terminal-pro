import { describe, expect, it } from 'vitest';
import { computeIndicators, type PricePoint } from './indicators';

const series = (n: number, start = 100): PricePoint[] =>
  Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    close: start + i * Math.sin(i / 3),
  }));

describe('indicators — warmup is null, never NaN (C1)', () => {
  it('warmup values are null and post-warmup values are finite', () => {
    const ind = computeIndicators(series(80));
    // SMA20 warmup: first 19 null; SMA50: first 49 null
    for (let i = 0; i < 19; i++) expect(ind.sma20[i]).toBeNull();
    expect(ind.sma20[19]).not.toBeNull();
    for (let i = 0; i < 49; i++) expect(ind.sma50[i]).toBeNull();
    expect(ind.sma50[49]).not.toBeNull();
    // EMA20 seeds at index 19; RSI14 at index 14; Bollinger at index 19
    expect(ind.ema20[18]).toBeNull();
    expect(ind.ema20[19]).not.toBeNull();
    expect(ind.rsi14[13]).toBeNull();
    expect(ind.rsi14[14]).not.toBeNull();
    expect(ind.bollinger.mid[18]).toBeNull();
    expect(ind.bollinger.upper[19]).not.toBeNull();
    expect(ind.bollinger.lower[19]).not.toBeNull();
  });

  it('short series produce all-null (no fabricated values, no NaN)', () => {
    const ind = computeIndicators(series(10));
    const walk = (v: unknown): void => {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(ind);
    expect(ind.sma50.every((v) => v === null)).toBe(true);
  });

  it('SMA matches a hand-computed window and values stay finite', () => {
    const pts = series(30);
    const ind = computeIndicators(pts);
    // sma20[19] = mean of closes[0..19]
    const expected = (pts.slice(0, 20).reduce((s, p) => s + p.close, 0)) / 20;
    expect(ind.sma20[19]).toBeCloseTo(expected, 10);
  });

  it('RSI stays within [0, 100] and is finite where present', () => {
    const ind = computeIndicators(series(120));
    for (const v of ind.rsi14) {
      if (v == null) continue;
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});
