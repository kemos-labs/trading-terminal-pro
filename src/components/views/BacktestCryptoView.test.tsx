import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { BacktestCryptoView } from './BacktestCryptoView';

// Backtest API is offline in jsdom — the view must render its chrome and
// fail closed (no fabricated equity curves).
const mockFetch = vi.fn().mockRejectedValue(new Error('offline'));
globalThis.fetch = mockFetch as unknown as typeof fetch;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

describe('BacktestCryptoView (smoke)', () => {
  beforeEach(() => {
    cleanup();
    mockFetch.mockClear().mockRejectedValue(new Error('offline'));
  });

  it('renders strategy controls and desk chrome while the API is unreachable', async () => {
    render(<BacktestCryptoView />);
    expect(screen.getByText('BACKTEST')).toBeTruthy();
    expect(screen.getByText('Strategy')).toBeTruthy();
    expect(screen.getByText('Symbol')).toBeTruthy();
    // Give on-mount status fetches a tick to settle; no unhandled throw.
    await new Promise((r) => setTimeout(r, 50));
  });
});
