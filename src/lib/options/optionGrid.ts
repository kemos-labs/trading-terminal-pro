/**
 * Option Grid — leverage (omega) and 1/N(d2) by strike × expiry (Thalex Grid).
 */

import { blackScholes, normCdf } from './black-scholes';
import { yearFractionFromSlice } from './time';
import type { VolSnapshot } from './types';

export interface GridCell {
  strike: number;
  expiry: string;
  dte: number;
  type: 'call' | 'put';
  iv: number | null;
  mid: number;
  delta: number | null;
  /** Elasticity ω = Δ · S / V */
  omega: number | null;
  /** N(d2) risk-neutral ITM proxy */
  nd2: number | null;
  /** 1/N(d2) — leverage-like payoff odds metric */
  invNd2: number | null;
}

export interface OptionGrid {
  strikes: number[];
  expiries: string[];
  dtes: number[];
  cells: GridCell[][]; // [expiryIdx][strikeIdx] for selected type
}

function nd2Of(
  type: 'call' | 'put',
  S: number, K: number, T: number, r: number, q: number, vol: number,
): number {
  if (T <= 0 || vol <= 0) return type === 'call' ? (S > K ? 1 : 0) : (S < K ? 1 : 0);
  const d2 = (Math.log(S / K) + (r - q - 0.5 * vol * vol) * T) / (vol * Math.sqrt(T));
  return type === 'call' ? normCdf(d2) : normCdf(-d2);
}

/**
 * Build leverage / N(d2) grid for one option type across the surface.
 */
export function buildOptionGrid(
  snap: VolSnapshot,
  type: 'call' | 'put' = 'call',
  maxExpiries = 8,
): OptionGrid {
  const slices = snap.expiries.slice(0, maxExpiries);
  const strikeSet = new Set<number>();
  for (const sl of slices) {
    const list = type === 'call' ? sl.calls : sl.puts;
    for (const q of list) {
      if (q.iv != null && q.iv > 0) strikeSet.add(q.strike);
    }
  }
  const strikes = [...strikeSet].sort((a, b) => a - b);
  // Keep strikes near money for readability
  const filtered = strikes.filter(k => k >= snap.spot * 0.7 && k <= snap.spot * 1.35);
  const useStrikes = filtered.length >= 5 ? filtered : strikes;

  const cells: GridCell[][] = [];
  for (const sl of slices) {
    const T = yearFractionFromSlice(sl);
    const list = type === 'call' ? sl.calls : sl.puts;
    const row: GridCell[] = [];
    for (const K of useStrikes) {
      const q = list.reduce((b, x) =>
        Math.abs(x.strike - K) < Math.abs(b.strike - K) ? x : b
      , list[0] ?? { strike: K, iv: null, mid: 0, delta: null, bid: 0, ask: 0, last: 0,
        expiry: sl.expiry, type, openInterest: 0, volume: 0,
        gamma: null, theta: null, vega: null, vanna: null, charm: null, volga: null,
        speed: null, rho: null, veta: null, color: null, zomma: null, ultima: null });

      const closeEnough = q && Math.abs(q.strike - K) / K < 0.02;
      if (!closeEnough || q.iv == null || q.iv <= 0) {
        row.push({
          strike: K, expiry: sl.expiry, dte: sl.dte, type,
          iv: null, mid: 0, delta: null, omega: null, nd2: null, invNd2: null,
        });
        continue;
      }
      const midRaw = q.mid != null && q.mid > 0 ? q.mid : blackScholes(type, snap.spot, K, T, snap.riskFreeRate, snap.dividendYield, q.iv).price;
      const mid = midRaw ?? 0;
      const g = blackScholes(type, snap.spot, K, T, snap.riskFreeRate, snap.dividendYield, q.iv);
      const omega = mid > 1e-8 ? (g.delta * snap.spot) / mid : null;
      const nd2 = nd2Of(type, snap.spot, K, T, snap.riskFreeRate, snap.dividendYield, q.iv);
      const invNd2 = nd2 > 1e-4 ? 1 / nd2 : null;
      row.push({
        strike: K, expiry: sl.expiry, dte: sl.dte, type,
        iv: q.iv, mid, delta: g.delta, omega, nd2, invNd2,
      });
    }
    cells.push(row);
  }

  return {
    strikes: useStrikes,
    expiries: slices.map(s => s.expiry),
    dtes: slices.map(s => s.dte),
    cells,
  };
}
