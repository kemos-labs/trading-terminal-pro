/**
 * DataProvider — single seam for swapping the volatility data source.
 *
 * DemoProvider generates a realistic synthetic SVI surface (offline / explicit DEMO).
 * LiveProvider fetches real quotes from FMP, yfinance proxy, and/or Deribit.
 *
 * LIVE is fail-closed: if no real option chain is available, getSnapshot returns
 * null (it does NOT inject synthetic IVs/OI). The store shows an empty/error
 * state so traders never mistake demo smiles for market data.
 */

import type { VolSnapshot, SurfaceGrid } from '../options/types';
import { buildSnapshot, presetFor, generateHistory } from '../options/synthetic';
import { buildYahooSnapshot, fetchYahooSnapshot, type YahooRawOption, type YahooResponse } from '../options/yahoo';
import { normalizeFmp } from '../options/fmp';
import { fmpGet, fetchFmpOptions } from '../data/fmpClient';
import { fetchYfHistory, fetchYfInfo } from '../data/yfinanceClient';
import { DATA_CONFIG } from '../../config/constants';
import type { FmpQuote, FmpOptionsResponse } from '../data/types';
import { estimateDividendYield, termRiskFreeRate } from '../options/marketParams';
import type { FmpTreasuryRate, FmpProfile } from '../data/types';
import { isCryptoSymbol, resolveCryptoUnderlyings } from '../options/basis';
import { deribitCurrencyFromSymbol, fetchDeribitMarket } from '../data/deribitClient';
import { buildDeribitSnapshot } from '../options/deribit';

export type Source = 'demo' | 'live';
export type ChainMode = 'auto' | 'fmp' | 'yfinance' | 'deribit';
export type ChainSource = 'fmp' | 'yfinance' | 'deribit' | 'synthetic';

export interface SnapshotContext {
  /** Risk-free rate (decimal) used by the live solver. */
  rfr?: number;
  /** Full treasury curve for term-matched rates (preferred over flat rfr). */
  treasury?: FmpTreasuryRate | FmpTreasuryRate[] | null;
  /** Override spot; falls back to the symbol preset. */
  spot?: number;
  /** Dividend yield override (decimal). */
  dividendYield?: number;
  /** Profile used to estimate dividend yield when override absent. */
  profile?: FmpProfile | null;
  /** Small random spot jitter applied in demo mode to simulate live ticks. */
  jitter?: number;
  /** Number of historical playback frames to backfill (demo only). */
  historyFrames?: number;
  /** Which source to use for the option chain (live mode only). */
  chainMode?: ChainMode;
}

export interface DataProvider {
  readonly id: Source;
  getSnapshot(symbol: string, ctx?: SnapshotContext): Promise<VolSnapshot | null>;
  /** Synthetic playback history (only meaningful for the demo provider). */
  getHistory?(symbol: string, frames?: number): { snapshot: VolSnapshot; surface: SurfaceGrid; timestamp: number }[];
}

/** Tick quote for future streaming adapters (OPRA / SSE). Snapshot-only this slice. */
export interface QuoteTick {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  size?: number;
  ts: number;
  source: 'opra' | 'yfinance' | 'fmp' | 'deribit' | 'synthetic';
}

/**
 * Optional streaming capability on the DataProvider seam.
 * LiveProvider may implement later; Demo never streams.
 * Delta / ChainDiff apply is future-only — ship snapshot path only.
 */
export interface StreamingDataProvider extends DataProvider {
  readonly supportsStreaming: boolean;
  connect?(symbol: string): Promise<void>;
  disconnect?(): void;
  onQuote?(cb: (t: QuoteTick) => void): () => void;
  /** Snapshot-only for this horizon; delta mode is future. */
  onChainSnapshot?(cb: (snap: VolSnapshot) => void): () => void;
}

/** Future only — do not implement delta-apply in this slice. */
export interface ChainDiff {
  symbol: string;
  mode: 'snapshot' | 'delta';
  asOfMs: number;
}

export function isStreamingProvider(p: DataProvider): p is StreamingDataProvider {
  return 'supportsStreaming' in p && (p as StreamingDataProvider).supportsStreaming === true;
}

/**
 * Thin HTTP snapshot transport helper (optional).
 * Store continues to use getProvider() only — this does not fork the seam.
 */
export class HttpSnapshotTransport {
  private readonly baseFetch: typeof fetch;

  constructor(baseFetch: typeof fetch = fetch.bind(globalThis)) {
    this.baseFetch = baseFetch;
  }

  async getJson<T>(url: string, init?: RequestInit): Promise<T | null> {
    try {
      const res = await this.baseFetch(url, init);
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }
}

export class DemoProvider implements DataProvider {
  readonly id = 'demo' as const;

  async getSnapshot(symbol: string, ctx: SnapshotContext = {}): Promise<VolSnapshot | null> {
    const defSpot = ctx.spot ?? presetFor(symbol)?.spot ?? DATA_CONFIG.SYMBOL_PRESETS.SPY.spot;
    return buildSnapshot(symbol, Date.now(), defSpot, 0, ctx.jitter ?? 0);
  }

