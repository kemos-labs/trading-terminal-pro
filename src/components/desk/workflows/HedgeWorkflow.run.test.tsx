import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, cleanup, act } from '@testing-library/react';
import { HedgeWorkflow } from './HedgeWorkflow';
import { useTerminalStore } from '../../../store/terminalStore';
import { buildSnapshot } from '../../../lib/options/synthetic';

class TestRO { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = TestRO as unknown as typeof ResizeObserver;

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  const ReactMod = await import('react');
  return {
    ...actual,
    ResponsiveContainer: ({ height }: { height?: number | string }) =>
      ReactMod.createElement('div', { 'data-testid': 'recharts-viewport-mock' }),
  };
});

function validSnap(symbol = 'SPY') {
  const snap = buildSnapshot(symbol, Date.now(), 500, 0.05, 0.01);
  useTerminalStore.setState({ snapshot: snap, symbol, fundingAnn: null });
  return snap;
}

beforeEach(() => { cleanup(); });

describe('HedgeWorkflow explicit-run correction', () => {
  it('no simulation before explicit activation on either panel', () => {
    validSnap();
    render(<HedgeWorkflow />);
    expect(screen.getByTestId('hedge-pending')).toBeInTheDocument();
    expect(screen.getByTestId('follower-pending')).toBeInTheDocument();
    // No executed scenario label before run
    expect(screen.queryByText(/K=.*pathVol=/)).toBeNull();
  });

  it('both panels run and re-run actually executes the edited snapshot', () => {
    validSnap();
    render(<HedgeWorkflow />);
    fireEvent.click(screen.getByTestId('hedge-run'));
    fireEvent.click(screen.getByTestId('follower-run'));
    const first = screen.getAllByText(/K=.*pathVol=/).map((e) => e.textContent);
    expect(first.length).toBe(2);
    // Edit band -> follower must go stale; re-run executes new band (run label persists, stale clears)
    const band = screen.getByLabelText('Band');
    fireEvent.change(band, { target: { value: '0.5' } });
    expect(screen.getByTestId('follower-stale')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('follower-run'));
    expect(screen.queryByTestId('follower-stale')).toBeNull();
    // Edit threshold -> hedge must go stale
    const trig = screen.getByLabelText('|Δ| trigger');
    fireEvent.change(trig, { target: { value: '0.9' } });
    expect(screen.getByTestId('hedge-stale')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('hedge-run'));
    expect(screen.queryByTestId('hedge-stale')).toBeNull();
  });

  it('edits without rerun keep old scenario labelled and marked stale', () => {
    validSnap();
    render(<HedgeWorkflow />);
    fireEvent.click(screen.getByTestId('hedge-run'));
    const before = screen.getAllByText(/K=.*pathVol=/)[0]!.textContent;
    const trig = screen.getByLabelText('|Δ| trigger');
    fireEvent.change(trig, { target: { value: '0.45' } });
    // Old scenario label still shows the executed snapshot, flagged stale
    expect(screen.getAllByText(/K=.*pathVol=/)[0]!.textContent).toBe(before);
    expect(screen.getByTestId('hedge-stale')).toBeInTheDocument();
  });

  it('symbol change invalidates prior result (stale, old symbol kept)', () => {
    const s1 = validSnap('SPY');
    render(<HedgeWorkflow />);
    fireEvent.click(screen.getByTestId('hedge-run'));
    expect(screen.getAllByText(/K=.*pathVol=/)[0]!.textContent).toMatch(/SPY/);
    const s2 = buildSnapshot('QQQ', Date.now(), 450, 0.05, 0.01);
    act(() => { useTerminalStore.setState({ snapshot: s2, symbol: 'QQQ' }); });
    // Result still labels the executed SPY snapshot and is stale — never silently relabelled QQQ-only
    expect(screen.getByTestId('hedge-stale')).toBeInTheDocument();
    expect(screen.getAllByText(/K=.*pathVol=/)[0]!.textContent).toMatch(/SPY/);
    void s1;
  });

  it('missing mark IV blocks run; valid zero rate is preserved', () => {
    const snap = validSnap();
    snap.expiries.forEach((e) => {
      e.atmIV = null as unknown as number;
      [...e.calls, ...e.puts].forEach((q) => { q.iv = null; });
    });
    useTerminalStore.setState({ snapshot: { ...snap } });
    render(<HedgeWorkflow />);
    // ATM IV unavailable: explicit label, run blocked
    expect(screen.getAllByText(/ATM IV unavailable/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('hedge-unavailable').textContent).toMatch(/mark IV unavailable/);
    expect(screen.getByTestId('hedge-run')).toBeDisabled();
    cleanup();
    // Valid zero rate must not block and must not read as rate unavailable
    const z = validSnap();
    useTerminalStore.setState({ snapshot: { ...z, riskFreeRate: 0 } });
    render(<HedgeWorkflow />);
    expect(screen.getByTestId('hedge-run')).not.toBeDisabled();
    expect(screen.queryByText(/rate unavailable/)).toBeNull();
  });

  it('missing rate and invalid path vol block run', () => {
    const snap = validSnap();
    useTerminalStore.setState({ snapshot: { ...snap, riskFreeRate: NaN } });
    render(<HedgeWorkflow />);
    expect(screen.getByTestId('hedge-unavailable').textContent).toMatch(/rate unavailable/);
    expect(screen.getByTestId('hedge-run')).toBeDisabled();
    cleanup();
    validSnap();
    render(<HedgeWorkflow />);
    const vols = screen.getAllByLabelText(/Path vol scenario/);
    fireEvent.change(vols[0]!, { target: { value: '-1' } });
    expect(screen.getByTestId('hedge-unavailable').textContent).toMatch(/path vol unavailable/);
    expect(screen.getByTestId('hedge-run')).toBeDisabled();
  });

  it('user override with ATM available freezes user-scenario basis on both panels', () => {
    validSnap();
    render(<HedgeWorkflow />);
    const vols = screen.getAllByLabelText(/Path vol scenario/);
    fireEvent.change(vols[0]!, { target: { value: '0.77' } });
    fireEvent.change(vols[1]!, { target: { value: '0.66' } });
    // Draft labels reflect override selection independently per panel
    expect(screen.getAllByText(/user-entered scenario vol/).length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByTestId('hedge-run'));
    fireEvent.click(screen.getByTestId('follower-run'));
    const strips = screen.getAllByText(/77\.0% · user-entered scenario vol|66\.0% · user-entered scenario vol/);
    expect(strips.length).toBe(2);
    // Executed runs must not claim ATM initialization despite ATM being available
    expect(screen.queryByText(/initialized from ATM IV/)).toBeNull();
  });

  it('changing snapshot ATM availability after run retains old executed basis on both panels', () => {
    validSnap();
    render(<HedgeWorkflow />);
    fireEvent.click(screen.getByTestId('hedge-run'));
    fireEvent.click(screen.getByTestId('follower-run'));
    // 2 draft field labels + 2 executed strips
    expect(screen.getAllByText(/initialized from ATM IV/).length).toBe(4);
    // Swap in a snapshot with ATM IV unavailable; executed strips must keep old basis
    const dead = validSnap();
    dead.expiries.forEach((e) => {
      e.atmIV = null as unknown as number;
      [...e.calls, ...e.puts].forEach((q) => { q.iv = null; });
    });
    act(() => { useTerminalStore.setState({ snapshot: { ...dead } }); });
    expect(screen.getAllByText(/initialized from ATM IV/).length).toBe(2);
    expect(screen.getByTestId('hedge-stale')).toBeInTheDocument();
    expect(screen.getByTestId('follower-stale')).toBeInTheDocument();
  });

  it('primary charts mount with definite pixel height and nonzero plotted points after Run', () => {
    validSnap();
    render(<HedgeWorkflow />);
    fireEvent.click(screen.getByTestId('hedge-run'));
    fireEvent.click(screen.getByTestId('follower-run'));
    for (const id of ['hedge-chart-a', 'hedge-chart-b', 'hedge-chart-c']) {
      const frame = screen.getByTestId(id);
      const pts = Number(frame.getAttribute('data-chart-points'));
      expect(Number.isFinite(pts) && pts > 0).toBe(true);
    }
    // Definite pixel height wrappers: recharts height:100% resolves to 0 without these.
    for (const id of ['hedge-chart-a-body', 'hedge-chart-b-body', 'hedge-chart-c-body']) {
      const body = screen.getByTestId(id) as HTMLElement;
      expect(body.style.height).toBe('240px');
      expect(body.querySelector('[data-testid="recharts-viewport-mock"]')).not.toBeNull();
    }
  });

  it('nullable snapshot mounts safe pending-data state', () => {
    useTerminalStore.setState({ snapshot: null as unknown as never, symbol: 'SPY' });
    render(<HedgeWorkflow />);
    expect(screen.getByTestId('trade-hedge-workflow')).toBeInTheDocument();
    expect(screen.getByText(/no market snapshot/i)).toBeInTheDocument();
  });
});
