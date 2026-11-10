/**
 * P1-16 correction 1 — chart axis-title de-duplication guard.
 *
 * Defect: every PnlWorkflow chart passed BOTH xTitle/yTitle to DeskChartFrame
 * (which renders its own title strips outside the plot) AND label={...} to the
 * Recharts XAxis/YAxis (which renders a second copy inside the plot,
 * horizontally, colliding with ticks/zero-line). The pixels showed "PnL ($)"
 * twice and "Date" twice on the first chart.
 *
 * Fix (confined to PnlWorkflow.tsx): drop the redundant Recharts label props,
 * keeping the DeskChartFrame strips as the single title per axis.
 *
 * This file pins that contract twice: (1) no Recharts axis in this workflow
 * carries a label prop (source assertion — jsdom cannot measure Recharts
 * inside-plot labels, so the absence is asserted where it is introduced), and
 * (2) each chart frame renders its xTitle/yTitle strip exactly once.
 * Deterministic state test, not live evidence.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, render, screen, within, fireEvent } from '@testing-library/react';
import { PnlWorkflow } from './PnlWorkflow';
import { useTerminalStore } from '../../../store/terminalStore';
import { buildSnapshot } from '../../../lib/options/synthetic';

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  const React = await import('react');
  return {
    ...actual,
    // Render children into a fixed frame so chart frames resolve in jsdom.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ResponsiveContainer: ({ children, height }: any) =>
      React.createElement(
        'div',
        {
          'data-testid': 'recharts-viewport-mock',
          style: { width: 800, height: typeof height === 'number' ? height : 400 },
        },
        children,
      ),
  };
});

const snap = buildSnapshot('SPY', Date.now(), 500, 0.05, 0.01);

const HISTORY = Array.from({ length: 45 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 5, 1) + i * 86_400_000).toISOString().slice(0, 10),
  open: 480 + i, high: 482 + i, low: 478 + i, close: 480.5 + i, volume: 1_000_000,
}));

/** Expected single titles per initially-mounted chart frame: [testId, xTitle, yTitle]. */
const FRAMES: Array<[string, string, string]> = [
  ['pnl-chart-a', 'Date', 'PnL ($)'],
  ['pnl-chart-b', 'Date', 'PnL ($)'],
  ['pnl-chart-c-be', 'Spot', 'PnL ($)'],
  ['pnl-chart-d', 'Strike', 'BE dist %'],
  ['pnl-chart-e', 'Strike', 'Price ($)'],
  ['pnl-chart-f', 'Horizon (days)', 'PnL ($)'],
];

describe('PnlWorkflow axis titles — exactly one title per axis (P1-16 correction 1)', () => {
  beforeAll(() => {
    act(() => {
      useTerminalStore.setState({ snapshot: snap, symbol: 'SPY', fmpHistory: HISTORY as never, historySource: 'fmp' });
    });
  });

  it('no Recharts axis in PnlWorkflow carries a label prop', () => {
    // jsdom has no layout engine, so an inside-plot Recharts duplicate label
    // is invisible to DOM queries here (and was only ever visible in pixels);
    // assert the absence at the point of introduction. DeskChartFrame strips
    // remain the single title per axis.
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, 'PnlWorkflow.tsx'), 'utf8');
    expect(source).not.toContain('deskAxisLabel');
    // No label={...} object-prop remains on any axis (string label="..." props
    // on DeskSelect/DeskField are unaffected by this pattern).
    expect(source).not.toMatch(/label=\{/);
  });

  it('each chart frame renders its xTitle/yTitle strip exactly once', () => {
    render(<PnlWorkflow />);
    for (const [testId, xTitle, yTitle] of FRAMES) {
      const frame = screen.getByTestId(testId);
      // Within one frame there must be exactly one copy of each title: the
      // DeskChartFrame strip outside the plot.
      expect(within(frame).getAllByText(xTitle)).toHaveLength(1);
      expect(within(frame).getAllByText(yTitle)).toHaveLength(1);
    }
  });

  it('straddle historical-PnL mode frame also carries single titles', () => {
    render(<PnlWorkflow />);
    // Section C defaults to breakeven; switch its Mode select to historical PnL.
    const modeSelects = screen.getAllByLabelText(/Mode/i);
    expect(modeSelects.length).toBeGreaterThan(0);
    fireEvent.change(modeSelects[0] as HTMLSelectElement, { target: { value: 'pnl' } });
    const frame = screen.getByTestId('pnl-chart-c-pnl');
    expect(within(frame).getAllByText('Date')).toHaveLength(1);
    expect(within(frame).getAllByText('PnL ($)')).toHaveLength(1);
  });
});
