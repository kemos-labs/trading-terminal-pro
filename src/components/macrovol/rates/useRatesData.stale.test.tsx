/**
 * useRatesData summary-cache wiring — stale metadata tranche 01.
 *
 * `summaryCache` is a verbatim passthrough of the server `cache` envelope on
 * the summary fetch. It is the sole stale signal for the RatesPanel pill:
 * never inferred from frozen `as_of`, never fabricated, and left untouched
 * (prior value kept) when a cold/expired fetch rejects fail-closed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRatesData } from './useRatesData';
import { macrovolApi } from '../../../lib/macrovol/api';

vi.mock('../../../lib/macrovol/api', () => ({
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

const CORE = {
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

function mockCore(summary: unknown) {
  mocked.ratesSummary.mockResolvedValue(summary as never);
  mocked.ratesPlumbing.mockResolvedValue(CORE.plumbing as never);
  mocked.ratesCurve.mockResolvedValue(CORE.curve as never);
  mocked.ratesBasis.mockResolvedValue(CORE.basis as never);
  mocked.ratesBasisHistory.mockResolvedValue(null as never);
  mocked.ratesShape.mockResolvedValue(null as never);
  mocked.correlations.mockResolvedValue(null as never);
  mocked.stirStrip.mockResolvedValue(null as never);
  mocked.ratesCurveHistory.mockResolvedValue({ labels: [], today: [], historical: [] } as never);
}

describe('useRatesData summaryCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes a stale envelope with numerics untouched', async () => {
    mockCore({
      ...CORE.summary,
      cache: { state: 'stale', hit: true, ageMs: 350_000, stale: true, coalesced: false, providerError: 'upstream-error' },
    });
    const { result } = renderHook(() => useRatesData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.summary?.sofr).toBe(4.53);
    expect(result.current.summary?.effr).toBe(4.32);
    expect(result.current.summaryCache?.stale).toBe(true);
    expect(result.current.summaryCache?.ageMs).toBe(350_000);
    expect(result.current.summaryCache?.providerError).toBe('upstream-error');
    expect(result.current.error).toBeNull();
  });

  it('exposes a fresh envelope as not-stale', async () => {
    mockCore({
      ...CORE.summary,
      cache: { state: 'fresh', hit: true, ageMs: 120, stale: false, coalesced: false, providerError: null },
    });
    const { result } = renderHook(() => useRatesData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.summary?.sofr).toBe(4.53);
    expect(result.current.summaryCache?.stale).toBe(false);
  });

  it('maps a missing envelope to null (unknown, never stale)', async () => {
    mockCore({ ...CORE.summary });
    const { result } = renderHook(() => useRatesData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.summary?.sofr).toBe(4.53);
    expect(result.current.summaryCache).toBeNull();
  });

  it('keeps cold/expired rejection fail-closed with no fabricated envelope', async () => {
    const err = new Error('UPSTREAM_ERROR');
    mocked.ratesSummary.mockRejectedValue(err);
    mocked.ratesPlumbing.mockRejectedValue(err);
    mocked.ratesCurve.mockRejectedValue(err);
    mocked.ratesBasis.mockResolvedValue(CORE.basis as never);
    mocked.ratesBasisHistory.mockResolvedValue(null as never);
    mocked.ratesShape.mockResolvedValue(null as never);
    mocked.correlations.mockResolvedValue(null as never);
    mocked.stirStrip.mockResolvedValue(null as never);
    mocked.ratesCurveHistory.mockResolvedValue({ labels: [], today: [], historical: [] } as never);
    const { result } = renderHook(() => useRatesData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Summary stays null (fail-closed) and no stale envelope is invented.
    expect(result.current.summary).toBeNull();
    expect(result.current.summaryCache).toBeNull();
  });
});
