import { describe, it, expect } from 'vitest';
import { deribitBundleToSurfaceGrid } from './cryptoSurfaceAdapter';
import type { DeribitMarketBundle, NormalizedTicker } from '../../../api/deribit';

function ticker(over: Partial<NormalizedTicker> & { expiryMs: number | null; strike: number | null }): NormalizedTicker {
  return {
    instrument: over.instrument ?? `BTC-${over.expiryMs}-${over.strike}-C`,
    baseCurrency: 'BTC',
    quoteCurrency: 'USD',
    settlementCurrency: 'USD',
    contractSize: 1,
    kind: 'option',
    expiryMs: over.expiryMs,
    strike: over.strike,
    optionType: 'call',
    isInverse: false,
    bidPrice: null,
    askPrice: null,
    markPrice: null,
    lastPrice: null,
    bidIv: over.bidIv ?? null,
    askIv: over.askIv ?? null,
    markIv: over.markIv ?? null,
    feedIv: over.markIv ?? null,
    midIv: null,
    bidIvDerived: null,
    askIvDerived: null,
    modelIv: null,
    indexPrice: null,
    openInterest: null,
    volume: null,
    volumeUsd: null,
    funding8h: null,
    timestamp: Date.now(),
    hasQuote: over.hasQuote ?? true,
    isStale: false,
    ...over,
  } as NormalizedTicker;
}

function bundleWith(instruments: NormalizedTicker[], indexPrice: number | null = 65000): DeribitMarketBundle {
  return {
    currency: 'BTC',
    indexPrice,
    instruments,
    coverage: 1,
    funding8h: null,
    fetchedAt: Date.now(),
    source: 'deribit',
  };
}

