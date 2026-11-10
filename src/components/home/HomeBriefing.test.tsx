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
  // Fresh event times by default: Live assertions must hold at any wall clock.
  // Stale-age tests pass explicit old timestamps instead.
  const freshIso = new Date(Date.now() - 5000).toISOString();
  const freshMs = Date.now() - 5000;
  return {
    schemaVersion: 1,
    symbol: 'SPY',
    asOf: freshIso,
    sources: ['finnhub/quote'],
    fromCache: false,
    ageMs: 1200,
    stale: false,
    freshness: { live: true, state: 'live' },
    desks: {
      equities: { available: true, provider: 'finnhub', symbol: 'SPY', price: 500, changePct: 0.5, asOf: freshIso, note: null },
      rates: { available: true, provider: 'macrovol(fred)', sofr: 4.53, effr: 4.32, usy2: 4.25, usy10: 4.55, spread_2s10s_bps: 30, asOf: freshIso },
      crypto: { available: true, provider: 'deribit', indexPrice: 60000, funding8h: 0.00005, optionCount: 40, asOf: freshMs, freeFallback: { available: false, reason: 'unavailable', provider: 'binance+bybit' } },
      ksa: { available: true, provider: 'sahmk', tasi: 12150, tasiChangePct: 0.42, delayed: true, asOf: freshIso },
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

describe('HomeBriefing freshness ledger (P1-16)', () => {
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

  it('lists one row per desk with provider, UTC event time, and state', async () => {
    mockBriefing(briefing({}));
    render(<HomeBriefing />);
    await waitFor(() => expect(screen.getByTestId('home-freshness-ledger')).toBeInTheDocument());
    const ledger = screen.getByTestId('home-freshness-ledger').textContent ?? '';
    for (const desk of ['Snapshot', 'Equities', 'Rates', 'Crypto (Deribit)', 'Crypto (free)', 'KSA']) {
      expect(ledger).toMatch(new RegExp(desk.replace(/[()]/g, '\\$&')));
    }
    // Real provenance, never fabricated: provider names and full UTC stamps.
    expect(ledger).toMatch(/finnhub/);
    expect(ledger).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}Z/);
    expect(ledger).not.toMatch(/NaN|Infinity/);
    // KSA is delayed-truthful, never Live.
    const ksaRow = screen.getByTestId('home-freshness-ledger').querySelector('tbody')?.textContent ?? '';
    expect(ksaRow).toMatch(/delayed/);
  });

  it('labels an available feed with a four-day-old observation stale, never live', async () => {
    const oldIso = new Date(Date.now() - 102 * 3600_000).toISOString();
    mockBriefing(briefing({
      rates: { available: true, provider: 'macrovol(fred)', sofr: 4.53, effr: 4.32, usy2: 4.25, usy10: 4.55, spread_2s10s_bps: 30, asOf: oldIso },
    }));
    render(<HomeBriefing />);
    await waitFor(() => expect(screen.getByTestId('home-freshness-ledger')).toBeInTheDocument());
    const rows = [...screen.getByTestId('home-freshness-ledger').querySelectorAll('tbody tr')];
    const ratesRow = rows.find((tr) => tr.textContent?.includes('Rates'))?.textContent ?? '';
    expect(ratesRow).toMatch(/stale/);
    expect(ratesRow).not.toMatch(/live/);
    // Fresh desks stay Live; the exact age remains visible beside the badge.
    const eqRow = rows.find((tr) => tr.textContent?.includes('Equities'))?.textContent ?? '';
    expect(eqRow).toMatch(/live/);
    expect(ratesRow).toMatch(/102h/);
  });

  it('shares the stale verdict between the Rates cell header and the ledger', async () => {
    const oldIso = new Date(Date.now() - 102 * 3600_000).toISOString();
    mockBriefing(briefing({
      rates: { available: true, provider: 'macrovol(fred)', sofr: 4.53, effr: 4.32, usy2: 4.25, usy10: 4.55, spread_2s10s_bps: 30, asOf: oldIso },
    }));
    render(<HomeBriefing />);
    await waitFor(() => expect(screen.getByTestId('home-cell-rates')).toBeInTheDocument());
    const header = screen.getByTestId('home-cell-rates').querySelector('header')?.textContent ?? '';
    expect(header).toMatch(/stale/);
    expect(header).not.toMatch(/delayed/);
    // The Feeds strip agrees: no green 'Rates ok' beside a stale Rates cell.
    const strip = screen.getByTestId('home-provider-strip').textContent ?? '';
    expect(strip).toMatch(/Rates stale/);
    expect(strip).not.toMatch(/Rates ok/);
  });

  it('ledger scroll region is keyboard-focusable (WCAG 2.1.1, axe scrollable-region-focusable)', async () => {
    mockBriefing(briefing({}));
    render(<HomeBriefing />);
    await waitFor(() => expect(screen.getByTestId('home-freshness-ledger')).toBeInTheDocument());
    const region = screen.getByLabelText('Freshness ledger rows');
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region.className).toContain('overflow-x-auto');
  });

  it('marks unavailable rows honestly on partial snapshots', async () => {
    mockBriefing(briefing({
      ksa: { available: false, provider: 'sahmk', tasi: null, tasiChangePct: null, delayed: null, asOf: null },
    }, { freshness: { live: false, state: 'partial' } }));
    render(<HomeBriefing />);
    await waitFor(() => expect(screen.getByTestId('home-freshness-ledger')).toBeInTheDocument());
    const ledger = screen.getByTestId('home-freshness-ledger').textContent ?? '';
    expect(ledger).toMatch(/partial/);
    expect(ledger).toMatch(/unavailable/);
  });

  it('labels a Deribit-down free-fallback crypto cell honestly (never unavailable)', async () => {    mockBriefing(briefing({
      crypto: {
        available: false, provider: 'deribit', indexPrice: null, funding8h: null, optionCount: null, asOf: null,
        freeFallback: { available: true, reason: 'partial', provider: 'binance+bybit', asOf: Date.now() - 5000 },
      },
    }, { freshness: { live: false, state: 'partial' } }));
    render(<HomeBriefing />);
    await waitFor(() => expect(screen.getByTestId('home-cell-crypto')).toBeInTheDocument());
    const cell = screen.getByTestId('home-cell-crypto');
    expect(cell.textContent ?? '').toMatch(/free fallback/i);
    // Header state is the verdict: free provider, never an unavailable badge.
    const header = cell.querySelector('header')?.textContent ?? '';
    expect(header).toMatch(/free fallback/);
    expect(header).not.toMatch(/unavailable/);
  });

  it('keeps stacked grid sections non-shrinking inside the scrolling root (390x844 overlap guard)', async () => {
    mockBriefing(briefing({}));
    render(<HomeBriefing />);
    await waitFor(() => expect(screen.getByTestId('home-briefing')).toBeInTheDocument());
    const root = screen.getByTestId('home-briefing');
    // Root stays the scroll container.
    expect(root.className).toMatch(/min-h-0/);
    expect(root.className).toMatch(/overflow-y-auto/);
    // Desk grid keeps its content height on the stacked phone layout (no
    // min-h-0 shrink, and the leftover-height growth is scoped to md and up,
    // where the card row is the widest block).
    const deskGrid = screen.getByTestId('home-cell-vol').parentElement;
    expect(deskGrid?.className).not.toMatch(/min-h-0/);
    expect(deskGrid?.className).not.toMatch(/(^|\s)flex-1(\s|$)/);
    expect(deskGrid?.className).toMatch(/md:flex-1/);
    // KSA + launcher wrapper retains content height.
    const ksaRow = screen.getByTestId('home-cell-ksa').parentElement;
    expect(ksaRow?.className).toMatch(/shrink-0/);
    expect(ksaRow?.className).not.toMatch(/min-h-0/);
  });

  it('spends the leftover desktop height on ledger rows, not an empty bordered box', async () => {
    mockBriefing(briefing({}));
    render(<HomeBriefing />);
    await waitFor(() => expect(screen.getByTestId('home-freshness-ledger')).toBeInTheDocument());
    const ledger = screen.getByTestId('home-freshness-ledger');
    expect(ledger.className).toContain('flex-1');
    expect(ledger.className).toContain('min-h-[180px]');
    // The row region and its table fill the frame, so the slack becomes row
    // height instead of empty space under the last ledger row.
    const region = ledger.querySelector('[role="region"]') as HTMLElement;
    expect(region.className).toContain('flex-1');
    expect((region.querySelector('table') as HTMLElement).className).toContain('h-full');
    // Snapshot provenance is stated once, in the page header — the ledger adds
    // no duplicated chrome.
    expect(screen.getByTestId('home-briefing').textContent).toMatch(/one shared snapshot, no per-widget polling/);
    expect(ledger.textContent).not.toMatch(/zero client polling/);
  });
});
