/**
 * Delta-hedging simulators (Thalex Hedging + Delta Follower).
 *
 * Modes:
 *  - threshold: rehedge when |Δ_net| exceeds threshold
 *  - tolerance: band around target delta (default 0)
 *  - period: rehedge every N steps
 */

import { priceGreeksMarket } from '../math/adapters';
import { yearFractionFromSlice } from './time';
import type { VolSnapshot } from './types';

export type HedgeMode = 'threshold' | 'tolerance' | 'period';

export interface HedgeConfig {
  mode: HedgeMode;
  /** |delta| trigger for threshold mode (e.g. 0.1) */
  threshold: number;
  /** Half-width of do-nothing band for tolerance mode */
  tolerance: number;
  /** Rehedge every N steps for period mode */
  periodSteps: number;
  /** Option type */
  type: 'call' | 'put';
  strike: number;
  /** Years to expiry at t=0 */
  T: number;
  /** Option IV used for marking */
  vol: number;
  /** Realized vol of the underlying path */
  realizedVol: number;
  /** Drift of the underlying */
  drift: number;
  /** Horizon days */
  days: number;
  steps: number;
  /** Position: +1 long option, −1 short */
  optionQty: number;
  /** Hedge instrument: spot or future (delta 1) */
  hedgeInstrument: 'spot' | 'future';
  seed?: number;
  r?: number;
  q?: number;
}

export interface HedgeStep {
  tDay: number;
  spot: number;
  optionDelta: number;
  hedgeQty: number;
  netDelta: number;
  optionMark: number;
  hedgeMark: number;
  cash: number;
  totalPnl: number;
  hedged: boolean;
}

export interface HedgeResult {
  steps: HedgeStep[];
  tradeCount: number;
  terminalPnl: number;
  maxDrawdown: number;
  avgAbsNetDelta: number;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boxMuller(rand: () => number): number {
  const u = Math.max(1e-12, rand());
  const v = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Simulate delta-hedging of a single option over a GBM path.
 */
export function simulateDeltaHedge(cfg: HedgeConfig, S0: number): HedgeResult {
  const rand = rng(cfg.seed ?? 7);
  const r = cfg.r ?? 0.05;
  const q = cfg.q ?? 0;
  const dt = (cfg.days / 365) / cfg.steps;
  const sig = cfg.realizedVol;

  let S = S0;
  let T = cfg.T;
  let hedgeQty = 0;
  let cash = 0;
  let tradeCount = 0;

  const entryOpt = priceGreeksMarket(cfg.type, S, cfg.strike, Math.max(T, 1e-8), r, q, cfg.vol);
  // Finance option purchase: pay premium
  cash -= cfg.optionQty * entryOpt.price;

  // Initial hedge to net-zero delta
  const target0 = -cfg.optionQty * entryOpt.delta;
  cash -= target0 * S; // buy/sell hedge
  hedgeQty = target0;
  tradeCount++;

  const steps: HedgeStep[] = [];
  let peak = 0;
  let maxDD = 0;
  let absDeltaSum = 0;

  for (let i = 0; i <= cfg.steps; i++) {
    const tDay = (cfg.days * i) / cfg.steps;
    T = Math.max(1e-8, cfg.T - tDay / 365);
    const opt = priceGreeksMarket(cfg.type, S, cfg.strike, T, r, q, cfg.vol);
    const optionDelta = opt.delta;
    const netDelta = cfg.optionQty * optionDelta + hedgeQty;
    const optionMark = cfg.optionQty * opt.price;
    const hedgeMark = hedgeQty * S;
    const totalPnl = cash + optionMark + hedgeMark;

    peak = Math.max(peak, totalPnl);
    maxDD = Math.max(maxDD, peak - totalPnl);
    absDeltaSum += Math.abs(netDelta);

    let hedged = false;
    if (i > 0 && i < cfg.steps) {
      let should = false;
      if (cfg.mode === 'threshold') {
        should = Math.abs(netDelta) >= cfg.threshold;
      } else if (cfg.mode === 'tolerance') {
        should = Math.abs(netDelta) > cfg.tolerance;
      } else if (cfg.mode === 'period') {
        should = i % Math.max(1, cfg.periodSteps) === 0;
      }
      if (should) {
        const targetHedge = -cfg.optionQty * optionDelta;
        const dH = targetHedge - hedgeQty;
        cash -= dH * S;
        hedgeQty = targetHedge;
        tradeCount++;
        hedged = true;
      }
    }

    steps.push({
      tDay, spot: S, optionDelta, hedgeQty,
      netDelta: cfg.optionQty * optionDelta + hedgeQty,
      optionMark, hedgeMark, cash, totalPnl, hedged,
    });

    if (i < cfg.steps) {
      const z = boxMuller(rand);
      S = S * Math.exp((cfg.drift - 0.5 * sig * sig) * dt + sig * Math.sqrt(dt) * z);
    }
  }

  // Liquidate at end
  const last = steps[steps.length - 1]!;
  return {
    steps,
    tradeCount,
    terminalPnl: last.totalPnl,
    maxDrawdown: maxDD,
    avgAbsNetDelta: absDeltaSum / steps.length,
  };
}

/** Defaults for UI from a live snapshot. */
export function defaultHedgeFromSnapshot(snap: VolSnapshot): Partial<HedgeConfig> {
  const slice = snap.expiries.find(e => e.dte >= 7) ?? snap.expiries[0];
  if (!slice) return {};
  const atm = slice.calls.reduce((b, q) =>
    Math.abs(q.strike - snap.spot) < Math.abs(b.strike - snap.spot) ? q : b
  , slice.calls[0]!);
  return {
    type: 'call',
    strike: atm.strike,
    T: yearFractionFromSlice(slice),
    vol: atm.iv ?? slice.atmIV,
    realizedVol: slice.atmIV,
    drift: 0,
    days: Math.min(slice.dte, 30),
    steps: 60,
    optionQty: -1, // short option (classic MM)
    hedgeInstrument: 'spot',
    mode: 'threshold',
    threshold: 0.1,
    tolerance: 0.05,
    periodSteps: 5,
    r: snap.riskFreeRate,
    q: snap.dividendYield,
  };
}

/**
 * Delta-follower bot: track a target option delta with a future/spot hedge
 * that rebalances continuously (or on band).
 */
export function simulateDeltaFollower(
  snap: VolSnapshot,
  opts: {
    type: 'call' | 'put';
    strike: number;
    expiry: string;
    /** Target position in the option */
    optionQty: number;
    band: number;
    days: number;
    steps: number;
    realizedVol: number;
    drift: number;
    seed?: number;
  },
): HedgeResult {
  const slice = snap.expiries.find(e => e.expiry === opts.expiry) ?? snap.expiries[0]!;
  const qte = (opts.type === 'call' ? slice.calls : slice.puts)
    .reduce((b, q) => Math.abs(q.strike - opts.strike) < Math.abs(b.strike - opts.strike) ? q : b,
      (opts.type === 'call' ? slice.calls : slice.puts)[0]!);

  return simulateDeltaHedge({
    mode: 'tolerance',
    threshold: opts.band,
    tolerance: opts.band,
    periodSteps: 1,
    type: opts.type,
    strike: qte.strike,
    T: yearFractionFromSlice(slice),
    vol: qte.iv ?? slice.atmIV,
    realizedVol: opts.realizedVol,
    drift: opts.drift,
    days: opts.days,
    steps: opts.steps,
    optionQty: opts.optionQty,
    hedgeInstrument: 'future',
    seed: opts.seed,
    r: snap.riskFreeRate,
    q: snap.dividendYield,
  }, snap.spot);
}
