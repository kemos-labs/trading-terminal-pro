import { create } from 'zustand';
import type { VolSnapshot, SurfaceGrid, ActiveTab, DisplayMode, FALevels } from '../lib/options/types';
import { buildSurfaceGrid, type SurfaceWingMode } from '../lib/options/synthetic';
import { diagnoseArbitrage, type NoArbResult } from '../lib/options/noarb';
import { sviReadout, type SVIReadout } from '../lib/options/surfaceTools';
import { REFRESH_CONFIG, VALIDATION_CONFIG } from '../config/constants';
import {
  fetchFmpQuote,
  fetchFmpTreasuryRates,
  fetchFmpPriceHistory,
  fetchFmpProfile,
  fetchFmpNews,
  fetchFmpEarnings,
  invalidateFmpCache,
} from '../lib/data/fmpClient';
import { fetchYfHistory, fetchYfInfo, fetchYfInfoRaw, invalidateYfCache } from '../lib/data/yfinanceClient';
// yfinance info fallback keeps spot honest when FMP is unconfigured (see refresh loop)
import { invalidateYahooChainCache } from '../lib/options/yahoo';
import { invalidateDeribitCache } from '../lib/data/deribitClient';
import { getProvider, LiveProvider, type ChainMode } from '../lib/data/provider';
import type { FmpQuote, FmpTreasuryRate, FmpProfile, FmpNewsItem, FmpPriceBar, FmpEarnings } from '../lib/data/types';
import { usEquitySession, type SessionStatus } from '../lib/options/time';
import { pushLiveFrame } from '../lib/options/liveHistory';
import { toast } from 'sonner';
import {
  EMPTY_PROVENANCE,
  makeProvenance,
  type StoreProvenance,
} from '../lib/data/freshness';
import { perfMark, perfTimeSync } from '../config/perfBudget';
import type { BoardFocusState } from '../hooks/useBoardFocus';
import { findSectionMeta, sectionsForTab, RATES_SECTION_TO_MODE } from '../config/deskSections';
import { repriceSnapshotAtSpot } from '../lib/options/reprice';
import {
  extractSurfaceMetrics,
  pushSurfaceMetrics,
  type SurfaceMetricsFrame,
  type SurfaceUpdatePath,
} from '../lib/options/surfaceMetrics';
import { prefetchGreeks, invalidateGreeksCache } from '../lib/macrovol/greeksCache';
import { startVisibilityPolling } from '../lib/polling/visibilityPolling';

function processSurface(surface: SurfaceGrid, spot: number) {
  const readout = sviReadout(surface, spot);
  const arb = diagnoseArbitrage(surface, spot);
  return { surface, sviReadout: readout, arbResult: arb };
}

function recordSurfaceMetrics(
  snap: VolSnapshot,
  path: SurfaceUpdatePath,
  get: () => TerminalStore,
  set: (partial: Partial<TerminalStore>) => void,
) {
  if (snap.surfaceSource === 'synthetic') return;
  const frame = extractSurfaceMetrics(snap, path, snap.timestamp || Date.now());
  const prev = get().surfaceMetrics;
  set({
    surfaceMetrics: pushSurfaceMetrics(prev, frame),
    lastSurfacePath: path,
  });
}

function processSnapshot(snap: VolSnapshot, wingMode: SurfaceWingMode = 'otm') {
  return processSurface(buildSurfaceGrid(snap, { wingMode }), snap.spot);
}

/** Spot tick: sticky-IV reprice greeks + rebuild surface (shared by poll + SSE). */
export function applySpotPatch(
  snap: VolSnapshot,
  price: number,
  now: number,
  wingMode: SurfaceWingMode = 'otm',
) {
  const patched = repriceSnapshotAtSpot(snap, price, { timestamp: now });
  const processed = processSnapshot(patched, wingMode);
  return { patched, processed };
}

function liveSnapshotCtx(state: {
  liveRFR: number | null;
  fmpTreasuryRates: FmpTreasuryRate[] | null;
  fmpProfile: FmpProfile | null;
  chainMode: ChainMode;
}) {
  return {
    rfr: state.liveRFR ?? undefined,
    treasury: state.fmpTreasuryRates,
    profile: state.fmpProfile,
    chainMode: state.chainMode,
  };
}

