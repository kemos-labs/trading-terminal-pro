/**
 * Hook-local dual BTC/ETH books — shared Deribit cache, half-rate inactive.
 * CoinGecko spot fills tape when Deribit index fails (fail-closed, no demo).
 * Active book remains store + LiveProvider via setSymbol.
 */
import { useEffect, useRef, useState } from 'react';
import { fetchDeribitMarket, type DeribitMarketBundle } from '../lib/data/deribitClient';
import { buildDeribitSnapshot } from '../lib/options/deribit';
import type { VolSnapshot } from '../lib/options/types';
import { makeProvenance, type DataProvenance } from '../lib/data/freshness';
import { useTerminalStore } from '../store/terminalStore';
import { macrovolApi, type CryptoSpotAsset, type CryptoSpotData } from '../lib/macrovol/api';
import { startVisibilityPolling } from '../lib/polling/visibilityPolling';

export type DualTapeSnap = {
  ccy: 'BTC' | 'ETH';
  spot: number | null;
  fundingAnn: number | null;
  optionCount: number;
  /** Nearest-to-30D ATM mark IV, normalized to decimal. */
  atmIv30d: number | null;
  totalOpenInterest: number | null;
  volume24h: number | null;
  asOf: number;
  ok: boolean;
  /** Spot source: Deribit index when live; CoinGecko when Deribit down */
  spotSource?: 'deribit' | 'coingecko' | null;
  change24hPct?: number | null;
  marketCapUsd?: number | null;
  /** Deribit index − CoinGecko in bps of spot (when both live) */
  basisBps?: number | null;
};

export type CryptoBookState = {
  ccy: 'BTC' | 'ETH';
  market: DeribitMarketBundle | null;
  snapshot: VolSnapshot | null;
  asOf: number;
  provenance: DataProvenance | null;
};

const ACTIVE_MS = 30_000;
const INACTIVE_MS = 60_000;
const GECKO_MS = 60_000;

/** Half-rate refresh decision for the inactive currency (full rate when active). */
export function shouldFetchCcy(
  ccyActive: boolean,
  lastFetch: number,
  now: number,
  force = false,
): boolean {
  return force || ccyActive || now - lastFetch >= INACTIVE_MS;
}

function geckoAsset(ccy: 'BTC' | 'ETH', g: CryptoSpotData | null): CryptoSpotAsset | null {
  if (!g) return null;
  const row = ccy === 'BTC' ? g.btc : g.eth;
  return row ?? g.assets?.find((a) => a.symbol === ccy) ?? null;
}

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

function optionExpiryMs(instrument: string): number | null {
  const match = instrument.match(/^[A-Z]+-(\d{1,2})([A-Z]{3})(\d{2})-/);
  if (!match) return null;
  const month = MONTHS[match[2]!];
  if (month == null) return null;
  const ms = Date.UTC(2000 + Number(match[3]), month, Number(match[1]), 8);
  return Number.isFinite(ms) ? ms : null;
}

/** Lightweight market summary for the always-on dual tape (no snapshot rebuild). */
export function summarizeDeribitTape(m: DeribitMarketBundle): {
  atmIv30d: number | null;
  totalOpenInterest: number;
  volume24h: number;
} {
  const now = m.fetchedAt || Date.now();
  const rows = m.options.map((row) => {
    const parts = row.instrument_name.split('-');
    return { row, expiryMs: optionExpiryMs(row.instrument_name), strike: Number(parts[2]) };
  }).filter((x) => x.expiryMs != null && Number.isFinite(x.strike));
  const expiries = [...new Set(rows.map((x) => x.expiryMs!))];
  const target = expiries.reduce<number | null>((best, expiry) => {
    const distance = Math.abs((expiry - now) / 86_400_000 - 30);
    if (best == null) return expiry;
    return distance < Math.abs((best - now) / 86_400_000 - 30) ? expiry : best;
  }, null);
  const nearest = target == null ? [] : rows
    .filter((x) => x.expiryMs === target && x.row.mark_iv != null && x.row.mark_iv > 0)
    .sort((a, b) => Math.abs(a.strike - m.indexPrice) - Math.abs(b.strike - m.indexPrice))
    .slice(0, 2);
  const rawIv = nearest.length
    ? nearest.reduce((sum, x) => sum + (x.row.mark_iv ?? 0), 0) / nearest.length
    : null;
  return {
    atmIv30d: rawIv == null ? null : rawIv > 3 ? rawIv / 100 : rawIv,
    totalOpenInterest: m.options.reduce((sum, row) => sum + (row.open_interest ?? 0), 0),
    volume24h: m.options.reduce((sum, row) => sum + (row.volume ?? 0), 0),
  };
}

function toTape(
  ccy: 'BTC' | 'ETH',
  m: DeribitMarketBundle | null,
  g: CryptoSpotData | null,
): DualTapeSnap {
  if (m?.indexPrice != null && Number.isFinite(m.indexPrice)) {
    const ga = geckoAsset(ccy, g);
    const summary = summarizeDeribitTape(m);
    let basisBps: number | null = null;
    if (ga?.spot_usd != null && ga.spot_usd > 0) {
      basisBps = ((m.indexPrice - ga.spot_usd) / ga.spot_usd) * 10_000;
    }
    return {
      ccy,
      spot: m.indexPrice,
      fundingAnn: m.fundingAnn,
      optionCount: m.options?.length ?? 0,
      atmIv30d: summary.atmIv30d,
      totalOpenInterest: summary.totalOpenInterest,
      volume24h: summary.volume24h,
      asOf: m.fetchedAt,
      ok: true,
      spotSource: 'deribit',
      change24hPct: ga?.change_24h_pct ?? null,
      marketCapUsd: ga?.market_cap_usd ?? null,
      basisBps,
    };
  }
  // Deribit down — CoinGecko spot backup
  const ga = geckoAsset(ccy, g);
  if (ga?.spot_usd != null && Number.isFinite(ga.spot_usd)) {
    return {
      ccy,
      spot: ga.spot_usd,
      fundingAnn: null,
      optionCount: 0,
      atmIv30d: null,
      totalOpenInterest: null,
      volume24h: null,
      asOf: ga.last_updated_at ? ga.last_updated_at * 1000 : (g?.as_of_ms ?? Date.now()),
      ok: true,
      spotSource: 'coingecko',
      change24hPct: ga.change_24h_pct ?? null,
      marketCapUsd: ga.market_cap_usd ?? null,
      basisBps: null,
    };
  }
  return {
    ccy,
    spot: null,
    fundingAnn: null,
    optionCount: 0,
    atmIv30d: null,
    totalOpenInterest: null,
    volume24h: null,
    asOf: Date.now(),
    ok: false,
    spotSource: null,
    basisBps: null,
  };
}

