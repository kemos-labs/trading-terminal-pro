import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OptionCalculatorView } from './OptionCalculatorView';
import { useTerminalStore } from '../../../store/terminalStore';
import { buildSnapshot } from '../../../lib/options/synthetic';
import {
  bsGreeks,
  bsPrice,
  entryCost,
  findBreakevens,
  normCdf,
  pnlAtExpiry,
  positionPnl,
  probAbove,
  probProfitLognormal,
  scanExtremes,
  type CalcLeg,
  type PositionedLeg,
} from '../../../lib/options/blackscholes';

// ---------------------------------------------------------------------------
// BSM math unit tests
// ---------------------------------------------------------------------------

describe('blackscholes math', () => {
  it('reproduces the classic Hull call/put values', () => {
    // Hull: S=42, K=40, r=0.10, q=0, σ=0.20, T=0.5 → C ≈ 4.7594, P ≈ 0.8086.
    expect(bsPrice('call', 42, 40, 0.5, 0.1, 0, 0.2)).toBeCloseTo(4.759422, 4);
    expect(bsPrice('put', 42, 40, 0.5, 0.1, 0, 0.2)).toBeCloseTo(0.808599, 4);
  });

  it('prices an ATM zero-rate one-year 20-vol call at ≈ 7.966', () => {
    expect(bsPrice('call', 100, 100, 1, 0, 0, 0.2)).toBeCloseTo(7.9656, 3);
  });

  it('satisfies put–call parity C − P = S·e^(−qT) − K·e^(−rT)', () => {
    const cases: [number, number, number, number, number, number][] = [
      [100, 90, 0.75, 0.03, 0.01, 0.35],
      [50, 55, 0.25, 0.08, 0.02, 0.15],
      [75_000, 80_000, 2, 0.02, 0, 0.6],
      [3_000, 2_500, 0.08, 0.05, 0, 0.8],
    ];
    for (const [S, K, T, r, q, vol] of cases) {
      const lhs = bsPrice('call', S, K, T, r, q, vol) - bsPrice('put', S, K, T, r, q, vol);
      const rhs = S * Math.exp(-q * T) - K * Math.exp(-r * T);
      // Norm-CDF approximation error scales with S — use a relative bound.
      expect(Math.abs(lhs - rhs)).toBeLessThan(1e-6 * Math.max(S, 1));
    }
  });

  it('returns intrinsic at and after expiry, discounted forward intrinsic at zero vol', () => {
    expect(bsPrice('call', 110, 100, 0, 0.05, 0, 0.2)).toBeCloseTo(10, 12);
    expect(bsPrice('put', 95, 100, 1e-12, 0.05, 0, 0.2)).toBeCloseTo(5, 8);
    // Zero vol: max(0, S·e^(−qT) − K·e^(−rT))
    expect(bsPrice('call', 100, 90, 1, 0.05, 0, 0)).toBeCloseTo(100 - 90 * Math.exp(-0.05), 10);
    expect(bsGreeks('call', 100, 90, 1, 0.05, 0, 0).gamma).toBe(0);
  });

  it('links put/call greeks: delta offset by discount factor, identical gamma & vega', () => {
    const S = 120;
    const K = 118;
    const T = 0.6;
    const r = 0.04;
    const q = 0.01;
    const vol = 0.45;
    const c = bsGreeks('call', S, K, T, r, q, vol);
    const p = bsGreeks('put', S, K, T, r, q, vol);
    expect(p.delta).toBeCloseTo(c.delta - Math.exp(-q * T), 6);
    expect(p.gamma).toBeCloseTo(c.gamma, 10);
    expect(p.vega).toBeCloseTo(c.vega, 10);
    expect(p.price).toBeCloseTo(
      c.price - S * Math.exp(-q * T) + K * Math.exp(-r * T),
      6,
    );
    expect(c.theta).toBeLessThan(0); // long ATM-ish call bleeds time value
    expect(c.vega).toBeGreaterThan(0);
    expect(c.delta).toBeGreaterThan(0.5); // slightly ITM call
  });

  it('probAbove follows the log-normal N(d2) law and degenerates correctly', () => {
    // d2 = (0.05 − 0.02) / 0.2 = 0.15 → N(0.15) ≈ 0.5596
    expect(probAbove(100, 100, 1, 0.05, 0, 0.2)).toBeCloseTo(normCdf(0.15), 6);
    expect(probAbove(100, 100, 1, 0.05, 0, 0.2)).toBeCloseTo(0.5596, 3);
    expect(probAbove(100, 80, 1, 0, 0, 0.3)).toBeGreaterThan(0.7);
    expect(probAbove(100, 150, 1, 0, 0, 0.3)).toBeLessThan(0.1);
    // T → 0: deterministic indicator.
    expect(probAbove(105, 100, 0, 0, 0, 0.3)).toBe(1);
    expect(probAbove(95, 100, 0, 0, 0, 0.3)).toBe(0);
    expect(probAbove(100, 100, 0, 0, 0, 0.3)).toBe(0.5);
    // Zero vol: compares against the grown forward.
    expect(probAbove(100, 90, 1, 0.05, 0, 0)).toBe(1);
    expect(probAbove(100, 110, 1, 0.05, 0, 0)).toBe(0);
  });

  it('finds breakevens and extremes for a bull call spread', () => {
    const legs: CalcLeg[] = [
      { id: 'a', side: 'buy', qty: 1, type: 'call', strike: 100, iv: 0.5, premium: 6 },
      { id: 'b', side: 'sell', qty: 1, type: 'call', strike: 110, iv: 0.45, premium: 2 },
    ];
    expect(entryCost(legs)).toBeCloseTo(4, 12);
    const f = (s: number) => pnlAtExpiry(legs, s);
    const bes = findBreakevens(f, 50, 200, 3000);
    expect(bes).toHaveLength(1);
    expect(bes[0]).toBeCloseTo(104, 5);
    const ext = scanExtremes(f, 50, 200, 5000);
    expect(ext.max).toBeCloseTo(6, 9); // width 10 − net debit 4
    expect(ext.min).toBeCloseTo(-4, 9); // capped at net debit
    expect(ext.risingAtRight).toBe(false);
    expect(ext.fallingAtLeft).toBe(false);
  });

  it('flags unbounded wings: long call up, long put down-left', () => {
    const call: CalcLeg[] = [{ id: 'c', side: 'buy', qty: 1, type: 'call', strike: 100, iv: 0.5, premium: 5 }];
    const callExt = scanExtremes((s) => pnlAtExpiry(call, s), 50, 300, 4000);
    expect(callExt.risingAtRight).toBe(true);

    const put: CalcLeg[] = [{ id: 'p', side: 'buy', qty: 1, type: 'put', strike: 100, iv: 0.5, premium: 5 }];
    const putExt = scanExtremes((s) => pnlAtExpiry(put, s), 1, 300, 4000);
    expect(putExt.fallingAtLeft).toBe(true);
    expect(putExt.max).toBeCloseTo(94, 6); // (100 − 1) intrinsic − 5 premium
  });

  it('computes mark-to-model P&L and probability of profit sanely', () => {
    // Short 100-straddle entered for 10 + 10.
    const base: CalcLeg[] = [
      { id: 'sc', side: 'sell', qty: 1, type: 'call', strike: 100, iv: 0.4, premium: 10 },
      { id: 'sp', side: 'sell', qty: 1, type: 'put', strike: 100, iv: 0.4, premium: 10 },
    ];
    const T = 30 / 365;
    const pos: PositionedLeg[] = base.map((l) => ({ ...l, T }));
    expect(entryCost(base)).toBeCloseTo(-20, 12); // net credit received
    expect(positionPnl(pos, 100, 0.02, 0, 0)).toBeGreaterThan(0); // decay works for us ATM
    expect(positionPnl(pos, 130, 0.02, 0, 0)).toBeLessThan(0); // big move hurts
    expect(positionPnl(pos, 70, 0.02, 0, 0)).toBeLessThan(0);

    const popStraddle = probProfitLognormal((s) => pnlAtExpiry(base, s), 100, T, 0.02, 0, 0.4);
    expect(popStraddle).toBeGreaterThan(0);
    // Breakevens sit at ±$20 ≈ ±1.75σ for this horizon, so most log-normal
    // mass lands inside them: short straddles pair high POP with fat tails.
    expect(popStraddle).toBeGreaterThan(0.5);
    expect(popStraddle).toBeLessThan(1);

    // Iron-condor-shaped payoff should profit far more often than the straddle.
    const condor: CalcLeg[] = [
      { id: 'sp', side: 'sell', qty: 1, type: 'put', strike: 90, iv: 0.4, premium: 3 },
      { id: 'bp', side: 'buy', qty: 1, type: 'put', strike: 80, iv: 0.4, premium: 1 },
      { id: 'scl', side: 'sell', qty: 1, type: 'call', strike: 110, iv: 0.4, premium: 3 },
      { id: 'bcl', side: 'buy', qty: 1, type: 'call', strike: 120, iv: 0.4, premium: 1 },
    ];
    const popCondor = probProfitLognormal((s) => pnlAtExpiry(condor, s), 100, T, 0.02, 0, 0.4);
    expect(popCondor).toBeGreaterThan(0);
    expect(popCondor).toBeLessThan(1);
    // The condor's defining property vs the straddle: bounded loss on BOTH wings.
    const ext = scanExtremes((s) => pnlAtExpiry(condor, s), 50, 200, 6000);
    expect(ext.min).toBeCloseTo(-6, 9); // wing width 10 − net credit 4
    expect(ext.fallingAtLeft).toBe(false);
    expect(ext.risingAtRight).toBe(false);
    // And its breakevens bracket spot symmetrically around the credit.
    const bes = findBreakevens((s) => pnlAtExpiry(condor, s), 50, 200, 4000);
    expect(bes).toHaveLength(2);
    expect(bes[0]).toBeCloseTo(86, 5);
    expect(bes[1]).toBeCloseTo(114, 5);
  });
});

