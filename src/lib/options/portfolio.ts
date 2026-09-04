/**
 * Multi-leg portfolio builder — combo greeks and mark PnL (Thalex-style).
 */

import { priceGreeksMarket, type MarketGreeks } from '../math/adapters';
import { priceEuropeanSpot } from '../math/spotBsm';
import { asDecimalRate, asDecimalVol, asYearFraction } from '../math/units';
import { yearFractionFromSlice } from './time';
import type { VolSnapshot, OptionQuote } from './types';

export type LegSide = 'long' | 'short';
export type LegKind = 'call' | 'put' | 'future' | 'spot';

export interface PortfolioLeg {
  id: string;
  kind: LegKind;
  /** call/put only */
  side: LegSide;
  qty: number;
  strike?: number;
  expiry?: string;
  /** Entry premium: long→observed ask, short→observed bid; null if that side unavailable (never mid/last fallback) */
  entryPrice: number | null;
  /** How entryPrice was sourced. Structural law: long = 'ask', short = 'bid',
   * explicit user override = 'user'. Mid/last/mark substitution is forbidden. */
  entryBasis?: 'ask' | 'bid' | 'user' | null;
  /** Override IV (decimal); else taken from snapshot */
  iv?: number;
}

/** Structural executable-entry law: long requires observed positive ask,
 * short requires observed positive bid, 'user' is an explicit override.
 * Spot/future legs have no quote side (price is the underlying level). */
export function entryBasisValidFor(leg: Pick<PortfolioLeg, 'kind' | 'side' | 'entryBasis'>): boolean {
  if (leg.kind === 'spot' || leg.kind === 'future') return true;
  if (leg.entryBasis === 'user') return true;
  if (leg.side === 'long') return leg.entryBasis === 'ask';
  return leg.entryBasis === 'bid';
}

export interface ComboGreeks {
  price: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  vanna: number;
  volga: number;
  charm: number;
}

export interface ComboMark {
  mark: number | null;
  pnl: number | null;
  greeks: ComboGreeks;
  /** True when any leg has missing expiry/IV/entryPrice — result is unavailable, not partial */
  unavailable?: boolean;
  unavailableReason?: string;
}

const ZERO: ComboGreeks = {
  price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, vanna: 0, volga: 0, charm: 0,
};

function signOf(side: LegSide): number {
  return side === 'long' ? 1 : -1;
}

function findQuote(
  snap: VolSnapshot,
  type: 'call' | 'put',
  strike: number,
  expiry: string,
): OptionQuote | null {
  const slice = snap.expiries.find(e => e.expiry === expiry);
  if (!slice) return null;
  const list = type === 'call' ? slice.calls : slice.puts;
  let best: OptionQuote | null = null;
  let bestDist = Infinity;
  for (const q of list) {
    const d = Math.abs(q.strike - strike);
    if (d < bestDist) {
      bestDist = d;
      best = q;
    }
  }
  return best;
}

function dteYears(snap: VolSnapshot, expiry: string): number | null {
  const slice = snap.expiries.find(e => e.expiry === expiry);
  if (!slice) return null;
  return yearFractionFromSlice(slice);
}

/**
 * Aggregate combo greeks / mark at a given spot (and optional vol shock / time decay).
 * @param opts.daysElapsed — calendar days since snapshot; reduces residual T (theta path).
 */
