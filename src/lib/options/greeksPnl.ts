/**
 * Greek-attributed mark PnL along a spot path (scenario model).
 *
 * P0: This is a user-controlled scenario model — NOT historical market PnL.
 * Without exchange option-mark history we sticky-strike reprice with Black–Scholes
 * using the current surface IV, then decompose bar-to-bar moves:
 *   Δ·dS + ½Γ·dS² + Θ·dT + ν·dσ  (+ residual)
 * Sticky IV ⇒ vega attribution is 0 by construction (labelled). For historical
 * PnL, use observed HistoryToSpotBars with provenance; synthetic paths carry
 * method 'scenario-synthetic-gbm-sticky-iv' and must be labelled Scenario.
 *
 * Greeks come from computeGreeks (θ per day, ν per 1 vol point).
 */

import { computeGreeks } from './greeks';
import type { PortfolioLeg } from './portfolio';
import { evaluateCombo } from './portfolio';
import { yearFractionFromSlice } from './time';
import type { VolSnapshot } from './types';

export interface SpotBar {
  /** Epoch ms */
  ts: number;
  close: number;
}

export interface GreeksPnlBar {
  ts: number;
  dateLabel: string;
  spot: number;
  mark: number;
  /** Cumulative mark PnL from first bar */
  pnl: number;
  /** Incremental attributed components this bar */
  dPnl: number;
  deltaPnl: number;
  gammaPnl: number;
  thetaPnl: number;
  vegaPnl: number;
  residualPnl: number;
  attributedPnl: number;
  /** Cumulative attributed */
  cumDelta: number;
  cumGamma: number;
  cumTheta: number;
  cumVega: number;
  cumResidual: number;
}

export interface GreeksPnlSeries {
  bars: GreeksPnlBar[];
  terminalPnl: number;
  totalDelta: number;
  totalGamma: number;
  totalTheta: number;
  totalVega: number;
  totalResidual: number;
  /** How marks were produced — scenario vs historical. */
  method: 'bs-sticky-iv' | 'scenario-synthetic-gbm-sticky-iv';
  /** Provenance label for UI */
  provenance: 'observed-history' | 'scenario-synthetic';
  /** Vega attribution note: sticky IV ⇒ 0 vol move */
  vegaNote: string;
}

function legVol(snap: VolSnapshot, leg: PortfolioLeg): number | null {
  if (leg.iv != null && leg.iv > 0) return leg.iv;
  if (leg.kind === 'spot' || leg.kind === 'future' || !leg.expiry) return null;
  const slice = snap.expiries.find(e => e.expiry === leg.expiry);
  if (!slice) {
    const fallback = snap.expiries[0]?.atmIV;
    return fallback != null && fallback > 0 ? fallback : null;
  }
  const list = leg.kind === 'call' ? slice.calls : slice.puts;
  if (leg.strike != null) {
    const q = list.reduce((b, x) =>
      Math.abs(x.strike - leg.strike!) < Math.abs(b.strike - leg.strike!) ? x : b
    , list[0]!);
    if (q?.iv != null && q.iv > 0) return q.iv;
  }
  return slice.atmIV > 0 ? slice.atmIV : null;
}

function legT0(snap: VolSnapshot, leg: PortfolioLeg): number {
  if (!leg.expiry) return yearFractionFromSlice({ expiry: '2099-01-01', dte: 30 });
  const slice = snap.expiries.find(e => e.expiry === leg.expiry);
  if (slice) return yearFractionFromSlice(slice);
  return yearFractionFromSlice({ expiry: leg.expiry, dte: 30 });
}

/**
 * Build a synthetic daily path — SCENARIO MODEL ONLY, never Historical.
 * P0: Must be labelled Scenario — synthetic GBM around current spot.
 * Used when observed history is unavailable and caller explicitly accepts scenario.
 */