// ---------------------------------------------------------------------------
// Render tests
// ---------------------------------------------------------------------------

describe('OptionCalculatorView', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      symbol: 'BTC',
      snapshot: buildSnapshot('BTC', Date.now(), 75_000, 0.04, 0),
      chainAvailable: true,
    });
  });

  it('renders the header with live-chain provenance and switches strategies', () => {
    render(<OptionCalculatorView />);
    expect(screen.getByRole('heading', { level: 1, name: /option calculator/i })).toBeInTheDocument();
    expect(screen.getByText('DERIBIT LIVE CHAIN')).toBeInTheDocument();

    // Default preset is Long Call.
    expect(screen.getByRole('button', { name: 'Long Call' })).toHaveAttribute('aria-pressed', 'true');

    // Switch to Short Straddle → two SELL legs + its description text.
    fireEvent.click(screen.getByRole('button', { name: 'Short Straddle' }));
    expect(screen.getByRole('button', { name: 'Short Straddle' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('SELL').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/premium decay/i)).toBeInTheDocument();

    // Iron Condor builds four legs.
    fireEvent.click(screen.getByRole('button', { name: 'Iron Condor' }));
    expect(screen.getAllByText('SELL').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('BUY').length).toBeGreaterThanOrEqual(2);
  });

  it('updates the entry-cost KPI when a leg quantity is edited', () => {
    render(<OptionCalculatorView />);
    const parse = () =>
      Number((screen.getByTestId('kpi-entry').textContent ?? '').replace(/[^0-9.\u2212-]/g, ''));
    const before = parse();
    expect(before).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Qty 1'), { target: { value: '3' } });
    const after = parse();
    expect(after).toBeGreaterThan(before * 2.5);
    expect(after).toBeLessThan(before * 3.5);
  });

  it('renders the payoff SVG with legend markers and the 5×5 scenario matrix', () => {
    render(<OptionCalculatorView />);
    expect(screen.getByRole('img', { name: /payoff chart/i })).toBeInTheDocument();
    expect(screen.getByText(/Scenario Matrix/i)).toBeInTheDocument();
    expect(screen.getAllByTestId('scen-cell')).toHaveLength(25);
  });

  it('exposes the IV-shift and time-to-expiry sliders plus sizing input', () => {
    render(<OptionCalculatorView />);
    const ivSlider = screen.getByRole('slider', { name: /iv shift/i }) as HTMLInputElement;
    const tSlider = screen.getByRole('slider', { name: /time to expiry/i }) as HTMLInputElement;
    expect(ivSlider.min).toBe('-30');
    expect(ivSlider.max).toBe('30');
    expect(tSlider.min).toBe('0');
    expect(tSlider.max).toBe('100');

    fireEvent.change(ivSlider, { target: { value: '-20' } });
    expect((screen.getByRole('slider', { name: /iv shift/i }) as HTMLInputElement).value).toBe('-20');

    fireEvent.change(screen.getByLabelText('Max risk budget dollars'), { target: { value: '50000' } });
    expect((screen.getByLabelText('Max risk budget dollars') as HTMLInputElement).value).toBe('50000');
  });
});
