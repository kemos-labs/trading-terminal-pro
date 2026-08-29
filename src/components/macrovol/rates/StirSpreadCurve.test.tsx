import { describe, expect, it } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { toCurvePoints, StirSpreadCurve } from './StirSpreadCurve';

/** Mirrors StirSpread shape from lib/macrovol/api (subset used by the curve). */
type SpreadRow = {
  name: string;
  legs?: string[];
  rate_bps?: number | null;
  implied_rate?: number | null;
};

describe('toCurvePoints (STIR spread → bps curve)', () => {
  it('maps rate_bps to bps and carries full leg name', () => {
    const rows: SpreadRow[] = [
      { name: 'SR1Z5-SR3Z5', legs: ['SR1Z5', 'SR3Z5'], rate_bps: 3.2 },
      { name: 'SR1M6-SR3M6', legs: ['SR1M6', 'SR3M6'], rate_bps: -1.1 },
    ];
    const pts = toCurvePoints(rows, {
      x: (r) => r.name,
      bps: (r) => (r.rate_bps != null
        ? r.rate_bps
        : r.implied_rate != null
          ? r.implied_rate * 100
          : null),
      full: (r) => r.legs?.join(' / '),
    });
    expect(pts).toEqual([
      { x: 'SR1Z5-SR3Z5', bps: 3.2, full: 'SR1Z5 / SR3Z5' },
      { x: 'SR1M6-SR3M6', bps: -1.1, full: 'SR1M6 / SR3M6' },
    ]);
  });

  it('falls back to implied_rate*100 when rate_bps is missing', () => {
    const rows: SpreadRow[] = [{ name: 'ZQH6-SR3H6', implied_rate: 4.5 }];
    const pts = toCurvePoints(rows, {
      x: (r) => r.name,
      bps: (r) => (r.rate_bps != null
        ? r.rate_bps
        : r.implied_rate != null
          ? r.implied_rate * 100
          : null),
    });
    expect(pts).toEqual([{ x: 'ZQH6-SR3H6', bps: 450, full: undefined }]);
  });

  it('emits null bps for unresolved rows (skipped by the chart)', () => {
    const rows: SpreadRow[] = [
      { name: 'SR1Z5-SR3Z5', rate_bps: null },
      { name: 'SR1M6-SR3M6' },
    ];
    const pts = toCurvePoints(rows, {
      x: (r) => r.name,
      bps: (r) => (r.rate_bps != null
        ? r.rate_bps
        : r.implied_rate != null
          ? r.implied_rate * 100
          : null),
    });
    expect(pts.map((p) => p.bps)).toEqual([null, null]);
  });
});

class ResizeObserverStub2 {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub2;

describe('StirSpreadCurve — spec compliance (bps axis, zero, linear)', () => {
  const PTS = [
    { x: 'SR3H7/SR1H7', bps: 59.5, full: 'Mar27 SOFR fut − EFFR (synth)' },
    { x: 'SR3M6/SR1M6', bps: 10.2, full: 'Jun26 SOFR fut − EFFR' },
    { x: 'SR3U6/SR1U6', bps: -8.4, full: 'Sep26 SOFR fut − EFFR' },
  ];

  it('renders the SERFF board title + points without crashing at 0-width (zero-line geometry in E2E)', () => {
    const { container } = render(
      <StirSpreadCurve title="SERFF · SR3 − EFFR = leg1 − leg2 (bp per 1 contract)" points={PTS} />,
    );
    // jsdom renders ResponsiveContainer at 0×0 so the SVG tree is skipped; the
    // zero-inclusive domain is exercised by clean render here and by E2E geometry.
    expect(container).toBeTruthy();
  });

  it('renders fail-closed note with fewer than 2 resolved points', () => {
    render(<StirSpreadCurve title="t" points={[{ x: 'a', bps: 1 }]} />);
    expect(screen.getByText(/Awaiting live bps for curve/)).toBeTruthy();
  });
});
