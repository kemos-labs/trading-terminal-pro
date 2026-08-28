import { describe, expect, it } from 'vitest';
import { buildSnapshot } from './synthetic';
import {
  breakEvenSpots,
  comboPayoffAtExpiry,
  evaluateCombo,
  templateLegs,
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
});
