import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { StirSection } from './StirSection';
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

function mkSr1(contract: string, implied: number | null, over: Partial<StirContract> = {}): StirContract {
  return {
    contract,
    ticker: contract,
    month: contract,
    implied_rate: implied,
    last_price: implied != null && Number.isFinite(implied) ? 100 - implied : null,
    high: null,
    low: null,
    volume: 100,
    net: null,
    source: 'live',
    ...over,
  } as StirContract;
}

function mkZq(contract: string, implied: number | null, over: Partial<StirContract> = {}): StirContract {
  return {
    contract,
    ticker: contract,
    month: contract,
    implied_rate: implied,
    last_price: implied != null && Number.isFinite(implied) ? 100 - implied : null,
    high: null,
    low: null,
    volume: 50,
    net: null,
    source: 'live',
    ...over,
  } as StirContract;
}

function mkStir(over: { sr3?: StirContract[]; sr1?: StirContract[]; zq?: StirContract[] } = {}): StirStripData {
  return {
    sr3: over.sr3 ?? [],
    sr1: over.sr1 ?? [],
    zq: over.zq ?? [],
    treasury_futures: [],
    live_count: 0,
    total_sr3: 0,
    sofr: 4.3,
    as_of: '2026-09-01T01:30:00.000Z',
    source: 'yfinance',
  } as unknown as StirStripData;
}

const SR1_TWO: StirContract[] = [
  mkSr1('SR1F6', 4.12, { month: 'Jan 26' }),
  mkSr1('SR1G6', 4.08, { month: 'Feb 26' }),
];

const ZQ_TWO: StirContract[] = [
  mkZq('ZQF6', 4.33, { month: 'Jan 26', source: 'settled' }),
  mkZq('ZQG6', 4.29, { month: 'Feb 26' }),
];

describe('StirSection independent-leg curve reachability', () => {
  it('SR3 empty but SR1 has two finite rows: curve selector reachable and SR1 leg shows its own title/data', () => {
    render(<StirSection stir={mkStir({ sr3: [], sr1: SR1_TWO, zq: [] })} stirChart={[]} onOpenImply={() => {}} />);
    // Curve is rendered even though the SR3 board guard is empty (fails under the old guard).
    expect(screen.getByTestId('sofr-futures-curve')).toBeTruthy();
    expect(screen.getByTestId('sofr-leg-sr1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sofr-leg-sr1'));
    const title = screen.getByTestId('sofr-curve-title').textContent ?? '';
    expect(title).toMatch(/1M SOFR/);
    expect(title).toMatch(/SR1/);
    expect(title).not.toMatch(/3M SOFR/);
    // Its own data is listed (no SR3 copy).
    expect(screen.getByTestId('sofr-curve-table').textContent).toContain('SR1F6');
    expect(screen.getByTestId('sofr-curve-provenance').textContent).toMatch(/SR1 n=2/);
  });

  it('SR3 empty but ZQ has two finite rows: ZQ leg reachable with its own title/data', () => {
    render(<StirSection stir={mkStir({ sr3: [], sr1: [], zq: ZQ_TWO })} stirChart={[]} onOpenImply={() => {}} />);
    expect(screen.getByTestId('sofr-futures-curve')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sofr-leg-zq'));
    const title = screen.getByTestId('sofr-curve-title').textContent ?? '';
    expect(title).toMatch(/Fed Funds/);
    expect(title).toMatch(/ZQ/);
    expect(title).not.toMatch(/3M SOFR/);
    expect(screen.getByTestId('sofr-curve-table').textContent).toContain('ZQG6');
    expect(screen.getByTestId('sofr-curve-provenance').textContent).toMatch(/ZQ n=2/);
  });

  it('all-empty stays truthfully Unavailable and keeps the board empty-state wording', () => {
    render(<StirSection stir={mkStir({ sr3: [], sr1: [], zq: [] })} stirChart={[]} onOpenImply={() => {}} />);
    // Curve shell is still reachable (old guard hid it entirely).
    expect(screen.getByTestId('sofr-futures-curve')).toBeTruthy();
    // Default SR3 leg is fail-closed, never zero-filled.
    expect(screen.getByText(/Awaiting live 3M SOFR futures strip/i)).toBeTruthy();
    fireEvent.click(screen.getByTestId('sofr-leg-sr1'));
    expect(screen.getByTestId('sofr-leg-unavailable-sr1').textContent).toMatch(/1M SOFR.*Unavailable/);
    fireEvent.click(screen.getByTestId('sofr-leg-zq'));
    expect(screen.getByTestId('sofr-leg-unavailable-zq').textContent).toMatch(/Fed Funds.*Unavailable/);
    // Board empty-state wording is preserved verbatim.
    expect(screen.getByText(/No live SOFR futures quotes — strip left empty rather than inventing rates\./)).toBeTruthy();
  });

  it('fewer-than-two / non-finite rows remain Unavailable (no synthetic values)', () => {
    render(
      <StirSection
        stir={mkStir({
          sr3: [],
          sr1: [mkSr1('SR1F6', 4.12, { month: 'Jan 26' })],
          zq: [
            mkZq('ZQF6', null, { month: 'Jan 26' }),
            mkZq('ZQG6', Number.NaN, { month: 'Feb 26' }),
          ],
        })}
        stirChart={[]}
        onOpenImply={() => {}}
      />,
    );
    expect(screen.getByTestId('sofr-futures-curve')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sofr-leg-sr1'));
    expect(screen.getByTestId('sofr-leg-unavailable-sr1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sofr-leg-zq'));
    expect(screen.getByTestId('sofr-leg-unavailable-zq')).toBeTruthy();
    const prov = screen.getByTestId('sofr-curve-provenance').textContent ?? '';
    expect(prov).toMatch(/SR1 Unavailable/);
    expect(prov).toMatch(/ZQ Unavailable/);
  });

  it('valid zero stays zero while null stays missing', () => {
    render(
      <StirSection
        stir={mkStir({
          sr3: [],
          sr1: [mkSr1('SR1F6', 0, { month: 'Jan 26' }), mkSr1('SR1G6', 4.08, { month: 'Feb 26' })],
          zq: [],
        })}
        stirChart={[]}
        onOpenImply={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('sofr-leg-sr1'));
    const table = screen.getByTestId('sofr-curve-table').textContent ?? '';
    expect(table).toContain('0.000%');
    expect(table).not.toMatch(/NaN|Infinity/);
  });

  it('local leg/mode controls make no fetch', () => {
    const origFetch = (globalThis as unknown as { fetch?: unknown }).fetch;
    const spy = vi.fn(() => {
      throw new Error('fetch must not be called by local curve controls');
    });
    (globalThis as unknown as { fetch: unknown }).fetch = spy;
    try {
      render(<StirSection stir={mkStir({ sr3: [], sr1: SR1_TWO, zq: ZQ_TWO })} stirChart={[]} onOpenImply={() => {}} />);
      fireEvent.click(screen.getByTestId('sofr-leg-sr1'));
      fireEvent.click(screen.getByTestId('sofr-leg-zq'));
      fireEvent.click(screen.getByTestId('sofr-leg-all'));
      fireEvent.click(screen.getByTestId('sofr-mode-price'));
      fireEvent.click(screen.getByTestId('sofr-mode-implied'));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      (globalThis as unknown as { fetch?: unknown }).fetch = origFetch;
    }
  });
});
