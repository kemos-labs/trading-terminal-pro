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

import { priceGreeksMarket } from '../math/adapters';
import type { PortfolioLeg } from './portfolio';
import { entryBasisValidFor, evaluateCombo } from './portfolio';
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
  /** Discriminated: false = unavailable (do not render zero as valid). */
  available: boolean;
  reason?: string;
  terminalPnl: number | null;
  totalDelta: number | null;
  totalGamma: number | null;
  totalTheta: number | null;
  totalVega: number | null;
  totalResidual: number | null;
  /** How marks were produced — scenario vs historical. */
  method: 'bs-sticky-iv' | 'scenario-synthetic-gbm-sticky-iv';
  /** Provenance label for UI — observed underlying replay vs scenario */
  provenance: 'observed-history' | 'scenario-synthetic';
  /** Vega attribution note: sticky IV ⇒ 0 vol move */
  vegaNote: string;
}

function legVol(snap: VolSnapshot, leg: PortfolioLeg): number | null {
  if (leg.iv != null && leg.iv > 0) return leg.iv;
  if (leg.kind === 'spot' || leg.kind === 'future' || !leg.expiry) return null;
  const slice = snap.expiries.find(e => e.expiry === leg.expiry);
  if (!slice) return null;
  const list = leg.kind === 'call' ? slice.calls : slice.puts;
  if (leg.strike != null) {
    const q = list.reduce((b, x) =>
      Math.abs(x.strike - leg.strike!) < Math.abs(b.strike - leg.strike!) ? x : b
    , list[0]!);
    if (q?.iv != null && q.iv > 0) return q.iv;
  }
  // No silent 25% — use slice atmIV only if explicitly observed
  return slice.atmIV > 0 ? slice.atmIV : null;
}

function legT0(snap: VolSnapshot, leg: PortfolioLeg): number | null {
  if (!leg.expiry) return null;
  const slice = snap.expiries.find(e => e.expiry === leg.expiry);
  if (slice) return yearFractionFromSlice(slice);
  // No dummy 2099 or 30d — unavailable if expiry not in snapshot
  return null;
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
    pathProvenance?: 'observed-history' | 'scenario-synthetic';
    /** Override IV; else surface */
    iv?: number;
    /** Explicit executable entry price: long→ask, short→bid; null forces unavailable */
    entryPrice?: number | null;
    entryBasis?: 'ask' | 'bid' | 'user' | null;
  },
): GreeksPnlSeries {
  const side = opts.side ?? 'long';
  const hasExplicit = opts.entryPrice !== undefined;
  const entryPrice = hasExplicit ? (opts.entryPrice ?? null) : null;
  // Fail-closed: no silent 0 — explicit executable price required
  const entryBasis = hasExplicit ? (opts.entryBasis ?? null) : null;
  const leg: PortfolioLeg = {
    id: '1',
    kind: opts.type,
    side,
    qty: opts.qty ?? 1,
    strike: opts.strike,
    expiry: opts.expiry,
    entryPrice,
    entryBasis,
    iv: opts.iv,
  };
  return comboGreeksPnl([leg], snap, opts.path, opts.pathProvenance);
}

/**
 * Multi-leg historical greek PnL (Thalex Combo PnL).
 */
export function comboGreeksPnl(
  legs: PortfolioLeg[],
  snap: VolSnapshot,
  path: SpotBar[],
  pathProvenance: 'observed-history' | 'scenario-synthetic' = 'observed-history',
): GreeksPnlSeries {
  // Fail-closed: missing legs/expiry/IV/entryPrice or an invalid executable
  // basis (mid/last substitution) → unavailable, never silently priced.
  const hasMissingLeg = legs.some((l) => {
    if (l.kind === 'spot' || l.kind === 'future') return false;
    if (l.strike == null || !l.expiry) return true;
    if (l.entryPrice == null || !isFinite(l.entryPrice as number) || (l.entryPrice as number) <= 0) return true;
    if (!entryBasisValidFor(l)) return true;
    const T0 = legT0(snap, l);
    if (T0 == null) return true;
    const v = legVol(snap, l);
    if (v == null) return true;
    return false;
  });
  if (hasMissingLeg) {
    return {
      bars: [], available: false, reason: 'missing-expiry-or-iv-or-entryPrice',
      terminalPnl: null, totalDelta: null, totalGamma: null,
      totalTheta: null, totalVega: null, totalResidual: null,
      method: pathProvenance === 'scenario-synthetic' ? 'scenario-synthetic-gbm-sticky-iv' : 'bs-sticky-iv',
      provenance: pathProvenance,
      vegaNote: 'Unavailable — missing expiry/IV/entryPrice (fail-closed)',
    };
  }
  if (!path.length || !legs.length) {
    return {
      bars: [], available: false, reason: !legs.length ? 'no-legs' : 'no-history',
      terminalPnl: null, totalDelta: null, totalGamma: null,
      totalTheta: null, totalVega: null, totalResidual: null,
      method: pathProvenance === 'scenario-synthetic' ? 'scenario-synthetic-gbm-sticky-iv' : 'bs-sticky-iv',
      provenance: pathProvenance, vegaNote: pathProvenance === 'scenario-synthetic' ? 'Scenario synthetic GBM — sticky IV, vega 0' : 'Sticky IV — 0 vol move by construction',
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
  if (entryMark == null) {
    return {
      bars: [], available: false, reason: 'unavailable-mark', terminalPnl: null,
      totalDelta: null, totalGamma: null, totalTheta: null, totalVega: null, totalResidual: null,
      method: pathProvenance === 'scenario-synthetic' ? 'scenario-synthetic-gbm-sticky-iv' : 'bs-sticky-iv',
      provenance: pathProvenance, vegaNote: 'Unavailable — missing market mark (fail-closed)',
    };
  }
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
      if (T0 == null) continue;
      const T = Math.max(1e-8, T0 - daysElapsed / 365);
      const volRaw = legVol(snap, leg);
      if (volRaw == null || !(volRaw > 0)) continue; // P0: no silent 25% fallback — unavailable IV skips leg
      const vol = volRaw;
      if (T <= 1e-8) {
        delta += sgn * (leg.kind === 'call' ? (S > leg.strike ? 1 : 0) : (S < leg.strike ? -1 : 0));
        continue;
      }
      const g = priceGreeksMarket(leg.kind, S, leg.strike, T, r, q, vol);
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
    if (mark == null || prevMark == null) return {
      bars: [], available: false, reason: 'unavailable-mark', terminalPnl: null,
      totalDelta: null, totalGamma: null, totalTheta: null, totalVega: null, totalResidual: null,
      method: pathProvenance === 'scenario-synthetic' ? 'scenario-synthetic-gbm-sticky-iv' : 'bs-sticky-iv',
      provenance: pathProvenance, vegaNote: 'Unavailable — missing market mark (fail-closed)',
    };
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
  const isSynthetic = pathProvenance === 'scenario-synthetic';
  return {
    bars,
    available: true,
    terminalPnl: last.pnl,
    totalDelta: cumDelta,
    totalGamma: cumGamma,
    totalTheta: cumTheta,
    totalVega: cumVega,
    totalResidual: cumResidual,
    method: isSynthetic ? 'scenario-synthetic-gbm-sticky-iv' : 'bs-sticky-iv',
    provenance: pathProvenance,
    vegaNote: isSynthetic ? 'Scenario synthetic GBM — sticky IV, vega 0 (model-repriced)' : 'Historical underlying replay with model-repriced options — sticky IV, vega 0',
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
