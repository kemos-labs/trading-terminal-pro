/**
 * StructureWorkflow executable-entry transparency — display-only tests.
 * Exercises the real templateLegs/evaluateCombo pipeline; asserts no
 * fabricated entry values and no mid/last/model substitution.
 */
import { describe, expect, it } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { StructureWorkflow } from './StructureWorkflow';
import { useTerminalStore } from '../../../store/terminalStore';
import { entryBasisValidFor, evaluateCombo, templateLegs } from '../../../lib/options/portfolio';
import { buildSnapshot } from '../../../lib/options/synthetic';
import { EMPTY_PROVENANCE, makeProvenance } from '../../../lib/data/freshness';

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;

function mountWith(symbol: string, mutate?: (snap: ReturnType<typeof buildSnapshot>) => void) {
  const snap = buildSnapshot(symbol, Date.now(), 500, 0.05, 0.01);
  mutate?.(snap);
  useTerminalStore.setState({ snapshot: snap, symbol, provenance: { ...EMPTY_PROVENANCE } });
  render(<StructureWorkflow />);
  return snap;
}

describe('StructureWorkflow executable entry transparency', () => {
  it('two-sided quotes: each leg shows actual entry price with observed ask/bid basis', () => {
    const snap = mountWith('SPY-ENTRY-OK');
    const legs = templateLegs('short_straddle', snap, 0);
    expect(legs.length).toBeGreaterThan(0);
    for (const leg of legs) {
      expect(leg.entryPrice).not.toBeNull();
      expect(leg.entryPrice).toBeGreaterThan(0);
    }
    const section = screen.getByTestId('structure-entry-transparency');
    expect(section).toBeInTheDocument();
    legs.forEach((leg, i) => {
      const line = screen.getByTestId(`structure-entry-leg-${i}`);
      const slice = snap.expiries.find((e) => e.expiry === leg.expiry)!;
      const quotes = leg.kind === 'call' ? slice.calls : slice.puts;
      const q = quotes.find((x) => x.strike === leg.strike)!;
      expect(q).toBeDefined();
      // Actual pipeline value rendered, never a substituted mid/last
      const expected = leg.side === 'long' ? q.ask : q.bid;
      expect(leg.entryPrice).toBe(expected);
      expect(line.textContent).toContain(`$${leg.entryPrice!.toFixed(2)}`);
      expect(line.textContent).toContain(leg.side === 'long' ? 'observed ask' : 'observed bid');
      expect(line.textContent).not.toContain('unavailable');
    });
    expect(screen.queryByTestId('structure-entry-overall')).not.toBeInTheDocument();
  });

  it('missing long ask: leg line and overall reason shown, no fabricated value', () => {
    const snap = mountWith('SPY-ENTRY-NOASK', (s) => {
      const slice = s.expiries[0]!;
      const atmStrike = slice.calls.reduce((b, q) =>
        Math.abs(q.strike - s.spot) < Math.abs(b.strike - s.spot) ? q : b, slice.calls[0]!).strike;
      slice.calls.forEach((q) => { if (q.strike === atmStrike) q.ask = null; });
    });
    // Drive the rendered template to a long leg (component default is short_straddle).
    fireEvent.change(screen.getAllByLabelText('Template')[0]!, { target: { value: 'long_straddle' } });
    const legs = templateLegs('long_call', snap, 0);
    const missing = legs.find((l) => l.kind === 'call' && l.side === 'long');
    expect(missing?.entryPrice).toBeNull();
    expect(missing?.entryBasis).toBeNull();
    const m = evaluateCombo(legs, snap);
    expect(m.unavailable).toBe(true);
    const line = screen.getByTestId('structure-entry-leg-0');
    expect(line.textContent).toContain('entry unavailable');
    expect(line.textContent).toContain('missing observed ask');
    expect(line.textContent).not.toMatch(/\$\d+\.\d{2}/);
    const overall = screen.getByTestId('structure-entry-overall');
    expect(overall.textContent).toContain('Structure unavailable');
    expect(overall.textContent).toContain(m.unavailableReason ?? '');
  });

  it('missing short bid: leg line names the missing observed bid', () => {
    const snap = mountWith('SPY-ENTRY-NOBID', (s) => {
      s.expiries[0]!.puts.forEach((q) => { q.bid = null; });
    });
    const legs = templateLegs('short_straddle', snap, 0);
    const missingIdx = legs.findIndex((l) => l.kind === 'put' && l.side === 'short');
    const missing = legs[missingIdx];
    expect(missing?.entryPrice).toBeNull();
    const line = screen.getByTestId(`structure-entry-leg-${missingIdx}`);
    expect(line.textContent).toContain('entry unavailable');
    expect(line.textContent).toContain('missing observed bid');
    expect(line.textContent).not.toMatch(/\$\d+\.\d{2}/);
    expect(screen.getByTestId('structure-entry-overall')).toBeInTheDocument();
  });

  it('unknown chain provenance renders an explicit unknown freshness label', () => {
    mountWith('SPY-ENTRY-UNKNOWN');
    const fresh = screen.getByTestId('structure-entry-freshness');
    expect(fresh.textContent).toMatch(/unknown/i);
    expect(fresh.textContent).toMatch(/do not guarantee current execution/i);
    // No invented age/fetch-time proxy.
    expect(fresh.textContent).not.toMatch(/\d+\s*(ms|s|min)/);
  });

  it('existing chain provenance kind is surfaced honestly (live/stale/delayed)', () => {
    for (const kind of ['live', 'stale', 'delayed'] as const) {
      const snap = buildSnapshot(`SPY-ENTRY-${kind.toUpperCase()}`, Date.now(), 500, 0.05, 0.01);
      const chain = kind === 'live'
        ? makeProvenance('chain', 'fmp', Date.now(), {})
        : makeProvenance('chain', 'fmp', Date.now(), kind === 'stale' ? { sourceKind: 'stale' } : { sourceKind: 'delayed' });
      // Honest use of the existing API: surface whatever kind it actually classifies.
      useTerminalStore.setState({ snapshot: snap, symbol: `SPY-ENTRY-${kind.toUpperCase()}`, provenance: { ...EMPTY_PROVENANCE, chain } });
      const { unmount } = render(<StructureWorkflow />);
      const fresh = screen.getByTestId('structure-entry-freshness');
      expect(fresh.textContent).toContain(chain.kind);
      expect(fresh.textContent).toMatch(/do not guarantee current execution/i);
      unmount();
    }
  });

  it('user basis is lib-supported but never fabricated by the template pipeline UI', () => {
    const snap = mountWith('SPY-ENTRY-USER');
    // Lib accepts an explicit user override as executable.
    expect(entryBasisValidFor({ kind: 'call', side: 'long', entryBasis: 'user' })).toBe(true);
    const legs = templateLegs('long_call', snap, 0).map((l) => ({ ...l, entryBasis: 'user' as const }));
    const m = evaluateCombo(legs, snap);
    expect(m.unavailable).not.toBe(true);
    // The template pipeline never emits user basis, so the UI must not claim it.
    const raw = templateLegs('long_call', snap, 0);
    expect(raw.every((l) => l.entryBasis !== 'user')).toBe(true);
    expect(screen.queryByText(/explicit user entry/)).not.toBeInTheDocument();
  });
});
