/**
 * useDeribitFutures — instruments + bulk tickers + index → basis rows.
 * useDeribitFundingHistory — perp funding-rate history (8h + annualized).
 *
 * Data comes from our canonical /api/v1 crypto market contracts (Deribit
 * public API, server-cached). Fail-closed: on upstream failure the hook keeps the
 * last good rows and surfaces `error` + `stale`; it never fabricates values.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchFundingHistory,
  fetchIndexPrice,
  fetchTickers,
  listFutures,
  type DeribitCurrency,
  type DeribitFutureInstrument,
  type DeribitFutureTicker,
  type DeribitFundingHistoryBundle,
} from '../lib/data/deribitFutures';
import { buildBasisRows, type BasisRow } from '../lib/data/futuresMath';
import { startVisibilityPolling } from '../lib/polling/visibilityPolling';

export interface UseDeribitFuturesResult {
  currency: DeribitCurrency;
  /** True only until the first snapshot for this currency lands. */
  loading: boolean;
  error: string | null;
  /** True when the latest refresh failed but prior rows are still shown. */
  stale: boolean;
  indexPrice: number | null;
  rows: BasisRow[];
  asOf: number | null;
  refresh: () => void;
}

const DEFAULT_REFRESH_MS = 20_000;

/**
 * Polls instruments + tickers + index and derives basis rows (premium/APR math
 * lives in futuresMath.ts so it stays unit-testable without a DOM).
 */
export function useDeribitFutures(
  currency: DeribitCurrency,
  opts?: { refreshMs?: number },
): UseDeribitFuturesResult {
  const refreshMs = Math.max(5_000, opts?.refreshMs ?? DEFAULT_REFRESH_MS);

  const [instruments, setInstruments] = useState<DeribitFutureInstrument[] | null>(null);
  const [tickers, setTickers] = useState<Record<string, DeribitFutureTicker> | null>(null);
  const [indexPrice, setIndexPrice] = useState<number | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  // Tracks whether ANY successful snapshot has landed for the current currency
  // so an interval-refresh failure renders as `stale`, not as a cold loading.
  const hadDataRef = useRef(false);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    hadDataRef.current = false;
    setLoading(true);
    setError(null);
    setInstruments(null);
    setTickers(null);
    setIndexPrice(null);
    setAsOf(null);

    const load = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const [inst, tk, idx] = await Promise.all([
        listFutures(currency),
        fetchTickers(currency),
        fetchIndexPrice(currency),
      ]);
      if (cancelled) return;
      const gotAny = inst != null || tk != null || idx != null;
      if (gotAny) {
        hadDataRef.current = true;
        if (inst) setInstruments(inst);
        if (tk) setTickers(tk);
        if (idx) setIndexPrice(idx.index_price);
        setAsOf(Date.now());
        setError(null);
      } else {
        setError('Deribit futures data unavailable');
      }
      setLoading(false);
    };

    const initiallyHidden = typeof document !== 'undefined' && document.hidden;
    if (initiallyHidden) setLoading(false);
    const stop = startVisibilityPolling(load, refreshMs, !initiallyHidden);
    return () => { cancelled = true; stop(); };
  }, [currency, nonce, refreshMs]);

  const rows = useMemo(() => {
    if (!instruments || !tickers) return [] as BasisRow[];
    return buildBasisRows({
      instruments,
      tickers,
      indexPrice,
      nowMs: asOf ?? Date.now(),
    });
  }, [instruments, tickers, indexPrice, asOf]);

  return {
    currency,
    loading: loading && !hadDataRef.current,
    error,
    stale: error != null && rows.length > 0,
    indexPrice,
    rows,
    asOf,
    refresh,
  };
}

// ── Funding history ──────────────────────────────────────────────────────────

export interface UseDeribitFundingHistoryResult {
  currency: DeribitCurrency;
  instrumentName: string;
  days: 1 | 7 | 30 | 90;
  loading: boolean;
  error: string | null;
  bundle: DeribitFundingHistoryBundle | null;
  asOf: number | null;
  refresh: () => void;
}

/** Perp funding history via public/get_funding_rate_history (hourly points). */
export function useDeribitFundingHistory(params?: {
  currency?: DeribitCurrency;
  days?: 1 | 7 | 30 | 90;
  refreshMs?: number;
}): UseDeribitFundingHistoryResult {
  const currency = params?.currency ?? 'BTC';
  const days = params?.days ?? 7;
  const refreshMs = Math.max(30_000, params?.refreshMs ?? 90_000);
  const instrumentName = `${currency}-PERPETUAL`;

  const [bundle, setBundle] = useState<DeribitFundingHistoryBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBundle(null);

    const load = async () => {
      if (typeof document !== 'undefined' && document.hidden) {
        setLoading(false);
        return;
      }
      const data = await fetchFundingHistory(instrumentName, days);
      if (cancelled) return;
      if (!data || data.points.length === 0) {
        setError(`Deribit funding history unavailable (${instrumentName}, ${days}d)`);
      } else {
        setBundle(data);
      }
      setLoading(false);
    };
    const initiallyHidden = typeof document !== 'undefined' && document.hidden;
    if (initiallyHidden) setLoading(false);
    const stop = startVisibilityPolling(load, refreshMs, !initiallyHidden);
    return () => { cancelled = true; stop(); };
  }, [instrumentName, days, nonce, refreshMs]);

  return {
    currency,
    instrumentName,
    days,
    loading,
    error,
    bundle,
    asOf: bundle?.fetchedAt ?? null,
    refresh,
  };
}
