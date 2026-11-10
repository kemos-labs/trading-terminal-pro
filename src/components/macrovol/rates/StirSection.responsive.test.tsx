import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StirSection, countLiveContracts } from './StirSection';
import type { StirContract, StirStripData } from '../../../lib/macrovol/api';

afterEach(() => cleanup());

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  const React = await import('react');
  return {
    ...actual,
    ResponsiveContainer: ({ height }: { height?: number | string }) =>
      React.createElement('div', {
        'data-testid': 'recharts-viewport-mock',
        style: { width: 800, height: typeof height === 'number' ? height : 400 },
      }),
  };
});

const LONG_TICKER = 'SR3Z9-FALLBACK-LONG-IDENTIFIER';
const LONG_MONTH = 'December 2029 Long Month Label';

function mkSr3(over: Partial<StirContract> & { contract: string }): StirContract {
  return {
    month: 'Jun 26',
    ticker: 'SR3M6',
    implied_rate: 3.677,
    last_price: 96.323,
    settlement: 96.31,
    high: 96.4,
    low: 96.2,
    volume: 12345,
    net: 0.005,
    source: 'live',
    ...over,
  } as StirContract;
}

function mkSr1(over: Partial<StirContract> & { contract: string }): StirContract {
  return {
    month: 'Jan 26',
    ticker: 'SR1F6',
    implied_rate: 4.12,
    last_price: 95.88,
    high: 95.9,
    low: 95.8,
    volume: 4321,
    net: -0.002,
    source: 'live',
    ...over,
  } as StirContract;
}

function mkStir(): StirStripData {
  return {
    sr3: [
      mkSr3({ contract: 'SR3M6', month: 'Jun 26', ticker: 'SR3M6' }),
      // Long/fallback identifier: must render in full, never silently abbreviated.
      mkSr3({
        contract: LONG_TICKER,
        month: LONG_MONTH,
        ticker: LONG_TICKER,
        source: 'fallback',
        // Null numerics must stay null/‘—’, never 0 or synthetic.
        last_price: null,
        high: null,
        low: null,
        volume: null,
        net: null,
        settlement: null,
        prev_close: null,
      }),
      mkSr3({ contract: 'SR3U6', month: 'Sep 26', ticker: 'SR3U6 · set', source: 'settled' }),
    ],
    sr1: [
      mkSr1({ contract: 'SR1F6' }),
      mkSr1({ contract: LONG_TICKER, month: LONG_MONTH, ticker: LONG_TICKER, source: 'fallback' }),
    ],
    zq: [],
    treasury_futures: [],
    live_count: 2,
    total_sr3: 3,
    as_of: '2026-09-01T01:30:00.000Z',
    source: 'yfinance',
  } as unknown as StirStripData;
}

function renderSection() {
  const stir = mkStir();
  render(<StirSection stir={stir} stirChart={[]} onOpenImply={() => {}} />);
  return stir;
}