interface TerminalStore {
  symbol: string;
  snapshot: VolSnapshot | null;
  surface: SurfaceGrid | null;
  sviReadout: SVIReadout | null;
  arbResult: NoArbResult | null;
  historicalFrames: { snapshot: VolSnapshot; surface: SurfaceGrid; timestamp: number }[];
  frameIndex: number;
  isPlaying: boolean;
  speed: number;
  source: 'demo' | 'live';
  chainMode: ChainMode;
  liveAvailable: boolean;
  loading: boolean;
  lastUpdate: number;
  /** Epoch ms of last successful spot quote refresh. */
  lastSpotUpdate: number;
  /** Epoch ms of last successful chain/surface rebuild. */
  lastChainUpdate: number;
  activeTab: ActiveTab;
  displayMode: DisplayMode;
  selectedExpiry: string | null;
  /** FMP enrichment data */
  fmpQuote: FmpQuote | null;
  fmpTreasuryRates: FmpTreasuryRate[] | null;
  liveRFR: number | null;
  fmpSpot: number | null;
  fmpProfile: FmpProfile | null;
  fmpNews: FmpNewsItem[] | null;
  fmpHistory: FmpPriceBar[] | null;
  fmpEarnings: FmpEarnings[] | null;
  /** Whether the live surface used a real option chain. */
  chainAvailable: boolean;
  /** True once a chain load has been attempted (success or fail). Unattempted reads as unknown, never down. */
  chainAttempted: boolean;
  /** True once a spot fetch has been attempted (success or fail). Unattempted reads as unknown, never down. */
  spotAttempted: boolean;
  /** Where the live spot came from (`none` = no real print yet). */
  spotSource: 'fmp' | 'yfinance' | 'deribit' | 'none';
  /** Which source actually served the chain (`none` = unavailable). */
  chainUsed: 'fmp' | 'yfinance' | 'deribit' | 'none';
  historySource: 'fmp' | 'yfinance' | 'none';
  profileSource: 'fmp' | 'yfinance' | 'none';
  /** Latest US equity session snapshot (updated on refresh). */
  session: SessionStatus;
  /** Whether the SSE spot stream is currently connected. */
  streamConnected: boolean;
  /** Playback frames are from live captures only (LIVE-only terminal). */
  historyMode: 'live';
  /** Beginner hover hints: show plain-English explanations on tool metrics. */
  explainHovers: boolean;
  /** UI density: dense (terminal) vs readable (more padding). */
  uiDensity: 'dense' | 'readable';
  /** Active desk section label for context bar (Phase C). */
  deskSectionId: string | null;
  deskSectionLabel: string | null;
  deskSectionApis: string[];
  /** Deribit annualized funding when on BTC/ETH desk. */
  fundingAnn: number | null;
  /**
   * Required multi-domain provenance (nulls allowed).
   * StatusBar dual chips consume provenance.spot / provenance.chain.
   */
  provenance: StoreProvenance;
  /** Board keyboard focus (SoT). Cleared on desk/symbol change. */
  boardFocus: BoardFocusState;
  keyboardBoardFocusEnabled: boolean;
  /** Dual BTC+ETH charts (default off). */
  cryptoDualCharts: boolean;
  /** FlashAlpha dealer levels (free tier: individual stocks only, no SPY). */
  faLevels: FALevels | null;
  faLevelsLoading: boolean;
  /** How the current surface was last built — full chain vs sticky-IV spot reprice. */
  lastSurfacePath: SurfaceUpdatePath | null;
  /** Session tape of ATM / fixed-K / 25Δ RR for shape-change diagnostics. */
  surfaceMetrics: SurfaceMetricsFrame[];
  /**
   * Which chain side feeds each strike on the SURF mesh.
   * OTM = desk default; ITM = opposite; ALL = avg when both sides quote.
   */
  surfaceWingMode: SurfaceWingMode;

  playbackInterval: ReturnType<typeof setInterval> | null;
  refreshInterval: (() => void) | null;