export function evaluateCombo(
  legs: PortfolioLeg[],
  snap: VolSnapshot,
  opts: { spot?: number; volShock?: number; daysElapsed?: number } = {},
): ComboMark {
  const S = opts.spot ?? snap.spot;
  const volShock = opts.volShock ?? 0;
  const daysElapsed = Math.max(0, opts.daysElapsed ?? 0);
  const r = snap.riskFreeRate;
  const q = snap.dividendYield;
  const acc = { ...ZERO };
  let entryCost = 0;
  let hasMissing = false;
  let missingReason = '';

  for (const leg of legs) {
    if (!Number.isFinite(leg.qty) || leg.qty <= 0) {
      hasMissing = true;
      missingReason = 'invalid qty (must be finite positive; negative qty cannot reverse side)';
      continue;
    }
    const sgn = signOf(leg.side) * leg.qty;
    const ep = leg.entryPrice as unknown as number | null;
    if (ep == null || !isFinite(ep)) {
      hasMissing = true;
      missingReason = 'missing entryPrice';
      continue;
    }
    if (leg.kind !== 'spot' && leg.kind !== 'future' && ep <= 0) {
      hasMissing = true;
      missingReason = 'non-positive entry price (executable entries require observed positive ask/bid)';
      continue;
    }
    if (!entryBasisValidFor(leg)) {
      hasMissing = true;
      missingReason = `invalid entry basis '${leg.entryBasis}' for ${leg.side} leg (long requires observed ask, short requires observed bid)`;
      continue;
    }
    // Provenance: ask/bid legs must match the snapshot's observed quote, not just the label.
    if (leg.kind !== 'spot' && leg.kind !== 'future' && leg.entryBasis !== 'user') {
      const qte = findQuote(snap, leg.kind as 'call' | 'put', leg.strike!, leg.expiry!);
      if (leg.entryBasis === 'ask') {
        if (qte?.ask == null || !Number.isFinite(qte.ask) || qte.ask <= 0 || Math.abs(qte.ask - ep) > 1e-9) {
          hasMissing = true;
          missingReason = 'ask basis requires entryPrice to equal observed positive ask at that strike/expiry';
          continue;
        }
      } else if (leg.entryBasis === 'bid') {
        if (qte?.bid == null || !Number.isFinite(qte.bid) || qte.bid <= 0 || Math.abs(qte.bid - ep) > 1e-9) {
          hasMissing = true;
          missingReason = 'bid basis requires entryPrice to equal observed positive bid at that strike/expiry';
          continue;
        }
      }
    }
    entryCost += sgn * ep;

    if (leg.kind === 'spot' || leg.kind === 'future') {
      const mark = S;
      acc.price += sgn * mark;
      acc.delta += sgn * 1;
      continue;
    }

    if (leg.strike == null || !leg.expiry) {
      hasMissing = true;
      missingReason = 'missing strike/expiry';
      continue;
    }
    const T0 = dteYears(snap, leg.expiry);
    if (T0 == null) {
      hasMissing = true;
      missingReason = 'expiry not in snapshot';
      continue;
    }
    const T = Math.max(1e-8, T0 - daysElapsed / 365);
    const qte = findQuote(snap, leg.kind, leg.strike, leg.expiry);
    // Use midIv (solved) not generic iv; no silent 0.25 fallback
    let vol: number | null = leg.iv ?? qte?.midIv ?? qte?.iv ?? null;
    if (vol == null || vol <= 0) {
      hasMissing = true;
      missingReason = 'missing IV';
      continue;
    }
    vol = Math.max(0.01, vol + volShock);

    // Expired: intrinsic only
    if (T <= 1e-8 || daysElapsed / 365 >= T0) {
      const intrinsic = leg.kind === 'call'
        ? Math.max(0, S - leg.strike)
        : Math.max(0, leg.strike - S);
      acc.price += sgn * intrinsic;
      acc.delta += sgn * (leg.kind === 'call' ? (S > leg.strike ? 1 : 0) : (S < leg.strike ? -1 : 0));
      continue;
    }

    const g: MarketGreeks = priceGreeksMarket(leg.kind, S, leg.strike, T, r, q, vol);
    acc.price += sgn * g.price;
    acc.delta += sgn * g.delta;
    acc.gamma += sgn * g.gamma;
    acc.theta += sgn * g.theta;
    acc.vega += sgn * g.vega;
    acc.rho += sgn * g.rho;
    acc.vanna += sgn * g.vanna;
    acc.volga += sgn * g.volga;
    acc.charm += sgn * g.charm;
  }

  if (hasMissing) {
    return {
      mark: null,
      pnl: null,
      greeks: acc,
      unavailable: true,
      unavailableReason: missingReason,
    };
  }
  return {
    mark: acc.price,
    pnl: acc.price - entryCost,
    greeks: acc,
  };
}

/** Combo greeks as a function of spot (for profile charts). */
export function comboGreeksProfile(
  legs: PortfolioLeg[],
  snap: VolSnapshot,
  spots: number[],
): { spot: number; mark: number; pnl: number; delta: number; gamma: number; theta: number; vega: number }[] {
  const marks = spots.map(spot => {
    const m = evaluateCombo(legs, snap, { spot });
    if (m.unavailable || m.mark == null || m.pnl == null) return null;
    return {
      spot,
      mark: m.mark,
      pnl: m.pnl,
      delta: m.greeks.delta,
      gamma: m.greeks.gamma,
      theta: m.greeks.theta,
      vega: m.greeks.vega,
    };
  });
  return marks.filter((m): m is NonNullable<typeof m> => m != null);
}

/** Spot grid around current (±pct). */
export function spotGrid(spot: number, pct = 0.15, n = 61): number[] {
  const lo = spot * (1 - pct);
  const hi = spot * (1 + pct);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(lo + (hi - lo) * (i / (n - 1)));
  }
  return out;
}

export type TemplateName =
  | 'long_straddle'
  | 'short_straddle'
  | 'long_call'
  | 'short_put'
  | 'risk_reversal'
  | 'call_spread'
  | 'collar';