/** Keep the prior tape (incl. Deribit spot/IV) and refresh only gecko meta. */
function overlayGecko(prev: DualTapeSnap, g: CryptoSpotData | null): DualTapeSnap {
  const ga = geckoAsset(prev.ccy, g);
  return {
    ...prev,
    change24hPct: ga?.change_24h_pct ?? prev.change24hPct,
    marketCapUsd: ga?.market_cap_usd ?? prev.marketCapUsd,
  };
}

export function useCryptoDualBooks(opts?: { dualCharts?: boolean }) {
  const dualCharts = opts?.dualCharts ?? false;
  const symbol = useTerminalStore((s) => s.symbol);
  const storeSnap = useTerminalStore((s) => s.snapshot);
  const active: 'BTC' | 'ETH' = symbol === 'ETH' ? 'ETH' : 'BTC';

  const [tape, setTape] = useState<{ btc: DualTapeSnap | null; eth: DualTapeSnap | null }>({
    btc: null,
    eth: null,
  });
  const [books, setBooks] = useState<{
    btc: CryptoBookState | null;
    eth: CryptoBookState | null;
  }>({ btc: null, eth: null });
  const [gecko, setGecko] = useState<CryptoSpotData | null>(null);

  const lastBtcFetch = useRef(0);
  const lastEthFetch = useRef(0);
  const lastGeckoFetch = useRef(0);
  const geckoRef = useRef<CryptoSpotData | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Snapshot active ccy + store snapshot once: the interval must not capture
    // a stale `active`/`storeSnap` from an earlier render.
    const activeAtStart: 'BTC' | 'ETH' = active;
    const storeSnapAtStart = storeSnap;

    const load = async (force: boolean) => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const now = Date.now();
      const lastFetch = { btc: lastBtcFetch.current, eth: lastEthFetch.current };
      const needGecko = force || now - lastGeckoFetch.current >= GECKO_MS;
      const fetchBtc = shouldFetchCcy(activeAtStart === 'BTC', lastFetch.btc, now, force);
      const fetchEth = shouldFetchCcy(activeAtStart === 'ETH', lastFetch.eth, now, force);

      const [btcM, ethM, geckoRes] = await Promise.all([
        fetchBtc ? fetchDeribitMarket('BTC').catch(() => null) : Promise.resolve(null),
        fetchEth ? fetchDeribitMarket('ETH').catch(() => null) : Promise.resolve(null),
        needGecko
          ? macrovolApi.cryptoSpot().catch(() => null)
          : Promise.resolve(null),
      ]);

      if (cancelled) return;

      if (geckoRes && !geckoRes.error) {
        geckoRef.current = geckoRes;
        setGecko(geckoRes);
        lastGeckoFetch.current = now;
      }
      const g = geckoRef.current;

      // Active ccy refreshes every cycle; inactive refreshes half-rate and
      // keeps its prior Deribit tape between refreshes (gecko meta overlaid).
      setTape((prev) => ({
        btc: fetchBtc || !prev.btc
          ? toTape('BTC', btcM, g)
          : overlayGecko(prev.btc, g),
        eth: fetchEth || !prev.eth
          ? toTape('ETH', ethM, g)
          : overlayGecko(prev.eth, g),
      }));

      if (fetchBtc) lastBtcFetch.current = now;
      if (fetchEth) lastEthFetch.current = now;

      if (dualCharts) {
        const thin = { r: 0.04, q: 0, maxExpiries: 8 };
        const build = (ccy: 'BTC' | 'ETH', m: DeribitMarketBundle | null): CryptoBookState => {
          if (!m) {
            return {
              ccy,
              market: null,
              snapshot: null,
              asOf: Date.now(),
              provenance: makeProvenance('crypto', 'deribit', null, { down: true }),
            };
          }
          const snap =
            ccy === activeAtStart && storeSnapAtStart?.symbol === ccy
              ? storeSnapAtStart
              : buildDeribitSnapshot(m, thin);
          return {
            ccy,
            market: m,
            snapshot: snap ?? null,
            asOf: m.fetchedAt,
            provenance: makeProvenance('crypto', 'deribit', m.fetchedAt),
          };
        };
        setBooks((prev) => ({
          btc: fetchBtc
            ? build('BTC', btcM ?? prev.btc?.market ?? null)
            : prev.btc,
          eth: fetchEth
            ? build('ETH', ethM ?? prev.eth?.market ?? null)
            : prev.eth,
        }));
      }
    };

    void load(true);
    const stop = startVisibilityPolling(() => load(false), ACTIVE_MS, false);
    return () => {
      cancelled = true;
      stop();
    };
  }, [active, dualCharts, storeSnap]);

  return { tape, books, active, gecko };
}
