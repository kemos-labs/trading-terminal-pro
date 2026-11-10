/**
 * RatesPanel `rates-stale` pill — stale metadata tranche 01.
 *
 * Exactly one accessible `data-testid="rates-stale"` status pill renders in the
 * funding row, and ONLY when the server `cache.stale` envelope on the summary
 * fetch is true. Fresh envelopes, missing envelopes, and fail-closed errors
 * render no pill. Frozen `as_of` (FRED T-1 daily print) never implies stale.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { macrovolApi } from '../../lib/macrovol/api';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

vi.mock('../../lib/macrovol/api', () => ({
  macrovolApi: {
    ratesSummary: vi.fn(),
    ratesPlumbing: vi.fn(),
    ratesCurve: vi.fn(),
    ratesBasis: vi.fn(),
    ratesBasisHistory: vi.fn(),
    ratesShape: vi.fn(),
    correlations: vi.fn(),
    stirStrip: vi.fn(),
    ratesCurveHistory: vi.fn(),
  },
}));

const mocked = vi.mocked(macrovolApi, true);

const BASE = {
  summary: {
    sofr: 4.53, effr: 4.32, usy2: 4.25, usy10: 4.55,
    spread_2s10s: 0.3, spread_3m10y: 0.18,
    as_of: '2026-09-01', source: 'fixture',
  },
  plumbing: {
    iorb: 4.4, sofr: 4.53, effr: 4.32, rrp_rate: 4.3,
    rrp_volume_latest: 110, rrp_volume_history: [], wresbal_history: [],
  },
  curve: { labels: ['1M', '10Y'], yields: [4.4, 4.55], as_of: '2026-09-01', source: 'fixture' },
  basis: { sofr: 4.53, effr: 4.32, iorb: 4.4, sofr_effr: 21, sofr_iorb: 13, effr_iorb: -8, unit: 'bps' },
};

function mockAll(summary: unknown) {
  mocked.ratesSummary.mockResolvedValue(summary as never);
  mocked.ratesPlumbing.mockResolvedValue(BASE.plumbing as never);
  mocked.ratesCurve.mockResolvedValue(BASE.curve as never);
  mocked.ratesBasis.mockResolvedValue(BASE.basis as never);
  mocked.ratesBasisHistory.mockResolvedValue({
    history: [
      { date: '2026-08-30', sofr: 4.52, effr: 4.31, iorb: 4.4, sofr_effr_bps: 21, sofr_iorb_bps: 12, effr_iorb_bps: -9 },
      { date: '2026-08-31', sofr: 4.53, effr: 4.32, iorb: 4.4, sofr_effr_bps: 21, sofr_iorb_bps: 13, effr_iorb_bps: -8 },
    ],
  } as never);
  mocked.ratesShape.mockResolvedValue({ spreads: {}, levels: {} } as never);
  mocked.correlations.mockResolvedValue({ instruments: [], matrix: [] } as never);
  mocked.stirStrip.mockResolvedValue(null as never);
  mocked.ratesCurveHistory.mockResolvedValue({ labels: [], today: [], historical: [] } as never);
}

// Import after the mock so the panel consumes the mocked client.
import { RatesPanel } from './RatesPanel';

describe('RatesPanel rates-stale pill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it('renders exactly one accessible Stale pill with bounded age when cache.stale', async () => {
    mockAll({
      ...BASE.summary,
      cache: { state: 'stale', hit: true, ageMs: 350_000, stale: true, coalesced: false, providerError: 'upstream-error' },
    });
    const { container } = render(<RatesPanel mode="funding" />);
    const pill = await screen.findByTestId('rates-stale', undefined, { timeout: 8000 });
    expect(container.querySelectorAll('[data-testid="rates-stale"]')).toHaveLength(1);
    expect(pill).toHaveTextContent('Stale');
    expect(pill.getAttribute('role')).toBe('status');
    // Bounded age + sanitized provider code ride in the title, never as body copy.
    expect(pill.getAttribute('title')).toContain('350000ms');
    expect(pill.getAttribute('title')).toContain('upstream-error');
    // Numeric data still renders alongside the pill (last-good, not empty).
    expect(screen.getAllByText('4.53', { exact: false }).length).toBeGreaterThanOrEqual(1);
  });

  it('renders no pill for a fresh envelope', async () => {
    mockAll({
      ...BASE.summary,
      cache: { state: 'fresh', hit: true, ageMs: 120, stale: false, coalesced: false, providerError: null },
    });
    render(<RatesPanel mode="funding" />);
    await waitFor(
      () => expect(screen.getByText('MONEY MARKETS')).toBeInTheDocument(),
      { timeout: 8000 },
    );
    expect(screen.queryByTestId('rates-stale')).toBeNull();
  });

  it('renders no pill when the envelope is absent (frozen as_of is not stale)', async () => {
    // FRED summary with a days-old date-only print and NO cache envelope.
    mockAll({ ...BASE.summary, as_of: '2026-08-20' });
    render(<RatesPanel mode="funding" />);
    await waitFor(
      () => expect(screen.getByText('MONEY MARKETS')).toBeInTheDocument(),
      { timeout: 8000 },
    );
    expect(screen.queryByTestId('rates-stale')).toBeNull();
  });
});
