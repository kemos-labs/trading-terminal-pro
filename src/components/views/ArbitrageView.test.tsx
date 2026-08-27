import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArbitrageView } from './ArbitrageView';
import { useTerminalStore } from '../../store/terminalStore';
import { buildSnapshot, buildSurfaceGrid } from '../../lib/options/synthetic';
import { sviReadout } from '../../lib/options/surfaceTools';
import { diagnoseArbitrage } from '../../lib/options/noarb';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

describe('ArbitrageView', () => {
  beforeEach(() => {
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
      source: 'demo',
      liveAvailable: false,
      loading: false,
      lastUpdate: Date.now(),
      activeTab: 'vol',
      displayMode: 'strike',
      selectedExpiry: null,
      playbackInterval: null,
      refreshInterval: null,
    });
  });

  it('renders "No data" when surface is null', () => {
    useTerminalStore.setState({ surface: null, arbResult: null });
    render(<ArbitrageView />);
    expect(screen.getByText('No arbitrage data')).toBeInTheDocument();
  });

  it('renders DiagnosticsStrip with arbResult', () => {
    render(<ArbitrageView />);
    const badge = screen.getByTestId('diagnostics-arb-badge');
    expect(badge).toBeInTheDocument();
  });

  it('renders a canvas element for the heatmap', () => {
    render(<ArbitrageView />);
    const canvas = document.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
  });

  it('toggles between calendar and butterfly mode', () => {
    render(<ArbitrageView />);

    const btn = screen.getByRole('tab', { name: /Butterfly/ });
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(btn.className).toContain('bg-secondary');
  });
});
