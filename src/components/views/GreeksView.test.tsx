import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import {
  buildSnapshot,
  buildSurfaceGrid,
} from '../../lib/options/synthetic';
import { invalidateGreeksCache } from '../../lib/macrovol/greeksCache';
import { GreeksView } from './GreeksView';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

vi.mock('../../lib/macrovol/api', () => ({
  macrovolApi: {
    greeks: vi.fn().mockResolvedValue({
      ticker: 'SPY',
      spot: 100,
      total_points: 10,
      atm: {
        delta: 0.5,
        gamma: 0.02,
        vega: 0.1,
        theta: -0.05,
        vanna: 0.01,
        charm: -0.001,
      },
      gex: [],
      points: [],
      surfaces: {
        delta: {
          T_vals: [0.08, 0.16],
          K_vals: [95, 100, 105],
          grid: [
            [0.4, 0.5, 0.6],
            [0.35, 0.48, 0.55],
          ],
        },
      },
      r: 0.04,
      q: 0.013,
      r_source: 'SOFR',
      source: 'yfinance',
    }),
    greeksHistory: vi.fn().mockResolvedValue({ ticker: 'SPY', data: [] }),
  },
}));

describe('GreeksView (Greeks 1.0 host)', () => {
  beforeEach(() => {
    invalidateGreeksCache();
    const snapshot = buildSnapshot('SPY', Date.now(), 100, 0, 0);
    const surface = buildSurfaceGrid(snapshot);
    useTerminalStore.setState({
      symbol: 'SPY',
      snapshot,
      surface,
      historicalFrames: [],
      frameIndex: 0,
      isPlaying: false,
      speed: 1,
      source: 'live',
      liveAvailable: true,
      loading: false,
      lastUpdate: Date.now(),
      activeTab: 'vol',
      deskSectionId: 'vol-sub-greeks',
      displayMode: 'strike',
      selectedExpiry: null,
      playbackInterval: null,
      refreshInterval: null,
    });
  });

  it('mounts Vol · Greeks shell locked to header symbol (not dual edition)', async () => {
    render(<GreeksView />);
    // Lazy-loaded Greeks10View can exceed the default 1s timeout under the full
    // parallel suite (jsdom is slow under load); give it the same budget as the
    // other lazy tests in this file.
    await waitFor(
      () => {
        expect(screen.getByText(/^SPY$/)).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    expect(screen.queryByText('Terminal Greeks')).toBeNull();
    expect(screen.queryByText('Open Greeks 1.0 (MacroVol API)')).toBeNull();
    // No desk-local multi-ticker chip row
    expect(screen.queryByText('Change')).toBeNull();
    expect(screen.queryByText('QQQ')).toBeNull();
  });

  it('exposes Plotly / 3D mesh theme toggle', async () => {
    render(<GreeksView />);
    await waitFor(
      () => {
        expect(screen.getByTestId('greeks-theme-plotly')).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    expect(screen.getByTestId('greeks-theme-mesh')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('greeks-theme-mesh'));
    expect(localStorage.getItem('ui.greeks.surfaceTheme')).toBe('mesh');
  });

  it('ATM greek cards drive selection labels', async () => {
    render(<GreeksView />);
    await waitFor(
      () => {
        expect(screen.getByText('ATM')).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    expect(screen.getByText('DELTA')).toBeInTheDocument();
    expect(screen.getByText('GAMMA')).toBeInTheDocument();
  });
});