  setSymbol: (symbol: string) => void;
  setActiveTab: (tab: ActiveTab) => void;
  setDisplayMode: (mode: DisplayMode) => void;
  setSelectedExpiry: (expiry: string | null) => void;
  setFrameIndex: (idx: number) => void;
  setPlaying: (playing: boolean) => void;
  togglePlay: () => void;
  setSpeed: (speed: number) => void;
  refresh: () => void;
  setSource: (source: 'demo' | 'live') => void;
  setChainMode: (chain: ChainMode) => void;
  storeFrames: (snap: VolSnapshot) => void;
  toggleExplainHovers: () => void;
  setUiDensity: (d: 'dense' | 'readable') => void;
  toggleUiDensity: () => void;
  setDeskContext: (ctx: { id: string | null; label: string | null; apis?: string[] }) => void;
  /** Set the active desk section by id (resolves label/apis from the section registry). */
  setDeskSection: (sectionId: string | null) => void;
  setBoardFocus: (focus: BoardFocusState) => void;
  setKeyboardBoardFocusEnabled: (on: boolean) => void;
  setCryptoDualCharts: (on: boolean) => void;
  setFALevels: (data: FALevels | null) => void;
  /** Rebuild surface from current chain using OTM / ITM / ALL quote preference. */
  setSurfaceWingMode: (mode: SurfaceWingMode) => void;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
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
  chainMode: 'auto',
  liveAvailable: false,
  loading: true,
  lastUpdate: Date.now(),
  lastSpotUpdate: 0,
  lastChainUpdate: 0,
  activeTab: (() => {
    try {
      const d = new URLSearchParams(window.location.search).get('desk');
      return (['home', 'vol', 'positioning', 'rates', 'ksa', 'academy', 'desk', 'crypto'].includes(d ?? '') ? d : 'home') as ActiveTab;
    } catch { return 'home' as ActiveTab; }
  })(),
  displayMode: 'strike',
  selectedExpiry: null,
  fmpQuote: null,
  fmpTreasuryRates: null,
  liveRFR: null,
  fmpSpot: null,
  fmpProfile: null,
  fmpNews: null,
  fmpHistory: null,
  fmpEarnings: null,
  chainAvailable: false,
  chainAttempted: false,
  spotAttempted: false,
  spotSource: 'none',
  chainUsed: 'none',
  historySource: 'none',
  profileSource: 'none',
  session: usEquitySession(),
  streamConnected: false,
  historyMode: 'live',
  explainHovers: true,
  uiDensity: (() => {
    try {
      const raw = localStorage.getItem('ui.density');
      if (raw === 'readable') return 'readable' as const;
      if (raw === 'dense') return 'dense' as const;
    } catch { /* ignore */ }
    return 'readable' as const;
  })(),
  deskSectionId: (() => {
    try { return new URLSearchParams(window.location.search).get('sec'); } catch { return null; }
  })(),
  deskSectionLabel: null,
  deskSectionApis: [],
  fundingAnn: null,
  provenance: { ...EMPTY_PROVENANCE },
  boardFocus: { boardId: null, rowIndex: 0, colKey: null },
  keyboardBoardFocusEnabled: (() => {
    try {
      const raw = localStorage.getItem('ui.keyboard.boardFocus');
      if (raw === '0' || raw === 'false') return false;
    } catch { /* ignore */ }
    return true;
  })(),
  cryptoDualCharts: (() => {
    try {
      return localStorage.getItem('ui.crypto.dualCharts') === '1';
    } catch { /* ignore */ }
    return false;
  })(),
  faLevels: null,
  faLevelsLoading: false,
  lastSurfacePath: null,
  surfaceMetrics: [],
  surfaceWingMode: (() => {
    try {
      const raw = localStorage.getItem('ui.surface.wingMode');
      if (raw === 'otm' || raw === 'itm' || raw === 'all') return raw;
    } catch { /* ignore */ }
    return 'otm' as const;
  })(),

  playbackInterval: null,
  refreshInterval: null,

  setSymbol: async (symbol: string) => {
    const trimmed = symbol.trim().toUpperCase();
    const { MIN_LENGTH, MAX_LENGTH, PATTERN } = VALIDATION_CONFIG.symbol;
    if (!trimmed || trimmed.length < MIN_LENGTH || trimmed.length > MAX_LENGTH || !PATTERN.test(trimmed)) {
      toast.error('Invalid symbol', {
        description: 'Enter a ticker (e.g. SPY, AAPL, BTC)',
      });
      return;
    }

    // StrictMode / double boot: same symbol already loading — do not restart and
    // invalidate the in-flight chain fetch (that was the false "chain unavailable" toast).
    const prev = get();
    if (prev.symbol === trimmed && prev.loading && liveFetchGen > 0) {
      return;
    }

    const { refreshInterval, playbackInterval } = get();
    if (refreshInterval) refreshInterval();
    if (playbackInterval) clearInterval(playbackInterval);

    // Bump gen so any in-flight live fetch for the previous symbol is dropped.
    liveFetchGen += 1;
    // Keep warnedSymbols: toast once per symbol per session (only clear on chain-mode change).

    set({
      symbol: trimmed,
      loading: true,
      snapshot: null,
      surface: null,
      sviReadout: null,
      arbResult: null,
      historicalFrames: [],
      frameIndex: 0,
      isPlaying: false,
      lastSpotUpdate: 0,
      lastChainUpdate: 0,
      historyMode: 'live',
      boardFocus: { boardId: null, rowIndex: 0, colKey: null },
      chainAvailable: false,
      chainAttempted: false,
      spotAttempted: false,
      chainUsed: 'none',
      spotSource: 'none',
      fundingAnn: null,
      source: 'live',
      faLevels: null,
      faLevelsLoading: false,
      lastSurfacePath: null,
      surfaceMetrics: [],
    });

    // Background load — do not block first paint (boot briefing uses this window).
    startRefreshLoop(get, set, 'live');
    void (async () => {
      if (get().symbol !== trimmed) return;
      // Chain first — enrichment (history/profile/news) must never gate surface.
      // FlashAlpha is NOT fetched here — free tier ~5/day; Flow desk loads on demand.
      const chainP = fetchLiveSnapshot(trimmed, true);
      void fetchLiveEnrichment(trimmed).catch(() => { /* optional */ });
      await chainP;
    })();
  },

