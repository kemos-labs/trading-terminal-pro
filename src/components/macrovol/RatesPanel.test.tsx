/**
 * RatesPanel funding test — the #sec-mm-strip section id must render exactly
 * once (duplicate ids are invalid HTML and break locator determinism), with
 * observed quote cells, when the FRED core pack resolves.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

vi.mock('../../lib/macrovol/api', () => ({
  macrovolApi: {
    ratesSummary: vi.fn().mockResolvedValue({
      sofr: 4.53, effr: 4.32, usy2: 4.25, usy10: 4.55,
      spread_2s10s: 0.3, spread_3m10y: 0.18, as_of: '2026-09-01T00:00:00Z', source: 'fixture',
    }),
    ratesPlumbing: vi.fn().mockResolvedValue({
      iorb: 4.4, sofr: 4.53, effr: 4.32, rrp_rate: 4.3,
      rrp_volume_latest: 110, rrp_volume_history: [], wresbal_history: [],
    }),
    ratesCurve: vi.fn().mockResolvedValue({
      labels: ['1M', '10Y'], yields: [4.4, 4.55], as_of: '2026-09-01', source: 'fixture',
    }),
    ratesBasis: vi.fn().mockResolvedValue({
      sofr: 4.53, effr: 4.32, iorb: 4.4, sofr_effr: 21, sofr_iorb: 13, effr_iorb: -8, unit: 'bps',
    }),
    ratesBasisHistory: vi.fn().mockResolvedValue({
      history: [
        { date: '2026-08-30', sofr: 4.52, effr: 4.31, iorb: 4.4, sofr_effr_bps: 21, sofr_iorb_bps: 12, effr_iorb_bps: -9 },
        { date: '2026-08-31', sofr: 4.53, effr: 4.32, iorb: 4.4, sofr_effr_bps: 21, sofr_iorb_bps: 13, effr_iorb_bps: -8 },
      ],
    }),
    ratesShape: vi.fn().mockResolvedValue({ spreads: {}, levels: {} }),
    correlations: vi.fn().mockResolvedValue({ instruments: [], matrix: [] }),
    stirStrip: vi.fn().mockResolvedValue(null),
    ratesCurveHistory: vi.fn().mockResolvedValue({ labels: [], today: [], historical: [] }),
  },
}));

import { RatesPanel } from './RatesPanel';

describe('RatesPanel funding', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it('renders exactly one #sec-mm-strip with observed quote cells', async () => {
    const { container } = render(<RatesPanel mode="funding" />);
    await waitFor(
      () => {
        expect(screen.getByText('MONEY MARKETS')).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    // Duplicate section ids are invalid HTML and break locator determinism.
    expect(container.querySelectorAll('#sec-mm-strip')).toHaveLength(1);
    // Observed fixture values reach the strip.
    expect(screen.getAllByText('4.53', { exact: false }).length).toBeGreaterThanOrEqual(1);
  });
});
