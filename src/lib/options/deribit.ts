/**
 * Build VolSnapshot from Deribit public book summary (coin-margined options).
 *
 * Prices on Deribit are in the base coin; we convert to USD via index/underlying.
 * mark_iv is percent (e.g. 47.7 → 0.477).
 */

import type { VolSnapshot, ExpirySlice, OptionQuote, FuturesMark } from './types';
import { priceGreeksMarket } from '../math/adapters';
import { computeAtmIV } from './yahoo';
import { yearFractionToExpiry, calendarDte } from './time';
import type { DeribitBookRow, DeribitFutureRow, DeribitMarketBundle } from '../data/deribitClient';
import { VALIDATION_CONFIG } from '../../config/constants';

const { MIN_IV, MAX_IV } = VALIDATION_CONFIG.ranges;

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/** Parse BTC-10JUL26-61500-C → { expiry: '2026-07-10', strike, type } */
export function parseDeribitInstrument(name: string): {
  currency: string;
  expiry: string;
  strike: number;
  type: 'call' | 'put';
} | null {
  // BTC-31JUL26-85000-C  or  ETH-27MAR26-2000-P
  const m = name.match(/^([A-Z]+)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:\.\d+)?)-([CP])$/i);
  if (!m) return null;
  const day = parseInt(m[2]!, 10);
  const mon = MONTHS[m[3]!.toUpperCase()];
  if (mon == null) return null;
  const year = 2000 + parseInt(m[4]!, 10);
  const strike = parseFloat(m[5]!);
  if (!(strike > 0)) return null;
  const type = m[6]!.toUpperCase() === 'C' ? 'call' : 'put';
  const expiry = `${year}-${String(mon + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { currency: m[1]!.toUpperCase(), expiry, strike, type };
}

/**
 * Parse dated future BTC-25JUL25 or perpetual BTC-PERPETUAL.
 * Marks on Deribit inverse futures are in USD.
 */
export function parseDeribitFuture(name: string): {
  currency: string;
  expiry: string | null;
  isPerp: boolean;
} | null {
  const up = name.toUpperCase();
  const perp = up.match(/^([A-Z]+)-PERPETUAL$/);
  if (perp) return { currency: perp[1]!, expiry: null, isPerp: true };
  const m = up.match(/^([A-Z]+)-(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!m) return null;
  const day = parseInt(m[2]!, 10);
  const mon = MONTHS[m[3]!];
  if (mon == null) return null;
  const year = 2000 + parseInt(m[4]!, 10);
  const expiry = `${year}-${String(mon + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { currency: m[1]!, expiry, isPerp: false };
}

export function buildFuturesMarks(
  rows: DeribitFutureRow[],
  index: number,
  now = Date.now(),
): FuturesMark[] {
  const out: FuturesMark[] = [];
  for (const row of rows) {
    const parsed = parseDeribitFuture(row.instrument_name);
    if (!parsed) continue;
    const mark = row.mark_price ?? row.mid_price ?? row.last;
    if (mark == null || !(mark > 0)) continue;
    const idx = (row.underlying_price && row.underlying_price > 0)
      ? row.underlying_price
      : (row.estimated_delivery_price && row.estimated_delivery_price > 0)
        ? row.estimated_delivery_price
        : index;
    if (!(idx > 0)) continue;
    const dte = parsed.expiry != null ? calendarDte(parsed.expiry, now) : null;
    const T = parsed.expiry != null
      ? yearFractionToExpiry(parsed.expiry, now)
      : dte != null && dte > 0
        ? dte / 365
        : null;
    const basis = mark - idx;
    const annCarry = T != null && T > 0 ? (mark / idx - 1) / T : null;
    out.push({
      instrument: row.instrument_name,
      expiry: parsed.expiry,
      dte,
      mark,
      index: idx,
      basis,
      annCarry,
      isPerp: parsed.isPerp,
    });
  }
  // Prefer dated futures first by DTE, perp last
  out.sort((a, b) => {
    if (a.isPerp && !b.isPerp) return 1;
    if (!a.isPerp && b.isPerp) return -1;
    return (a.dte ?? 9999) - (b.dte ?? 9999);
  });
  return out;
}

function coinToUsd(coinPrice: number | null | undefined, index: number): number {
  if (coinPrice == null || !isFinite(coinPrice) || coinPrice < 0) return 0;
  return coinPrice * index;
}

function toQuote(
  row: DeribitBookRow,
  parsed: NonNullable<ReturnType<typeof parseDeribitInstrument>>,
  index: number,
  T: number,
  r: number,
  q: number,
): OptionQuote | null {
  // Prefer mark_iv from exchange; fall back skip if unusable
  let iv = row.mark_iv;
  if (iv != null && iv > 5) iv = iv / 100; // percent → decimal
  if (iv == null || !isFinite(iv) || iv < MIN_IV || iv > MAX_IV) return null;

  const pxIndex = (row.underlying_price && row.underlying_price > 0)
    ? row.underlying_price
    : index;

  const bid = coinToUsd(row.bid_price, pxIndex);
  const ask = coinToUsd(row.ask_price, pxIndex);
  const last = coinToUsd(row.last, pxIndex);
  const mark = coinToUsd(row.mark_price, pxIndex);
  let mid = coinToUsd(row.mid_price, pxIndex);
  if (!(mid > 0)) {
    if (bid > 0 && ask > 0) mid = (bid + ask) / 2;
    else if (mark > 0) mid = mark;
    else if (last > 0) mid = last;
    else mid = 0;
  }
  // Deep OTM may have zero bid — still usable with mark
  if (!(mid > 0) && mark > 0) mid = mark;
  if (!(mid > 0)) return null;

  const g = priceGreeksMarket(parsed.type, index, parsed.strike, T, r, q, iv);
  const oi = Math.max(0, row.open_interest ?? 0);
  const vol = Math.max(0, row.volume ?? 0);

  return {
    strike: parsed.strike,
    expiry: parsed.expiry,
    type: parsed.type,
    bid,
    ask: ask > 0 ? ask : mid,
    last: last > 0 ? last : mid,
    mid,
    iv,
    delta: g.delta,
    gamma: g.gamma,
    theta: g.theta,
    vega: g.vega,
    vanna: g.vanna,
    charm: g.charm,
    volga: g.volga,
    speed: g.speed,
    rho: g.rho,
    veta: g.veta,
    color: g.color,
    zomma: g.zomma,
    ultima: g.ultima,
    openInterest: oi,
    volume: vol,
  };
}

export interface BuildDeribitOptions {
  maxExpiries?: number;
  r?: number;
  q?: number;
  now?: number;
  /** Keep strikes within this moneyness band of index */
  moneynessBand?: number;
}

/**
 * Convert Deribit market bundle into the terminal's VolSnapshot.
 */
export function buildDeribitSnapshot(
  bundle: DeribitMarketBundle,
  opts: BuildDeribitOptions = {},
): VolSnapshot | null {
  const maxExpiries = opts.maxExpiries ?? 12;
  const r = opts.r ?? 0.04;
  const q = opts.q ?? 0;
  const now = opts.now ?? Date.now();
  const band = opts.moneynessBand ?? 0.45;
  const index = bundle.indexPrice;
  if (!(index > 0)) return null;

  type Acc = { expiry: string; calls: OptionQuote[]; puts: OptionQuote[] };
  const byExpiry = new Map<string, Acc>();

  for (const row of bundle.options) {
    const parsed = parseDeribitInstrument(row.instrument_name);
    if (!parsed) continue;
    if (parsed.strike < index * (1 - band) || parsed.strike > index * (1 + band)) continue;

    const Traw = yearFractionToExpiry(parsed.expiry, now);
    const T = Traw != null && Traw > 0 ? Traw : 0;
    if (T <= 0) continue;

    const qte = toQuote(row, parsed, index, T, r, q);
    if (!qte) continue;

    let acc = byExpiry.get(parsed.expiry);
    if (!acc) {
      acc = { expiry: parsed.expiry, calls: [], puts: [] };
      byExpiry.set(parsed.expiry, acc);
    }
    if (parsed.type === 'call') acc.calls.push(qte);
    else acc.puts.push(qte);
  }

  const expiries = [...byExpiry.keys()].sort();
  // Prefer nearest first; keep first maxExpiries by calendar order
  const kept = expiries.slice(0, maxExpiries);
  if (kept.length === 0) return null;

  const slices: ExpirySlice[] = [];
  for (const exp of kept) {
    const acc = byExpiry.get(exp)!;
    acc.calls.sort((a, b) => a.strike - b.strike);
    acc.puts.sort((a, b) => a.strike - b.strike);
    if (acc.calls.length + acc.puts.length < 4) continue;

    const dte = calendarDte(exp, now);
    const T = yearFractionToExpiry(exp, now) ?? Math.max(1e-6, dte / 365);
    const atmIV = computeAtmIV(
      acc.calls.filter(c => c.iv != null).map(c => ({ strike: c.strike, iv: c.iv! })),
      acc.puts.filter(p => p.iv != null).map(p => ({ strike: p.strike, iv: p.iv! })),
      index,
    );
    // Fail-closed: skip expiries without a real ATM IV (never invent vol).
    if (atmIV == null || !(atmIV > 0) || !Number.isFinite(atmIV)) continue;

    slices.push({
      expiry: exp,
      dte,
      calls: acc.calls,
      puts: acc.puts,
      atmIV,
      forward: index * Math.exp((r - q) * Math.max(T, 1e-8)),
    });
  }

  if (slices.length === 0) return null;

  // Sort by DTE ascending
  slices.sort((a, b) => a.dte - b.dte);

  const futuresMarks = buildFuturesMarks(bundle.futures ?? [], index, now);
  // If book empty but perp ticker present, add synthetic perp mark
  if (futuresMarks.length === 0 && bundle.perp && (bundle.perp.mark_price > 0)) {
    const mark = bundle.perp.mark_price;
    const idx = bundle.perp.index_price > 0 ? bundle.perp.index_price : index;
    futuresMarks.push({
      instrument: bundle.perp.instrument_name,
      expiry: null,
      dte: null,
      mark,
      index: idx,
      basis: mark - idx,
      annCarry: null,
      isPerp: true,
    });
  }

  return {
    symbol: bundle.currency,
    spot: index,
    riskFreeRate: r,
    dividendYield: q,
    timestamp: bundle.fetchedAt,
    expiries: slices,
    surfaceSource: 'live',
    /** Deribit options: 1 coin per contract (not equity 100-share) */
    contractSize: 1,
    fundingAnn: bundle.fundingAnn ?? undefined,
    futuresMarks: futuresMarks.length > 0 ? futuresMarks : undefined,
  };
}
