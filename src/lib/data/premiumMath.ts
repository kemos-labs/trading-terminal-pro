/**
 * Premium-matrix + option-scanner math over the live Deribit chain snapshot.
 *
 * Pure functions only — no React, no fetch. The input is structurally the
 * terminal's `VolSnapshot` (spot + expiries of call/put `OptionQuote`s), so
 * views can pass the store snapshot directly.
 *
 * Mark price: the crypto snapshot builder (`lib/options/deribit.ts`) already
 * converts coin-denominated prices to USD and prefers the exchange
 * `mark_price` when `mid_price` is absent, so `OptionQuote.mid` is the USD
 * mark proxy. Standing dollar premium = mark × open interest (Deribit
 * contracts are 1 coin, OI in contracts).
 *
 * Fail-closed: any value that cannot be computed from live data is `null`,
 * never a silent zero.
 */
import type { OptionQuote } from '../options/types';

export type PremiumSide = 'both' | 'calls' | 'puts';

/** Minimal chain shape — satisfied by VolSnapshot. */
export interface PremiumChain {
  spot: number;
  expiries: ReadonlyArray<{
    expiry: string;
    dte?: number;
    calls: ReadonlyArray<OptionQuote>;
    puts: ReadonlyArray<OptionQuote>;
  }>;
}

/** One strike × expiry cell. `null` = no usable data, rendered as "—". */
export interface PremiumCell {
  strike: number;
  expiry: string;
  callPremium: number | null;
  putPremium: number | null;
  /** Side-filtered standing premium for this cell (USD). */
  premium: number | null;
}

export interface PremiumMatrixResult {
  /** Visible strikes, descending (highest first), ATM nearest spot. */
  strikes: number[];
  /** Visible expiries, ascending DTE. */
  expiries: string[];
  atmStrike: number | null;
  /** cells[strikeIdx][expiryIdx]. */
  cells: PremiumCell[][];
  /** Σ per strike row across the visible window; null when every cell is null. */
  rowTotals: (number | null)[];
  /** Σ per expiry column across the visible window; null when every cell is null. */
  colTotals: (number | null)[];
  grandTotal: number | null;
  side: PremiumSide;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** USD mark price proxy: mid preferred, last as fallback, else null. */
export function markPriceUsd(q: Pick<OptionQuote, 'mid' | 'last'>): number | null {
  if (finite(q.mid) && q.mid > 0) return q.mid;
  if (finite(q.last) && q.last > 0) return q.last;
  return null;
}

/** Standing dollar premium for one option: mark × OI. Zero OI is a real 0. */
export function standingPremiumUsd(q: OptionQuote): number | null {
  const mark = markPriceUsd(q);
  if (mark == null) return null;
  return mark * Math.max(0, q.openInterest || 0);
}

function expirySortKey(slice: { expiry: string; dte?: number }): string {
  const dte = finite(slice.dte) ? slice.dte : Number.POSITIVE_INFINITY;
  // Pad so lexicographic sort == numeric DTE sort; Infinity → 'zzz'.
  const pad = Number.isFinite(dte) ? String(Math.round(dte)).padStart(6, '0') : 'zzzzzz';
  return `${pad}:${slice.expiry}`;
}

/**
 * Strike × expiry matrix of standing dollar premium (calls+puts summed by
 * `side`). Row/column totals sum ONLY the visible window.
 */
export function premiumMatrix(
  chain: PremiumChain,
  opts: { side?: PremiumSide; maxStrikes?: number | null } = {},
): PremiumMatrixResult {
  const side = opts.side ?? 'both';
  const maxStrikes = opts.maxStrikes ?? null;

  const slices = [...chain.expiries].sort((a, b) =>
    expirySortKey(a).localeCompare(expirySortKey(b)),
  );

  // Union of strikes with at least one quote.
  const allStrikes = new Set<number>();
  for (const slice of slices) {
    for (const q of slice.calls) if (finite(q.strike)) allStrikes.add(q.strike);
    for (const q of slice.puts) if (finite(q.strike)) allStrikes.add(q.strike);
  }

  const spot = finite(chain.spot) && chain.spot > 0 ? chain.spot : null;
  let strikes = [...allStrikes].sort((a, b) => b - a); // descending
  let atmStrike: number | null = null;

  if (spot != null && allStrikes.size > 0) {
    atmStrike = strikes.reduce((best, k) =>
      Math.abs(k - spot) < Math.abs(best - spot) ? k : best,
    );
    if (maxStrikes != null && maxStrikes > 0 && strikes.length > maxStrikes) {
      strikes = strikes
        .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))
        .slice(0, maxStrikes)
        .sort((a, b) => b - a);
    }
  }

  const expiries = slices.map((s) => s.expiry);

  // Aggregate quotes per (strike, expiry) — sum defensively if duplicates slip in.
  const agg = new Map<string, { callSum: number | null; putSum: number | null }>();
  const add = (strike: number, expiry: string, kind: 'call' | 'put', quote: OptionQuote) => {
    const key = `${strike}|${expiry}`;
    const cur = agg.get(key) ?? { callSum: null, putSum: null };
    const p = standingPremiumUsd(quote);
    if (p != null) {
      if (kind === 'call') cur.callSum = (cur.callSum ?? 0) + p;
      else cur.putSum = (cur.putSum ?? 0) + p;
    }
    agg.set(key, cur);
  };
  for (const slice of slices) {
    for (const q of slice.calls) if (allStrikes.has(q.strike)) add(q.strike, slice.expiry, 'call', q);
    for (const q of slice.puts) if (allStrikes.has(q.strike)) add(q.strike, slice.expiry, 'put', q);
  }

  const cells: PremiumCell[][] = [];
  const rowTotals: (number | null)[] = [];

  for (const strike of strikes) {
    const row: PremiumCell[] = [];
    let rowSum = 0;
    let rowHasValue = false;
    for (let ci = 0; ci < expiries.length; ci++) {
      const entry = agg.get(`${strike}|${expiries[ci]}`) ?? { callSum: null, putSum: null };
      let premium: number | null;
      if (side === 'calls') premium = entry.callSum;
      else if (side === 'puts') premium = entry.putSum;
      else if (entry.callSum != null && entry.putSum != null) premium = entry.callSum + entry.putSum;
      else premium = entry.callSum ?? entry.putSum ?? null;
      if (premium != null) {
        rowSum += premium;
        rowHasValue = true;
      }
      row.push({ strike, expiry: expiries[ci]!, callPremium: entry.callSum, putPremium: entry.putSum, premium });
    }
    cells.push(row);
    rowTotals.push(rowHasValue ? rowSum : null);
  }

  const colTotals: (number | null)[] = expiries.map((_, ci) => {
    let sum = 0;
    let has = false;
    for (const row of cells) {
      const v = row[ci]?.premium;
      if (v != null) {
        sum += v;
        has = true;
      }
    }
    return has ? sum : null;
  });

  const grandTotal = rowTotals.some((t) => t != null)
    ? rowTotals.reduce<number>((s, t) => s + (t ?? 0), 0)
    : null;

  return { strikes, expiries, atmStrike, cells, rowTotals, colTotals, grandTotal, side };
}