  storeFrames: (snap: VolSnapshot) => {
    const state = get();
    // LIVE-only ring buffer — never seed demo frames.
    if (!state.chainAvailable || snap.surfaceSource === 'synthetic') {
      set({ historicalFrames: [], historyMode: 'live', frameIndex: 0 });
      return;
    }
    const surface = buildSurfaceGrid(snap, { wingMode: state.surfaceWingMode });
    const base = state.historyMode === 'live' ? state.historicalFrames : [];
    const frames = pushLiveFrame(base, snap, surface);
    set({
      historicalFrames: frames,
      frameIndex: Math.max(0, frames.length - 1),
      historyMode: 'live',
    });
  },

  setBoardFocus: (focus) => set({ boardFocus: focus }),

  setKeyboardBoardFocusEnabled: (on) => {
    try {
      localStorage.setItem('ui.keyboard.boardFocus', on ? '1' : '0');
    } catch { /* ignore */ }
    set({ keyboardBoardFocusEnabled: on });
  },

  setCryptoDualCharts: (on) => {
    try {
      localStorage.setItem('ui.crypto.dualCharts', on ? '1' : '0');
    } catch { /* ignore */ }
    set({ cryptoDualCharts: on });
  },

  setFALevels: (data) => set({ faLevels: data, faLevelsLoading: false }),

  setSurfaceWingMode: (mode) => {
    try {
      localStorage.setItem('ui.surface.wingMode', mode);
    } catch { /* ignore */ }
    const snap = get().snapshot;
    if (!snap || snap.surfaceSource === 'synthetic') {
      set({ surfaceWingMode: mode });
      return;
    }
    const { surface, sviReadout: readout, arbResult: arb } = processSnapshot(snap, mode);
    set({
      surfaceWingMode: mode,
      surface,
      sviReadout: readout,
      arbResult: arb,
    });
    // Refresh live history ring so playback matches current wing mode.
    const state = get();
    if (state.chainAvailable) {
      const frames = pushLiveFrame(
        state.historyMode === 'live' ? state.historicalFrames : [],
        snap,
        surface,
      );
      set({
        historicalFrames: frames,
        frameIndex: Math.max(0, frames.length - 1),
        historyMode: 'live',
      });
    }
  },

  setActiveTab: (tab) => {
    // Legacy `greeks` desk → Vol · Greeks
    if ((tab as string) === 'greeks') {
      set({
        activeTab: 'vol',
        deskSectionId: 'vol-sub-greeks',
        deskSectionLabel: 'Greeks',
        deskSectionApis: ['yfinance', 'FRED'],
        boardFocus: { boardId: null, rowIndex: 0, colKey: null },
      });
      return;
    }
    set({
      activeTab: tab,
      deskSectionId: null,
      deskSectionLabel: null,
      deskSectionApis: [],
      boardFocus: { boardId: null, rowIndex: 0, colKey: null },
    });
  },
  setDisplayMode: (mode) => set({ displayMode: mode }),
  setSelectedExpiry: (expiry) => set({ selectedExpiry: expiry }),

  setFrameIndex: (idx: number) => {
    const frames = get().historicalFrames;
    if (idx < 0 || idx >= frames.length) return;
    const frame = frames[idx]!;
    const { sviReadout: readout, arbResult: arb } = processSurface(frame.surface, frame.snapshot.spot);
    set({
      frameIndex: idx,
      snapshot: frame.snapshot,
      surface: frame.surface,
      sviReadout: readout,
      arbResult: arb,
      lastUpdate: frame.timestamp,
    });
  },

  setPlaying: (playing: boolean) => {
    const { playbackInterval } = get();
    if (playbackInterval) clearInterval(playbackInterval);
    if (playing) {
      const id = setInterval(() => {
        const s = get();
        const next = s.frameIndex + 1;
        if (next >= s.historicalFrames.length) {
          s.setPlaying(false);
          return;
        }
        s.setFrameIndex(next);
      }, REFRESH_CONFIG.PLAYBACK_INTERVAL_MS / get().speed);
      set({ playbackInterval: id, isPlaying: true });
    } else {
      set({ playbackInterval: null, isPlaying: false });
    }
  },

