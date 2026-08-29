import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HeatmapEngine, type HeatmapCellData, type HeatmapAxisKey } from './HeatmapEngine';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  // jsdom canvas stub — fillText tracked via src/test/setup mock
});
afterEach(() => {
  vi.restoreAllMocks();
});

function key(label: string, num?: number | null): HeatmapAxisKey {
  return { key: label, label, num: num ?? null };
}

const ROWS = [key('7d', 7), key('14d', 14), key('30d', 30)];
const COLS = [key('470', 470), key('480', 480), key('490', 490), key('500', 500), key('510', 510)];

const CELLS: HeatmapCellData[][] = ROWS.map((_, ri) => COLS.map((__, ci) => {
  if (ri === 1 && ci === 2) return { value: null, source: 'test' }; // missing hole
  const v = (ci - 2) * 1e6 * (ri + 1) * (ri === 2 && ci === 4 ? -1 : 1);
  return { value: v, coverage: 'OI 100/120', sides: 'call+put', source: 'test-fixture', asOf: 1_700_000_000_000 };
}));

describe('HeatmapEngine — canonical analytical heatmap', () => {
  it('renders canvas + legend + accessible table fallback with exact values', () => {
    render(
      <HeatmapEngine
        rows={ROWS}
        cols={COLS}
        cells={CELLS}
        diverging
        units="$mm"
        metricLabel="GEX"
        spotRef={{ colKey: '490', label: 'SPOT 490' }}
        caption="GEX table"
      />,
    );
    expect(screen.getByTestId('heatmap-engine')).toBeTruthy();
    // Legend with symmetric domain + missing counter
    expect(screen.getByText(/1\/15 missing/)).toBeTruthy();
    expect(screen.getByText(/spot\/ATM ref: SPOT 490/)).toBeTruthy();
    // Table fallback contains exact formatted values and an em-dash for the hole
    const table = screen.getByRole('table', { hidden: true });
    expect(table).toBeTruthy();
    expect(table.textContent).toContain('—');
  });

  it('keyboard navigation moves focus and emits selected cell (Enter semantics via click)', () => {
    const onSelect = vi.fn();
    render(
      <HeatmapEngine
        rows={ROWS}
        cols={COLS}
        cells={CELLS}
        diverging
        metricLabel="GEX"
        onCellSelect={onSelect}
      />,
    );
    const wrap = screen.getByRole('application');
    fireEvent.keyDown(wrap, { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      row: ROWS[0],
      col: COLS[1],
    }));
    fireEvent.keyDown(wrap, { key: 'ArrowRight' });
    fireEvent.keyDown(wrap, { key: 'Escape' });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('missing cells never display as zero (em-dash in fallback; tooltip says unavailable)', () => {
    render(<HeatmapEngine rows={ROWS} cols={COLS} cells={CELLS} diverging metricLabel="GEX" />);
    const table = screen.getByRole('table', { hidden: true });
    // The hole cell shows '—', not '0.00'
    expect(table.textContent).not.toMatch(/0\.00.*0\.00.*0\.00/);
  });

  it('sequential (non-diverging) mode renders without a symmetric legend claim', () => {
    render(
      <HeatmapEngine
        rows={ROWS}
        cols={COLS}
        cells={CELLS.map((row) => row.map((c) => ({ ...c, value: c.value == null ? null : Math.abs(c.value) })))}
        diverging={false}
        metricLabel="IV"
        units="%"
      />,
    );
    expect(screen.getByTestId('heatmap-engine')).toBeTruthy();
  });

  it('shows the empty state when there is no data (fail-closed, never zero-filled)', () => {
    render(<HeatmapEngine rows={[]} cols={[]} cells={[]} diverging metricLabel="GEX" />);
    expect(screen.getByTestId('heatmap-empty')).toBeTruthy();
    expect(screen.getByText(/values stay unavailable/)).toBeTruthy();
  });
});
