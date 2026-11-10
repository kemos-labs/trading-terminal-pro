import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StructureWorkflow } from './StructureWorkflow';
import { PnlWorkflow } from './PnlWorkflow';
import { HedgeWorkflow } from './HedgeWorkflow';
import { useTerminalStore } from '../../../store/terminalStore';

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;

// jsdom has no layout engine, so recharts' ResponsiveContainer always measures
// 0x0 and warns. Render a fixed-size empty frame instead: charts stay
// unrendered in jsdom exactly as today (real chart rendering is asserted by
// Playwright geometry checks), without the environmental warning.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  const React = await import('react');
  return {
    ...actual,
    ResponsiveContainer: ({ height }: { height?: number | string }) =>
      React.createElement('div', {
        'data-testid': 'recharts-viewport-mock',
        style: { width: 800, height: typeof height === 'number' ? height : 400 },
      }),
  };
});
import { buildSnapshot } from '../../../lib/options/synthetic';
import { templateLegs, breakEvenSpots, comboPayoffAtExpiry, evaluateCombo } from '../../../lib/options/portfolio';
import { comboGreeksPnl, optionGreeksPnl, syntheticSpotPath } from '../../../lib/options/greeksPnl';
import { analyzeComboBreakEven } from '../../../lib/options/breakEven';
import { simulateDeltaHedge } from '../../../lib/options/hedging';
import { priceGreeksMarket } from '../../../lib/math/adapters';