  togglePlay: () => {
    const s = get();
    s.setPlaying(!s.isPlaying);
  },

  setSpeed: (speed: number) => {
    set({ speed });
    const s = get();
    if (s.isPlaying) {
      s.setPlaying(true);
    }
  },

  refresh: async () => {
    const state = get();
    set({ session: usEquitySession() });

    // LIVE-only refresh — market feeds only.
    const session = usEquitySession();
    const now = Date.now();
    const spotCadence = session.isOpen
      ? REFRESH_CONFIG.LIVE_SPOT_OPEN_MS
      : REFRESH_CONFIG.LIVE_SPOT_CLOSED_MS;
    const chainCadence = session.isOpen
      ? REFRESH_CONFIG.LIVE_CHAIN_OPEN_MS
      : REFRESH_CONFIG.LIVE_CHAIN_CLOSED_MS;

    const needSpot = now - state.lastSpotUpdate >= spotCadence || state.lastSpotUpdate === 0;
    const needChain = now - state.lastChainUpdate >= chainCadence || state.lastChainUpdate === 0;

    // When SSE is connected, skip poll-based spot (stream owns lastSpotUpdate).
    if (needSpot && !state.streamConnected && state.spotSource !== 'yfinance') {
      set({ spotAttempted: true });
      const spotSym = state.symbol.toUpperCase();
      try {
        const quotes = await fetchFmpQuote(state.symbol);
        // FMP unkeyed/down → one-time yfinance quote fallback (observed delayed print).
        if ((!quotes || quotes.length === 0) && state.spotSource === 'none') {
          const info = await fetchYfInfoRaw(state.symbol);
          const price = Number(info?.lastPrice ?? NaN);
          if (Number.isFinite(price) && price > 0) {
            const prevKind = get().provenance.spot?.kind;
            const spotProv = makeProvenance('spot', 'yfinance', now, {
              previousKind: prevKind,
            });
            set({
              fmpSpot: price,
              liveAvailable: true,
              lastSpotUpdate: now,
              lastUpdate: now,
              spotSource: 'yfinance',
              provenance: { ...get().provenance, spot: spotProv },
            });
          }
          return; // yfinance fallback cadence is slower; let next cycle decide
        }
        // Drop stale poll replies (symbol switched while quote was in flight).
        if (get().symbol.toUpperCase() === spotSym && quotes && quotes.length > 0) {
          const q = quotes[0]!;
          const prevSpotKind = get().provenance.spot?.kind;
          const spotProv = makeProvenance('spot', 'fmp', now, {
            previousKind: prevSpotKind,
          });
          set({
            fmpQuote: q,
            fmpSpot: q.price,
            liveAvailable: true,
            lastSpotUpdate: now,
            lastUpdate: now,
            spotSource: 'fmp',
            provenance: { ...get().provenance, spot: spotProv },
          });
          const snap = get().snapshot;
          if (
            snap
            && snap.symbol?.toUpperCase() === spotSym
            && q.price > 0
            && Math.abs(q.price - snap.spot) / snap.spot > 0.00005
          ) {
            const { patched, processed } = perfTimeSync('store.spotPatch', () =>
              applySpotPatch(snap, q.price, now, get().surfaceWingMode),
            );
            set({
              snapshot: patched,
              surface: processed.surface,
              sviReadout: processed.sviReadout,
              arbResult: processed.arbResult,
            });
            recordSurfaceMetrics(patched, 'sticky_spot', get, set);
          }
        }
      } catch (err) {
        console.error('Spot refresh failed:', err);
      }
    }

    // Never compete with setSymbol's initial force-fetch (gen race → false "unavailable" toast).
    if (needChain && !state.loading) {
      await fetchLiveSnapshot(state.symbol, false);
      // Periodic enrichment (history/news) — cheap via cache.
      fetchLiveEnrichment(state.symbol);
    }
  },

  setChainMode: (chain: ChainMode) => {
    set({ chainMode: chain, lastChainUpdate: 0 });
    invalidateFmpCache('options/symbol');
    invalidateYfCache();
    invalidateYahooChainCache();
    invalidateDeribitCache();
    clearWarned();
    if (get().source === 'live') {
      set({ loading: true });
      liveFetchGen += 1;
      // Force a full chain rebuild for the selected API (auto/yf/fmp/deribit).
      void fetchLiveSnapshot(get().symbol, true);
    }
  },

  toggleExplainHovers: () => set((s) => ({ explainHovers: !s.explainHovers })),

