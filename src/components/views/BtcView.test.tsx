import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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

  it('renders the crypto desk from a synthetic store snapshot while feeds are down', async () => {
    render(<BtcView />);
    // Give mount effects (dual books fetch) a tick to settle.
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent!.length).toBeGreaterThan(0);
  });
});
