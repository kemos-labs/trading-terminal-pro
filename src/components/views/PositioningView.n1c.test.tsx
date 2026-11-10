import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { PositioningView } from './PositioningView';
import { useTerminalStore } from '../../store/terminalStore';
import { buildSnapshot } from '../../lib/options/synthetic';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

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

function seedStore(section = 'pos-sub-chain') {
  useTerminalStore.setState({
    symbol: 'SPY',
    snapshot: buildSnapshot('SPY', Date.now(), 500, 0, 0),
    surface: null,
    sviReadout: null,
    arbResult: null,
    historicalFrames: [],
    frameIndex: 0,
    isPlaying: false,
    speed: 1,
    source: 'live',
    liveAvailable: false,
    loading: false,
    lastUpdate: Date.now(),
    activeTab: 'positioning',
    deskSectionId: section,
    displayMode: 'strike',
    selectedExpiry: null,
    playbackInterval: null,
    refreshInterval: null,
    chainAvailable: true,
    chainUsed: 'yfinance',
    spotSource: 'yfinance',
    historyMode: 'live',
    fmpHistory: null,
    historySource: 'none',
  });
}

function panel() {
  return screen.getByTestId('pbs-panel');
}

describe('PositioningView N1c position-by-strike', () => {
  beforeEach(() => {
    seedStore('pos-sub-chain');
  });

  it('panel is reachable in the Book workflow alongside existing features', () => {
    render(<PositioningView />);
    expect(panel()).toBeTruthy();
    expect(within(panel()).getByText(/POSITION BY STRIKE/)).toBeTruthy();
    // Existing Book features remain: chain, dealer chart, expiry matrix.
    expect(screen.getByText('Option Chain')).toBeTruthy();
    expect(screen.getAllByText(/Net GEX/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/EXPIRY MATRIX/)).toBeTruthy();
  });

  it('net / call-put / combined controls switch the bar set', () => {
    render(<PositioningView />);
    const p = panel();
    const snap = useTerminalStore.getState().snapshot!;
    const strike = snap.expiries[0]!.calls[0]!.strike;

    // Net default: one signed net bar, no component bars.
    expect(within(p).getByTestId(`pbs-bar-net-${strike}`)).toBeTruthy();
    expect(within(p).queryByTestId(`pbs-bar-call-${strike}`)).toBeNull();

    fireEvent.click(within(p).getByRole('tab', { name: 'Call / Put' }));
    expect(within(p).getByTestId(`pbs-bar-call-${strike}`)).toBeTruthy();
    expect(within(p).getByTestId(`pbs-bar-put-${strike}`)).toBeTruthy();
    expect(within(p).queryByTestId(`pbs-bar-net-${strike}`)).toBeNull();

    fireEvent.click(within(p).getByRole('tab', { name: 'Combined' }));
    expect(within(p).getByTestId(`pbs-bar-call-${strike}`)).toBeTruthy();
    expect(within(p).getByTestId(`pbs-bar-put-${strike}`)).toBeTruthy();
    expect(within(p).getByTestId(`pbs-bar-net-${strike}`)).toBeTruthy();
  });

  it('$GEX and Contracts stay separated with exact provenance', () => {
    render(<PositioningView />);
    const p = panel();
    expect(within(p).getByTestId('pbs-provenance').textContent).toMatch(
      /Derived signed Greek × OI proxy/,
    );
    expect(within(p).getByTestId('pbs-provenance').textContent).toMatch(
      /not verified dealer inventory/,
    );
    fireEvent.click(within(p).getByRole('tab', { name: 'Contracts' }));
    expect(within(p).getByTestId('pbs-detail-source').textContent).toMatch(
      /Observed chain OI \/ contracts/,
    );
    expect(within(p).getByTestId('pbs-detail-units').textContent).toMatch(/Contracts/);
    // Back to $GEX keeps the Greek proxy separate.
    fireEvent.click(within(p).getByRole('tab', { name: /Greek exposure/ }));
    expect(within(p).getByTestId('pbs-detail-source').textContent).toMatch(
      /Derived signed Greek × OI proxy/,
    );
  });

  it('non-OI weight shows Contracts Unavailable and keeps the Greek proxy', () => {
    render(<PositioningView />);
    // Switch the existing desk weight to the volume scenario.
    fireEvent.click(screen.getByRole('tab', { name: /Vol \(scenario\)/ }));
    const p = panel();
    fireEvent.click(within(p).getByRole('tab', { name: 'Contracts' }));
    expect(within(p).getByTestId('pbs-contracts-unavailable').textContent).toMatch(
      /Contracts Unavailable/,
    );
    // Greek proxy remains available.
    fireEvent.click(within(p).getByRole('tab', { name: /Greek exposure/ }));
    expect(within(p).queryByTestId('pbs-contracts-unavailable')).toBeNull();
    expect(within(p).getByTestId('pbs-detail')).toBeTruthy();
  });

  it('missing OI stays Unavailable (never zero-filled) with exact disclosure', () => {
    seedStore('pos-sub-chain');
    const st = useTerminalStore.getState();
    const snap = st.snapshot!;
    const target = snap.expiries[0]!.calls[2]!.strike;
    // Null the put OI for one strike across every slice in scope.
    for (const sl of snap.expiries) {
      for (const q of sl.puts) {
        if (q.strike === target) q.openInterest = null;
      }
    }
    useTerminalStore.setState({ snapshot: { ...snap } });

    render(<PositioningView />);
    const p = panel();
    fireEvent.click(within(p).getByRole('tab', { name: 'Contracts' }));
    fireEvent.click(within(p).getByTestId(`pbs-row-${target}`));

    const detail = within(p).getByTestId('pbs-detail');
    expect(within(p).getByTestId('pbs-detail-strike').textContent).toContain(String(target));
    expect(within(p).getByTestId('pbs-detail-spot').textContent).toContain(String(snap.spot));
    expect(within(p).getByTestId('pbs-detail-expiry').textContent).toMatch(/All expiries/);
    expect(within(p).getByTestId('pbs-detail-asof').textContent).toMatch(/\d{4}-\d{2}-\d{2}/);
    // Net contracts Unavailable — never rendered as a zero observation.
    expect(detail.textContent).toMatch(/net Unavailable/);
    expect(detail.textContent).not.toMatch(/net \+?0 contracts/);
    expect(within(p).getByTestId(`pbs-net-value-${target}`).textContent).toContain('—');
  });

  it('exact disclosure carries strike/spot/expiry/as-of/provenance and no NaN/Infinity', () => {
    render(<PositioningView />);
    const p = panel();
    const snap = useTerminalStore.getState().snapshot!;
    const strike = snap.expiries[0]!.calls[1]!.strike;
    const row = within(p).getByTestId(`pbs-row-${strike}`);
    fireEvent.focus(row);
    const detail = within(p).getByTestId('pbs-detail');
    expect(detail.textContent).toContain(String(strike));
    expect(detail.textContent).toContain(String(snap.spot));
    expect(detail.textContent).toMatch(/All expiries/);
    expect(detail.textContent).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(detail.textContent).toMatch(/Derived signed Greek × OI proxy/);
    // Keyboard path: the row is focusable and the detail region is tabbable.
    expect(row.tagName.toLowerCase()).toBe('button');
    expect(detail.getAttribute('tabindex')).toBe('0');
    // No leaked NaN/Infinity values anywhere in the panel — including the
    // provenance disclaimer itself. The browser-level failure-state gate scans
    // body text for /\b(?:NaN|Infinity)\b/, so prose that spells those tokens
    // (even to ban them) fails the visual gate while rendering no bad number.
    const nodes = Array.from(p.querySelectorAll('[data-testid^="pbs-"]'));
    const offenders = nodes
      .filter((n) => /NaN|Infinity/.test(n.textContent ?? ''))
      .map((n) => n.getAttribute('data-testid'));
    expect(offenders).toEqual([]);
    const provenance = within(p).getByTestId('pbs-provenance');
    expect(provenance.textContent).toMatch(/never zero, non-finite, or synthetic/);
  });

  it('PBS rows are native buttons without invalid listitem role, wrapped in listitem', () => {
    render(<PositioningView />);
    const p = panel();
    const snap = useTerminalStore.getState().snapshot!;
    const strike = snap.expiries[0]!.calls[0]!.strike;
    const btn = within(p).getByTestId(`pbs-row-${strike}`);
    expect(btn.tagName.toLowerCase()).toBe('button');
    expect(btn.getAttribute('role')).toBeNull();
    const wrapper = btn.parentElement;
    expect(wrapper?.getAttribute('role')).toBe('listitem');
    expect(within(p).getByRole('list')).toBeTruthy();
  });

  it('non-finite spot shows Unavailable in disclosure, finite spot stays exact', () => {
    seedStore('pos-sub-chain');
    const snap = useTerminalStore.getState().snapshot!;
    useTerminalStore.setState({ snapshot: { ...snap, spot: NaN } });
    const { unmount: u1 } = render(<PositioningView />);
    expect(within(screen.getByTestId('pbs-panel')).getByTestId('pbs-detail-spot').textContent).toMatch(/Unavailable/);
    expect(within(screen.getByTestId('pbs-panel')).getByTestId('pbs-detail-spot').textContent).not.toMatch(/NaN/);
    u1();
    useTerminalStore.setState({ snapshot: { ...snap, spot: Infinity } });
    render(<PositioningView />);
    expect(within(screen.getByTestId('pbs-panel')).getByTestId('pbs-detail-spot').textContent).toMatch(/Unavailable/);
    expect(within(screen.getByTestId('pbs-panel')).getByTestId('pbs-detail-spot').textContent).not.toMatch(/Infinity/);
  });

  it('absent-side OI (no quote at strike) is Unavailable, not zero-filled; valid zero stays zero', () => {
    seedStore('pos-sub-chain');
    const st = useTerminalStore.getState();
    const snap = st.snapshot!;
    // Remove call side entirely for a strike that exists in dealer points
    const target = snap.expiries[0]!.calls[0]!.strike;
    // Pick a central strike for zero-preservation check (not the deleted one)
    const midIdx = Math.floor(snap.expiries[0]!.calls.length / 2);
    const zeroStrike = snap.expiries[0]!.calls[midIdx]!.strike;
    for (const sl of snap.expiries) {
      sl.calls = sl.calls.filter((q) => q.strike !== target);
    }
    // Set only put side to valid zero for zeroStrike — call side stays non-zero so dealer row remains
    for (const sl of snap.expiries) {
      for (const q of sl.puts) if (q.strike === zeroStrike) q.openInterest = 0;
    }
    useTerminalStore.setState({ snapshot: { ...snap } });
    render(<PositioningView />);
    const p = panel();
    fireEvent.click(within(p).getByRole('tab', { name: 'Contracts' }));
    // absent call side -> Unavailable, not zero
    expect(screen.getByTestId(`pbs-row-${target}`)).toBeTruthy();
    fireEvent.click(screen.getByTestId(`pbs-row-${target}`));
    expect(within(p).getByTestId('pbs-detail').textContent).toMatch(/net Unavailable/);
    expect(screen.getByTestId(`pbs-net-value-${target}`).textContent).toContain('—');
    // valid observed zero OI stays zero (put 0 displayed, not Unavailable)
    expect(screen.getByTestId(`pbs-row-${zeroStrike}`)).toBeTruthy();
    fireEvent.click(screen.getByTestId(`pbs-row-${zeroStrike}`));
    // call 0 would hide row, so we test put side zero is preserved in detail text
    expect(within(p).getByTestId('pbs-detail').textContent).toMatch(/put 0/);
    expect(within(p).getByTestId('pbs-detail').textContent).not.toMatch(/put —/);
  });

  it('Greek exposure provenance echoes active scenario weight, OI default stays compatible', () => {
    render(<PositioningView />);
    const p = panel();
    // default OI wording intact
    expect(within(p).getByTestId('pbs-detail-source').textContent).toMatch(/Derived signed Greek × OI proxy/);
    expect(within(p).getByTestId('pbs-provenance').textContent).toMatch(/Derived signed Greek × OI proxy/);
    fireEvent.click(screen.getByRole('tab', { name: /Vol \(scenario\)/ }));
    // Greek panel should now echo the active scenario weight
    expect(within(p).getByTestId('pbs-detail-source').textContent).toMatch(/volume/);
    expect(within(p).getByTestId('pbs-provenance').textContent).toMatch(/volume/);
  });
});
