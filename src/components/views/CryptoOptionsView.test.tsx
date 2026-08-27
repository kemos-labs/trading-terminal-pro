import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { CryptoOptionsView } from './CryptoOptionsView';

// Deribit-backed endpoints are offline in jsdom — the view must render its
// chrome and surface an error state (fail-closed, no fabricated chain).
const mockFetch = vi.fn().mockRejectedValue(new Error('offline'));
globalThis.fetch = mockFetch as unknown as typeof fetch;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

describe('CryptoOptionsView (smoke)', () => {
  beforeEach(() => {
    cleanup();
    mockFetch.mockClear().mockRejectedValue(new Error('offline'));
  });

  it('renders the shell header and fails closed when the API is unreachable', async () => {
    render(<CryptoOptionsView />);
    expect(screen.getByText(/chain &/i)).toBeTruthy();
    expect(screen.getByText(/surfaces/i)).toBeTruthy();
    // Chain fetch rejects → error state, not a fake board.
    expect(
      await screen.findByText(/offline|failed to load options data/i, {}, { timeout: 4000 }),
    ).toBeTruthy();
  });
});