/** Mono blue-gray heat intensity 0..1 for a value within [min, max]. */
export function monoIntensity(value: number | null, min: number, max: number): number {
  if (value == null || !finite(value) || !finite(min) || !finite(max) || max <= min) return 0;
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return 0.05 + 0.9 * Math.sqrt(t);
}

// ── Scanner ────────────────────────────────────────────────────────────────

export type ScannerTypeFilter = 'both' | 'call' | 'put';

export interface ScannerFilters {
  type?: ScannerTypeFilter;
  /** MARK IV lower bound, percent (e.g. 40 = 40%). Null/undefined = unbounded. */
  ivMinPct?: number | null;
  /** MARK IV upper bound, percent. */
  ivMaxPct?: number | null;
  /** Expiry filter; 'all'/null = every expiry. */
  expiry?: string | null;
  /** Minimum open interest (contracts). */
  oiMin?: number | null;
  /** Absolute-delta window, 0..1 (|Δ| must fall inside to survive). */
  deltaMin?: number | null;
  deltaMax?: number | null;
}

export interface ScannerRow {
  instrument: string;
  symbol: string;
  expiry: string;
  dte: number | null;
  strike: number;
  type: 'call' | 'put';
  mark: number | null;
  markIvPct: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  premiumUsd: number | null;
  openInterest: number;
  volume: number;
  /** True when the option is past spot (call: K < S · put: K > S). */
  itm: boolean;
}

