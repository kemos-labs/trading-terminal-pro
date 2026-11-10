/**
 * OptionChain stale scope qualifier — stale-label-fix tranche.
 *
 * The `chain-stale` pill stays exactly one; a sibling scope note states the
 * staleness is chain-only and spot keeps its own badge (mixed, never blanket).
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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

function seedStore(provenanceChain: ReturnType<typeof makeProvenance> | null) {
  const snapshot = buildSnapshot('SPY', Date.now(), 100, 0, 0);
  const surface = buildSurfaceGrid(snapshot);
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
}

describe('OptionChain stale scope qualifier', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      provenance: { ...EMPTY_PROVENANCE },
      snapshot: null,
      selectedExpiry: null,
    } as Partial<ReturnType<typeof useTerminalStore.getState>> as never);
  });

  it('pairs one Stale pill with a chain-only scope note when provenance is stale', () => {
    seedStore(makeProvenance('chain', 'yfinance', Date.now() - 400_000));
    const { container } = render(<OptionChain />);
    expect(container.querySelectorAll('[data-testid="chain-stale"]')).toHaveLength(1);
    const scope = screen.getByTestId('chain-stale-scope');
    expect(scope).toHaveTextContent('chain only');
    expect(scope).toHaveTextContent('spot keeps own badge');
    expect(screen.getByText('Strike')).toBeInTheDocument();
  });

  it('shows no scope note when chain provenance is live', () => {
    seedStore(makeProvenance('chain', 'yfinance', Date.now()));
    render(<OptionChain />);
    expect(screen.getByText('Strike')).toBeInTheDocument();
    expect(screen.queryByTestId('chain-stale')).toBeNull();
    expect(screen.queryByTestId('chain-stale-scope')).toBeNull();
  });
});
