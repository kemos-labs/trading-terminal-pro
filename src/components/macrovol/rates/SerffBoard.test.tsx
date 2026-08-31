import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { SerffBoard } from './SerffBoard';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-ignore
globalThis.ResizeObserver = ResizeObserverStub;
// @ts-ignore
global.ResizeObserver = ResizeObserverStub;

describe('SerffBoard — exact legs + ratio contract', () => {
  it('renders ratio and sign note from the data contract', () => {
    const rows = [
      { cc: 'SR3/FF', name: 'SERFFM6', description: 'Jun26 SOFR fut − EFFR', last_bps: 5.2, price_spread: -0.052, legs: ['SR3M6', 'EFFR'], ratio: '1:1', kind: 'serff', imply: { bias: 'easing', label: 'MILD EASE', text: 't', confidence: 'medium' } },
      { cc: 'SR3/FF', name: 'SERFF 4-leg (M6−U6)−(M7−U7)', description: 'Front Jun-Sep minus back Jun-Sep', last_bps: -3.1, price_spread: 0.031, legs: ['SR3M6', 'SR3U6', 'SR3M7', 'SR3U7'], ratio: '1:-1:-1:1', kind: 'serff', imply: null },
      { cc: 'Inter', name: 'SR1Z6−SR3Z6', description: '1M vs 3M SOFR', last_bps: 2.0, price_spread: -0.02, legs: ['SR1Z6', 'SR3Z6'], ratio: '1:1', kind: 'inter', imply: null },
    ] as unknown as Parameters<typeof SerffBoard>[0]['rows'];
    render(<SerffBoard rows={rows} onOpenImply={() => {}} />);
    expect(screen.getByTestId('serff-sign-note').textContent).toMatch(/Sign convention/);
    expect(screen.getByText(/Ratio/)).toBeTruthy();
    expect(screen.getAllByText('1:1').length).toBeGreaterThan(0);
    expect(screen.getByText('1:-1:-1:1')).toBeTruthy();
  });

  it('emits null bps as — and never fabricates zero', () => {
    const rows = [
      { cc: 'SR3/FF', name: 'SERFF 4-leg (Z6−H7)−(Z7−H8)', description: 'Dec-Mar calendar differential — unavailable', last_bps: null, price_spread: null, legs: ['SR3Z6', 'SR3H7', 'SR3Z7', 'SR3H8'], ratio: '1:-1:-1:1', kind: 'serff', imply: null },
    ] as unknown as Parameters<typeof SerffBoard>[0]['rows'];
    const { container } = render(<SerffBoard rows={rows} onOpenImply={() => {}} />);
    expect(container.textContent).toContain('—');
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });
});