const MONTHS_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Deribit-style instrument tag, e.g. BTC-27JUN25-65000-C. Falls back to the raw expiry. */
export function instrumentTag(symbol: string, expiry: string, strike: number, type: 'call' | 'put'): string {
  let tag = '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiry);
  if (m) {
    const mon = MONTHS_ABBR[Number(m[2]) - 1] ?? '???';
    tag = `${Number(m[3])}${mon}${m[1]!.slice(2)}`;
  } else {
    tag = expiry;
  }
  const ks = Number.isInteger(strike) ? String(strike) : String(strike);
  return `${symbol}-${tag}-${ks}-${type === 'call' ? 'C' : 'P'}`;
}

function deriveDte(expiry: string, now: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiry);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 8);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil((ms - now) / 86_400_000));
}

/** Flatten the live chain into one filtered row per listed option. */
export function scannerRows(chain: PremiumChain & { symbol?: string }, filters: ScannerFilters = {}): ScannerRow[] {
  const symbol = chain.symbol ?? 'BTC';
  const spot = finite(chain.spot) ? chain.spot : null;
  const type = filters.type ?? 'both';
  const ivMin = finite(filters.ivMinPct) ? filters.ivMinPct : null;
  const ivMax = finite(filters.ivMaxPct) ? filters.ivMaxPct : null;
  const oiMin = finite(filters.oiMin) ? filters.oiMin : null;
  const dMin = finite(filters.deltaMin) ? filters.deltaMin : null;
  const dMax = finite(filters.deltaMax) ? filters.deltaMax : null;
  const expiryFilter = filters.expiry && filters.expiry !== 'all' ? filters.expiry : null;
  const now = Date.now();

  const rows: ScannerRow[] = [];
  for (const slice of chain.expiries) {
    if (expiryFilter && slice.expiry !== expiryFilter) continue;
    for (const q of [...slice.calls, ...slice.puts]) {
      if (type !== 'both' && q.type !== type) continue;
      const ivPct = finite(q.iv) && q.iv > 0 ? q.iv * 100 : null;
      if (ivMin != null && (ivPct == null || ivPct < ivMin)) continue;
      if (ivMax != null && (ivPct == null || ivPct > ivMax)) continue;
      if (oiMin != null && !((q.openInterest ?? 0) >= oiMin)) continue;
      const absDelta = finite(q.delta) ? Math.abs(q.delta) : null;
      if (dMin != null && (absDelta == null || absDelta < dMin)) continue;
      if (dMax != null && (absDelta == null || absDelta > dMax)) continue;

      rows.push({
        instrument: instrumentTag(symbol, slice.expiry, q.strike, q.type),
        symbol,
        expiry: slice.expiry,
        dte: finite(slice.dte) ? slice.dte : deriveDte(slice.expiry, now),
        strike: q.strike,
        type: q.type,
        mark: markPriceUsd(q),
        markIvPct: ivPct,
        delta: finite(q.delta) ? q.delta : null,
        gamma: finite(q.gamma) ? q.gamma : null,
        theta: finite(q.theta) ? q.theta : null,
        vega: finite(q.vega) ? q.vega : null,
        premiumUsd: standingPremiumUsd(q),
        openInterest: Math.max(0, q.openInterest || 0),
        volume: Math.max(0, q.volume || 0),
        itm: spot != null ? (q.type === 'call' ? q.strike < spot : q.strike > spot) : false,
      });
    }
  }
  return rows;
}

/** Top-N rows by standing open interest — honest stand-in for trade-tape movers. */
export function largestOiRows(rows: ScannerRow[], n = 5): ScannerRow[] {
  return rows
    .filter((r) => r.openInterest > 0)
    .sort((a, b) => b.openInterest - a.openInterest)
    .slice(0, Math.max(0, n));
}

export interface ExpirySummary {
  expiry: string;
  dte: number | null;
  totalOi: number;
  options: number;
}

/** Per-expiry totals for the EXPIRIES strip chips. */
export function expirySummaries(chain: PremiumChain): ExpirySummary[] {
  return [...chain.expiries]
    .sort((a, b) => expirySortKey(a).localeCompare(expirySortKey(b)))
    .map((slice) => {
      let totalOi = 0;
      for (const q of [...slice.calls, ...slice.puts]) totalOi += Math.max(0, q.openInterest || 0);
      return {
        expiry: slice.expiry,
        dte: finite(slice.dte) ? slice.dte : deriveDte(slice.expiry, Date.now()),
        totalOi,
        options: slice.calls.length + slice.puts.length,
      };
    });
}
