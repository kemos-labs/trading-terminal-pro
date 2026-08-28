import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { BacktestTool } from './BacktestTool';
import { useTerminalStore } from '../../../store/terminalStore';
import { buildSnapshot } from '../../../lib/options/synthetic';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

function seedStore() {
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
    activeTab: 'vol',
    displayMode: 'strike',
    selectedExpiry: null,
    playbackInterval: null,
    refreshInterval: null,
    chainAvailable: false,
    chainUsed: 'none',
    spotSource: 'none',
    historyMode: 'live',
  });
}

describe('BacktestTool', () => {
  beforeEach(() => {
    seedStore();
  });

  it('renders kit controls, print strip, honest path-sim copy, and chart titles', () => {
    render(<BacktestTool />);

    expect(screen.getAllByText('Weeks').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Realized σ')).toBeTruthy();
    expect(screen.getAllByText(/Scenario Monte Carlo/i).length).toBeGreaterThanOrEqual(1);

    expect(screen.getByText('E[PnL]')).toBeTruthy();
    expect(screen.getByText('Win')).toBeTruthy();
    expect(screen.getByText('σ')).toBeTruthy();
    expect(screen.getByText('Hedge PnL')).toBeTruthy();

    expect(screen.getByText('Horizon (days)')).toBeTruthy();
    expect(screen.getByText('PnL ($)')).toBeTruthy();
  });
});
