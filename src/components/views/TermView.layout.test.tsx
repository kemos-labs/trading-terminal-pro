import * as React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TermView } from './TermView';
import { useTerminalStore } from '../../store/terminalStore';
import { buildSnapshot, buildSurfaceGrid } from '../../lib/options/synthetic';
import { sviReadout } from '../../lib/options/surfaceTools';
import { diagnoseArbitrage } from '../../lib/options/noarb';

// Pass-through ResponsiveContainer so Recharts axes/legend render their text
// in jsdom; the pre-existing TermView.test mocks it as an empty frame.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  const React = await import('react');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(
        'div',
        {
          'data-testid': 'recharts-viewport-passthrough',
          style: { width: 800, height: 400 },
        },
        children,
      ),
  };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, 'TermView.tsx'), 'utf8');

function seedStore() {
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
}

describe('TermView axis-title/legend layout (label-overlap correction)', () => {
  beforeEach(() => {
    seedStore();
  });

  it('keeps exactly one readable source of each axis title (DeskChartFrame captions)', () => {
    render(<TermView />);
    // DeskChartFrame captions are the single legible source of each title.
    expect(screen.getAllByText('ATM IV %')).toHaveLength(1);
    expect(screen.getAllByText('DTE (√ scale)')).toHaveLength(1);
  });

  it('removes redundant in-plot Recharts axis labels (no duplicated DTE/ATM titles)', () => {
    // No XAxis/YAxis `label=` prop may reintroduce the overprint; the
    // DeskChartFrame xTitle/yTitle captions above are the single source.
    expect(source).not.toMatch(/<XAxis[\s\S]*?label=\{/);
    expect(source).not.toMatch(/<YAxis[\s\S]*?label=\{/);
    expect(source).not.toContain('deskAxisLabel');
    expect(source).toContain('xTitle="DTE (√ scale)"');
    expect(source).toContain('yTitle="ATM IV %"');
  });

  it('relocates the legend above the plot so it cannot overprint the x caption', () => {
    render(<TermView />);
    // Legend formatter still maps series names honestly; visual placement verified via source + screenshots.
    expect(source).toMatch(/<Legend[\s\S]*?verticalAlign="top"/);
    expect(source).toMatch(/verticalAlign="top"[\s\S]*?align="right"/);
    expect(source).toContain("v === 'hv' ? 'HV (c2c)' : 'ATM IV'");
  });

  it('preserves honest series names, tooltips, and null/Unavailable semantics', () => {
    render(<TermView />);
    expect(screen.getByText('Front ATM IV')).toBeInTheDocument();
    expect(screen.getByText('HV (c2c)')).toBeInTheDocument();
    // Data/formula surface intact: forward-vol + diagnostics strip.
    expect(screen.getByText('Fwd vol')).toBeInTheDocument();
    expect(screen.getByTestId('term-diagnostics')).toBeInTheDocument();
    // Series names/tooltip mapping unchanged in source.
    expect(source).toContain("name === 'hv' ? 'HV (realized)' : 'ATM IV'");
    expect(source).toContain("v === 'hv' ? 'HV (c2c)' : 'ATM IV'");
  });
});