  setUiDensity: (d) => {
    try {
      localStorage.setItem('ui.density', d);
    } catch { /* ignore */ }
    set({ uiDensity: d });
  },

  toggleUiDensity: () => {
    const next = get().uiDensity === 'dense' ? 'readable' : 'dense';
    get().setUiDensity(next);
  },

  setDeskContext: ({ id, label, apis }) => {
    const prev = get();
    if (
      prev.deskSectionId === id
      && prev.deskSectionLabel === label
      && JSON.stringify(prev.deskSectionApis) === JSON.stringify(apis ?? [])
    ) {
      return;
    }
    // Clear previous active mark
    if (prev.deskSectionId) {
      document.getElementById(prev.deskSectionId)?.removeAttribute('data-desk-section-active');
    }
    if (id) {
      document.getElementById(id)?.setAttribute('data-desk-section-active', '1');
    }
    set({
      deskSectionId: id,
      deskSectionLabel: label,
      deskSectionApis: apis ?? [],
    });
  },

  /**
   * Single source of truth for which desk section is active. Resolves the
   * label/apis from the section registry so the red function bar, [ ] jump
   * keys, and deep-link codes all drive one store value (no DOM .click()).
   */
  setDeskSection: (sectionId) => {
    const tab = get().activeTab;
    if (!sectionId) {
      set({ deskSectionId: null, deskSectionLabel: null, deskSectionApis: [] });
      return;
    }
    // Legacy Trade Analyze / greeks-desk → Vol · Greeks (unless this tab owns the id, e.g. Crypto Thalex lab)
    if (
      (sectionId === 'desk-ws-analyze' || sectionId === 'greeks-desk')
      && !sectionsForTab(tab).some((s) => s.id === sectionId)
    ) {
      const meta = findSectionMeta('vol-sub-greeks', 'vol');
      set({
        activeTab: 'vol',
        deskSectionId: 'vol-sub-greeks',
        deskSectionLabel: meta?.label ?? 'Greeks',
        deskSectionApis: meta?.apis ?? ['yfinance', 'FRED'],
      });
      return;
    }
    // Rates: map legacy sec-* / function codes → 4 mode ids in the red bar registry
    let resolved = sectionId;
    if (tab === 'rates') {
      const mode = RATES_SECTION_TO_MODE[sectionId];
      if (mode) resolved = `rates-mode-${mode}`;
    }
    // Flow: legacy dealer/levels/edge/strategy → Book | Tools
    if (tab === 'positioning') {
      if (
        sectionId === 'pos-sub-dealer'
        || sectionId === 'pos-sub-chain'
      ) {
        resolved = 'pos-sub-chain';
      } else if (
        sectionId === 'pos-sub-levels'
        || sectionId === 'pos-sub-edge'
        || sectionId === 'pos-sub-strategy'
        || sectionId === 'pos-sub-tools'
      ) {
        resolved = 'pos-sub-tools';
      }
    }
    if (!sectionsForTab(tab).some((s) => s.id === resolved)) {
      set({ deskSectionId: null, deskSectionLabel: null, deskSectionApis: [] });
      return;
    }
    const meta = findSectionMeta(resolved, tab);
    set({
      deskSectionId: resolved,
      deskSectionLabel: meta?.label ?? null,
      deskSectionApis: meta?.apis ?? [],
    });
  },

  setSource: async (source: 'demo' | 'live') => {
    // Terminal is LIVE-only — demo/synthetic mode is disabled.
    if (source === 'demo') {
      toast.message('LIVE only', {
        description: 'Demo/synthetic surfaces are disabled. Using market feeds.',
      });
    }
    const { refreshInterval } = get();
    if (refreshInterval) refreshInterval();
    set({ source: 'live', lastSpotUpdate: 0, lastChainUpdate: 0, loading: true });
    startRefreshLoop(get, set, 'live');
    // Non-blocking: chain first; enrichment parallel (never gate surface).
    void (async () => {
      const sym = get().symbol;
      const chainP = fetchLiveSnapshot(sym, true);
      void fetchLiveEnrichment(sym).catch(() => { /* optional */ });
      await chainP;
    })();
  },
}));

// One-time warning *per symbol* so we don't toast spam on every refresh cycle.
// Reset on symbol/chain-mode change (see setSymbol / setChainMode).
const warnedSymbols = new Set<string>();
function hasWarned(symbol: string) {
  return warnedSymbols.has(symbol.toUpperCase());
}
function markWarned(symbol: string) {
  warnedSymbols.add(symbol.toUpperCase());
}
function clearWarned() {
  warnedSymbols.clear();
}
/** Monotonic token so late async replies for a previous symbol cannot clobber state. */
let liveFetchGen = 0;

