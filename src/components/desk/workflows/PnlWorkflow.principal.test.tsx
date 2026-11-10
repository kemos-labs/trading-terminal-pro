/**
 * P1-16 — Trade · PnL principal-chart blank-frame regression.
 *
 * The recorded P1-16 defect was "blotter/controls populated but BOTH PnL
 * principal charts render empty axes". The root cause was a percentage
 * ResponsiveContainer height inside the DeskChartFrame flex body: recharts
 * measures 0 and paints no surface. workflows.test.tsx already asserts the
 * plotted-point counts; this file pins the *geometry contract* that produced
 * the fix — each principal frame must hand ResponsiveContainer a definite
 * pixel height — so a revert to height="100%" fails here before any browser.
 *
 * jsdom has no layout engine, so ResponsiveContainer is replaced with a
 * fixed-frame mock (same approach as workflows.test.tsx) that records the
 * height it was given. Deterministic state test, not live evidence.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import React from 'react';
import { act, render, screen } from '@testing-library/react';
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
    ResponsiveContainer: ({ height }: { height?: number | string }) =>
      React.createElement('div', {
        'data-testid': 'recharts-viewport-mock',
        style: { width: 800, height: typeof height === 'number' ? height : 400 },
      }),
  };
});

const snap = buildSnapshot('SPY', Date.now(), 500, 0.05, 0.01);

const HISTORY = Array.from({ length: 45 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 5, 1) + i * 86_400_000).toISOString().slice(0, 10),
  open: 480 + i, high: 482 + i, low: 478 + i, close: 480.5 + i, volume: 1_000_000,
}));

/** Viewport height the frame handed to ResponsiveContainer (px, or null when absent). */
function principalViewportHeightPx(testId: string): string | null {
  const frame = screen.getByTestId(testId);
  const viewport = frame.querySelector('[data-testid="recharts-viewport-mock"]');
  const height = viewport instanceof HTMLElement ? viewport.style.height : null;
  return height || null;
}

describe('PnlWorkflow principal charts — definite height (P1-16 blank-principal guard)', () => {
  beforeAll(() => {
    act(() => {
      useTerminalStore.setState({ snapshot: snap, symbol: 'SPY', fmpHistory: HISTORY as never, historySource: 'fmp' });
    });
  });

  it('both principal frames mount with plotted points and a pixel (not percentage) height', () => {
    render(<PnlWorkflow />);
    for (const id of ['pnl-chart-a', 'pnl-chart-b']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
      expect(Number(screen.getByTestId(id).getAttribute('data-chart-points'))).toBeGreaterThan(0);
      // A percentage height resolves to 0x0 inside the frame flex body and
      // paints no surface — the exact blank-principal failure mode.
      expect(principalViewportHeightPx(id)).toBe('240px');
    }
  });

  it('without observed history both principals fail closed, never as empty axes', () => {
    act(() => {
      useTerminalStore.setState({ fmpHistory: null, historySource: 'none' });
    });
    render(<PnlWorkflow />);
    for (const id of ['pnl-chart-a', 'pnl-chart-b']) {
      expect(screen.queryByTestId(id)).toBeNull();
      expect(screen.getByTestId(`pnl-chart-unavailable-${id.slice(-1)}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('pnl-chart-unavailable-a').textContent).toMatch(/No observed spot history/);
    act(() => {
      useTerminalStore.setState({ fmpHistory: HISTORY as never, historySource: 'fmp' });
    });
  });
});
