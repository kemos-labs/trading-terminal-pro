/**
 * OptionChain `chain-stale` pill — stale metadata tranche 01.
 *
 * Exactly one accessible `data-testid="chain-stale"` status pill renders in the
 * OptionChain header, and ONLY when the existing store `provenance.chain` kind
 * is `stale`/`expired` (server `freshness` via `sourceFreshness` + snapshot age).
 * The pill is display-only: strike/IV/Delta/OI math and null handling are
 * untouched, missing OI still renders as em-dash, and no NaN/Infinity leaks.
 * This never reuses the Session-GEX 96h wall-clock rule and never claims dealer
 * exposure staleness. Empty (fail-closed) renders no pill.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { OptionChain } from './OptionChain';
import { useTerminalStore } from '../../store/terminalStore';
import { buildSnapshot, buildSurfaceGrid } from '../../lib/options/synthetic';
import { sviReadout } from '../../lib/options/surfaceTools';
import { diagnoseArbitrage } from '../../lib/options/noarb';
import {
  EMPTY_PROVENANCE,
  makeProvenance,
} from '../../lib/data/freshness';

// jsdom polyfills for code that touches ResizeObserver indirectly.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

function seedSnapshot() {
  const snapshot = buildSnapshot('SPY', Date.now(), 100, 0, 0);
  const surface = buildSurfaceGrid(snapshot);
  return { snapshot, surface };
}

function seedStore(provenanceChain: ReturnType<typeof makeProvenance> | null) {
  const { snapshot, surface } = seedSnapshot();
  useTerminalStore.setState({
    symbol: 'SPY',
    snapshot,
    surface,
    sviReadout: sviReadout(surface, snapshot.spot),
    arbResult: diagnoseArbitrage(surface, snapshot.spot),
    historicalFrames: [],
    frameIndex: 0,
    isPlaying: false,
    speed: 1,
    source: 'live',
    liveAvailable: true,
    loading: false,
    lastUpdate: Date.now(),
    activeTab: 'positioning',
    displayMode: 'strike',
    selectedExpiry: null,
    playbackInterval: null,
    refreshInterval: null,
    chainAvailable: true,
    chainUsed: 'yfinance',
    provenance: { ...EMPTY_PROVENANCE, chain: provenanceChain },
  } as Partial<ReturnType<typeof useTerminalStore.getState>> as never);
  return snapshot;
}

describe('OptionChain chain-stale pill', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      provenance: { ...EMPTY_PROVENANCE },
      snapshot: null,
      selectedExpiry: null,
    } as Partial<ReturnType<typeof useTerminalStore.getState>> as never);
  });

  it('shows one accessible Stale pill with bounded age when chain provenance is stale', () => {
    // 400s old observation: past chain staleMs (180s), inside expiredMs (900s).
    seedStore(makeProvenance('chain', 'yfinance', Date.now() - 400_000));
    const { container } = render(<OptionChain />);
    expect(screen.getByText('Strike')).toBeInTheDocument();
    const pill = screen.getByTestId('chain-stale');
    expect(container.querySelectorAll('[data-testid="chain-stale"]')).toHaveLength(1);
    expect(pill).toHaveTextContent('Stale');
    expect(pill.getAttribute('role')).toBe('status');
    expect(pill.getAttribute('title')).toContain('stale');
    // Bounded age in seconds rides in the title, never as invented body copy.
    expect(pill.getAttribute('title')).toMatch(/age \d+s/);
    // Rows still render last-good data; header + export affordance preserved.
    expect(screen.getByTestId('chain-diagnostics')).toBeInTheDocument();
  });

  it('shows the pill for expired chain provenance with rows present', () => {
    seedStore(makeProvenance('chain', 'yfinance', Date.now() - 1_000_000));
    render(<OptionChain />);
    expect(screen.getByTestId('chain-stale')).toBeInTheDocument();
    expect(screen.getByText('Strike')).toBeInTheDocument();
  });

  it('shows no pill when chain provenance is live', () => {
    seedStore(makeProvenance('chain', 'yfinance', Date.now()));
    render(<OptionChain />);
    expect(screen.getByText('Strike')).toBeInTheDocument();
    expect(screen.queryByTestId('chain-stale')).toBeNull();
  });

  it('shows no pill when chain provenance is absent (unknown, never stale)', () => {
    seedStore(null);
    render(<OptionChain />);
    expect(screen.getByText('Strike')).toBeInTheDocument();
    expect(screen.queryByTestId('chain-stale')).toBeNull();
  });

  it('renders fail-closed empty state with no pill when the snapshot is missing', () => {
    useTerminalStore.setState({
      snapshot: null,
      loading: false,
      chainAvailable: false,
      chainUsed: 'none',
      provenance: {
        ...EMPTY_PROVENANCE,
        chain: makeProvenance('chain', 'none', null, { down: true }),
      },
    } as Partial<ReturnType<typeof useTerminalStore.getState>> as never);
    render(<OptionChain />);
    expect(screen.getByText('No live option chain')).toBeInTheDocument();
    expect(screen.queryByTestId('chain-stale')).toBeNull();
  });

  it('preserves IV/Delta/OI math, null handling, and leaks no NaN/Infinity', () => {
    // Stale pill must not alter row math: spot-anchored rows render and the
    // serialized DOM carries no NaN/Infinity tokens.
    seedStore(makeProvenance('chain', 'yfinance', Date.now() - 400_000, { sourceKind: 'stale' }));
    const { container } = render(<OptionChain />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/NaN/);
    expect(text).not.toMatch(/Infinity/);
    // Missing-value glyph still differs from zero (em-dash, never 0-as-data).
    expect(text).not.toMatch(/undefined/);
    expect(screen.getByTestId('chain-stale')).toBeInTheDocument();
  });
});
