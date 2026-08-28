import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { OptionPnlTool } from './OptionPnlTool';
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
    fmpHistory: null,
    historySource: 'none',
  });
}

describe('OptionPnlTool', () => {
  beforeEach(() => {
    seedStore();
  });

  it('renders kit controls, print strip, and history axis titles', () => {
    render(<OptionPnlTool />);

    expect(screen.getByText('Expiry')).toBeTruthy();
    expect(screen.getByText('Type')).toBeTruthy();
    expect(screen.getByText('Strike')).toBeTruthy();
    expect(screen.getByText('Side')).toBeTruthy();

    expect(screen.getByText('Path')).toBeTruthy();
    // P0: fail-closed — no history → none (synthetic only via explicit Scenario toggle)
    expect(screen.getByText(/none|No history|Scenario/i)).toBeTruthy();
    expect(screen.getByText('Term PnL')).toBeTruthy();
    expect(screen.getByText('Marks')).toBeTruthy();

    expect(screen.getByText('Date')).toBeTruthy();
    expect(screen.getByText('PnL ($)')).toBeTruthy();
  });
});