export function startRefreshLoop(
  get: () => TerminalStore,
  set: (partial: Partial<TerminalStore>) => void,
  _source: 'demo' | 'live',
) {
  const { refreshInterval } = get();
  if (refreshInterval) refreshInterval();
  const id = startVisibilityPolling(() => get().refresh(), REFRESH_CONFIG.LIVE_INTERVAL_MS, false);
  set({ refreshInterval: id });
}

async function fetchLiveSnapshot(symbol: string, force: boolean) {
  const set = useTerminalStore.setState;
  const provider = getProvider('live') as LiveProvider;
  const gen = ++liveFetchGen;
  const upper = symbol.toUpperCase();
  // A load is now in flight: freshness may read down on failure, never before.
  set({ chainAttempted: true });
  try {
    if (force) {
      invalidateYahooChainCache();
      invalidateFmpCache('options/symbol');
      invalidateDeribitCache();
      invalidateGreeksCache(upper);
    }
    perfMark('live.snapshot.start');
    const snap = await provider.getSnapshot(upper, liveSnapshotCtx(useTerminalStore.getState()));
    // Drop stale replies (user switched symbol / mode mid-flight) — but never
    // leave the desk gate spinning: the superseding fetch owns the final state,
    // and if it also dies the gate must still settle.
    if (gen !== liveFetchGen || useTerminalStore.getState().symbol !== upper) {
      set({ loading: false });
      return;
    }
    if (!snap) {
      // Fail-closed: clear sticky chain state so UI never paints old LIVE surface as current.
      const prev = useTerminalStore.getState();
      set({
        loading: false,
        chainAvailable: false,
        chainUsed: 'none',
        snapshot: null,
        surface: null,
        sviReadout: null,
        arbResult: null,
        session: usEquitySession(Date.now()),
        provenance: {
          ...prev.provenance,
          chain: makeProvenance('chain', 'none', null, {
            down: true,
            previousKind: prev.provenance.chain?.kind,
            label: 'chain:none',
          }),
        },
      });
      if (useTerminalStore.getState().activeTab !== 'crypto' && !hasWarned(upper)) {
        markWarned(upper);
        toast.warning('Live chain unavailable', {
          description:
            'No live option chain for this symbol. Equities: yfinance (delayed) / FMP if keyed · Crypto: Deribit. Fail-closed.',
        });
      }
      return;
    }
    const wingMode = useTerminalStore.getState().surfaceWingMode;
    const { surface, sviReadout: readout, arbResult: arb } = processSnapshot(snap, wingMode);
    const now = Date.now();
    const liveSpot = provider.lastSpotSource !== 'synthetic';
    const prev = useTerminalStore.getState();
    const chainOk = provider.lastChainAvailable && provider.lastChainSource !== 'synthetic';
    const spotAsOf = liveSpot
      ? (provider.lastSpotFetchedAt || now)
      : (prev.lastSpotUpdate || null);
    const chainAsOf = provider.lastChainFetchedAt || now;
    const spotProv = makeProvenance('spot', provider.lastSpotSource, spotAsOf, {
      previousKind: prev.provenance.spot?.kind,
      demo: false,
    });
    const chainProv = makeProvenance(
      'chain',
      provider.lastChainSource,
      chainAsOf,
      {
        previousKind: prev.provenance.chain?.kind,
        demo: false,
        label: chainOk ? `chain:${provider.lastChainSource}` : 'chain:none',
      },
    );
    const spotSrc = provider.lastSpotSource === 'synthetic' ? 'none' as const : provider.lastSpotSource;
    const chainSrc = provider.lastChainSource === 'synthetic' ? 'none' as const : provider.lastChainSource;
    set({
      snapshot: snap,
      surface,
      sviReadout: readout,
      arbResult: arb,
      loading: false,
      lastUpdate: now,
      lastChainUpdate: now,
      lastSpotUpdate: liveSpot ? now : prev.lastSpotUpdate,
      liveAvailable: true,
      chainAvailable: provider.lastChainAvailable,
      spotSource: spotSrc,
      chainUsed: chainSrc,
      fundingAnn: provider.lastFundingAnn ?? snap.fundingAnn ?? null,
      session: usEquitySession(now),
      provenance: {
        ...prev.provenance,
        spot: spotProv,
        chain: chainProv,
      },
      lastSurfacePath: 'full_chain',
    });
    recordSurfaceMetrics(snap, 'full_chain', () => useTerminalStore.getState(), set);
    useTerminalStore.getState().storeFrames(snap);

    // Warm Greeks pack in background (same underlier). Vol · GRK must not re-pull
    // a cold yfinance book after chain already painted.
    if (chainOk) {
      prefetchGreeks(upper, Number.isFinite(snap.dividendYield) ? snap.dividendYield : null);
    }

    if (useTerminalStore.getState().activeTab !== 'crypto' && !provider.lastChainAvailable && !hasWarned(upper)) {
      markWarned(upper);
      toast.warning('Live chain unavailable', {
        description:
          'Equity chain: yfinance (delayed) / FMP if keyed failed. Crypto: Deribit. No synthetic chain shown.',
      });
    }
  } catch (err) {
    // A superseded fetch still clears a stuck gate; the live fetch owns the rest.
    if (gen !== liveFetchGen) {
      set({ loading: false });
      return;
    }
    console.error('Failed to fetch live snapshot:', err);
    if (useTerminalStore.getState().activeTab !== 'crypto') {
      toast.error('Live fetch failed', {
        description: err instanceof Error ? err.message : 'Could not retrieve options data',
      });
    }
    const prev = useTerminalStore.getState();
    set({
      loading: false,
      chainAvailable: false,
      chainUsed: 'none',
      snapshot: null,
      surface: null,
      sviReadout: null,
      arbResult: null,
      provenance: {
        ...prev.provenance,
        chain: makeProvenance('chain', 'none', null, {
          down: true,
          previousKind: prev.provenance.chain?.kind,
          label: 'chain:error',
        }),
      },
    });
  }
}

