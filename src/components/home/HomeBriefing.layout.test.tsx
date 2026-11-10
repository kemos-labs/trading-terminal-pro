/**
 * P1-16 — Home dead-space layout contract (desktop LPAD/KSA column and the
 * band under the stack).
 *
 * jsdom has no layout engine, so the geometry contract is pinned through the
 * classes the layout depends on (same approach as the existing grid
 * focusability assertion in workflows.test.tsx). The recorded defect was a
 * ~330px empty band under the Home stack at 1440x900 plus near-empty stretched
 * launcher cells. The fix keeps every block content-sized and shares the
 * leftover column height between the desk-card grid and the freshness-ledger
 * rows, so nothing is a stretched empty container:
 * - the desk grid grows only from md up (mobile stays content-sized/scrolling),
 * - the launcher row stays shrink-0 (stretched launcher cells were the defect),
 * - the ledger table fills its frame (h-full) so slack becomes row height.
 *
 * Deterministic state test with a mocked briefing fetch — not live evidence.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HomeBriefing } from './HomeBriefing';
import { useTerminalStore } from '../../store/terminalStore';

const REAL_FETCH = global.fetch;

function briefingPayload() {
  const freshIso = new Date(Date.now() - 5_000).toISOString();
  const freshMs = Date.now() - 5_000;
  return {
    schemaVersion: 1,
    symbol: 'SPY',
    asOf: freshIso,
    sources: ['finnhub/quote', 'deribit/market:BTC'],
    fromCache: false,
    ageMs: 1_200,
    stale: false,
    freshness: { live: true, state: 'live' },
    desks: {
      equities: { available: true, provider: 'finnhub', symbol: 'SPY', price: 500, changePct: 0.5, asOf: freshIso, note: null },
      rates: { available: true, provider: 'macrovol(fred)', sofr: 4.53, effr: 4.32, usy2: 4.25, usy10: 4.55, spread_2s10s_bps: 30, asOf: freshIso },
      crypto: { available: true, provider: 'deribit', indexPrice: 60_000, funding8h: 0.00005, optionCount: 40, asOf: freshMs, freeFallback: { available: false, provider: 'binance+bybit' } },
      ksa: { available: true, provider: 'sahmk', tasi: 12_150, tasiChangePct: 0.42, delayed: true, asOf: freshIso },
    },
  };
}

describe('HomeBriefing dead-space layout (P1-16)', () => {
  beforeEach(() => {
    useTerminalStore.setState({ symbol: 'SPY', chainAvailable: true, chainAttempted: true, chainUsed: 'live' });
    global.fetch = vi.fn(async () => new Response(JSON.stringify(briefingPayload()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = REAL_FETCH;
  });

  it('desk-card grid absorbs the leftover column height from md up only', () => {
    render(<HomeBriefing />);
    const grid = screen.getByTestId('home-desk-grid');
    expect(grid.className).toContain('md:flex-1');
    expect(grid.className).toContain('md:auto-rows-fr');
    // Below md the stacked column keeps its content height and scrolls.
    expect(grid.className).not.toMatch(/(^|\s)flex-1(\s|$)/);
  });

  it('launcher row stays content-sized and mounts exactly one shared launchpad grid', () => {
    render(<HomeBriefing />);
    const launchpads = screen.getAllByTestId('launchpad-grid');
    expect(launchpads).toHaveLength(1);
    const ksa = screen.getByTestId('home-cell-ksa');
    const row = ksa.parentElement!;
    expect(row.className).toContain('shrink-0');
    expect(row.contains(launchpads[0]!)).toBe(true);
  });

  it('freshness ledger fills its frame with rows instead of an empty bordered box', async () => {
    render(<HomeBriefing />);
    const ledger = screen.getByTestId('home-freshness-ledger');
    await waitFor(() => expect(ledger.querySelector('[role="region"]')).toBeTruthy());
    const region = ledger.querySelector('[role="region"]') as HTMLElement;
    expect(region.className).toContain('flex-1');
    // h-full stretches the seven rows over the leftover height; without it the
    // frame would bottom out as ~400px of empty bordered space.
    const table = region.querySelector('table') as HTMLElement;
    expect(table.className).toContain('h-full');
  });

  it('ledger rows keep their provenance columns when data is present', async () => {
    render(<HomeBriefing />);
    const ledger = screen.getByTestId('home-freshness-ledger');
    await waitFor(() => expect(ledger.textContent).toContain('Crypto (free)'));
    // Row shape is unchanged: desk · provider · event time · age · state, and
    // the unavailable free fallback stays an honest dash/unavailable row.
    expect(ledger.textContent).toContain('binance+bybit');
    expect(ledger.textContent).toMatch(/Crypto \(free\)binance\+bybit——unavailable/);
  });
});
