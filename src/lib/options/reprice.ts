/**
 * Sticky-IV reprice of a VolSnapshot at a new spot.
 *
 * When the live spot tick updates between full chain rebuilds, greek fields
 * (δ, γ, …) must be recomputed at the new S with frozen IV — otherwise GEX/DEX
 * and desk tools read stale greeks × new spot (audit H2).
 */

import { priceGreeksMarket } from '../math/adapters';
import { yearFractionFromSlice } from './time';
import type { OptionQuote, ExpirySlice, VolSnapshot } from './types';

function repriceQuote(
  q: OptionQuote,
  spot: number,
  T: number,
  r: number,
  div: number,
): OptionQuote {
  if (q.iv == null || !(q.iv > 0) || !Number.isFinite(q.iv)) return q;
  if (!(spot > 0) || !(T > 0)) return q;
  const g = priceGreeksMarket(q.type, spot, q.strike, T, r, div, q.iv);
  return {
    ...q,
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
  };
}

function repriceSlice(
  slice: ExpirySlice,
  spot: number,
  snapR: number,
  snapQ: number,
  now: number,
): ExpirySlice {
  // Continuous T to 16:00 ET — same basis as chain build (not calendar dte/365).
  const T = yearFractionFromSlice(slice, now);
  const r = slice.riskFreeRate ?? snapR;
  const q = slice.dividendYield ?? snapQ;
  return {
    ...slice,
    calls: slice.calls.map((c) => repriceQuote(c, spot, T, r, q)),
    puts: slice.puts.map((p) => repriceQuote(p, spot, T, r, q)),
  };
}

/**
 * Return a new snapshot with `spot` set and all option greeks recomputed
 * at sticky IV. No-op (identity) when spot is invalid or unchanged within eps.
 */
export function repriceSnapshotAtSpot(
  snap: VolSnapshot,
  newSpot: number,
  opts?: { timestamp?: number; epsRel?: number },
): VolSnapshot {
  if (!(newSpot > 0) || !Number.isFinite(newSpot)) return snap;
  const eps = opts?.epsRel ?? 1e-12;
  if (snap.spot > 0 && Math.abs(newSpot - snap.spot) / snap.spot < eps) {
    return snap;
  }
  const ts = opts?.timestamp ?? Date.now();
  return {
    ...snap,
    spot: newSpot,
    timestamp: ts,
    expiries: snap.expiries.map((s) =>
      repriceSlice(s, newSpot, snap.riskFreeRate, snap.dividendYield, ts),
    ),
  };
}
