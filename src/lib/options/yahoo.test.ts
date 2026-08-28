import { describe, it, expect } from 'vitest';
import { buildYahooSnapshot, YahooResponse } from './yahoo';
import { priceGreeksMarket } from '../math/adapters';
import { yearFractionToExpiry } from './time';

const SPOT = 550;
const R = 0.0525;
const Q = 0.013;
/** Fixed "now" so pricing T matches the snapshot pipeline. */
const NOW = Date.UTC(2026, 0, 15, 15, 0, 0); // 10:00 ET winter

function makeQuote(
  expiry: string,
  strike: number,
  type: 'call' | 'put',
  targetIV: number,
  overrides: { bid?: number; ask?: number; last?: number; iv?: number | null } = {},
) {
  const t = yearFractionToExpiry(expiry, NOW) ?? 30 / 365.25;
  const bs = priceGreeksMarket(type, SPOT, strike, t, R, Q, targetIV);
  // Symmetric spread around the fair BS price; keeps bid positive and mid == fair price.
  const epsilon = Math.max(0.005, bs.price * 0.03);
  const bid = bs.price > epsilon ? bs.price - epsilon : bs.price * 0.5;
  const ask = bs.price > epsilon ? bs.price + epsilon : bs.price * 1.5;
  return {
    strike,
    expiry,
    type,
    bid: overrides.bid ?? bid,
    ask: overrides.ask ?? ask,
    last: overrides.last ?? 0,
    iv: overrides.iv ?? null,
    volume: 100,
    openInterest: 1000,
  };
}

function buildFixture(quotes: ReturnType<typeof makeQuote>[]): YahooResponse {
  return {
    symbol: 'SPY',
    spot: SPOT,
    expirations: [...new Set(quotes.map(q => q.expiry))],
    quotes,
    timestamp: Date.now(),
  };
}

function baseStrikes(): number[] {
  return [500, 520, 540, 550, 560, 580, 600];
}

function makeBaseQuotes(expiry: string, targetIV: number): ReturnType<typeof makeQuote>[] {
  const quotes: ReturnType<typeof makeQuote>[] = [];
  for (const k of baseStrikes()) {
    quotes.push(makeQuote(expiry, k, 'call', targetIV));
    quotes.push(makeQuote(expiry, k, 'put', targetIV));
  }
  return quotes;
}

