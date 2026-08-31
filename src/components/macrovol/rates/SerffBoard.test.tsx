import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { SerffBoard } from './SerffBoard';

class ResizeObserverStub {
  constructor(cb) {
    this.cb = cb;
  }
  observe(el) {
    // Synchronously report a sized contentRect so react-window renders rows in jsdom.
    this.cb(
      [{ target: el, contentRect: { width: 800, height: 320, top: 0, left: 0 } }],
      this,
    );
  }
  unobserve() {}
  disconnect() {}
}
// @ts-ignore
globalThis.ResizeObserver = ResizeObserverStub;
// @ts-ignore
global.ResizeObserver = ResizeObserverStub;

const imply = { bias: 'easing', label: 'MILD EASE', text: 't', confidence: 'medium' };

describe('SerffBoard — CME SERFF = same-month SR1 − ZQ (1:1)', () => {
  it('renders the listed SERFF row with exact legs and 1:1 ratio', () => {
    const rows = [
      {
        cc: 'SR1/ZQ',
        name: 'SERFFZ6',
        description: 'CME SERFF inter-commodity spread: same-month SR1 − ZQ, ratio 1:1.',
        last_bps: 13.0,
        price_spread: -0.13,
        legs: ['SR1Z6', 'ZQZ6'],
        ratio: '1:1',
        kind: 'serff',
        imply,
      },
    ] as unknown as Parameters<typeof SerffBoard>[0]['rows'];
    render(<SerffBoard rows={rows} onOpenImply={() => {}} />);
    expect(screen.getByTestId('serff-sign-note').textContent).toMatch(/1:1 ratio/);
    const titleEl = screen.getByText(/SERFF · SR1Z6 − ZQZ6 \[1:1\]/);
    expect(titleEl.textContent).toContain('SR1Z6');
    expect(titleEl.textContent).toContain('ZQZ6');
    expect(screen.getAllByText('1:1').length).toBeGreaterThan(0);
    expect(screen.getByText('SERFFZ6')).toBeTruthy();
    expect(screen.getByTestId('serff-bps').textContent).toBe('+13.0');
  });

  it('shows Unavailable (never zero) when the exact SR1 or ZQ leg is missing', () => {
    const rows = [
      {
        cc: 'SR1/ZQ',
        name: 'SERFFZ6',
        description: 'SERFFZ6 Unavailable — missing exact leg(s): ZQZ6. No proxy substitution.',
        last_bps: null,
        price_spread: null,
        legs: ['SR1Z6', 'ZQZ6'],
        ratio: '1:1',
        kind: 'serff',
        imply: null,
      },
    ] as unknown as Parameters<typeof SerffBoard>[0]['rows'];
    const { container } = render(<SerffBoard rows={rows} onOpenImply={() => {}} />);
    expect(screen.getByTestId('serff-bps').textContent).toBe('Unavailable');
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
    expect(container.textContent).not.toMatch(/\+0\.0/);
  });

  it('segregates cash-EFFR derived proxies as non-listed, non-executable, not SERFF', () => {
    const rows = [
      {
        cc: 'SR1/ZQ',
        name: 'SERFFZ6',
        description: 'same-month SR1 − ZQ',
        last_bps: 13.0,
        price_spread: -0.13,
        legs: ['SR1Z6', 'ZQZ6'],
        ratio: '1:1',
        kind: 'serff',
        imply,
      },
      {
        cc: 'Proxy',
        name: 'SR3Z6−EFFR (proxy)',
        description: 'Derived, non-listed, non-executable proxy — not SERFF.',
        last_bps: 5.0,
        price_spread: -0.05,
        legs: ['SR3Z6', 'EFFR (cash)'],
        ratio: '1:1',
        kind: 'derived-proxy',
        imply: null,
      },
    ] as unknown as Parameters<typeof SerffBoard>[0]['rows'];
    render(<SerffBoard rows={rows} onOpenImply={() => {}} />);
    expect(screen.getByTestId('serff-proxy-heading').textContent).toMatch(/non-listed/i);
    expect(screen.getByTestId('serff-proxy-heading').textContent).toMatch(/non-executable/i);
    expect(screen.getByTestId('serff-proxy-heading').textContent).toMatch(/not SERFF/i);
    expect(screen.getByText('SR3Z6−EFFR (proxy)')).toBeTruthy();
  });

  it('never renders four-leg SR3 calendar rows as SERFF', () => {
    const rows = [
      {
        cc: 'SR3/FF',
        name: 'SERFF 4-leg (M6−U6)−(M7−U7)',
        description: 'Front Jun-Sep minus back Jun-Sep',
        last_bps: -3.1,
        price_spread: 0.031,
        legs: ['SR3M6', 'SR3U6', 'SR3M7', 'SR3U7'],
        ratio: '1:-1:-1:1',
        kind: 'calendar-of-calendars',
        imply: null,
      },
    ] as unknown as Parameters<typeof SerffBoard>[0]['rows'];
    const { container } = render(<SerffBoard rows={rows} onOpenImply={() => {}} />);
    // calendar-of-calendars rows are not SERFF — the board must not render them.
    expect(container.textContent).not.toMatch(/4-leg/);
    expect(container.textContent).not.toMatch(/1:-1:-1:1/);
  });
});