/**
 * Fetch the cross-cutting FMP market data (spot quote, price history, profile,
 * news, earnings, treasury) and push it into the store. All reads go through
 * the cached fmpClient, so repeated calls are cheap once values are warm.
 */
async function fetchLiveEnrichment(symbol: string) {
  const set = useTerminalStore.setState;
  set({ spotAttempted: true });
  const upper = symbol.toUpperCase();
  // Capture gen at start — late enrichment must not clobber a newer symbol/chain.
  const gen = liveFetchGen;
  const isBtcEth = upper === 'BTC' || upper === 'ETH';
  const histSymbol = upper === 'BTC' ? 'BTC-USD' : upper === 'ETH' ? 'ETH-USD' : symbol;

  // Parallel free-tier enrichment — never serial waterfall (was multi-second before chain).
  const [quotes, fmpHist, yfHist, fmpProf, yfProf, news, earnings, treasury] = await Promise.all([
    isBtcEth ? Promise.resolve(null) : fetchFmpQuote(symbol).catch(() => null),
    isBtcEth ? Promise.resolve(null) : fetchFmpPriceHistory(symbol).catch(() => null),
    fetchYfHistory(histSymbol).catch(() => null),
    fetchFmpProfile(symbol).catch(() => null),
    fetchYfInfo(symbol).catch(() => null),
    fetchFmpNews(symbol).catch(() => null),
    fetchFmpEarnings(symbol).catch(() => null),
    useTerminalStore.getState().fmpTreasuryRates
      ? Promise.resolve(null)
      : fetchFmpTreasuryRates().catch(() => null),
  ]);

  if (gen !== liveFetchGen || useTerminalStore.getState().symbol.toUpperCase() !== upper) {
    return;
  }

  if (quotes && quotes.length > 0) {
    const t = Date.now();
    const prev = useTerminalStore.getState();
    set({
      fmpQuote: quotes[0]!,
      fmpSpot: quotes[0]!.price,
      liveAvailable: true,
      lastSpotUpdate: t,
      spotSource: 'fmp',
      provenance: {
        ...prev.provenance,
        spot: makeProvenance('spot', 'fmp', t, { previousKind: prev.provenance.spot?.kind }),
      },
    });
  }

  if (fmpHist && fmpHist.length > 0) {
    set({ fmpHistory: fmpHist, historySource: 'fmp' });
  } else if (yfHist && yfHist.length > 0) {
    set({ fmpHistory: yfHist, historySource: 'yfinance' });
  } else {
    set({ fmpHistory: null, historySource: 'none' });
  }

  if (fmpProf) {
    set({ fmpProfile: fmpProf, profileSource: 'fmp' });
  } else if (yfProf) {
    set({ fmpProfile: yfProf, profileSource: 'yfinance' });
  } else {
    set({ fmpProfile: null, profileSource: 'none' });
  }

  if (news) set({ fmpNews: news });
  if (earnings) set({ fmpEarnings: earnings });

  if (treasury && treasury.length > 0) {
    const y1 = treasury[0]!.year1;
    set({ fmpTreasuryRates: treasury, liveRFR: y1 > 1 ? y1 / 100 : y1 });
  }
}