describe('buildYahooSnapshot', () => {
  it('solves IV from mid-price when raw.iv is missing', () => {
    const expiry = '2026-02-14';
    const targetIV = 0.22;
    const quotes = makeBaseQuotes(expiry, targetIV);

    const snap = buildYahooSnapshot(buildFixture(quotes), R, Q, 12, NOW);
    expect(snap).not.toBeNull();
    expect(snap!.expiries.length).toBe(1);

    const all = [...snap!.expiries[0]!.calls, ...snap!.expiries[0]!.puts];
    expect(all.length).toBeGreaterThanOrEqual(5);
    for (const q of all) {
      expect(q.iv).toBeGreaterThan(0);
      expect(Math.abs(q.iv - targetIV)).toBeLessThan(1e-3);
    }
  });

  it('prefers mid over last when both present', () => {
    const expiry = '2026-02-14';
    const targetIV = 0.20;
    const quotes = makeBaseQuotes(expiry, targetIV);
    // Corrupt last on a few quotes; mid should still yield correct IVs.
    for (let i = 0; i < Math.min(4, quotes.length); i++) {
      quotes[i]!.last = 999;
    }

    const snap = buildYahooSnapshot(buildFixture(quotes), R, Q, 12, NOW);
    expect(snap).not.toBeNull();
    for (const q of [...snap!.expiries[0]!.calls, ...snap!.expiries[0]!.puts]) {
      expect(Math.abs(q.iv - targetIV)).toBeLessThan(1e-3);
    }
  });

  it('filters crossed markets and prices below intrinsic', () => {
    const expiry = '2026-02-14';
    const quotes = makeBaseQuotes(expiry, 0.22);
    const crossed = makeQuote(expiry, 555, 'call', 0.22, { bid: 20, ask: 15 });
    const belowIntrinsic = makeQuote(expiry, 450, 'call', 0.22, { bid: 0.5, ask: 0.6 });
    quotes.push(crossed, belowIntrinsic);

    const snap = buildYahooSnapshot(buildFixture(quotes), R, Q, 12, NOW);
    expect(snap).not.toBeNull();
    const callStrikes = snap!.expiries[0]!.calls.map(q => q.strike);
    expect(callStrikes).toContain(550);
    expect(callStrikes).not.toContain(555);
    expect(callStrikes).not.toContain(450);
  });

  it('keeps valid raw IV when present and solves only when invalid', () => {
    const expiry = '2026-03-16';
    const targetIV = 0.18;
    const quotes = makeBaseQuotes(expiry, targetIV);
    // Zero out raw IVs on a subset; solver should still recover target IV.
    for (let i = 0; i < Math.min(4, quotes.length); i++) {
      quotes[i]!.iv = 0;
    }

    const snap = buildYahooSnapshot(buildFixture(quotes), R, Q, 12, NOW);
    expect(snap).not.toBeNull();
    for (const q of [...snap!.expiries[0]!.calls, ...snap!.expiries[0]!.puts]) {
      expect(Math.abs(q.iv - targetIV)).toBeLessThan(1e-3);
    }
  });

  it('produces finite Greeks and no null IVs', () => {
    const expiry = '2026-03-01';
    const quotes = makeBaseQuotes(expiry, 0.21);

    const snap = buildYahooSnapshot(buildFixture(quotes), R, Q, 12, NOW);
    expect(snap).not.toBeNull();
    for (const q of [...snap!.expiries[0]!.calls, ...snap!.expiries[0]!.puts]) {
      expect(Number.isFinite(q.iv)).toBe(true);
      expect(q.iv).toBeGreaterThan(0);
      expect(Number.isFinite(q.delta ?? 0)).toBe(true);
      expect(Number.isFinite(q.vega ?? 0)).toBe(true);
    }
  });

  it('computes ATM IV near the strike-spot IV, not the mean of all strikes', async () => {
    const { computeAtmIV } = await import('./yahoo');
    // Steep skew: far OTM puts very high IV, ATM ~20%, OTM calls lower.
    const calls = [
      { strike: 500, iv: 0.30 },
      { strike: 550, iv: 0.20 },
      { strike: 600, iv: 0.16 },
    ];
    const puts = [
      { strike: 500, iv: 0.35 },
      { strike: 550, iv: 0.20 },
      { strike: 600, iv: 0.18 },
    ];
    const atm = computeAtmIV(calls, puts, 550);
    expect(atm).toBeCloseTo(0.20, 2);
    // Mean of all would be ~0.23 — ensure we didn't average wings.
    const mean =
      [...calls, ...puts].reduce((s, q) => s + q.iv, 0) / (calls.length + puts.length);
    expect(Math.abs(atm - 0.2)).toBeLessThan(Math.abs(mean - 0.2));
  });

  it('filters excessively wide bid-ask spreads', () => {
    const expiry = '2026-02-14';
    const quotes = makeBaseQuotes(expiry, 0.22);
    // Pathological 500% spread around a fake mid.
    quotes.push({
      strike: 555,
      expiry,
      type: 'call',
      bid: 0.1,
      ask: 50,
      last: 0,
      iv: null,
      volume: 0,
      openInterest: 0,
    });

    const snap = buildYahooSnapshot(buildFixture(quotes), R, Q, 12, NOW);
    expect(snap).not.toBeNull();
    const callStrikes = snap!.expiries[0]!.calls.map((q) => q.strike);
    expect(callStrikes).not.toContain(555);
  });
});
