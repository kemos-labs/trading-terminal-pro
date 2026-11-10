import React, { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VolStructureView } from './VolStructureView';

const mockState: Record<string, any> = {
  deskSectionId: 'vol-sub-surface', snapshot: null, loading: false, fmpHistory: null, chainUsed: 'yfinance', symbol: 'SPY', setDeskContext: vi.fn(),
};
vi.mock('../../store/terminalStore', () => ({
  useTerminalStore: (sel: any) => sel(mockState),
}));
vi.mock('../../lib/market/deskJump', () => ({ consumeDeskJumpOnMount: vi.fn() }));
vi.mock('../common/GexLevelsStrip', () => ({ GexLevelsStrip: () => <div /> }));
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) => <div data-testid="recharts-viewport-mock">{children}</div>,
  };
});
if (!(globalThis as any).ResizeObserver) {
  (globalThis as any).ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
}

function makeSnap() {
  return {
    symbol: 'SPY', spot: 500, riskFreeRate: 0.04, dividendYield: 0.01,
    timestamp: Date.now(),
    expiries: [
      {
        expiry: '2026-09-19', dte: 10, atmIV: 0.2,
        calls: [
          { strike: 505, expiry: '2026-09-19', type: 'call', bid: 1, ask: 2, last: 1.5, mid: 1.5, iv: 0.20, midIv: 0.20, delta: 0.50, gamma: 0.01, theta: -0.1, vega: 0.5, volume: 10, openInterest: 10 },
          { strike: 520, expiry: '2026-09-19', type: 'call', bid: 1, ask: 2, last: 1.5, mid: 1.5, iv: 0.22, midIv: 0.22, delta: 0.25, gamma: 0.01, theta: -0.1, vega: 0.5, volume: 10, openInterest: 10 },
        ], puts: [
          { strike: 495, expiry: '2026-09-19', type: 'put', bid: 1, ask: 2, last: 1.5, mid: 1.5, iv: 0.21, midIv: 0.21, delta: -0.49, gamma: 0.01, theta: -0.1, vega: 0.5, volume: 10, openInterest: 10 },
          { strike: 480, expiry: '2026-09-19', type: 'put', bid: 1, ask: 2, last: 1.5, mid: 1.5, iv: 0.24, midIv: 0.24, delta: -0.25, gamma: 0.01, theta: -0.1, vega: 0.5, volume: 10, openInterest: 10 },
          { strike: 460, expiry: '2026-09-19', type: 'put', bid: 1, ask: 2, last: 1.5, mid: 1.5, iv: 0.32, midIv: 0.32, delta: -0.10, gamma: 0.01, theta: -0.1, vega: 0.5, volume: 10, openInterest: 10 },
        ],
      },
      {
        expiry: '2026-10-17', dte: 38, atmIV: 0.2,
        calls: [{ strike: 500, expiry: '2026-10-17', type: 'call', bid: 1, ask: 2, last: 1.5, mid: 1.5, iv: 0.19, midIv: 0.19, delta: 0.51, gamma: 0.01, theta: -0.1, vega: 0.5, volume: 10, openInterest: 10 }],
        puts: [{ strike: 500, expiry: '2026-10-17', type: 'put', bid: 1, ask: 2, last: 1.5, mid: 1.5, iv: 0.195, midIv: 0.195, delta: -0.48, gamma: 0.01, theta: -0.1, vega: 0.5, volume: 10, openInterest: 10 }],
      },
    ],
  } as any;
}

function renderFocus() {
  return render(
    <Suspense fallback={<div data-testid="vol-focus-fallback" />}>
      <VolStructureView />
    </Suspense>,
  );
}

describe('VolStructureView smile/term focus height guard', () => {
  beforeEach(() => {
    mockState.loading = false;
    mockState.snapshot = makeSnap();
    mockState.fmpHistory = null;
    mockState.chainUsed = 'yfinance';
    mockState.symbol = 'SPY';
    history.replaceState(null, '', '/');
  });

  it('smile focus container carries a definite min-height for the Recharts frame', async () => {
    mockState.deskSectionId = 'vol-sub-smile';
    const { container } = renderFocus();
    expect(await screen.findByTestId('vol-smile-view')).toBeInTheDocument();
    const focus = container.querySelector('.term-crossfade');
    expect(focus).not.toBeNull();
    expect(focus!.className).toMatch(/min-h-\[520px\]/);
  });

  it('term focus container carries a definite min-height for the Recharts frame', async () => {
    mockState.deskSectionId = 'vol-sub-term';
    const { container } = renderFocus();
    expect(await screen.findByTestId('vol-term-view')).toBeInTheDocument();
    const focus = container.querySelector('.term-crossfade');
    expect(focus).not.toBeNull();
    expect(focus!.className).toMatch(/min-h-\[520px\]/);
  });

  it('surface focus container keeps the legacy unbounded flex policy', () => {
    mockState.deskSectionId = 'vol-sub-surface';
    const { container } = renderFocus();
    const focus = container.querySelector('.term-crossfade');
    expect(focus).not.toBeNull();
    expect(focus!.className).not.toMatch(/min-h-\[520px\]/);
  });
});