export function syntheticSpotPath(
  spot: number,
  days = 30,
  vol = 0.2,
  seed = 17,
): SpotBar[] {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: SpotBar[] = [];
  const now = Date.now();
  let S = spot * Math.exp(-0.5 * vol * vol * (days / 365)); // start slightly back
  // Rewind with reverse GBM-ish then walk forward to land near spot
  const path: number[] = [S];
  for (let i = 1; i <= days; i++) {
    const z = (rand() * 2 - 1) * Math.sqrt(3); // rough
    S = S * Math.exp((-0.5 * vol * vol) * (1 / 365) + vol * Math.sqrt(1 / 365) * z);
    path.push(S);
  }
  // Scale path so last close ≈ spot
  const scale = spot / path[path.length - 1]!;
  for (let i = 0; i < path.length; i++) {
    out.push({
      ts: now - (days - i) * 86_400_000,
      close: path[i]! * scale,
    });
  }
  return out;
}

/** Convert FMP/yfinance-style bars to SpotBar[]. */
export function historyToSpotBars(
  history: { date: string; close: number }[] | null | undefined,
  maxBars = 60,
): SpotBar[] {
  if (!history?.length) return [];
  const slice = history.slice(-maxBars);
  return slice
    .filter(b => b.close > 0 && isFinite(b.close))
    .map(b => ({
      ts: Date.parse(b.date.includes('T') ? b.date : `${b.date}T16:00:00Z`),
      close: b.close,
    }))
    .filter(b => Number.isFinite(b.ts));
}

/**
 * Single-option historical greek PnL (Thalex Option PnL).
 * Sticky IV; residual T shrinks with calendar time on the path.
 */
export function optionGreeksPnl(
  snap: VolSnapshot,
  opts: {
    type: 'call' | 'put';
    strike: number;
    expiry: string;
    qty?: number;
    side?: 'long' | 'short';
    path: SpotBar[];
    /** Override IV; else surface */
    iv?: number;
  },
): GreeksPnlSeries {
  const leg: PortfolioLeg = {
    id: '1',
    kind: opts.type,
    side: opts.side ?? 'long',
    qty: opts.qty ?? 1,
    strike: opts.strike,
    expiry: opts.expiry,
    entryPrice: 0,
    iv: opts.iv,
  };
  return comboGreeksPnl([leg], snap, opts.path);
}

/**
 * Multi-leg historical greek PnL (Thalex Combo PnL).
 */
