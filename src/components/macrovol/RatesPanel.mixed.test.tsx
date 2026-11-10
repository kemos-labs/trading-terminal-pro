/**
 * RatesPanel mixed-resource status — stale-label-fix tranche.
 *
 * When the summary `cache.stale` envelope is true, the panel names the stale
 * resource explicitly and states that macro/stress/plumbing keep their own
 * badges (mixed, never blanket all-stale). Fresh envelopes render no banner.
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
  mocked.ratesBasisHistory.mockResolvedValue(null as never);
  mocked.ratesShape.mockResolvedValue(null as never);
  mocked.correlations.mockResolvedValue({ instruments: [], matrix: [] } as never);
  mocked.stirStrip.mockResolvedValue(null as never);
  mocked.ratesCurveHistory.mockResolvedValue({ labels: [], today: [], historical: [] } as never);
}

import { RatesPanel } from './RatesPanel';

describe('RatesPanel mixed-resource status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it('names the stale resource and the independent badges when cache.stale', async () => {
    mockAll({
      ...BASE.summary,
      cache: { state: 'stale', hit: true, ageMs: 350_000, stale: true, coalesced: false, providerError: 'upstream-error' },
    });
    const { container } = render(<RatesPanel mode="funding" />);
    const banner = await screen.findByTestId('rates-mixed-status', undefined, { timeout: 8000 });
    expect(banner.getAttribute('role')).toBe('status');
    // Exactly one Stale pill — scope text is separate copy, not a second pill.
    expect(container.querySelectorAll('[data-testid="rates-stale"]')).toHaveLength(1);
    expect(banner).toHaveTextContent('rates summary only');
    expect(banner).toHaveTextContent('keep their own badges');
    // Last-good numerics still render (no capability erased, no blanking).
    expect(screen.getAllByText('4.53', { exact: false }).length).toBeGreaterThanOrEqual(1);
  });

  it('renders no banner for a fresh envelope', async () => {
    mockAll({
      ...BASE.summary,
      cache: { state: 'fresh', hit: true, ageMs: 120, stale: false, coalesced: false, providerError: null },
    });
    render(<RatesPanel mode="funding" />);
    await waitFor(
      () => expect(screen.getByText('MONEY MARKETS')).toBeInTheDocument(),
      { timeout: 8000 },
    );
    expect(screen.queryByTestId('rates-mixed-status')).toBeNull();
    expect(screen.queryByTestId('rates-stale')).toBeNull();
  });
});
