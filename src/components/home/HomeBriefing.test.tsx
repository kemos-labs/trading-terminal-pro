/**
 * HomeBriefing aggregate + agreement states (A2/A3).
 * Proves, with mocked fetch (deterministic state, NOT live evidence):
 * - the Feeds aggregate chip renders the server derivation: Live only when
 *   all desks are up; Partial on any outage (never Live/OK); Stale is never
 *   Live; all-down reads Unavailable;
 * - terminal-chain disagreement with the briefing snapshot is surfaced, never
 *   left as two contradicting badges;
 * - the launcher stays usable in every state (no desk is gated by Home).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HomeBriefing } from './HomeBriefing';
import { useTerminalStore } from '../../store/terminalStore';

const REAL_FETCH = global.fetch;

function briefing(desks: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    symbol: 'SPY',
    asOf: '2026-09-01T01:30:00.000Z',
    sources: ['finnhub/quote'],
    fromCache: false,
    ageMs: 1200,
    stale: false,
    freshness: { live: true, state: 'live' },
    desks: {
      equities: { available: true, provider: 'finnhub', symbol: 'SPY', price: 500, changePct: 0.5, asOf: '2026-09-01T01:30:00.000Z', note: null },
      rates: { available: true, provider: 'macrovol(fred)', sofr: 4.53, effr: 4.32, usy2: 4.25, usy10: 4.55, spread_2s10s_bps: 30, asOf: '2026-09-01T01:30:00.000Z' },
      crypto: { available: true, provider: 'deribit', indexPrice: 60000, funding8h: 0.00005, optionCount: 40, asOf: 1788300000000, freeFallback: { available: false, reason: 'unavailable', provider: 'binance+bybit' } },
      ksa: { available: true, provider: 'sahmk', tasi: 12150, tasiChangePct: 0.42, delayed: true, asOf: '2026-09-01T01:30:00.000Z' },
      ...desks,
    },
    ...extra,
  };
}

function mockBriefing(payload: unknown) {
  global.fetch = vi.fn(async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
}

describe('HomeBriefing feeds aggregate (A2)', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      symbol: 'SPY',
      chainAvailable: false,
      chainAttempted: false,
      chainUsed: 'none',
    });
  });

  afterEach(() => {
    global.fetch = REAL_FETCH;
  });

  it('reads Live only when every desk is up', async () => {
    mockBriefing(briefing({}));
    render(<HomeBriefing />);
    await waitFor(() => expect(screen.getByTestId('home-feeds-aggregate')).toBeInTheDocument());
    expect(screen.getByTestId('home-feeds-aggregate').textContent).toMatch(/Live/);
    expect(screen.getByTestId('home-feeds-aggregate').textContent).not.toMatch(/Partial|OK/);
    // Independent desks stay usable: launcher renders.
    expect(screen.getByTestId('launchpad-grid')).toBeInTheDocument();
  });

  it('reads Partial on any single outage, never Live or OK', async () => {
    mockBriefing(briefing({
      ksa: { available: false, provider: 'sahmk', tasi: null, tasiChangePct: null, delayed: null, asOf: null },
    }, { freshness: { live: false, state: 'partial' } }));
    render(<HomeBriefing />);
    await waitFor(() => expect(screen.getByTestId('home-feeds-aggregate')).toBeInTheDocument());
    const label = screen.getByTestId('home-feeds-aggregate').textContent ?? '';
    expect(label).toMatch(/Partial/);
    expect(label).not.toMatch(/Live/);
    expect(label).not.toMatch(/OK/);
    expect(label).not.toMatch(/Healthy/);
    expect(screen.getByTestId('launchpad-grid')).toBeInTheDocument();
  });

  it('reads Stale, never Live, for a stale snapshot', async () => {
    mockBriefing(briefing({}, { stale: true, freshness: { live: false, state: 'stale' } }));
    render(<HomeBriefing />);
    await waitFor(() => expect(screen.getByTestId('home-feeds-aggregate')).toBeInTheDocument());
    const label = screen.getByTestId('home-feeds-aggregate').textContent ?? '';
    expect(label).toMatch(/Stale/);
    expect(label).not.toMatch(/Live/);
  });

  it('reads Unavailable when all desks are down, launcher still usable', async () => {
    mockBriefing(briefing({
      equities: { available: false, provider: 'finnhub', symbol: 'SPY', price: null, changePct: null, asOf: null, note: 'down' },
      rates: { available: false, provider: 'macrovol(fred)', sofr: null, effr: null, usy2: null, usy10: null, spread_2s10s_bps: null, asOf: null },
      crypto: { available: false, provider: 'deribit', indexPrice: null, funding8h: null, optionCount: null, asOf: null, freeFallback: { available: false, reason: 'unavailable', provider: 'binance+bybit' } },
      ksa: { available: false, provider: 'sahmk', tasi: null, tasiChangePct: null, delayed: null, asOf: null },
    }, { sources: [], freshness: { live: false, state: 'unavailable' } }));
    render(<HomeBriefing />);
    await waitFor(() => expect(screen.getByTestId('home-feeds-aggregate')).toBeInTheDocument());
    expect(screen.getByTestId('home-feeds-aggregate').textContent).toMatch(/Unavailable/);
    // No desk is gated by Home state: launcher renders even all-down.
    expect(screen.getByTestId('launchpad-grid')).toBeInTheDocument();
  });

  it('surfaces snapshot-fresh but terminal-chain-down disagreement', async () => {
    mockBriefing(briefing({}));
    useTerminalStore.setState({ chainAvailable: false, chainAttempted: true, chainUsed: 'none' });
    render(<HomeBriefing />);
    await waitFor(() => expect(screen.getByTestId('home-chain-disagree')).toBeInTheDocument());
    expect(screen.getByTestId('home-chain-disagree').textContent).toMatch(/terminal chain down/);
  });

  it('stays silent when the chain was never attempted (no false contradiction)', async () => {
    mockBriefing(briefing({}));
    useTerminalStore.setState({ chainAvailable: false, chainAttempted: false, chainUsed: 'none' });
    render(<HomeBriefing />);
    await waitFor(() => expect(screen.getByTestId('home-feeds-aggregate')).toBeInTheDocument());
    expect(screen.queryByTestId('home-chain-disagree')).toBeNull();
    expect(screen.queryByTestId('home-chain-disagree-pos')).toBeNull();
  });
});