/** Pick strike closest to target |delta| among quotes with finite delta. */
function nearestDeltaStrike<T extends { strike: number; delta?: number | null }>(
  quotes: T[],
  targetAbsDelta: number,
): T | undefined {
  let best: T | undefined;
  let bestDist = Infinity;
  for (const q of quotes) {
    if (q.delta == null || !Number.isFinite(q.delta)) continue;
    const dist = Math.abs(Math.abs(q.delta) - targetAbsDelta);
    if (dist < bestDist) {
      bestDist = dist;
      best = q;
    }
  }
  return best;
}

/** Build common multi-leg templates from a snapshot. */
export function templateLegs(
  name: TemplateName,
  snap: VolSnapshot,
  expiryIdx = 0,
): PortfolioLeg[] {
  const slice = snap.expiries[expiryIdx] ?? snap.expiries[0];
  // Fail closed: a live slice can arrive with zero validated quotes on either
  // side (all rows filtered). Reducing an empty side yields undefined and the
  // atm.strike read below throws inside render (PnlWorkflow useMemo) — return
  // no legs so callers render their honest empty states instead of crashing.
  if (!slice || slice.calls.length === 0 || slice.puts.length === 0) return [];
  const atm = slice.calls.reduce((b, q) =>
    Math.abs(q.strike - snap.spot) < Math.abs(b.strike - snap.spot) ? q : b
  , slice.calls[0]!);
  const atmPut = slice.puts.find(p => p.strike === atm.strike) ?? slice.puts[0]!;
  const otmCall = slice.calls.find(c => c.strike > snap.spot * 1.05) ?? atm;
  const otmPut = slice.puts.find(p => p.strike < snap.spot * 0.95) ?? atmPut;
  // ~25Δ wings for collar / RR when chain greeks exist; else % OTM fallback
  const d25Call = nearestDeltaStrike(
    slice.calls.filter((c) => c.strike >= snap.spot),
    0.25,
  ) ?? otmCall;
  const d25Put = nearestDeltaStrike(
    slice.puts.filter((p) => p.strike <= snap.spot),
    0.25,
  ) ?? otmPut;

  const id = () => Math.random().toString(36).slice(2, 9);
  const execPrice = (q: import('./types').OptionQuote, side: LegSide): { price: number | null; basis: 'ask' | 'bid' | null } => {
    if (side === 'long') return q.ask != null && q.ask > 0 && isFinite(q.ask) ? { price: q.ask, basis: 'ask' } : { price: null, basis: null };
    return q.bid != null && q.bid > 0 && isFinite(q.bid) ? { price: q.bid, basis: 'bid' } : { price: null, basis: null };
  };
  switch (name) {
    case 'long_straddle': {
      const c = execPrice(atm, 'long'); const p = execPrice(atmPut, 'long');
      return [
        { id: id(), kind: 'call', side: 'long', qty: 1, strike: atm.strike, expiry: slice.expiry, entryPrice: c.price, entryBasis: c.basis },
        { id: id(), kind: 'put', side: 'long', qty: 1, strike: atmPut.strike, expiry: slice.expiry, entryPrice: p.price, entryBasis: p.basis },
      ];
    }
    case 'short_straddle': {
      const c = execPrice(atm, 'short'); const p = execPrice(atmPut, 'short');
      return [
        { id: id(), kind: 'call', side: 'short', qty: 1, strike: atm.strike, expiry: slice.expiry, entryPrice: c.price, entryBasis: c.basis },
        { id: id(), kind: 'put', side: 'short', qty: 1, strike: atmPut.strike, expiry: slice.expiry, entryPrice: p.price, entryBasis: p.basis },
      ];
    }
    case 'long_call': {
      const c = execPrice(atm, 'long');
      return [{ id: id(), kind: 'call', side: 'long', qty: 1, strike: atm.strike, expiry: slice.expiry, entryPrice: c.price, entryBasis: c.basis }];
    }
    case 'short_put': {
      const p = execPrice(atmPut, 'short');
      return [{ id: id(), kind: 'put', side: 'short', qty: 1, strike: atmPut.strike, expiry: slice.expiry, entryPrice: p.price, entryBasis: p.basis }];
    }
    case 'risk_reversal': {
      const c = execPrice(otmCall, 'long'); const p = execPrice(otmPut, 'short');
      return [
        { id: id(), kind: 'call', side: 'long', qty: 1, strike: otmCall.strike, expiry: slice.expiry, entryPrice: c.price, entryBasis: c.basis },
        { id: id(), kind: 'put', side: 'short', qty: 1, strike: otmPut.strike, expiry: slice.expiry, entryPrice: p.price, entryBasis: p.basis },
      ];
    }
    case 'call_spread': {
      const a = execPrice(atm, 'long'); const b = execPrice(otmCall, 'short');
      return [
        { id: id(), kind: 'call', side: 'long', qty: 1, strike: atm.strike, expiry: slice.expiry, entryPrice: a.price, entryBasis: a.basis },
        { id: id(), kind: 'call', side: 'short', qty: 1, strike: otmCall.strike, expiry: slice.expiry, entryPrice: b.price, entryBasis: b.basis },
      ];
    }
    case 'collar': {
      const p = execPrice(d25Put, 'long'); const c = execPrice(d25Call, 'short');
      return [
        { id: id(), kind: 'put', side: 'long', qty: 1, strike: d25Put.strike, expiry: slice.expiry, entryPrice: p.price, entryBasis: p.basis },
        { id: id(), kind: 'call', side: 'short', qty: 1, strike: d25Call.strike, expiry: slice.expiry, entryPrice: c.price, entryBasis: c.basis },
      ];
    }
    default:
      return [];
  }
}

