import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BootBriefing } from './BootBriefing';

vi.mock('../../lib/macrovol/api', () => ({
  macrovolApi: {
    ratesSummary: vi.fn(async () => ({
      sofr: 3.58,
      effr: 3.63,
      usy2: 4.19,
      usy10: 4.55,
      spread_2s10s: 0.35,
      spread_3m10y: 0.69,
      as_of: '2026-07-10T00:00:00Z',
    })),
    macroSummary: vi.fn(async () => ({
      cpi_yoy: 2.8,
      core_pce_yoy: 2.6,
      unemployment: 4.2,
      nfp_mom: 120,
    })),
    macroStress: vi.fn(async () => ({
      vix: 15.2,
      // FRED percent scale (2.72 → 272bp in UI), not raw bps.
      hy_oas: 3.2,
      ig_oas: 0.95,
      bei_5y: 2.2,
      bei_10y: 2.3,
      real_10y: 2.0,
      usd_broad: 120,
      nfci: -0.4,
      term_sofr_3m: 3.9,
    })),
    ratesFx: vi.fn(async () => ({
      pairs: [
        { pair: 'USDJPY', rate: 161.5, decimals: 2 },
        { pair: 'EURUSD', rate: 1.14, decimals: 4 },
      ],
      as_of: '2026-07-10T00:00:00Z',
      source: 'Frankfurter',
    })),
    ratesAuctions: vi.fn(async () => ({
      auctions: [],
      next: { auction_date: '2026-07-23', security_type: 'Note', security_term: '10-Year' },
      next_coupon: { auction_date: '2026-07-23', security_type: 'Note', security_term: '10-Year' },
    })),
    cryptoSpot: vi.fn(async () => ({
      assets: [],
      btc: { id: 'bitcoin', symbol: 'BTC', spot_usd: 64000, change_24h_pct: 1.2 },
    })),
  },
}));

describe('BootBriefing (landing)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the landing: brand, live strip values, and Enter', async () => {
    const onEnter = vi.fn();
    render(<BootBriefing heavyReady={false} onEnter={onEnter} />);

    // Brand + hero present
    expect(screen.getByText('Kemos Research')).toBeTruthy();
    expect(screen.getByRole('button', { name: /enter terminal/i })).toBeTruthy();

    // Live strip shows real fetched numbers (SOFR from mocked FRED rates)
    await waitFor(() => {
      expect(screen.getByText('SOFR')).toBeTruthy();
      expect(screen.getByText(/3\.58%/)).toBeTruthy();
    });

    // Education card feature still present
    expect(screen.getByText(/while you wait/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /enter terminal/i }));
    expect(onEnter).toHaveBeenCalled();
  });

  it('⏎ enters the terminal', async () => {
    const onEnter = vi.fn();
    render(<BootBriefing heavyReady={false} onEnter={onEnter} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onEnter).toHaveBeenCalled();
  });

  it('auto-enters shortly after heavyReady (never holds the user hostage)', async () => {
    const onEnter = vi.fn();
    render(<BootBriefing heavyReady onEnter={onEnter} />);
    await vi.advanceTimersByTimeAsync(1_500);
    await waitFor(() => expect(onEnter).toHaveBeenCalled());
  });

  it('does NOT auto-enter while chains are still loading', async () => {
    const onEnter = vi.fn();
    render(<BootBriefing heavyReady={false} onEnter={onEnter} />);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(onEnter).not.toHaveBeenCalled();
  });
});
