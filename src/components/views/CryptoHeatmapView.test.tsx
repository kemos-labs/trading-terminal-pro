import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CryptoHeatmapView } from './CryptoHeatmapView';
import { useTerminalStore } from '../../store/terminalStore';
import { buildSnapshot } from '../../lib/options/synthetic';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  useTerminalStore.setState({
    symbol: 'BTC',
    snapshot: buildSnapshot('BTC', Date.now(), 75_000, 0.04, 0),
    chainAvailable: true,
  });
});

describe('CryptoHeatmapView', () => {
  it('renders the live exposure workstation and switches Greek metrics', () => {
    render(<CryptoHeatmapView />);
    expect(screen.getByText(/Greek Exposure/i)).toBeTruthy();
    expect(screen.getByText(/Gamma Exposure Heatmap/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Δ DEX/ }));
    expect(screen.getByText(/Delta Exposure Heatmap/i)).toBeTruthy();
    expect(screen.getByText('Expiry Concentration')).toBeTruthy();
  });
});