/** Intrinsic at expiry for BE analysis — discriminated, never NaN/Infinity. */
export function comboPayoffAtExpiry(legs: PortfolioLeg[], S: number): number | null {
  let pnl = 0;
  for (const leg of legs) {
    if (!Number.isFinite(leg.qty) || leg.qty <= 0) return null;
    const sgn = signOf(leg.side) * leg.qty;
    const ep = leg.entryPrice as unknown as number | null;
    if (ep == null || !Number.isFinite(ep)) {
      // Missing entryPrice → unavailable, not free — return null not NaN
      return null;
    }
    if (leg.kind !== 'spot' && leg.kind !== 'future') {
      if (ep <= 0) return null;
      if (!entryBasisValidFor(leg)) return null;
    }
    if (leg.kind === 'spot' || leg.kind === 'future') {
      const v = S - ep;
      if (!Number.isFinite(v)) return null;
      pnl += sgn * v;
      continue;
    }
    if (leg.strike == null) return null;
    const intrinsic = leg.kind === 'call'
      ? Math.max(0, S - leg.strike)
      : Math.max(0, leg.strike - S);
    const legPnl = intrinsic - ep;
    if (!Number.isFinite(legPnl)) return null;
    pnl += sgn * legPnl;
  }
  return Number.isFinite(pnl) ? pnl : null;
}

export interface BreakEvenResult {
  available: boolean;
  breakEvens: number[];
  reason?: string;
}

export function breakEvenSpots(legs: PortfolioLeg[], spot: number, loMult = 0.5, hiMult = 1.5, n = 400): BreakEvenResult {
  // Fail-closed: any missing executable entry price → unavailable
  if (legs.some(l => l.entryPrice == null || !Number.isFinite(l.entryPrice as number))) {
    return { available: false, breakEvens: [], reason: 'missing entryPrice' };
  }
  if (legs.some(l => !Number.isFinite(l.qty) || l.qty <= 0)) {
    return { available: false, breakEvens: [], reason: 'invalid qty' };
  }
  if (legs.some(l => !entryBasisValidFor(l))) {
    return { available: false, breakEvens: [], reason: "invalid entry basis (long requires observed ask, short requires observed bid)" };
  }
  if (!Number.isFinite(spot) || spot <= 0) return { available: false, breakEvens: [], reason: 'invalid spot' };
  const lo = spot * loMult;
  const hi = spot * hiMult;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= 0) return { available: false, breakEvens: [], reason: 'invalid range' };
  const bes: number[] = [];
  let prev = comboPayoffAtExpiry(legs, lo);
  if (prev == null) return { available: false, breakEvens: [], reason: 'unavailable payoff' };
  for (let i = 1; i <= n; i++) {
    const S = lo + (hi - lo) * (i / n);
    const v = comboPayoffAtExpiry(legs, S);
    if (v == null || prev == null) return { available: false, breakEvens: [], reason: 'unavailable payoff' };
    if (prev === 0) bes.push(lo + (hi - lo) * ((i - 1) / n));
    else if (prev * v < 0) {
      const S0 = lo + (hi - lo) * ((i - 1) / n);
      const denom = Math.abs(prev) + Math.abs(v) || 1;
      const t = Math.abs(prev) / denom;
      const be = S0 + t * (S - S0);
      if (Number.isFinite(be)) bes.push(be);
    }
    prev = v;
  }
  return { available: true, breakEvens: bes.filter(Number.isFinite) };
}

/** BS mid for a single option (utility). */
export function theoreticalPrice(
  type: 'call' | 'put',
  S: number, K: number, T: number, r: number, q: number, vol: number,
): number {
  return priceEuropeanSpot(type, S, K, asYearFraction(T), asDecimalRate(r), asDecimalRate(q), asDecimalVol(vol)).price;
}
