import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { TermView } from './TermView';
import { useTerminalStore } from '../../store/terminalStore';
import {
  buildSnapshot,
  buildSurfaceGrid,
} from '../../lib/options/synthetic';
import { sviReadout } from '../../lib/options/surfaceTools';
import { diagnoseArbitrage } from '../../lib/options/noarb';

// jsdom has no layout engine, so recharts' ResponsiveContainer always measures
// 0x0 and warns. Render a fixed-size empty frame instead: charts stay
// unrendered in jsdom exactly as today (real chart rendering is asserted by
// Playwright geometry checks), without the environmental warning.
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

// jsdom polyfills required by recharts' ResponsiveContainer.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

describe('TermView', () => {
  beforeEach(() => {
    // Reset store to a deterministic synthetic state. buildSnapshot +
    // buildSurfaceGrid + sviReadout + diagnoseArbitrage give us non-null
    // values for sviReadout and arbResult without going through the live
    // network or the historical-frame generator.
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

  it('renders the diagnostics strip below the stats row with SVI RMSE, calendar, and butterfly values', () => {
    render(<TermView />);

    // The existing stats row labels must remain present.
    expect(screen.getByText('Front ATM IV')).toBeInTheDocument();
    expect(screen.getByText('Term Slope')).toBeInTheDocument();
    expect(screen.getByText('Back ATM IV')).toBeInTheDocument();

    const strip = screen.getByTestId('term-diagnostics');
    expect(strip).toBeInTheDocument();

    // RMSE is rendered through fmtPct so it carries a "%" suffix.
    const rmse = within(strip).getByTestId('diagnostics-svi-rmse');
    expect(rmse.textContent).toMatch(/%/);

    // Calendar and Butterfly counts are rendered as integer strings.
    const calendar = within(strip).getByTestId('diagnostics-calendar');
    const butterfly = within(strip).getByTestId('diagnostics-butterfly');
    expect(calendar.textContent).toMatch(/^\d+$/);
    expect(butterfly.textContent).toMatch(/^\d+$/);

    // The synthetic SPY demo surface is arbitrage-clean for the seeded state.
    const badge = within(strip).getByTestId('diagnostics-arb-badge');
    expect(badge.getAttribute('data-arb-clean')).toBe('true');
  });

  it('still renders the existing stats row and a diagnostics strip when diagnostics are null', () => {
    useTerminalStore.setState({ sviReadout: null, arbResult: null });

    render(<TermView />);

    // The stats row remains intact even when the strip has nothing to show.
    expect(screen.getByText('Front ATM IV')).toBeInTheDocument();
    expect(screen.getByText('Term Slope')).toBeInTheDocument();

    const strip = screen.getByTestId('term-diagnostics');
    expect(strip).toBeInTheDocument();

    // Strip falls back to em-dashes and a clean badge when both are null.
    const rmse = within(strip).getByTestId('diagnostics-svi-rmse');
    const calendar = within(strip).getByTestId('diagnostics-calendar');
    const butterfly = within(strip).getByTestId('diagnostics-butterfly');
    expect(rmse.textContent).toBe('\u2014');
    expect(calendar.textContent).toBe('\u2014');
    expect(butterfly.textContent).toBe('\u2014');

    const badge = within(strip).getByTestId('diagnostics-arb-badge');
    expect(badge.getAttribute('data-arb-clean')).toBe('true');
  });

  it('reflects arbitrage violations on the diagnostics strip', () => {
    const state = useTerminalStore.getState();
    const arb = state.arbResult;
    expect(arb).not.toBeNull();
    useTerminalStore.setState({
      arbResult: {
        calendar: { flags: arb!.calendar.flags, violations: 2 },
        butterfly: { flags: arb!.butterfly.flags, violations: 5 },
        clean: false,
      },
    });

    render(<TermView />);

    const strip = screen.getByTestId('term-diagnostics');
    expect(strip.getAttribute('data-arb-clean')).toBe('false');

    const calendar = within(strip).getByTestId('diagnostics-calendar');
    const butterfly = within(strip).getByTestId('diagnostics-butterfly');
    expect(calendar.textContent).toBe('2');
    expect(butterfly.textContent).toBe('5');

    const badge = within(strip).getByTestId('diagnostics-arb-badge');
    expect(badge.getAttribute('data-arb-clean')).toBe('false');
  });
});
