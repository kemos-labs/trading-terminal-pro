/**
 * KSA flex-shrink regression: single `ksa-view` owner + non-collapsing scroll column.
 * Tranche-scoped: does not assert Rates dead-space or nav behaviour.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { KsaMarketView } from './KsaMarketView';
import { fetchKsaBoardClient } from '../../lib/data/ksaClient';

vi.mock('../../lib/data/ksaClient', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../lib/data/ksaClient')>();
  return {
    ...orig,
    fetchKsaBoardClient: vi.fn(),
    KSA_BOARD_POLL_MS: 60_000,
  };
});

vi.mock('../../lib/polling/visibilityPolling', () => ({
  startVisibilityPolling: (fn: () => void) => {
    fn();
    return () => {};
  },
}));

const board = {
  tasi: { index_value: 12150, index_change: 50, index_change_percent: 0.42, total_volume: 220_000_000, market_mood: 'firm', advancing: 80, declining: 70 },
  nomu: { index_value: 25100, index_change: 10, index_change_percent: 0.04, total_volume: 5_000_000 },
  mega: [{ symbol: '2222', name_en: 'Saudi Aramco', price: 27.5, change_percent: 0.5 }],
  gainers: [{ symbol: '1111', name_en: 'Gainer One', price: 10, change_percent: 5, volume: 1000 }],
  losers: [{ symbol: '2223', name_en: 'Loser One', price: 9, change_percent: -3, volume: 900 }],
  volumeLeaders: [{ symbol: '3333', name_en: 'Vol One', price: 11, volume: 9_000_000 }],
  depth: { history: [], sectorBars: [], moverBars: [], volLeaders: [], breadth: { adv: 80, dec: 70, unc: 5, ratio: 0.06, advShare: 0.5, total: 155 } },
  session: { phase: 'open', open: true, local: '2026-09-14 11:00:00', timezone: 'Asia/Riyadh', weekday: 'Sun' },
  budget: { used: 10, capDaily: 100 },
  fromCache: false,
  ageMs: 1000,
  stale: false,
  is_delayed: true,
  configured: true,
};

describe('KsaMarketView layout regression (D1/D4)', () => {
  beforeEach(() => {
    vi.mocked(fetchKsaBoardClient).mockResolvedValue(board as never);
  });

  it('owns exactly one ksa-view testid and names mover panels distinctly', async () => {
    render(<KsaMarketView />);
    await waitFor(() => expect(screen.getByTestId('ksa-view')).toBeInTheDocument());
    expect(screen.getAllByTestId('ksa-view')).toHaveLength(1);
    expect(screen.getByTestId('ksa-movers-gainers')).toBeInTheDocument();
    expect(screen.getByTestId('ksa-movers-losers')).toBeInTheDocument();
    expect(screen.getByTestId('ksa-movers-volume')).toBeInTheDocument();
  });

  it('keeps direct scroll-column children non-shrinking so overflow-auto can scroll', async () => {
    const { container } = render(<KsaMarketView />);
    await waitFor(() => expect(screen.getByTestId('ksa-view')).toBeInTheDocument());
    const root = screen.getByTestId('ksa-view');
    expect(root.className).toMatch(/overflow-auto/);
    // Scroll column must force direct children non-shrinking via the
    // `[&>*]:shrink-0` rule (Tailwind generates the child rule at build
    // time, so jsdom sees it as a root-level class, not a computed style;
    // live flex-shrink/scrollHeight is verified in the browser evidence gate).
    expect(root.className).toContain('[&>*]:shrink-0');
    for (const testId of ['ksa-movers-gainers', 'ksa-movers-losers', 'ksa-movers-volume']) {
      expect(screen.getByTestId(testId).className).toMatch(/shrink-0/);
    }
    void container;
  });
});
