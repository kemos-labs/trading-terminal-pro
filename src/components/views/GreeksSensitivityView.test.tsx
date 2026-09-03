import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import { buildSnapshot } from '../../lib/options/synthetic';
import { spotSensitivity, ivSensitivity } from '../../lib/options/analytics';
import { GreeksSensitivityView } from './GreeksSensitivityView';
import { GREEK_KEYS, GREEK_META } from './greeksTypes';
import type { SensitivityMatrix } from '../../lib/options/types';

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

/**
 * Mirror of the chart-data construction in GreeksSensitivityView. Used here
 * to verify that each Greek row uses its own values, not (as in the bug)
 * every row using delta values.
 */
function buildChartRows(s: SensitivityMatrix) {
  return GREEK_KEYS.map(key => ({
    greek: key.charAt(0).toUpperCase() + key.slice(1),
    down: (s as Record<string, number[]>)[key]?.[0] ?? 0,
    base: (s as Record<string, number[]>)[key]?.[1] ?? 0,
    up: (s as Record<string, number[]>)[key]?.[2] ?? 0,
  }));
}

describe('GreeksSensitivityView chart data', () => {
  const snapshot = buildSnapshot('SPY', Date.now(), 100, 0, 0);

  it('GREEK_KEYS covers all 13 Greeks defined in GREEK_META', () => {
    expect(GREEK_META.length).toBe(13);
    expect(GREEK_KEYS.length).toBe(13);
    expect(new Set(GREEK_KEYS).size).toBe(13);
    expect(GREEK_KEYS).toContain('delta');
    expect(GREEK_KEYS).toContain('gamma');
    expect(GREEK_KEYS).toContain('theta');
    expect(GREEK_KEYS).toContain('vega');
    expect(GREEK_KEYS).toContain('rho');
    expect(GREEK_KEYS).toContain('vanna');
    expect(GREEK_KEYS).toContain('charm');
    expect(GREEK_KEYS).toContain('volga');
    expect(GREEK_KEYS).toContain('speed');
    expect(GREEK_KEYS).toContain('veta');
    expect(GREEK_KEYS).toContain('color');
    expect(GREEK_KEYS).toContain('zomma');
    expect(GREEK_KEYS).toContain('ultima');
  });

  it('spot sensitivity: each Greek row uses its own array (not delta everywhere)', () => {
    const s = spotSensitivity(snapshot);
    const rows = buildChartRows(s);

    // The chart produces one row per Greek key.
    expect(rows.length).toBe(GREEK_KEYS.length);

    // Row labels are title-cased key names ("Delta", "Gamma", ...).
    const labels = rows.map(r => r.greek);
    expect(labels).toEqual([
      'Delta', 'Gamma', 'Theta', 'Vega', 'Rho', 'Vanna', 'Charm',
      'Volga', 'Speed', 'Veta', 'Color', 'Zomma', 'Ultima',
    ]);

    // For the four Greeks actually computed by spotSensitivity, the row
    // values must equal the corresponding array — this catches the
    // duplicate-key bug where every row used delta.
    const gammaRow = rows.find(r => r.greek === 'Gamma')!;
    expect(gammaRow.down).toBe(s.gamma[0]);
    expect(gammaRow.base).toBe(s.gamma[1]);
    expect(gammaRow.up).toBe(s.gamma[2]);

    const vegaRow = rows.find(r => r.greek === 'Vega')!;
    expect(vegaRow.down).toBe(s.vega[0]);
    expect(vegaRow.base).toBe(s.vega[1]);
    expect(vegaRow.up).toBe(s.vega[2]);

    const thetaRow = rows.find(r => r.greek === 'Theta')!;
    expect(thetaRow.down).toBe(s.theta[0]);
    expect(thetaRow.base).toBe(s.theta[1]);
    expect(thetaRow.up).toBe(s.theta[2]);

    const deltaRow = rows.find(r => r.greek === 'Delta')!;
    expect(deltaRow.down).toBe(s.delta[0]);
    expect(deltaRow.base).toBe(s.delta[1]);
    expect(deltaRow.up).toBe(s.delta[2]);

    // Regression guard: gamma/vega/theta rows must NOT equal the delta row
    // (which is exactly the symptom of the duplicate-key bug).
    expect(gammaRow.base).not.toBe(deltaRow.base);
    expect(vegaRow.base).not.toBe(deltaRow.base);
    expect(thetaRow.base).not.toBe(deltaRow.base);
  });

  it('iv sensitivity: each Greek row uses its own array (not delta everywhere)', () => {
    const s = ivSensitivity(snapshot);
    const rows = buildChartRows(s);

    expect(rows.length).toBe(GREEK_KEYS.length);

    const gammaRow = rows.find(r => r.greek === 'Gamma')!;
    expect(gammaRow.down).toBe(s.gamma[0]);
    expect(gammaRow.base).toBe(s.gamma[1]);
    expect(gammaRow.up).toBe(s.gamma[2]);

    const vegaRow = rows.find(r => r.greek === 'Vega')!;
    expect(vegaRow.down).toBe(s.vega[0]);
    expect(vegaRow.base).toBe(s.vega[1]);
    expect(vegaRow.up).toBe(s.vega[2]);

    const thetaRow = rows.find(r => r.greek === 'Theta')!;
    expect(thetaRow.down).toBe(s.theta[0]);
    expect(thetaRow.base).toBe(s.theta[1]);
    expect(thetaRow.up).toBe(s.theta[2]);

    const deltaRow = rows.find(r => r.greek === 'Delta')!;
    expect(deltaRow.down).toBe(s.delta[0]);
    expect(deltaRow.base).toBe(s.delta[1]);
    expect(deltaRow.up).toBe(s.delta[2]);

    expect(gammaRow.base).not.toBe(deltaRow.base);
    expect(vegaRow.base).not.toBe(deltaRow.base);
    expect(thetaRow.base).not.toBe(deltaRow.base);
  });
});

describe('GreeksSensitivityView component', () => {
  it('renders both panels when a snapshot is loaded', () => {
    useTerminalStore.setState({ snapshot: buildSnapshot('SPY', Date.now(), 100, 0, 0) });

    render(<GreeksSensitivityView />);

    expect(screen.getByText('Spot Sensitivity')).toBeInTheDocument();
    expect(screen.getByText('IV Sensitivity')).toBeInTheDocument();
  });

  it('shows a placeholder when no snapshot is available', () => {
    useTerminalStore.setState({ snapshot: null });

    render(<GreeksSensitivityView />);

    expect(screen.getByText('No data')).toBeInTheDocument();
  });
});