describe('deribitBundleToSurfaceGrid', () => {
  it('maps 2 expiries × 5 strikes to correct grid shape and spot', () => {
    const now = Date.now();
    const e1 = now + 10 * 864e5;
    const e2 = now + 30 * 864e5;
    const strikes = [60000, 62500, 65000, 67500, 70000];
    const instruments: NormalizedTicker[] = [];
    for (const e of [e1, e2]) for (const k of strikes) instruments.push(ticker({ expiryMs: e, strike: k, markIv: 0.5 }));
    const res = deribitBundleToSurfaceGrid(bundleWith(instruments), now);
    expect(res).not.toBeNull();
    expect(res!.spot).toBe(65000);
    expect(res!.grid.strikes).toEqual(strikes);
    expect(res!.grid.expiries).toHaveLength(2);
    expect(res!.grid.dtes).toHaveLength(2);
    expect(res!.grid.iv).toHaveLength(2);
    expect(res!.grid.iv[0]).toHaveLength(5);
    // units remain decimal
    expect(res!.grid.iv[0]![0]).toBe(0.5);
  });

  it('missing/null/NaN/Infinity stay holes never zero', () => {
    const now = Date.now();
    const e1 = now + 10 * 864e5;
    const e2 = now + 30 * 864e5;
    const instruments = [
      ticker({ expiryMs: e1, strike: 60000, markIv: 0.5 }),
      ticker({ expiryMs: e1, strike: 65000, markIv: null }),
      ticker({ expiryMs: e1, strike: 70000, markIv: NaN }),
      ticker({ expiryMs: e2, strike: 60000, markIv: Infinity }),
      ticker({ expiryMs: e2, strike: 65000, markIv: 0.6 }),
      ticker({ expiryMs: e2, strike: 70000, markIv: undefined as unknown as null }),
    ];
    const res = deribitBundleToSurfaceGrid(bundleWith(instruments), now);
    expect(res).not.toBeNull();
    // holes are null not 0
    expect(res!.grid.iv[0]![1]).toBeNull();
    expect(res!.grid.iv[0]![2]).toBeNull();
    expect(res!.grid.iv[1]![0]).toBeNull();
    expect(res!.grid.iv[1]![2]).toBeNull();
    expect(res!.grid.iv.flat().includes(0 as unknown as null)).toBe(false);
    // finite values preserved
    expect(res!.grid.iv[0]![0]).toBe(0.5);
    expect(res!.grid.iv[1]![1]).toBe(0.6);
    // no NaN/Infinity leaked
    for (const row of res!.grid.iv) for (const v of row) expect(v === null || Number.isFinite(v)).toBe(true);
  });

  it('layer separation: bidIv/askIv do not fill markIv holes', () => {
    const now = Date.now();
    const e1 = now + 10 * 864e5;
    const e2 = now + 30 * 864e5;
    const instruments = [
      ticker({ expiryMs: e1, strike: 60000, markIv: null, bidIv: 0.4, askIv: 0.5 }),
      ticker({ expiryMs: e1, strike: 65000, markIv: 0.5, bidIv: 0.49, askIv: 0.51 }),
      ticker({ expiryMs: e2, strike: 60000, markIv: 0.6, bidIv: 0.59, askIv: 0.61 }),
      ticker({ expiryMs: e2, strike: 65000, markIv: null, bidIv: 0.55, askIv: 0.56 }),
    ];
    const res = deribitBundleToSurfaceGrid(bundleWith(instruments), now);
    expect(res).not.toBeNull();
    // markIv holes stay null despite bid/ask present
    expect(res!.grid.iv[0]![0]).toBeNull();
    expect(res!.grid.iv[1]![1]).toBeNull();
    // bid layer separate
    expect(res!.grid.bid[0]![0]).toBe(0.4);
    expect(res!.grid.ask[0]![0]).toBe(0.5);
  });

  it('excludes expired expiries', () => {
    const now = Date.now();
    const eExpired = now - 5 * 864e5;
    const eActive = now + 10 * 864e5;
    const eActive2 = now + 20 * 864e5;
    const instruments = [
      ticker({ expiryMs: eExpired, strike: 60000, markIv: 0.9 }),
      ticker({ expiryMs: eActive, strike: 60000, markIv: 0.5 }),
      ticker({ expiryMs: eActive, strike: 65000, markIv: 0.51 }),
      ticker({ expiryMs: eActive2, strike: 60000, markIv: 0.55 }),
      ticker({ expiryMs: eActive2, strike: 65000, markIv: 0.56 }),
    ];
    const res = deribitBundleToSurfaceGrid(bundleWith(instruments), now);
    expect(res).not.toBeNull();
    expect(res!.grid.expiries).toHaveLength(2);
    // expired not present
    expect(res!.grid.iv.flat().includes(0.9 as unknown as number)).toBe(false);
  });

  it('empty bundle and single expiry/strike returns null (honest empty)', () => {
    const now = Date.now();
    expect(deribitBundleToSurfaceGrid(bundleWith([], 65000), now)).toBeNull();
    expect(deribitBundleToSurfaceGrid(null as unknown as DeribitMarketBundle, now)).toBeNull();
    // single expiry
    const e1 = now + 10 * 864e5;
    expect(deribitBundleToSurfaceGrid(bundleWith([ticker({ expiryMs: e1, strike: 60000, markIv: 0.5 }), ticker({ expiryMs: e1, strike: 65000, markIv: 0.5 })], 65000), now)).toBeNull();
    // single strike
    const e2 = now + 20 * 864e5;
    expect(deribitBundleToSurfaceGrid(bundleWith([ticker({ expiryMs: e1, strike: 60000, markIv: 0.5 }), ticker({ expiryMs: e2, strike: 60000, markIv: 0.5 })], 65000), now)).toBeNull();
  });

  it('no spot returns null', () => {
    const now = Date.now();
    const e1 = now + 10 * 864e5;
    const e2 = now + 20 * 864e5;
    const instruments = [ticker({ expiryMs: e1, strike: 60000, markIv: 0.5 }), ticker({ expiryMs: e2, strike: 60000, markIv: 0.5 }), ticker({ expiryMs: e1, strike: 65000, markIv: 0.5 }), ticker({ expiryMs: e2, strike: 65000, markIv: 0.5 })];
    expect(deribitBundleToSurfaceGrid(bundleWith(instruments, null), now)).toBeNull();
    expect(deribitBundleToSurfaceGrid(bundleWith(instruments, NaN), now)).toBeNull();
  });

  it('no NaN/Infinity leaks into returned grid', () => {
    const now = Date.now();
    const e1 = now + 10 * 864e5;
    const e2 = now + 20 * 864e5;
    const instruments = [
      ticker({ expiryMs: e1, strike: 60000, markIv: 0.5 }),
      ticker({ expiryMs: e1, strike: 65000, markIv: 0.51 }),
      ticker({ expiryMs: e2, strike: 60000, markIv: 0.52 }),
      ticker({ expiryMs: e2, strike: 65000, markIv: 0.53 }),
    ];
    const res = deribitBundleToSurfaceGrid(bundleWith(instruments), now);
    expect(res).not.toBeNull();
    for (const row of res!.grid.iv) for (const v of row) expect(v == null || Number.isFinite(v!)).toBe(true);
    for (const v of res!.grid.strikes) expect(Number.isFinite(v)).toBe(true);
    for (const v of res!.grid.dtes) expect(Number.isFinite(v)).toBe(true);
  });
});
