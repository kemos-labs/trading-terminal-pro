import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
import { SurfaceMatrixView } from './SurfaceMatrixView';
import { useTerminalStore } from '../../store/terminalStore';
import type { VolSnapshot } from '../../lib/options/types';

function makeSnapshot(overrides: Partial<VolSnapshot> & { spot: number }): VolSnapshot {
  const spot = overrides.spot;
  const strikes = overrides.expiries ? [] : Array.from({ length: 80 }, (_, i) => 600 + i * 5);
  // Default expiries if not provided
  const expiries = overrides.expiries ?? [
    {
      expiry: '2026-09-19',
      dte: 12,
      atmIV: 0.2,
      calls: strikes.map((k) => ({ strike: k, bid: 1, ask: 1.1, last: 1, bidIv: 0.2, askIv: 0.22, midIv: 0.21, iv: 0.21, openInterest: 100 } as any)),
      puts: strikes.map((k) => ({ strike: k, bid: 1, ask: 1.1, last: 1, bidIv: 0.2, askIv: 0.22, midIv: 0.21, iv: 0.21, openInterest: 100 } as any)),
    },
  ];
  return {
    symbol: 'SPY',
    spot,
    riskFreeRate: 0.04,
    dividendYield: 0.01,
    timestamp: Date.now(),
    expiries,
    ...overrides,
    expiries,
  } as VolSnapshot;
}

beforeEach(() => {
  useTerminalStore.setState({ snapshot: null } as any);
});

describe('SurfaceMatrixView strike window', () => {
  it('dense chain shows balanced window including ATM (repro 770 case)', () => {
    // 600..995 step 5, 80 strikes, 18% filter leaves ~634..908, old slice would be 634-829? Actually first 40 = 600-795 misses upper wing
    // With spot 770, old slice(0,40) after filter+sort gives 635..830 includes ATM but our denser test: use step 2 to ensure >40 in window
    const strikes = Array.from({ length: 100 }, (_, i) => 600 + i * 3); // 600-897
    const expiries = [
      {
        expiry: '2026-09-19',
        dte: 12,
        atmIV: 0.2,
        calls: strikes.map((k) => ({ strike: k, bid: 1, ask: 1.1, last: 1, bidIv: 0.2, askIv: 0.22, midIv: 0.21, iv: 0.21, openInterest: 10 } as any)),
        puts: strikes.map((k) => ({ strike: k, bid: 1, ask: 1.1, last: 1, bidIv: 0.2, askIv: 0.22, midIv: 0.21, iv: 0.21, openInterest: 10 } as any)),
      },
    ];
    const snap = makeSnapshot({ spot: 770.19, expiries: expiries as any });
    useTerminalStore.setState({ snapshot: snap } as any);
    render(<SurfaceMatrixView />);
    // Heatmap table fallback should contain ATM strike 771 or 768 (nearest)
    const table = document.querySelector('table');
    expect(table).toBeTruthy();
    const headers = [...(table?.querySelectorAll('th') ?? [])].map((h) => h.textContent);
    // Should include a header near 771, not capped at 722
    expect(headers.some((h) => h === '771' || h === '768' || h === '770')).toBe(true);
    // Should not have old buggy max 722 as max when spot 770
    const numericHeaders = headers.map((h) => Number(h)).filter((n) => Number.isFinite(n));
    expect(Math.max(...numericHeaders)).toBeGreaterThan(770);
    expect(Math.min(...numericHeaders)).toBeLessThan(770);
  });

  it('offscreen spot omits interpolated line and shows numeric offscreen banner', () => {
    const strikes = [600, 610, 620, 630];
    const expiries = [
      {
        expiry: '2026-09-19',
        dte: 12,
        atmIV: 0.2,
        calls: strikes.map((k) => ({ strike: k, bid: 1, ask: 1.1, last: 1, midIv: 0.21, iv: 0.21, openInterest: 10 } as any)),
        puts: strikes.map((k) => ({ strike: k, bid: 1, ask: 1.1, last: 1, midIv: 0.21, iv: 0.21, openInterest: 10 } as any)),
      },
    ];
    const snap = makeSnapshot({ spot: 770, expiries: expiries as any });
    useTerminalStore.setState({ snapshot: snap } as any);
    render(<SurfaceMatrixView />);
    const banner = screen.getByTestId('spot-offscreen-banner');
    expect(banner.textContent).toMatch(/770/);
    expect(banner.textContent).toMatch(/offscreen/i);
    // interpolated line should be absent: no spot-label from HeatmapEngine (it would show SPOT 770 if in-range)
    // offscreen banner is separate, not a column-snapped line
    expect(screen.queryByTestId('spot-label')).toBeNull();
  });

  it('spot midway between uneven strikes uses true numeric coordinate (interpolated line)', () => {
    const strikes = [700, 710, 750, 760];
    const expiries = [
      {
        expiry: '2026-09-19',
        dte: 12,
        atmIV: 0.2,
        calls: strikes.map((k) => ({ strike: k, bid: 1, ask: 1.1, last: 1, midIv: 0.21, iv: 0.21, openInterest: 10 } as any)),
        puts: strikes.map((k) => ({ strike: k, bid: 1, ask: 1.1, last: 1, midIv: 0.21, iv: 0.21, openInterest: 10 } as any)),
      },
    ];
    // 725 is between 710 and 750, uneven gap 40
    const snap = makeSnapshot({ spot: 725, expiries: expiries as any });
    useTerminalStore.setState({ snapshot: snap } as any);
    render(<SurfaceMatrixView />);
    // In-range: no offscreen banner, but HeatmapEngine shows interpolated spot label
    expect(screen.queryByTestId('spot-offscreen-banner')).toBeNull();
    const spotLabel = screen.getByTestId('spot-label');
    expect(spotLabel.textContent).toMatch(/725/);
  });

  it('preserves null cells as unavailable not zero and keeps IV distinction', () => {
    const strikes = [700, 710, 720];
    const expiries = [
      {
        expiry: '2026-09-19',
        dte: 12,
        atmIV: 0.2,
        calls: [
          { strike: 700, bidIv: null, askIv: null, midIv: 0.2, iv: null, openInterest: null } as any,
          { strike: 710, bidIv: 0.19, askIv: 0.21, midIv: null, iv: null, openInterest: 5 } as any,
          { strike: 720, bidIv: null, askIv: null, midIv: null, iv: null, openInterest: null } as any,
        ],
        puts: [
          { strike: 700, bidIv: null, askIv: null, midIv: null, iv: null, openInterest: null } as any,
          { strike: 710, bidIv: null, askIv: null, midIv: 0.2, iv: 0.2, openInterest: null } as any,
          { strike: 720, bidIv: null, askIv: null, midIv: null, iv: null, openInterest: null } as any,
        ],
      },
    ];
    const snap = makeSnapshot({ spot: 710, expiries: expiries as any });
    useTerminalStore.setState({ snapshot: snap } as any);
    render(<SurfaceMatrixView />);
    const table = document.querySelector('table');
    const cells = [...(table?.querySelectorAll('td') ?? [])].map((td) => td.textContent);
    // At least one missing cell rendered as —
    expect(cells.some((c) => c === '—')).toBe(true);
  });
});
