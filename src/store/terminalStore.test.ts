import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTerminalStore } from './terminalStore';
import { buildSnapshot, buildSurfaceGrid } from '../lib/options/synthetic';
import { sviReadout } from '../lib/options/surfaceTools';
import { diagnoseArbitrage } from '../lib/options/noarb';

/**
 * LIVE-only store tests. Network-backed setSymbol is not exercised here —
 * seed a real-shaped snapshot (from the shared builder used in unit fixtures)
 * and assert SVI/arb math + symbol validation.
 */
function seedLiveSurface(symbol = 'SPY') {
  const snap = buildSnapshot(symbol, Date.now(), 500, 0, 0);
  // Mark as live so store provenance paths treat it as market data.
  const liveSnap = { ...snap, surfaceSource: 'live' as const };
  const surface = buildSurfaceGrid(liveSnap);
  const readout = sviReadout(surface, liveSnap.spot);
  const arb = diagnoseArbitrage(surface, liveSnap.spot);
  useTerminalStore.setState({
    symbol,
    snapshot: liveSnap,
    surface,
    sviReadout: readout,
    arbResult: arb,
    historicalFrames: [],
    frameIndex: 0,
    isPlaying: false,
    speed: 1,
    source: 'live',
    liveAvailable: true,
    loading: false,
    lastUpdate: Date.now(),
    activeTab: 'vol',
    displayMode: 'strike',
    selectedExpiry: null,
    playbackInterval: null,
    refreshInterval: null,
    fmpQuote: null,
    fmpTreasuryRates: null,
    liveRFR: null,
    fmpSpot: null,
    chainAvailable: true,
    chainUsed: 'yfinance',
    spotSource: 'yfinance',
    historyMode: 'live',
  });
}

describe('terminalStore', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      symbol: 'SPY',
      snapshot: null,
      surface: null,
      sviReadout: null,
      arbResult: null,
      historicalFrames: [],
      frameIndex: 0,
      isPlaying: false,
      speed: 1,
      source: 'live',
      liveAvailable: false,
      loading: false,
      lastUpdate: Date.now(),
      activeTab: 'vol',
      displayMode: 'strike',
      selectedExpiry: null,
      playbackInterval: null,
      refreshInterval: null,
      fmpQuote: null,
      fmpTreasuryRates: null,
      liveRFR: null,
      fmpSpot: null,
      chainAvailable: false,
      chainUsed: 'none',
      spotSource: 'none',
      historyMode: 'live',
    });
  });

  it('computes sviReadout and arbResult on a live-shaped surface', () => {
    seedLiveSurface('SPY');
    const state = useTerminalStore.getState();
    expect(state.snapshot).not.toBeNull();
    expect(state.surface).not.toBeNull();
    expect(state.sviReadout).not.toBeNull();
    expect(state.arbResult).not.toBeNull();

    expect(state.sviReadout!.samples).toBeGreaterThanOrEqual(5);
    expect(state.sviReadout!.rmse).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(state.sviReadout!.params.a)).toBe(true);
    expect(Number.isFinite(state.sviReadout!.params.b)).toBe(true);
    expect(Number.isFinite(state.sviReadout!.params.rho)).toBe(true);
    expect(Number.isFinite(state.sviReadout!.params.m)).toBe(true);
    expect(Number.isFinite(state.sviReadout!.params.sigma)).toBe(true);

    expect(state.arbResult!.calendar.violations).toBe(0);
    expect(state.arbResult!.butterfly.violations).toBe(0);
    expect(state.arbResult!.clean).toBe(true);
    expect(state.source).toBe('live');
    expect(state.chainUsed).toBe('yfinance');
  });

  it('rejects invalid symbols and preserves previous state', async () => {
    seedLiveSurface('SPY');
    const validSnapshot = useTerminalStore.getState().snapshot;

    await useTerminalStore.getState().setSymbol('123INVALID');
    const afterInvalid = useTerminalStore.getState();

    expect(afterInvalid.symbol).toBe('SPY');
    expect(afterInvalid.snapshot).toBe(validSnapshot);
  });

  it('setSource(demo) forces live-only', async () => {
    seedLiveSurface('SPY');
    await useTerminalStore.getState().setSource('demo');
    expect(useTerminalStore.getState().source).toBe('live');
  }, 30_000);

  it('rapid symbol switch: stale A reply does not overwrite B snapshot (generation guard)', async () => {
    const { getProvider } = await import('../lib/data/provider');
    // Build two distinct live snapshots
    const snapA = { ...buildSnapshot('AAA', Date.now(), 100, 0, 0), symbol: 'AAA', surfaceSource: 'live' as const };
    const snapB = { ...buildSnapshot('BBB', Date.now(), 200, 0, 0), symbol: 'BBB', surfaceSource: 'live' as const };
    const live = getProvider('live') as unknown as { getSnapshot: (s: string) => Promise<never>; lastChainAvailable: boolean; lastChainSource: string; lastSpotSource: string; lastChainFetchedAt: number; lastSpotFetchedAt: number; lastFundingAnn: null };
    const orig = live.getSnapshot.bind(live);
    void orig;
    const spy = vi.spyOn(live, 'getSnapshot').mockImplementation(async (sym: string) => {
      if (sym === 'AAA') {
        await new Promise((r) => setTimeout(r, 60));
        live.lastChainAvailable = true;
        (live as unknown as Record<string, unknown>).lastChainSource = 'yfinance';
        (live as unknown as Record<string, unknown>).lastSpotSource = 'yfinance';
        live.lastChainFetchedAt = Date.now();
        live.lastSpotFetchedAt = Date.now();
        return snapA as never;
      }
      if (sym === 'BBB') {
        await new Promise((r) => setTimeout(r, 10));
        live.lastChainAvailable = true;
        (live as unknown as Record<string, unknown>).lastChainSource = 'yfinance';
        (live as unknown as Record<string, unknown>).lastSpotSource = 'yfinance';
        live.lastChainFetchedAt = Date.now();
        live.lastSpotFetchedAt = Date.now();
        return snapB as never;
      }
      return null as never;
    });
    // Mock enrichment fetches to avoid network
    const fmp = await import('../lib/data/fmpClient');
    vi.spyOn(fmp, 'fetchFmpQuote').mockResolvedValue(null as never);
    vi.spyOn(fmp, 'fetchFmpPriceHistory').mockResolvedValue(null as never);
    vi.spyOn(fmp, 'fetchFmpProfile').mockResolvedValue(null as never);
    vi.spyOn(fmp, 'fetchFmpNews').mockResolvedValue(null as never);
    vi.spyOn(fmp, 'fetchFmpEarnings').mockResolvedValue(null as never);
    vi.spyOn(fmp, 'fetchFmpTreasuryRates').mockResolvedValue(null as never);
    const yf = await import('../lib/data/yfinanceClient');
    vi.spyOn(yf, 'fetchYfHistory').mockResolvedValue(null as never);
    vi.spyOn(yf, 'fetchYfInfo').mockResolvedValue(null as never);
    // Fire overlapping symbol switches
    const pA = useTerminalStore.getState().setSymbol('AAA');
    // Immediately switch to BBB before AAA resolves
    const pB = useTerminalStore.getState().setSymbol('BBB');
    void pA; void pB;
    await new Promise((r) => setTimeout(r, 120));
    const st = useTerminalStore.getState();
    expect(st.symbol).toBe('BBB');
    expect(st.snapshot?.symbol).toBe('BBB');
    expect(st.loading).toBe(false);
    spy.mockRestore();
    vi.restoreAllMocks();
  });
});