describe('StirSection responsive identifier readability (<=560px)', () => {
  it('shares a common header/body track class for SR3 and SR1', () => {
    const { container } = render(<StirSection stir={mkStir()} stirChart={[]} onOpenImply={() => {}} />);
    const sr3Tracks = container.querySelectorAll('.stir-sr3-track');
    // 1 header + 3 body rows share the exact track class.
    expect(sr3Tracks.length).toBe(4);
    const sr1Tracks = container.querySelectorAll('.stir-sr1-track');
    // 1 header + 2 body rows share the exact track class.
    expect(sr1Tracks.length).toBe(3);
  });

  it('renders complete month/ticker identifiers including the long fallback id', () => {
    const { container } = render(<StirSection stir={mkStir()} stirChart={[]} onOpenImply={() => {}} />);
    // Full identifier text is present in the DOM (no silent abbreviation).
    expect(screen.getAllByText(LONG_TICKER).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(LONG_MONTH).length).toBeGreaterThanOrEqual(2);
    // No truncation of the long id: textContent of its cells equals the full string.
    const identCells = Array.from(container.querySelectorAll('.stir-ident')).map(
      (el) => el.textContent ?? '',
    );
    expect(identCells.some((t) => t === LONG_TICKER)).toBe(true);
    expect(identCells.some((t) => t === LONG_MONTH)).toBe(true);
  });

  it('separates SR1 identifier and numeric classes (ident only on first two cells)', () => {
    const { container } = render(<StirSection stir={mkStir()} stirChart={[]} onOpenImply={() => {}} />);
    const sr1 = container.querySelector('[data-board-scroll="stir-sr1"]');
    expect(sr1).not.toBeNull();
    const bodyRows = Array.from(sr1!.querySelectorAll('[data-track="stir-sr1-track"]')).filter(
      (el) => el.querySelector('.stir-ident, .stir-num'),
    );
    expect(bodyRows.length).toBeGreaterThan(0);
    for (const row of bodyRows) {
      const spans = Array.from(row.children) as HTMLElement[];
      expect(spans.length).toBeGreaterThan(2);
      // First two SR1 cells are identifiers only — never numeric nowrap.
      spans.slice(0, 2).forEach((el) => {
        expect(el.classList.contains('stir-ident')).toBe(true);
        expect(el.classList.contains('stir-num')).toBe(false);
      });
      // Remaining SR1 cells are numeric only so long values stay discoverable.
      spans.slice(2).forEach((el) => {
        expect(el.classList.contains('stir-num')).toBe(true);
        expect(el.classList.contains('stir-ident')).toBe(false);
      });
    }
  });

  it('keeps SR3 identifiers free of the numeric class', () => {
    const { container } = render(<StirSection stir={mkStir()} stirChart={[]} onOpenImply={() => {}} />);
    const sr3 = container.querySelector('[data-board-scroll="stir-sr3"]');
    expect(sr3).not.toBeNull();
    const idents = Array.from(sr3!.querySelectorAll('.stir-ident'));
    expect(idents.length).toBeGreaterThan(0);
    idents.forEach((el) => expect(el.classList.contains('stir-num')).toBe(false));
    // SR3 numerics still carry the numeric class for the nowrap override.
    expect(sr3!.querySelectorAll('.stir-num').length).toBeGreaterThan(0);
  });

  it('preserves null numerics as missing (no zero/synthetic substitution)', () => {
    renderSection();
    // The null-numeric fallback row contributes em-dash cells; valid zero stays zero elsewhere.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('keeps row order, settled suffix, CSV export and Imply controls', () => {
    const { container } = render(<StirSection stir={mkStir()} stirChart={[]} onOpenImply={() => {}} />);
    const rows = container.querySelectorAll('[data-board="stir-sr3-row"]');
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain('SR3M6');
    expect(rows[1].textContent).toContain(LONG_TICKER);
    expect(rows[2].textContent).toContain('· set');
    // CSV export button preserved.
    expect(screen.getByTitle('Export table as CSV')).toBeTruthy();
  });

  it('gives SR3/SR1 board regions distinct accessible names and keeps them focusable', () => {
    renderSection();
    const sr3 = screen.getByRole('region', { name: 'SR3 SOFR futures board data' });
    const sr1 = screen.getByRole('region', { name: 'SR1 SOFR futures board data' });
    expect(sr3.getAttribute('tabindex')).toBe('0');
    expect(sr1.getAttribute('tabindex')).toBe('0');
    expect(sr3.getAttribute('data-board-scroll')).toBe('stir-sr3');
    expect(sr1.getAttribute('data-board-scroll')).toBe('stir-sr1');
  });

  it('ships the <=560px track/identifier CSS with a common header/body definition', () => {
    const { container } = render(<StirSection stir={mkStir()} stirChart={[]} onOpenImply={() => {}} />);
    const style = container.querySelector('style')?.textContent ?? '';
    expect(style).toContain('@media (max-width: 560px)');
    // Single shared rule covers header + body tracks (same minmax definition).
    expect(style).toContain('.stir-sr3-track');
    expect(style).toContain('.stir-sr1-track');
    expect(style).toContain('minmax(104px');
    expect(style).toContain('overflow-wrap: anywhere');
    // Identifier rule wraps; only the numeric rule applies nowrap.
    const identRule = style.slice(
      style.indexOf('.stir-sr3-track .stir-ident'),
      style.indexOf('.stir-sr3-track .stir-num'),
    );
    expect(identRule).toContain('white-space: normal');
    expect(identRule).not.toContain('white-space: nowrap');
    const numRule = style.slice(style.indexOf('.stir-sr3-track .stir-num'));
    expect(numRule).toContain('white-space: nowrap');
  });

  it('uses no bare row roles without table semantics in the affected boards', () => {
    const { container } = render(<StirSection stir={mkStir()} stirChart={[]} onOpenImply={() => {}} />);
    const sr3 = container.querySelector('[data-board-scroll="stir-sr3"]');
    const sr1 = container.querySelector('[data-board-scroll="stir-sr1"]');
    expect(sr3?.querySelectorAll('[role="row"]').length).toBe(0);
    expect(sr1?.querySelectorAll('[role="row"]').length).toBe(0);
  });

  it('renders the SR3 board title with a real middle dot (no literal escape)', () => {
    renderSection();
    const title = screen.getByText('3M SOFR FUTURES (SFR / SR3) · CME board');
    expect(title).toBeTruthy();
    expect(title.textContent).toContain('3M SOFR FUTURES (SFR / SR3) · CME board');
    expect(document.body.textContent).not.toContain('\\u00b7');
  });

  it('preserves the frozen F1c exact-live count rule', () => {
    expect(
      countLiveContracts([
        { contract: 'A', source: 'live' },
        { contract: 'B', source: 'LIVE' },
        { contract: 'C', source: ' live' },
        { contract: 'D', source: 'settled' },
      ] as StirContract[]),
    ).toBe(1);
  });
});