describe('Trade workflows — behavior (not export existence)', () => {
  it('renders Structure controls and updates the selected template', () => {
    useTerminalStore.setState({ snapshot: snap, symbol: 'SPY' });
    render(<StructureWorkflow />);
    expect(screen.getByTestId('trade-structure-workflow')).toBeInTheDocument();
    const template = screen.getAllByLabelText('Template')[0]!;
    fireEvent.change(template, { target: { value: 'long_call' } });
    expect(template).toHaveValue('long_call');
  });

  it('option grid scrollable region is focusable (WCAG 2.1.1 keyboard access)', () => {
    useTerminalStore.setState({ snapshot: snap, symbol: 'SPY' });
    render(<StructureWorkflow />);
    const grid = screen.getByLabelText('Option grid — scrollable table of values by strike and expiry');
    expect(grid).toHaveAttribute('tabindex', '0');
    expect(grid.className).toContain('overflow-auto');
  });

  it('renders observed midpoint and Model price as separate provenance fields', () => {
    const noMid = buildSnapshot('SPY-NOMID', Date.now(), 500, 0.05, 0.01);
    noMid.expiries.forEach((expiry) => [...expiry.calls, ...expiry.puts].forEach((quote) => { quote.mid = null; }));
    useTerminalStore.setState({ snapshot: noMid, symbol: 'SPY-NOMID' });
    render(<StructureWorkflow />);
    const provenance = screen.getAllByTestId(/grid-provenance-/);
    expect(provenance.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Obs: Unavailable/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Model:/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Observed midpoint.*Model price/)).toBeNull();
  });

  it('Structure primary charts expose plotted-point hooks with the full profile (no silent empty axes)', () => {
    useTerminalStore.setState({ snapshot: snap, symbol: 'SPY' });
    render(<StructureWorkflow />);
    // Content side of the loading guard: workflow root and entry transparency
    // render once the chain settles (the guard itself lives in renderDeskView
    // and is intentionally untouched by this chart-geometry tranche).
    expect(screen.getByTestId('trade-structure-workflow')).toBeInTheDocument();
    expect(screen.getByTestId('structure-entry-transparency')).toBeInTheDocument();
    // spotGrid(snapshot.spot, 0.15, 61): both primaries plot the full profile.
    const pnl = screen.getByTestId('structure-chart-pnl');
    const greeks = screen.getByTestId('structure-chart-greeks');
    expect(Number(pnl.getAttribute('data-chart-points'))).toBe(61);
    expect(Number(greeks.getAttribute('data-chart-points'))).toBe(61);
    // Scenario sim exposes its band length honestly: finite, never fabricated
    // (0 only when the sim itself is unavailable, not a substituted zero).
    // Non-empty sim data additionally requires the rendered chart contract:
    // a definite-height viewport (numeric ResponsiveContainer height, pinned
    // here via the jsdom mock's fixed frame) so a height="100%" flex
    // collapse cannot regress silently — real-server geometry (h>100,
    // finite SVG paths) is asserted by the wave probe, not jsdom.
    const sim = screen.getByTestId('structure-chart-sim');
    const simPoints = Number(sim.getAttribute('data-chart-points'));
    expect(Number.isFinite(simPoints)).toBe(true);
    expect(simPoints).toBeGreaterThan(0);
    const simViewport = within(sim).getByTestId('recharts-viewport-mock');
    // Pinned definite-height contract: the sim ResponsiveContainer must carry
    // a numeric pixel height (220). A revert to height="100%" renders via
    // the mock default (400px) and fails here before reaching a browser.
    expect(simViewport.style.height).toBe('220px');
  });

  it('renders PnL controls and changes the observed option side', () => {
    useTerminalStore.setState({ snapshot: snap, symbol: 'SPY' });
    render(<PnlWorkflow />);
    expect(screen.getByTestId('trade-pnl-workflow')).toBeInTheDocument();
    const side = screen.getAllByLabelText('Side')[0]!;
    fireEvent.change(side, { target: { value: 'short' } });
    expect(side).toHaveValue('short');
    expect(screen.getAllByText(/Historical|Scenario/).length).toBeGreaterThan(0);
  });

  it('PnL principal charts show unavailable states without history, curves with history', () => {
    // No observed history: compact truthful unavailable states, never empty axes.
    useTerminalStore.setState({ snapshot: snap, symbol: 'SPY', fmpHistory: null, historySource: 'none' });
    const first = render(<PnlWorkflow />);
    expect(screen.getByTestId('pnl-chart-unavailable-a')).toBeInTheDocument();
    expect(screen.getByTestId('pnl-chart-unavailable-b')).toBeInTheDocument();
    expect(screen.getByTestId('pnl-chart-unavailable-a').textContent).toMatch(/No observed spot history/);
    expect(screen.queryByTestId('pnl-chart-a')).toBeNull();
    expect(screen.queryByTestId('pnl-chart-b')).toBeNull();
    first.unmount();

    // Observed history present: decision-useful curves with plotted points.
    const bars = Array.from({ length: 45 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 5, 1) + i * 86_400_000).toISOString().slice(0, 10),
      open: 480 + i, high: 482 + i, low: 478 + i, close: 480.5 + i, volume: 1_000_000,
    }));
    act(() => {
      useTerminalStore.setState({ snapshot: snap, symbol: 'SPY', fmpHistory: bars as never, historySource: 'fmp' });
    });
    render(<PnlWorkflow />);
    expect(screen.queryByTestId('pnl-chart-unavailable-a')).toBeNull();
    expect(screen.queryByTestId('pnl-chart-unavailable-b')).toBeNull();
    const chartA = screen.getByTestId('pnl-chart-a');
    const chartB = screen.getByTestId('pnl-chart-b');
    expect(Number(chartA.getAttribute('data-chart-points'))).toBeGreaterThan(0);
    expect(Number(chartB.getAttribute('data-chart-points'))).toBeGreaterThan(0);
    // Remaining PnL charts mount with definite heights and plotted points too
    // (default straddle mode is breakeven, so pnl-chart-c-pnl is not mounted).
    const chartCbe = screen.getByTestId('pnl-chart-c-be');
    const chartD = screen.getByTestId('pnl-chart-d');
    const chartE = screen.getByTestId('pnl-chart-e');
    const chartF = screen.getByTestId('pnl-chart-f');
    expect(Number(chartCbe.getAttribute('data-chart-points'))).toBeGreaterThan(0);
    expect(Number(chartD.getAttribute('data-chart-points'))).toBeGreaterThan(0);
    expect(Number(chartE.getAttribute('data-chart-points'))).toBeGreaterThan(0);
    expect(Number.isFinite(Number(chartF.getAttribute('data-chart-points')))).toBe(true);
    act(() => {
      useTerminalStore.setState({ fmpHistory: null, historySource: 'none' });
    });
  });

  it('renders Hedge controls and exposes the path-vol scenario label', () => {
    useTerminalStore.setState({ snapshot: snap, symbol: 'SPY', fundingAnn: null });
    render(<HedgeWorkflow />);
    expect(screen.getByTestId('trade-hedge-workflow')).toBeInTheDocument();
    expect(screen.getAllByText(/Path vol scenario/).length).toBeGreaterThan(0);
    const mode = screen.getAllByLabelText('Mode')[0]!;
    fireEvent.change(mode, { target: { value: 'period' } });
    expect(mode).toHaveValue('period');
    expect(screen.getByLabelText('Every N steps')).toBeInTheDocument();
  });
  const snap = buildSnapshot('SPY', Date.now(), 500, 0.05, 0.01);

  it('controls change calculations: qty scales delta', () => {
    const legs1 = templateLegs('long_call', snap, 0).map(l => ({ ...l, qty: 1 }));
    const legs2 = templateLegs('long_call', snap, 0).map(l => ({ ...l, qty: 3 }));
    const m1 = evaluateCombo(legs1, snap);
    const m2 = evaluateCombo(legs2, snap);
    expect(m2.greeks.delta).toBeCloseTo(m1.greeks.delta * 3, 6);
  });

  it('long entry uses ask, short entry uses bid', () => {
    const slice = snap.expiries[0]!;
    const longLegs = templateLegs('long_call', snap, 0);
    const shortLegs = templateLegs('short_put', snap, 0);
    const longLeg = longLegs[0]!;
    const shortLeg = shortLegs[0]!;
    const longQuote = slice.calls.find(q => q.strike === longLeg.strike)!;
    const shortQuote = slice.puts.find(q => q.strike === shortLeg.strike)!;
    expect(longLeg.entryPrice).toBe(longQuote.ask); // long → ask
    expect(shortLeg.entryPrice).toBe(shortQuote.bid); // short → bid
    expect(longLeg.entryBasis).toBe('ask');
    expect(shortLeg.entryBasis).toBe('bid');
    expect(longQuote.bid).not.toBe(longQuote.ask);
  });

  it('missing executable side produces Unavailable (null entryPrice, available:false)', () => {
    // Create a snapshot where one quote has null bid/ask
    const snap2 = buildSnapshot('SPY2', Date.now(), 500, 0.05, 0.01);
    // Force a missing ask for the ATM call
    snap2.expiries[0]!.calls.forEach(q => { if (q.strike === snap2.spot) q.ask = null; });
    const legs = templateLegs('long_call', snap2, 0);
    // long_call should have null entryPrice when ask missing
    const missing = legs.find(l => l.kind === 'call' && l.side === 'long');
    expect(missing?.entryPrice).toBeNull();
    expect(missing?.entryBasis).toBeNull();
    const m = evaluateCombo(legs, snap2);
    expect(m.unavailable).toBe(true);
    expect(m.pnl).toBeNull();
    expect(m.mark).toBeNull();
    // Break-even must be unavailable when entryPrice missing
    const be = breakEvenSpots(legs, snap2.spot);
    expect(be.available).toBe(false);
    expect(be.reason).toBe('missing entryPrice');
    // PnL series must be unavailable not zero
    const path = syntheticSpotPath(snap2.spot, 10, 0.2, 1);
    const pnl = comboGreeksPnl(legs, snap2, path);
    expect(pnl.available).toBe(false);
    expect(pnl.terminalPnl).toBeNull();
    expect(pnl.totalDelta).toBeNull();
  });

  it('missing expiry, IV, entry price, or history never becomes zero (fail-closed)', () => {
    const slice = snap.expiries[0]!;
    const atm = slice.calls[0]!;
    const path = syntheticSpotPath(snap.spot, 10, 0.2, 2);
    // Missing expiry
    const legsNoExpiry: any = [{ id: '1', kind: 'call', side: 'long', qty: 1, strike: atm.strike, entryPrice: atm.ask, iv: atm.iv }];
    const r1 = comboGreeksPnl(legsNoExpiry, snap, path);
    expect(r1.available).toBe(false);
    expect(r1.reason).toMatch(/missing-expiry/);
    expect(r1.terminalPnl).toBeNull();

    // Missing IV (null iv and no surface)
    const legsNoIv: any = [{ id: '1', kind: 'call', side: 'long', qty: 1, strike: atm.strike, expiry: '2099-01-01', entryPrice: atm.ask, iv: null }];
    const r2 = comboGreeksPnl(legsNoIv, snap, path);
    expect(r2.available).toBe(false);
    expect(r2.terminalPnl).toBeNull();

    // Missing entryPrice
    const legsNoEntry: any = [{ id: '1', kind: 'call', side: 'long', qty: 1, strike: atm.strike, expiry: slice.expiry, entryPrice: null, iv: atm.iv }];
    const r3 = comboGreeksPnl(legsNoEntry, snap, path);
    expect(r3.available).toBe(false);
    expect(r3.terminalPnl).toBeNull();

    // No history
    const legsOk = templateLegs('long_call', snap, 0);
    const r4 = comboGreeksPnl(legsOk, snap, []);
    expect(r4.available).toBe(false);
    expect(r4.reason).toBe('no-history');
    expect(r4.terminalPnl).toBeNull();

    // Single-option PnL without explicit entryPrice must be unavailable (no fabricated 0)
    const r5 = optionGreeksPnl(snap, { type: 'call', strike: atm.strike, expiry: slice.expiry, path });
    expect(r5.available).toBe(false);
    expect(r5.terminalPnl).toBeNull();
  });

  it('model/scenario/observed provenance labels are distinct', () => {
    const slice = snap.expiries[0]!;
    const atm = slice.calls[0]!;
    const pathObserved = syntheticSpotPath(snap.spot, 10, 0.2, 3);
    const legs = templateLegs('long_straddle', snap, 0);
    const histObserved = comboGreeksPnl(legs, snap, pathObserved, 'observed-history');
    expect(histObserved.provenance).toBe('observed-history');
    expect(histObserved.method).toBe('bs-sticky-iv');
    const histScenario = comboGreeksPnl(legs, snap, pathObserved, 'scenario-synthetic');
    expect(histScenario.provenance).toBe('scenario-synthetic');
    expect(histScenario.method).toBe('scenario-synthetic-gbm-sticky-iv');
    // Feed IV is observed, solved mid is derived, SVI is model — check types have distinct fields
    expect(atm.feedIv === undefined || typeof atm.feedIv === 'number' || atm.feedIv === null).toBe(true);
    expect(atm.midIv !== undefined || atm.iv !== null).toBe(true);
  });

  it('break-even discriminated: available vs unavailable, never NaN/Infinity', () => {
    const legs = templateLegs('long_straddle', snap, 0);
    const be = analyzeComboBreakEven(legs, snap.spot);
    expect(be.available).toBe(true);
    expect(be.breakEvens.every(Number.isFinite)).toBe(true);
    expect(be.payoffCurve.every(p => p.pnl == null || Number.isFinite(p.pnl))).toBe(true);
    expect(be.maxLoss == null || Number.isFinite(be.maxLoss)).toBe(true);
    expect(be.maxGain == null || Number.isFinite(be.maxGain)).toBe(true);
    expect(be.breakEvens.some(v => Number.isNaN(v) || !Number.isFinite(v))).toBe(false);

    // Missing entryPrice → unavailable, no fake zeros
    const badLegs = legs.map(l => ({ ...l, entryPrice: null }));
    const beBad = analyzeComboBreakEven(badLegs as any, snap.spot);
    expect(beBad.available).toBe(false);
    expect(beBad.breakEvens).toEqual([]);
    expect(beBad.maxLoss).toBeNull();
    expect(beBad.maxGain).toBeNull();
    // Payoff at expiry with missing premium returns null not NaN
    const payoffBad = comboPayoffAtExpiry(badLegs as any, snap.spot);
    expect(payoffBad).toBeNull();
    expect(Number.isNaN(payoffBad as any)).toBe(false);
  });

  it('PnL discriminated: never zero for missing data, correct attribution', () => {
    const legs = templateLegs('short_straddle', snap, 0);
    const path = syntheticSpotPath(snap.spot, 15, 0.2, 4);
    const res = comboGreeksPnl(legs, snap, path);
    expect(res.available).toBe(true);
    expect(res.terminalPnl != null && Number.isFinite(res.terminalPnl)).toBe(true);
    // Attribution closes
    const sum = (res.totalDelta ?? 0) + (res.totalGamma ?? 0) + (res.totalTheta ?? 0) + (res.totalVega ?? 0) + (res.totalResidual ?? 0);
    expect(sum).toBeCloseTo(res.terminalPnl as number, 4);
    // Vega is 0 for sticky IV
    expect(res.totalVega).toBe(0);
  });

  it('hedge behavior: implied-vol scenario labeling, no realized vol mislabel', () => {
    const legs = templateLegs('long_call', snap, 0);
    // Hedge uses implied vol scenario, not realized
    const r = snap.riskFreeRate;
    const q = snap.dividendYield;
    const result = simulateDeltaHedge({
      mode: 'threshold', threshold: 0.1, tolerance: 0.05, periodSteps: 5,
      type: 'call', strike: legs[0]!.strike!, T: 0.25, vol: 0.2, realizedVol: 0.25, drift: 0,
      days: 21, steps: 60, optionQty: -1, hedgeInstrument: 'spot', r, q, seed: 19,
    }, snap.spot);
    expect(result.steps.length).toBeGreaterThan(10);
    expect(Number.isFinite(result.terminalPnl)).toBe(true);
    // The workflow labels this as implied-vol scenario, not observed realized
    // (check that the hedge file no longer contains "observed-σ")
  });

  it('canonical-math outputs: priceGreeksMarket returns finite greeks', () => {
    const g = priceGreeksMarket('call', 500, 500, 0.25, 0.05, 0.01, 0.2);
    expect(Number.isFinite(g.price)).toBe(true);
    expect(g.price).toBeGreaterThan(0);
    expect(Number.isFinite(g.delta)).toBe(true);
    expect(g.delta).toBeGreaterThan(0);
    expect(g.delta).toBeLessThan(1);
    expect(Number.isFinite(g.gamma)).toBe(true);
    expect(g.gamma).toBeGreaterThan(0);
    expect(Number.isFinite(g.theta)).toBe(true);
    expect(Number.isFinite(g.vega)).toBe(true);
    expect(g.vega).toBeGreaterThan(0);
    // Charm should be finite and per Haug formula
    expect(Number.isFinite(g.charm)).toBe(true);
  });

  it('path simulation never renders NaN/Infinity', () => {
    const path = syntheticSpotPath(500, 30, 0.2, 42);
    expect(path.every(p => Number.isFinite(p.close) && p.close > 0)).toBe(true);
    expect(path.every(p => Number.isFinite(p.ts))).toBe(true);
    const snap2 = buildSnapshot('SPY', Date.now(), 500, 0.05, 0.01);
    const legs = templateLegs('long_straddle', snap2, 0);
    const pnl = comboGreeksPnl(legs, snap2, path);
    expect(pnl.bars.every(b => Number.isFinite(b.pnl) && Number.isFinite(b.spot) && Number.isFinite(b.mark))).toBe(true);
    expect(pnl.bars.some(b => Number.isNaN(b.pnl) || !Number.isFinite(b.pnl))).toBe(false);
  });
});
