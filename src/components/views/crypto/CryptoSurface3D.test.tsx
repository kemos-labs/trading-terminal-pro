import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { CryptoSurface3D } from './CryptoSurface3D';
import type { SurfaceData } from '../CryptoOptionsView';

// jsdom has no WebGL; replace @react-three/fiber Canvas with a pass-through
// and drei helpers with inert stubs (same approach as GreeksSurface3D.test).
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
}));

vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
  Html: ({ children }: { children?: React.ReactNode }) => (
    <span data-testid="r3f-html">{children}</span>
  ),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

describe('CryptoSurface3D (smoke)', () => {
  beforeEach(() => cleanup());

  it('renders the loading state with no surface data', () => {
    render(<CryptoSurface3D surface={null} underlyingPrice={undefined} loading />);
    expect(screen.getByText('Loading surface…')).toBeTruthy();
  });

  it('renders the empty state when no data and not loading', () => {
    render(<CryptoSurface3D surface={null} underlyingPrice={undefined} />);
    expect(screen.getByText('No surface data')).toBeTruthy();
  });

  it('accepts a populated surface without throwing', () => {
    const points = Array.from({ length: 12 }, (_, i) => ({
      strike: 90 + i * 2,
      expiry_ms: Date.now() + 30 * 24 * 3600 * 1000,
      mark_iv: 0.4 + (i % 3) * 0.02,
      delta: -0.5 + i * 0.08,
      gamma: 0.01,
      theta: -1.2,
      vega: 8,
      side: (i % 2 === 0 ? 'call' : 'put') as 'call' | 'put',
      bid: 5,
      ask: 6,
      underlying_price: 100,
    }));
    const surface: SurfaceData = {
      underlying: 'BTC',
      generated_at: Date.now(),
      points,
    };
    render(<CryptoSurface3D surface={surface} underlyingPrice={100} />);
    expect(screen.getByTestId('r3f-canvas')).toBeTruthy();
  });
});
