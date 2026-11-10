/**
 * PositioningView derived-panel stale stamping — stale-label-fix tranche.
 *
 * When store `provenance.chain` is stale/expired, the dealer stack and both
 * matrices (expiry, exposure) carry an explicit derived-from-stale-chain stamp
 * while spot-derived copy stays untouched (mixed, never blanket). Live chain
 * renders no stamps. Read-only provenance read; no math/store change.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { PositioningView } from './PositioningView';
import { useTerminalStore } from '../../store/terminalStore';
import { buildSnapshot } from '../../lib/options/synthetic';
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

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  const ReactMod = await import('react');
  return {
    ...actual,
    ResponsiveContainer: ({ height }: { height?: number | string }) =>
      ReactMod.createElement('div', {
        'data-testid': 'recharts-viewport-mock',
        style: { width: 800, height: typeof height === 'number' ? height : 400 },
      }),
  };
});

function seedStore(provenanceChain: ReturnType<typeof makeProvenance> | null) {
  const ts = Date.now();
  useTerminalStore.setState({
    symbol: 'SPY',
    snapshot: buildSnapshot('SPY', ts, 500, 0, 0),
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
    lastUpdate: ts,
    activeTab: 'positioning',
    deskSectionId: 'pos-sub-chain',
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
    provenance: { ...EMPTY_PROVENANCE, chain: provenanceChain },
  } as Partial<ReturnType<typeof useTerminalStore.getState>> as never);
}

describe('PositioningView chain-stale scope stamps', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  afterEach(() => {
    cleanup();
  });

  it('stamps dealer + expiry + exposure panels when chain provenance is stale', () => {
    seedStore(makeProvenance('chain', 'yfinance', Date.now() - 400_000));
    render(<PositioningView />);
    const dealer = screen.getByTestId('dealer-stale-scope');
    expect(dealer.getAttribute('role')).toBe('status');
    expect(dealer).toHaveTextContent('stale chain');
    expect(dealer).toHaveTextContent('spot stays live');
    expect(screen.getByTestId('expiry-stale-scope')).toHaveTextContent('stale chain input');
    expect(screen.getByTestId('exposure-stale-scope')).toHaveTextContent('stale chain input');
    // Chain affordance itself is preserved (no capability erased).
    expect(screen.getAllByText('Strike').length).toBeGreaterThanOrEqual(1);
  });

  it('renders no stamps when chain provenance is live', () => {
    seedStore(makeProvenance('chain', 'yfinance', Date.now()));
    render(<PositioningView />);
    expect(screen.queryByTestId('dealer-stale-scope')).toBeNull();
    expect(screen.queryByTestId('expiry-stale-scope')).toBeNull();
    expect(screen.queryByTestId('exposure-stale-scope')).toBeNull();
  });
});
