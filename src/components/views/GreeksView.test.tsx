import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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
      total_points: 3,
      atm: {
        delta: 0.5,
        gamma: 0.02,
        vega: 0.1,
        theta: -0.05,
        vanna: 0.01,
        charm: -0.001,
      },
      gex: [],
      points: [
        { T: 0.08, K: 95, iv: 22.5, iv_source: 'midpoint', price: 2.2, price_source: 'midpoint', bid: 2.0, ask: 2.4, last: 2.2, oi: 120, type: 'put', delta: -0.3, gamma: 0.02, vega: 0.1, theta: -0.05, vanna: 0.01, charm: -0.001 },
        { T: 0.08, K: 100, iv: 20.1, iv_source: 'last', price: 3.1, price_source: 'last', bid: null, ask: null, last: 3.1, oi: null, type: 'call', delta: 0.5, gamma: 0.025, vega: 0.12, theta: -0.06, vanna: 0.02, charm: -0.002 },
        { T: 0.16, K: 105, iv: 21.0, iv_source: 'midpoint', price: 1.8, price_source: 'midpoint', bid: 1.6, ask: 2.0, last: 1.9, oi: 0, type: 'call', delta: 0.4, gamma: 0.02, vega: 0.11, theta: -0.055, vanna: 0.015, charm: -0.0015 },
      ],
      surfaces: {
        delta: {
          T_vals: [0.08, 0.16],
          K_vals: [95, 100, 105],
          grid: [
            [0.4, 0.5, 0.6],
            [0.35, 0.48, 0.55],
          ],
          provenance: { kind: 'interpolated-model', method: 'linear+nearest' },
        },
      },
      r: 0.04,
      q: 0.013,
      r_source: 'SOFR',
      source: 'yfinance',
      surface_provenance: {
        observed: 'yfinance bid/ask/last quotes',
        derived: 'per-contract BSM Greeks',
        model: 'interpolated OTM grid: linear interior + nearest-neighbor hole-fill',
        model_kind: 'interpolated-model',
        model_method: 'linear+nearest',
        surface_side: 'otm',
        holes: 'model grid holes are filled via nearest; observed-layer holes stay unavailable (null)',
        oi: 'missing OI is null, observed zero stays 0.0',
        price_provenance: 'price_source midpoint when two-sided, else last',
      },
      points_provenance: 'derived per-contract BSM (price_source/iv_source per point); not observed provider cells',
    }),
    greeksHistory: vi.fn().mockResolvedValue({ ticker: 'SPY', data: [] }),
  },
}));

describe('GreeksView (Greeks 1.0 host)', () => {
  // Shared view-root coverage also protects lazy loading boundaries for all desks and test servers (including boot).
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

  it('exposes interpolated model grid, exact tables, and a lazy 3D entry gate', async () => {
    render(<GreeksView />);
    await waitFor(
      () => {
        expect(screen.getByText(/Strike profile/i)).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    expect(screen.getByText(/Term profile/i)).toBeInTheDocument();
    // Honest provenance: interpolated MODEL grid, never observed cells.
    expect(screen.getByText(/interpolated model grid · exact table below/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Interpolated MODEL grid/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Observed cells only/i)).toBeNull();
    expect(screen.queryByText(/no fitted model layer/i)).toBeNull();
    expect(screen.queryByText(/3D removed/i)).toBeNull();
    // 3D is NOT mounted before explicit entry (WebGL engine not loaded).
    expect(screen.queryByTestId('greeks-surface-3d')).toBeNull();
  });

  it('mounts the 3D Greeks surface only after explicit Open 3D (lazy engine)', async () => {
    render(<GreeksView />);
    await waitFor(
      () => {
        expect(screen.getByTestId('open-3d-greeks')).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    expect(screen.queryByTestId('greeks-surface-3d')).toBeNull();
    // fireEvent keeps the state update inside act (no React act warning).
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-3d-greeks'));
    });
    // Assert the actual 3D surface render, not only the Suspense fallback.
    await waitFor(
      () => {
        expect(screen.getByTestId('greeks-surface-3d')).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    const surface = screen.getByTestId('greeks-surface-3d');
    // Canvas actually mounted (explicit-entry lazy chunk rendered).
    expect(surface.querySelector('canvas')).not.toBeNull();
    // Observed/model separation is visible with exact units and controls.
    expect(surface.textContent).toMatch(/observed contracts/);
    expect(surface.textContent).toMatch(/model grid/);
    expect(surface.textContent).toMatch(/Strike \(\$\)/);
    expect(surface.textContent).toMatch(/DTE \(days\)/);
    expect(screen.getByTestId('greeks-3d-wireframe-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('greeks-3d-contours-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('greeks-3d-preset-default')).toBeInTheDocument();
    expect(screen.getByTestId('greeks-3d-fallback-note')).toBeInTheDocument();
  });

  it('ATM greek cards drive selection labels', async () => {
    render(<GreeksView />);
    await waitFor(
      () => {
        expect(screen.getByText('ATM')).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    expect(screen.getAllByText('DELTA').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('GAMMA').length).toBeGreaterThanOrEqual(1);
  });
});
