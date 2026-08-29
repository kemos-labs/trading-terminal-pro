import { describe, expect, it } from 'vitest';
import { buildDeribitSnapshot, parseDeribitFuture, parseDeribitInstrument } from './deribit';
import type { DeribitMarketBundle } from '../data/deribitClient';

describe('parseDeribitInstrument', () => {
  it('parses call and put names', () => {
    const c = parseDeribitInstrument('BTC-10JUL26-61500-C');
    expect(c).toEqual({
      currency: 'BTC',
      expiry: '2026-07-10',
      strike: 61500,
      type: 'call',
    });
    const p = parseDeribitInstrument('ETH-25SEP26-2000-P');
    expect(p?.type).toBe('put');
    expect(p?.strike).toBe(2000);
  });

  it('rejects garbage', () => {
    expect(parseDeribitInstrument('SPY250117C00450000')).toBeNull();
  });
});

describe('parseDeribitFuture', () => {
  it('parses dated future and perp', () => {
    expect(parseDeribitFuture('BTC-25JUL26')).toEqual({
      currency: 'BTC',
      expiry: '2026-07-25',
      isPerp: false,
    });
    expect(parseDeribitFuture('BTC-PERPETUAL')).toEqual({
      currency: 'BTC',
      expiry: null,
      isPerp: true,
    });
  });
});

describe('buildDeribitSnapshot', () => {
  const now = Date.parse('2026-07-01T15:00:00Z');

  function row(
    name: string,
    markIv: number,
    mark: number,
    oi = 100,
  ) {
    return {
      instrument_name: name,
      bid_price: mark * 0.98,
      ask_price: mark * 1.02,
      mid_price: mark,
      mark_price: mark,
      last: mark,
      mark_iv: markIv,
      open_interest: oi,
      volume: 10,
      volume_usd: 0,
      underlying_price: 100_000,
      estimated_delivery_price: 100_000,
      interest_rate: 0,
      creation_timestamp: now,
    };
  }

  it('keeps missing executable fields null and never uses mark/last as midpoint', () => {
    const base = row('BTC-31JUL26-100000-C', 50, 0.04);
    const bundle: DeribitMarketBundle = {
      currency: 'BTC', indexPrice: 100_000,
      options: [
        { ...base, bid_price: null, ask_price: null, mid_price: null },
        row('BTC-31JUL26-100000-P', 50, 0.04),
        row('BTC-31JUL26-110000-C', 52, 0.02),
        row('BTC-31JUL26-90000-P', 55, 0.025),
      ], futures: [], perp: null, fundingAnn: null, fetchedAt: now, source: 'deribit',
    };
    const snap = buildDeribitSnapshot(bundle, { now });
    const quote = snap?.expiries[0]?.calls.find(q => q.strike === 100_000);
    expect(quote).toMatchObject({ bid: null, ask: null, last: 0.04 * 100_000, mark: 0.04 * 100_000, mid: null });
  });

  it('builds a live surface with contractSize 1', () => {
    const bundle: DeribitMarketBundle = {
      currency: 'BTC',
      indexPrice: 100_000,
      options: [
        row('BTC-31JUL26-100000-C', 50, 0.04),
        row('BTC-31JUL26-100000-P', 50, 0.04),
        row('BTC-31JUL26-110000-C', 52, 0.02),
        row('BTC-31JUL26-90000-P', 55, 0.025),
        row('BTC-25SEP26-100000-C', 45, 0.08),
        row('BTC-25SEP26-100000-P', 45, 0.08),
        row('BTC-25SEP26-120000-C', 48, 0.03),
        row('BTC-25SEP26-80000-P', 50, 0.04),
      ],
      futures: [
        {
          instrument_name: 'BTC-31JUL26',
          mark_price: 101_500,
          mid_price: 101_500,
          last: 101_500,
          bid_price: 101_400,
          ask_price: 101_600,
          open_interest: 1000,
          volume: 50,
          underlying_price: 100_000,
          estimated_delivery_price: 100_000,
          creation_timestamp: now,
        },
        {
          instrument_name: 'BTC-PERPETUAL',
          mark_price: 100_200,
          mid_price: 100_200,
          last: 100_200,
          bid_price: 100_100,
          ask_price: 100_300,
          open_interest: 5000,
          volume: 200,
          underlying_price: 100_000,
          estimated_delivery_price: 100_000,
          creation_timestamp: now,
        },
      ],
      perp: null,
      fundingAnn: 0.15,
      fetchedAt: now,
      source: 'deribit',
    };
    const snap = buildDeribitSnapshot(bundle, { now, r: 0.04, q: 0 });
    expect(snap).not.toBeNull();
    expect(snap!.symbol).toBe('BTC');
    expect(snap!.spot).toBe(100_000);
    expect(snap!.surfaceSource).toBe('live');
    expect(snap!.contractSize).toBe(1);
    expect(snap!.fundingAnn).toBe(0.15);
    expect(snap!.expiries.length).toBeGreaterThanOrEqual(1);
    const front = snap!.expiries[0]!;
    expect(front.calls.length + front.puts.length).toBeGreaterThan(0);
    expect(front.atmIV).toBeGreaterThan(0.2);
    // USD conversion: coin mid * index
    expect(front.calls[0]!.mid).toBeGreaterThan(100);
    expect(snap!.futuresMarks?.length).toBeGreaterThanOrEqual(2);
    expect(snap!.futuresMarks!.some(m => m.isPerp)).toBe(true);
    expect(snap!.futuresMarks!.find(m => !m.isPerp)?.mark).toBe(101_500);
  });
});
