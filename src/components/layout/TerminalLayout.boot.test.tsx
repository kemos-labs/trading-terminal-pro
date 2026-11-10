/**
 * Actual-layout regression for P2 boot effect.
 * The Home->Vol transition test is a real React TerminalLayout render;
 * it fails on the old dep list [setSymbol, urlHydrated] (activeTab change never
 * retriggers the boot effect) and passes on the fixed list
 * [setSymbol, urlHydrated, activeTab].
 * StrictMode coverage is wrapped in actual React.StrictMode.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { TerminalLayout } from './TerminalLayout';
import { useTerminalStore } from '../../store/terminalStore';
import { EMPTY_PROVENANCE } from '../../lib/data/freshness';

describe('TerminalLayout boot lifecycle P2', () => {
  beforeEach(() => {
    try { sessionStorage.setItem('boot.seen','1'); } catch {}
    window.history.replaceState({}, '', '/?desk=home');
    useTerminalStore.setState({
      activeTab: 'home' as never,
      symbol: 'SPY',
      source: 'live',
      loading: false,
      snapshot: null,
      surface: null,
      chainAvailable: false,
      chainAttempted: false,
      lastChainUpdate: 0,
      lastSpotUpdate: 0,
      provenance: { ...EMPTY_PROVENANCE },
      historicalFrames: [],
    } as never);
    vi.restoreAllMocks();
  });

  it('negative control: Home->Vol transition starts chain (fails on old deps [setSymbol, urlHydrated] without activeTab)', async () => {
    // Real React transition: render at Home (independent desk, no chain start),
    // then switch to Vol (chain-dependent) – fixed effect with activeTab dep must fire setSymbol once.
    // With old deps [setSymbol, urlHydrated] this assertion fails (0 calls).
    const spy = vi.spyOn(useTerminalStore.getState(), 'setSymbol');
    const fmp = await import('../../lib/data/fmpClient');
    vi.spyOn(fmp, 'fetchFmpQuote').mockResolvedValue(null as never);
    vi.spyOn(fmp, 'fetchFmpPriceHistory').mockResolvedValue(null as never);
    vi.spyOn(fmp, 'fetchFmpProfile').mockResolvedValue(null as never);
    vi.spyOn(fmp, 'fetchFmpNews').mockResolvedValue(null as never);
    vi.spyOn(fmp, 'fetchFmpEarnings').mockResolvedValue(null as never);
    vi.spyOn(fmp, 'fetchFmpTreasuryRates').mockResolvedValue(null as never);
    const yf = await import('../../lib/data/yfinanceClient');
    vi.spyOn(yf, 'fetchYfHistory').mockResolvedValue(null as never);
    vi.spyOn(yf, 'fetchYfInfo').mockResolvedValue(null as never);
    const provider = (await import('../../lib/data/provider')).getProvider('live') as unknown as Record<string, unknown>;
    vi.spyOn(provider as never, 'getSnapshot' as never).mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 50));
      return null;
    });

    render(<TerminalLayout />);
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(spy).not.toHaveBeenCalled(); // Home is independent -> no chain start

    await act(async () => {
      useTerminalStore.getState().setActiveTab('vol' as never);
    });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('SPY');
  });

  it('Home boot performs no unnecessary chain start', async () => {
    const spy = vi.spyOn(useTerminalStore.getState(), 'setSymbol');
    render(<TerminalLayout />);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(spy).not.toHaveBeenCalled();
  });

  it('Flow/Trade transitions also start chain', async () => {
    const spy = vi.spyOn(useTerminalStore.getState(), 'setSymbol');
    const fmp = await import('../../lib/data/fmpClient');
    vi.spyOn(fmp, 'fetchFmpQuote').mockResolvedValue(null as never);
    const provider = (await import('../../lib/data/provider')).getProvider('live') as unknown as Record<string, unknown>;
    vi.spyOn(provider as never, 'getSnapshot' as never).mockResolvedValue(null as never);

    render(<TerminalLayout />);
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    await act(async () => { useTerminalStore.getState().setActiveTab('positioning' as never); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    await act(async () => { useTerminalStore.getState().setActiveTab('home' as never); useTerminalStore.setState({ snapshot: null, lastChainUpdate: 0, loading: false }); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    spy.mockClear();
    await act(async () => { useTerminalStore.getState().setActiveTab('desk' as never); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('existing snapshot is not discarded on desk change', async () => {
    const fakeSnap = { symbol: 'SPY', spot: 500, surfaceSource: 'live', timestamp: Date.now(), expiries: [{ expiry: '2026-09-19', atmIV: 0.2, strikes: [], calls: [], puts: [] }] } as never;
    useTerminalStore.setState({ snapshot: fakeSnap, lastChainUpdate: Date.now(), chainAvailable: true } as never);
    const spy = vi.spyOn(useTerminalStore.getState(), 'setSymbol');
    render(<TerminalLayout />);
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    await act(async () => { useTerminalStore.getState().setActiveTab('vol' as never); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(spy).not.toHaveBeenCalled();
    expect(useTerminalStore.getState().snapshot).toBe(fakeSnap);
  });

  it('StrictMode does not duplicate in-flight same-symbol request', async () => {
    const spy = vi.spyOn(useTerminalStore.getState(), 'setSymbol');
    const provider = (await import('../../lib/data/provider')).getProvider('live') as unknown as Record<string, unknown>;
    let calls = 0;
    vi.spyOn(provider as never, 'getSnapshot' as never).mockImplementation(async () => {
      calls++;
      await new Promise(r => setTimeout(r, 100));
      return null;
    });
    render(
      <React.StrictMode>
        <TerminalLayout />
      </React.StrictMode>
    );
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    await act(async () => { useTerminalStore.getState().setActiveTab('vol' as never); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    const first = spy.mock.calls.length;
    expect(first).toBe(1);
    await act(async () => { useTerminalStore.getState().setActiveTab('vol' as never); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(spy.mock.calls.length).toBe(first);
    expect(calls).toBeLessThanOrEqual(1);
  });
});
