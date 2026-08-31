import { describe, expect, it } from 'vitest';
import { buildSnapshot } from './synthetic';
import {
  breakEvenSpots,
  comboPayoffAtExpiry,
  entryBasisValidFor,
  evaluateCombo,
  templateLegs,
  type PortfolioLeg,
} from './portfolio';

describe('portfolio / combo', () => {
  const snap = buildSnapshot('SPY', Date.now(), 500, 0, 0);

  it('builds a short straddle with two legs', () => {
    const legs = templateLegs('short_straddle', snap, 0);
    expect(legs).toHaveLength(2);
    expect(legs[0]!.kind).toBe('call');
    expect(legs[1]!.kind).toBe('put');
    expect(legs[0]!.side).toBe('short');
  });

  it('evaluates combo greeks finite at spot', () => {
    const legs = templateLegs('long_straddle', snap, 0);
    const m = evaluateCombo(legs, snap);
    expect(Number.isFinite(m.mark)).toBe(true);
    expect(Number.isFinite(m.greeks.delta)).toBe(true);
    expect(Number.isFinite(m.greeks.gamma)).toBe(true);
    // Long straddle: gamma > 0, near-zero delta at ATM
    expect(m.greeks.gamma).toBeGreaterThan(0);
    expect(Math.abs(m.greeks.delta)).toBeLessThan(0.5);
  });

  it('finds break-evens for long straddle', () => {
    const legs = templateLegs('long_straddle', snap, 0);
    const beRes = breakEvenSpots(legs, snap.spot, 0.7, 1.3, 500);
    expect(beRes.available).toBe(true);
    expect(beRes.breakEvens.length).toBeGreaterThanOrEqual(1);
    // Payoff at deep ITM call side should be positive for long straddle
    const payoff = comboPayoffAtExpiry(legs, snap.spot * 1.5);
    expect(payoff != null && payoff > 0).toBe(true);
  });

  // ── Structural executable-entry law (C1) ────────────────────────────────

  const legWith = (over: Partial<PortfolioLeg>): PortfolioLeg => ({
    id: 't', kind: 'call', side: 'long', qty: 1,
    strike: snap.expiries[0]!.calls[0]!.strike, expiry: snap.expiries[0]!.expiry,
    entryPrice: 2.5, entryBasis: 'ask', ...over,
  });

  it('enforces long = observed ask, short = observed bid (fail closed)', () => {
    // long with 'bid' basis → unavailable
    const longWrong = evaluateCombo([legWith({ side: 'long', entryBasis: 'bid' })], snap);
    expect(longWrong.unavailable).toBe(true);
    expect(longWrong.mark).toBeNull();
    expect(longWrong.unavailableReason).toMatch(/entry basis/);
    // short with 'mid' basis (mid substitution) → unavailable
    const shortMid = evaluateCombo(
      [legWith({ side: 'short', entryBasis: 'mid' })],
      snap,
    );
    expect(shortMid.unavailable).toBe(true);
    // short with 'ask' basis → unavailable
    const shortAsk = evaluateCombo(
      [legWith({ side: 'short', entryBasis: 'ask' })],
      snap,
    );
    expect(shortAsk.unavailable).toBe(true);
  });

  it('accepts correct bases: long/ask, short/bid, and explicit user override', () => {
    expect(evaluateCombo([legWith({ side: 'long', entryBasis: 'ask' })], snap).unavailable).toBeFalsy();
    expect(evaluateCombo([legWith({ side: 'short', entryBasis: 'bid' })], snap).unavailable).toBeFalsy();
    expect(evaluateCombo([legWith({ side: 'long', entryBasis: 'user' })], snap).unavailable).toBeFalsy();
    expect(evaluateCombo([legWith({ side: 'short', entryBasis: 'user' })], snap).unavailable).toBeFalsy();
  });

  it('rejects non-positive and missing entry prices for option legs', () => {
    const zero = evaluateCombo([legWith({ entryPrice: 0 })], snap);
    expect(zero.unavailable).toBe(true);
    expect(zero.unavailableReason).toMatch(/positive/);
    const missing = evaluateCombo([legWith({ entryPrice: null })], snap);
    expect(missing.unavailable).toBe(true);
  });

  it('payoff-at-expiry is unavailable for invalid entry bases', () => {
    expect(comboPayoffAtExpiry([legWith({ side: 'long', entryBasis: 'mid' })], snap.spot)).toBeNull();
    expect(comboPayoffAtExpiry([legWith({ entryPrice: 0 })], snap.spot)).toBeNull();
    // user basis with a positive price is fine
    const v = comboPayoffAtExpiry([legWith({ entryBasis: 'user' })], snap.spot * 2);
    expect(v != null && Number.isFinite(v)).toBe(true);
  });

  it('break-even scan fails closed on invalid entry basis', () => {
    const be = breakEvenSpots([legWith({ side: 'long', entryBasis: 'last' })], snap.spot);
    expect(be.available).toBe(false);
    expect(be.reason).toMatch(/entry basis|entryPrice/);
  });

  it('entryBasisValidFor discriminates sides without a snapshot', () => {
    expect(entryBasisValidFor({ kind: 'call', side: 'long', entryBasis: 'ask' })).toBe(true);
    expect(entryBasisValidFor({ kind: 'call', side: 'long', entryBasis: 'bid' })).toBe(false);
    expect(entryBasisValidFor({ kind: 'put', side: 'short', entryBasis: 'bid' })).toBe(true);
    expect(entryBasisValidFor({ kind: 'put', side: 'short', entryBasis: 'ask' })).toBe(false);
    expect(entryBasisValidFor({ kind: 'call', side: 'long', entryBasis: 'user' })).toBe(true);
    expect(entryBasisValidFor({ kind: 'put', side: 'short', entryBasis: null })).toBe(false);
    expect(entryBasisValidFor({ kind: 'future', side: 'long', entryBasis: null })).toBe(true);
  });

  it('templates never emit mid/last bases and null when the side is unavailable', () => {
    for (const name of [
      'long_straddle', 'short_straddle', 'long_call', 'short_put',
      'risk_reversal', 'call_spread', 'collar',
    ] as const) {
      for (const leg of templateLegs(name, snap, 0)) {
        expect(['ask', 'bid', 'user', null]).toContain(leg.entryBasis ?? null);
        if (leg.entryBasis === 'ask') expect(leg.side).toBe('long');
        if (leg.entryBasis === 'bid') expect(leg.side).toBe('short');
        if (leg.entryPrice != null) expect(leg.entryPrice).toBeGreaterThan(0);
      }
    }
  });
});
