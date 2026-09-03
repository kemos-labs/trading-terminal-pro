import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { YieldCurveCompare, type CurveComparePoint } from './YieldCurveCompare';
import { periodsParamForWindow } from './useRatesData';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

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

const SAMPLE: CurveComparePoint[] = [
  { label: '1M', today: 3.67, historical: 4.35, delta_bps: -68 },
  { label: '3M', today: 3.87, historical: 4.42, delta_bps: -55 },
  { label: '2Y', today: 4.21, historical: 3.88, delta_bps: 33 },
  { label: '10Y', today: 4.56, historical: 4.35, delta_bps: 21 },
  { label: '30Y', today: 5.06, historical: 4.86, delta_bps: 20 },
];

describe('periodsParamForWindow', () => {
  it('maps presets and custom days', () => {
    expect(periodsParamForWindow('1M', 45)).toBe('1M');
    expect(periodsParamForWindow('1Y', 45)).toBe('1Y');
    expect(periodsParamForWindow('custom', 45)).toBe('45d');
    expect(periodsParamForWindow('custom', 3)).toBe('7d');
    expect(periodsParamForWindow('custom', 999)).toBe('800d');
  });
});

describe('YieldCurveCompare', () => {
  it('renders dual-curve title for today vs last year', () => {
    render(
      <YieldCurveCompare
        points={SAMPLE}
        todayAsOf="2026-07-09"
        compareAsOf="2025-07-03"
        source="FRED (9/9)"
      />,
    );
    expect(screen.getByText(/UST YIELD CURVE · TODAY VS LAST YEAR/i)).toBeTruthy();
    expect(screen.getByText(/white = live/i)).toBeTruthy();
  });

  it('shows empty state when fewer than 2 points', () => {
    render(<YieldCurveCompare points={[{ label: '10Y', today: 4.5, historical: null }]} />);
    expect(screen.getByText(/Awaiting FRED UST curve/i)).toBeTruthy();
  });

  it('renders tenor delta strip from live vs historical', () => {
    render(
      <YieldCurveCompare
        points={SAMPLE}
        todayAsOf="2026-07-09"
        compareAsOf="2025-07-03"
      />,
    );
    expect(screen.getByText(/1M/)).toBeTruthy();
    expect(screen.getByText(/-68bp/)).toBeTruthy();
  });

  it('shows Maturity and Yield axis captions', () => {
    render(
      <YieldCurveCompare
        points={SAMPLE}
        todayAsOf="2026-07-09"
        compareAsOf="2025-07-03"
      />,
    );
    expect(screen.getAllByText('Maturity').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Yield/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders compare window chips and calls onCompareWindow', () => {
    const onWin = vi.fn();
    render(
      <YieldCurveCompare
        points={SAMPLE}
        todayAsOf="2026-07-09"
        compareAsOf="2025-07-03"
        compareWindow="1Y"
        onCompareWindow={onWin}
      />,
    );
    expect(screen.getByRole('tab', { name: '3M' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '6M' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Custom' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '3M' }));
    expect(onWin).toHaveBeenCalledWith('3M');
  });

  it('shows Days field when custom window is active', () => {
    const onDays = vi.fn();
    render(
      <YieldCurveCompare
        points={SAMPLE}
        compareWindow="custom"
        onCompareWindow={() => {}}
        customDays={60}
        onCustomDays={onDays}
      />,
    );
    expect(screen.getByText('Days')).toBeTruthy();
    expect(screen.getByText(/TODAY VS 60D AGO/i)).toBeTruthy();
  });
});
