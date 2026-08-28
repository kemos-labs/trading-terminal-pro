import { describe, expect, it } from 'vitest';
import { buildSnapshot } from './synthetic';
import { templateLegs } from './portfolio';
import {
  comboGreeksPnl,
  historyToSpotBars,
  optionGreeksPnl,
  straddleBreakEvens,
  syntheticSpotPath,
} from './greeksPnl';
import { priceGreeksMarket } from '../math/adapters';
import { solveImpliedVol } from '../math/impliedVol';
import { asDecimalRate, asYearFraction } from '../math/units';

describe('greeksPnl / BS foundation', () => {
  it('implied vol recovers BS price (Black–Scholes invertibility)', () => {
    const S = 100, K = 100, T = 0.25, r = 0.05, q = 0.01, vol = 0.22;
    const px = priceGreeksMarket('call', S, K, T, r, q, vol).price;
    const res = solveImpliedVol('call', S, K, asYearFraction(T), asDecimalRate(r), asDecimalRate(q), px);
    const iv = res.ok ? (res.sigma as unknown as number) : null;
    expect(iv).not.toBeNull();
    expect(iv!).toBeCloseTo(vol, 4);
  });

  it('straddle BEs are K ± total premium', () => {
    const be = straddleBreakEvens(100, 3, 2.5, 'long');
    expect(be.upper).toBeCloseTo(105.5);
    expect(be.lower).toBeCloseTo(94.5);
    expect(be.totalPremium).toBeCloseTo(5.5);
  });

  it('option PnL series has zero start and finite terminal', () => {
    const snap = buildSnapshot('SPY', Date.now(), 500, 0, 0);
    const slice = snap.expiries[0]!;
    const atm = slice.calls.reduce((b, q) =>
      Math.abs(q.strike - snap.spot) < Math.abs(b.strike - snap.spot) ? q : b
    , slice.calls[0]!);
    const path = syntheticSpotPath(snap.spot, 20, 0.18, 5);
    const res = optionGreeksPnl(snap, {
      type: 'call',
      strike: atm.strike,
      expiry: slice.expiry,
      path,
    });
    expect(res.bars.length).toBe(path.length);
    expect(res.bars[0]!.pnl).toBe(0);
    expect(Number.isFinite(res.terminalPnl)).toBe(true);
    // Attribution should roughly sum to terminal
    const attr =
      res.totalDelta + res.totalGamma + res.totalTheta + res.totalVega + res.totalResidual;
    expect(attr).toBeCloseTo(res.terminalPnl, 4);
  });

  it('combo PnL attribution closes', () => {
    const snap = buildSnapshot('BTC', Date.now(), 90_000, 0, 0);
    const legs = templateLegs('short_straddle', snap, 0);
    const path = historyToSpotBars(
      Array.from({ length: 25 }, (_, i) => ({
        date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        close: 90_000 * (1 + 0.01 * Math.sin(i / 3)),
      })),
    );
    const res = comboGreeksPnl(legs, snap, path);
    expect(res.bars.length).toBeGreaterThan(5);
    const attr =
      res.totalDelta + res.totalGamma + res.totalTheta + res.totalVega + res.totalResidual;
    expect(attr).toBeCloseTo(res.terminalPnl, 4);
  });
});
