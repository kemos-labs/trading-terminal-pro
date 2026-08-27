import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { BtcView } from './BtcView';
import { useTerminalStore } from '../../store/terminalStore';
import { buildSnapshot } from '../../lib/options/synthetic';

// Dual-book feeds (Deribit / CoinGecko) are offline in jsdom — the desk must
// render from store state and fail closed on the live strips.
const mockFetch = vi.fn().mockRejectedValue(new Error('offline'));
globalThis.fetch = mockFetch as unknown as typeof fetch;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

describe('BtcView (smoke)', () => {
  beforeEach(() => {
    cleanup();
    mockFetch.mockClear().mockRejectedValue(new Error('offline'));
    useTerminalStore.setState({
      symbol: 'BTC',
      snapshot: buildSnapshot('BTC', Date.now(), 100, 0, 0),
      source: 'demo',
      historicalFrames: [],
      frameIndex: 0,
      isPlaying: false,
      speed: 1,
    });
  });

  it('default production build renders all six crypto workflows', async () => {
    // No VITE_CRYPTO_V2 env, no flag mock — this is the real default build.
    window.history.pushState({}, '', '/?desk=crypto&view=overview&asset=BTC&venue=deribit');
    render(<BtcView />);
    // CryptoShell lazy-loads; wait for tabs to appear.
    await waitFor(() => {
      expect(document.querySelectorAll('[role="tab"]').length).toBe(6);
    }, { timeout: 3000 });
    const tabs = document.querySelectorAll('[role="tab"]');
    const labels = Array.from(tabs).map(t => t.textContent);
    expect(labels).toContain('Overview');
    expect(labels).toContain('Volatility');
    expect(labels).toContain('Positioning');
    expect(labels).toContain('Flow');
    expect(labels).toContain('Carry');
    expect(labels).toContain('Trade & Risk');
  });
});
