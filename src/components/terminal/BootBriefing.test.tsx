import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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
    // Drain warming-fetch resolutions inside act so no setState lands after the test.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  });

  it('⏎ enters the terminal', async () => {
    const onEnter = vi.fn();
    render(<BootBriefing heavyReady={false} onEnter={onEnter} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onEnter).toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  });

  it('auto-enters shortly after heavyReady (never holds the user hostage)', async () => {
    const onEnter = vi.fn();
    render(<BootBriefing heavyReady onEnter={onEnter} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    await waitFor(() => expect(onEnter).toHaveBeenCalled());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  });

  it('auto-enters after the 6s escape hatch even when chains stay down (never traps the user)', async () => {
    const onEnter = vi.fn();
    render(<BootBriefing heavyReady={false} onEnter={onEnter} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
    expect(onEnter).toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  });
});

describe('BootBriefing escape hatch under re-renders', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-enters after 6s even when onEnter identity changes on every render', async () => {
    vi.useFakeTimers();
    const onEnter = vi.fn();
    const view = render(<BootBriefing heavyReady={false} onEnter={() => onEnter()} />);
    // Simulate a busy parent (live store ticks): fresh callback identity
    // plus one elapsed second, six times over. A timer tied to the callback
    // identity would be disarmed on every pass and never fire (0 calls on
    // the pre-fix code; the landing sat at 80% forever).
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      act(() => {
        view.rerender(<BootBriefing heavyReady={false} onEnter={() => onEnter()} />);
      });
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('enters exactly once across heavyReady flips and long waits', async () => {
    vi.useFakeTimers();
    const onEnter = vi.fn();
    const view = render(<BootBriefing heavyReady={false} onEnter={onEnter} />);
    view.rerender(<BootBriefing heavyReady={true} onEnter={onEnter} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });
});