  /** Synthetic playback history (used regardless of live/demo for the scrubber). */
  getHistory(symbol: string, frames = 64) {
    return generateHistory(symbol, frames);
  }
}

export class LiveProvider implements DataProvider {
  readonly id = 'live' as const;

  /** Whether the last snapshot used a REAL option chain (vs synthetic fallback). */
  lastChainAvailable = false;
  /** Which source actually provided the chain for the last snapshot. */
  lastChainSource: ChainSource = 'synthetic';
  /** Where the spot price came from for the last snapshot. */
  lastSpotSource: 'fmp' | 'yfinance' | 'deribit' | 'synthetic' = 'synthetic';
  /** Epoch ms when the last chain payload was obtained (best-effort). */
  lastChainFetchedAt = 0;
  /** Epoch ms when the last spot quote was obtained. */
  lastSpotFetchedAt = 0;
  /** Last Deribit annualized funding (crypto only). */
  lastFundingAnn: number | null = null;

  /** Accept a chain only when it has usable expiries (not empty shells). */
  private acceptChain(snap: VolSnapshot | null): boolean {
    return !!snap && Array.isArray(snap.expiries) && snap.expiries.length > 0
      && snap.expiries.some((e) => e.calls.length + e.puts.length > 0);
  }

  async getSnapshot(symbol: string, ctx: SnapshotContext = {}): Promise<VolSnapshot | null> {
    const crypto = isCryptoSymbol(symbol);
    const deribitCcy = deribitCurrencyFromSymbol(symbol);
    const under = crypto ? resolveCryptoUnderlyings(symbol) : null;
    // BTC/ETH: no dividend; ETF proxies (IBIT) may still pay 0.
    const q = crypto || deribitCcy
      ? (ctx.dividendYield ?? 0)
      : (ctx.dividendYield ?? estimateDividendYield(symbol, ctx.profile, ctx.spot));
    // Flat seed r (~30d); per-tenor r(T) is applied inside the chain build.
    const r = ctx.treasury
      ? termRiskFreeRate(ctx.treasury, 30 / 365)
      : (ctx.rfr ?? DATA_CONFIG.market.RISK_FREE_RATE);
    const rateForT = ctx.treasury
      ? (T: number) => termRiskFreeRate(ctx.treasury, T)
      : undefined;
    const chainMode = ctx.chainMode ?? 'auto';
    const buildOpts = { rateForT, useParityDividend: !(crypto || deribitCcy) as boolean };

    // ── Pure BTC / ETH: Deribit public options (auto + explicit) ──────────
    if (deribitCcy && (chainMode === 'auto' || chainMode === 'deribit')) {
      try {
        const market = await fetchDeribitMarket(deribitCcy);
        if (market) {
          const built = buildDeribitSnapshot(market, { r, q: 0, maxExpiries: 12 });
          if (built && this.acceptChain(built)) {
            this.lastChainAvailable = true;
            this.lastChainSource = 'deribit';
            this.lastSpotSource = 'deribit';
            this.lastChainFetchedAt = market.fetchedAt;
            this.lastSpotFetchedAt = market.fetchedAt;
            this.lastFundingAnn = market.fundingAnn;
            return {
              ...built,
              symbol: symbol.toUpperCase(),
              riskFreeRate: r,
              dividendYield: 0,
            };
          }
        }
      } catch (err) {
        console.warn('Deribit chain failed, falling back:', err);
      }
      // Fall through: synthetic crypto smile + any available spot
    }

    // Chain-critical spot: concurrent optional fetch — never block chain on spot/profile/history.
    let spot: number | null = ctx.spot ?? null;
    let spotSource: 'fmp' | 'yfinance' | 'deribit' | 'synthetic' = ctx.spot != null ? 'fmp' : 'synthetic';
    if (ctx.spot != null) this.lastSpotFetchedAt = Date.now();
    const spotPromise: Promise<{ price: number; source: 'fmp' | 'yfinance' } | null> = (async () => {
      if (ctx.spot != null) return null;
      const fmpSym = under?.label === 'BTC' || under?.label === 'ETH' ? under.spotSymbol.replace('-', '') : symbol;
      try {
        const quoteRes = await fmpGet(`quote?symbol=${encodeURIComponent(fmpSym)}`, { ttl: 12_000 });
        if (quoteRes.json) {
          const arr = quoteRes.json as FmpQuote[];
          if (arr.length > 0 && isFinite(arr[0]!.price) && arr[0]!.price > 0) return { price: arr[0]!.price, source: 'fmp' as const };
        }
      } catch { /* optional */ }
      try {
        const yfSym = under?.spotSymbol ?? symbol;
        const hist = await fetchYfHistory(yfSym, 60_000);
        if (hist && hist.length > 0) {
          const last = hist[hist.length - 1]!;
          if (last.close > 0) return { price: last.close, source: 'yfinance' as const };
        }
      } catch { /* optional */ }
      if (under) { try { await fetchYfInfo(under.spotSymbol, 60_000); } catch { /* optional */ } }
      return null;
    })();
    void spotPromise.catch(() => null);

    let snap: VolSnapshot | null = null;
    let chainOk = false;
    let chainUsed: ChainSource = 'synthetic';

    // Equity / ETF proxy chains (AAPL, QQQ, SPY, IBIT, …)
    // Forced deribit on equities is a no-op (already handled above for BTC/ETH).
    const chainSymbol = deribitCcy
      ? null
      : (under?.chainSymbol ?? symbol);

    const buildFromFmp = async (sym: string, spotVal: number | null): Promise<VolSnapshot | null> => {
      const raw = await fetchFmpOptions(sym);
      if (!raw) return null;
      const quotes: YahooRawOption[] = normalizeFmp(raw as FmpOptionsResponse);
      if (quotes.length < 5) return null;
      if (spotVal == null || !isFinite(spotVal) || spotVal <= 0) return null;
      const data: YahooResponse = {
        symbol: sym,
        spot: spotVal,
        expirations: [...new Set(quotes.map((x) => x.expiry))],
        quotes,
        timestamp: Date.now(),
      };
      const built = buildYahooSnapshot(data, r, q, { maxExpiries: 12, ...buildOpts });
      return this.acceptChain(built) ? built : null;
    };

    const buildFromYf = async (sym: string): Promise<VolSnapshot | null> => {
      // Prefer chain spot when FMP/YF history is cold — keeps IV inversion consistent.
      const built = await fetchYahooSnapshot(sym, 12, r, q, buildOpts);
      return this.acceptChain(built) ? built : null;
    };

    if (chainSymbol) {
      if (chainMode === 'fmp') {
        if (spot == null) {
          const sp = await spotPromise;
          if (sp && sp.price > 0) { spot = sp.price; spotSource = sp.source; this.lastSpotFetchedAt = Date.now(); }
        }
        snap = await buildFromFmp(chainSymbol, spot);
        if (snap) { chainOk = true; chainUsed = 'fmp'; this.lastChainFetchedAt = Date.now(); }
      } else if (chainMode === 'yfinance') {
        snap = await buildFromYf(chainSymbol);
        if (snap) { chainOk = true; chainUsed = 'yfinance'; this.lastChainFetchedAt = Date.now(); }
      } else if (chainMode === 'deribit') {
        // Non-crypto: nothing to do — synthetic fallback below.
      } else {
        // auto: yfinance chain starts immediately without awaiting optional spot; FMP fallback awaits spot only on yfinance miss.
        snap = await buildFromYf(chainSymbol);
        if (snap) {
          chainOk = true;
          chainUsed = 'yfinance';
          this.lastChainFetchedAt = Date.now();
        } else {
          if (spot == null) {
            const sp = await spotPromise;
            if (sp && sp.price > 0) { spot = sp.price; spotSource = sp.source; this.lastSpotFetchedAt = Date.now(); }
          }
          snap = await buildFromFmp(chainSymbol, spot);
          if (snap) { chainOk = true; chainUsed = 'fmp'; this.lastChainFetchedAt = Date.now(); }
        }
      }
    }

    // Adopt optional spot if still null — direct await without immediate-null race.
    if (spot == null) {
      const sp = await spotPromise;
      if (sp && sp.price > 0) { spot = sp.price; spotSource = sp.source; this.lastSpotFetchedAt = Date.now(); }
    }
    // Prefer market spot from the options payload when our spot is still synthetic.
    if (snap && spot == null && snap.spot > 0) {
      spot = snap.spot;
      spotSource = chainUsed === 'yfinance' ? 'yfinance' : spotSource;
      this.lastSpotFetchedAt = Date.now();
    }
    this.lastSpotSource = spotSource;

    this.lastChainAvailable = chainOk;
    this.lastChainSource = chainUsed;
    this.lastFundingAnn = null;

    // Fail-closed: never inject a synthetic smile under LIVE.
    if (!(snap && chainOk)) {
      this.lastChainAvailable = false;
      this.lastChainSource = 'synthetic';
      this.lastFundingAnn = null;
      return null;
    }

    // Patch spot from FMP/YF quote so surface aligns with the live print,
    // but keep the chain IVs from the options feed.
    let result: VolSnapshot = {
      ...snap,
      spot: spot != null && !crypto ? spot : snap.spot,
      surfaceSource: 'live',
    };

    if (crypto || deribitCcy) {
      result = { ...result, symbol: symbol.toUpperCase() };
    }

    return result;
  }
}

const providers: Record<Source, DataProvider> = {
  demo: new DemoProvider(),
  live: new LiveProvider(),
};

export function getProvider(source: Source): DataProvider {
  return providers[source];
}