export function comboGreeksPnl(
  legs: PortfolioLeg[],
  snap: VolSnapshot,
  path: SpotBar[],
): GreeksPnlSeries {
  if (!path.length || !legs.length) {
    return {
      bars: [], terminalPnl: 0, totalDelta: 0, totalGamma: 0,
      totalTheta: 0, totalVega: 0, totalResidual: 0, method: 'bs-sticky-iv',
      provenance: 'observed-history', vegaNote: 'Sticky IV — 0 vol move by construction',
    };
  }

  const r = snap.riskFreeRate;
  const q = snap.dividendYield;
  const t0 = path[0]!.ts;
  const bars: GreeksPnlBar[] = [];

  let cumDelta = 0;
  let cumGamma = 0;
  let cumTheta = 0;
  let cumVega = 0;
  let cumResidual = 0;

  // Entry mark at first bar
  const days0 = 0;
  const entryMark = evaluateCombo(legs, snap, { spot: path[0]!.close, daysElapsed: days0 }).mark;
  let prevMark = entryMark;
  let prevSpot = path[0]!.close;
  let prevTs = path[0]!.ts;

  // Greeks at open of each bar for attribution
  const greeksAt = (S: number, daysElapsed: number) => {
    let delta = 0, gamma = 0, theta = 0, vega = 0;
    for (const leg of legs) {
      const sgn = (leg.side === 'long' ? 1 : -1) * leg.qty;
      if (leg.kind === 'spot' || leg.kind === 'future') {
        delta += sgn;
        continue;
      }
      if (leg.strike == null || !leg.expiry) continue;
      const T0 = legT0(snap, leg);
      const T = Math.max(1e-8, T0 - daysElapsed / 365);
      const volRaw = legVol(snap, leg);
      if (volRaw == null || !(volRaw > 0)) continue; // P0: no silent 25% fallback — unavailable IV skips leg
      const vol = volRaw;
      if (T <= 1e-8) {
        delta += sgn * (leg.kind === 'call' ? (S > leg.strike ? 1 : 0) : (S < leg.strike ? -1 : 0));
        continue;
      }
      const g = computeGreeks(leg.kind, S, leg.strike, T, r, q, vol);
      delta += sgn * g.delta;
      gamma += sgn * g.gamma;
      theta += sgn * g.theta; // per day
      vega += sgn * g.vega;   // per 1 vol point
    }
    return { delta, gamma, theta, vega };
  };

  const firstG = greeksAt(path[0]!.close, 0);
  bars.push({
    ts: path[0]!.ts,
    dateLabel: formatDay(path[0]!.ts),
    spot: path[0]!.close,
    mark: entryMark,
    pnl: 0,
    dPnl: 0,
    deltaPnl: 0, gammaPnl: 0, thetaPnl: 0, vegaPnl: 0,
    residualPnl: 0, attributedPnl: 0,
    cumDelta: 0, cumGamma: 0, cumTheta: 0, cumVega: 0, cumResidual: 0,
  });

  for (let i = 1; i < path.length; i++) {
    const bar = path[i]!;
    const daysElapsed = Math.max(0, (bar.ts - t0) / 86_400_000);
    const mark = evaluateCombo(legs, snap, { spot: bar.close, daysElapsed }).mark;
    const dPnl = mark - prevMark;
    const dS = bar.close - prevSpot;
    const dTdays = Math.max(0, (bar.ts - prevTs) / 86_400_000);

    // Attribute using greeks at previous bar (Thalex-style open greeks)
    const g = i === 1 ? firstG : greeksAt(prevSpot, Math.max(0, (prevTs - t0) / 86_400_000));
    const deltaPnl = g.delta * dS;
    const gammaPnl = 0.5 * g.gamma * dS * dS;
    const thetaPnl = g.theta * dTdays;
    const vegaPnl = 0; // sticky IV → no vol move attributed
    const attributed = deltaPnl + gammaPnl + thetaPnl + vegaPnl;
    const residual = dPnl - attributed;

    cumDelta += deltaPnl;
    cumGamma += gammaPnl;
    cumTheta += thetaPnl;
    cumVega += vegaPnl;
    cumResidual += residual;

    bars.push({
      ts: bar.ts,
      dateLabel: formatDay(bar.ts),
      spot: bar.close,
      mark,
      pnl: mark - entryMark,
      dPnl,
      deltaPnl,
      gammaPnl,
      thetaPnl,
      vegaPnl,
      residualPnl: residual,
      attributedPnl: attributed,
      cumDelta,
      cumGamma,
      cumTheta,
      cumVega,
      cumResidual,
    });

    prevMark = mark;
    prevSpot = bar.close;
    prevTs = bar.ts;
  }

  const last = bars[bars.length - 1]!;
  return {
    bars,
    terminalPnl: last.pnl,
    totalDelta: cumDelta,
    totalGamma: cumGamma,
    totalTheta: cumTheta,
    totalVega: cumVega,
    totalResidual: cumResidual,
    method: 'bs-sticky-iv',
    provenance: 'observed-history',
    vegaNote: 'Sticky IV — 0 vol move by construction (vega = 0). Not a live vol PnL.',
  };

}

function formatDay(ts: number): string {
  try {
    return new Date(ts).toISOString().slice(5, 10);
  } catch {
    return '';
  }
}

/**
 * Straddle break-evens at expiry for long or short ATM (or given strike) straddle.
 * Long: BE = K ± premium_total; Short: same crossings (payoff zero).
 */
export function straddleBreakEvens(
  strike: number,
  callMid: number,
  putMid: number,
  side: 'long' | 'short' = 'long',
): { upper: number; lower: number; totalPremium: number; side: 'long' | 'short' } {
  const totalPremium = callMid + putMid;
  return {
    upper: strike + totalPremium,
    lower: strike - totalPremium,
    totalPremium,
    side,
  };
}
