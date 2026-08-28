import type { VolSnapshot, GreeksProfile, SensitivityMatrix } from './types';
import { priceGreeksMarket } from '../math/adapters';
import { normCdf } from '../math/norm';
import { yearFractionFromSlice } from './time';

/** Unit greek keys available on each quote for strike profiles. */
export type ProfileGreekKey = 'delta' | 'gamma' | 'theta' | 'vega' | 'vanna' | 'charm';

/**
 * Generates a Greeks profile for a specific expiry (per listed quote — call and put rows).
 * Includes charm / vanna for Benn-style second-order desk profiles.
 */
export function greeksProfile(
  snap: VolSnapshot,
  expiryIdx: number,
  key: ProfileGreekKey,
): GreeksProfile {
  const slice = snap.expiries[expiryIdx];
  if (!slice) return { strikes: [], values: [] };

  const allQuotes = [...slice.calls, ...slice.puts];
  allQuotes.sort((a, b) => a.strike - b.strike);

  const strikes: number[] = [];
  const values: number[] = [];
  for (const q of allQuotes) {
    strikes.push(q.strike);
    const g = q[key];
    values.push(g ?? 0);
  }

  return { strikes, values };
}

/**
 * Calculates portfolio sensitivity to spot price changes
 * @param snap - Volatility snapshot containing option data
 * @returns Sensitivity matrix showing portfolio Greeks under different spot price scenarios
 */
export function spotSensitivity(snap: VolSnapshot): SensitivityMatrix {
  const spot = snap.spot;
  const shocks = [-0.05, 0, 0.05];
  const ivShocks = [-0.05, 0, 0.05];

  const delta: number[] = [];
  const gamma: number[] = [];
  const vega: number[] = [];
  const theta: number[] = [];

  for (const s of shocks) {
    const S = spot * (1 + s);
    let dSum = 0, gSum = 0, vSum = 0, tSum = 0;
    for (const slice of snap.expiries) {
      for (const q of [...slice.calls, ...slice.puts]) {
        if (q.iv == null || q.iv <= 0) continue;
        const T = yearFractionFromSlice(slice);
        if (T <= 0) continue;
        const g = priceGreeksMarket(q.type, S, q.strike, T, snap.riskFreeRate, snap.dividendYield, q.iv);
        dSum += g.delta;
        gSum += g.gamma;
        vSum += g.vega;
        tSum += g.theta;
      }
    }
    delta.push(dSum);
    gamma.push(gSum);
    vega.push(vSum);
    theta.push(tSum);
  }

  return { spotShocks: shocks, ivShocks, delta, gamma, vega, theta };
}

/**
 * Calculates portfolio sensitivity to volatility changes
 * @param snap - Volatility snapshot containing option data
 * @returns Sensitivity matrix showing portfolio Greeks under different volatility scenarios
 */
export function ivSensitivity(snap: VolSnapshot): SensitivityMatrix {
  const shocks = [-0.05, 0, 0.05];
  const ivShocks = [-0.2, 0, 0.2];

  const delta: number[] = [];
  const gamma: number[] = [];
  const vega: number[] = [];
  const theta: number[] = [];

  for (const ivS of ivShocks) {
    let dSum = 0, gSum = 0, vSum = 0, tSum = 0;
    for (const slice of snap.expiries) {
      for (const q of [...slice.calls, ...slice.puts]) {
        if (q.iv == null || q.iv <= 0) continue;
        const T = yearFractionFromSlice(slice);
        if (T <= 0) continue;
        const vol = Math.max(0.01, q.iv * (1 + ivS));
        const g = priceGreeksMarket(q.type, snap.spot, q.strike, T, snap.riskFreeRate, snap.dividendYield, vol);
        dSum += g.delta;
        gSum += g.gamma;
        vSum += g.vega;
        tSum += g.theta;
      }
    }
    delta.push(dSum);
    gamma.push(gSum);
    vega.push(vSum);
    theta.push(tSum);
  }

  return { spotShocks: shocks, ivShocks, delta, gamma, vega, theta };
}

/**
 * Aggregates portfolio Greeks by expiry date
 * @param snap - Volatility snapshot containing option data
 * @returns Array of expiry buckets with aggregated Greeks
 */
export function netByExpiry(snap: VolSnapshot) {
  return snap.expiries.map(slice => {
    let delta = 0, gamma = 0, vega = 0;
    for (const q of [...slice.calls, ...slice.puts]) {
      delta += q.delta ?? 0;
      gamma += q.gamma ?? 0;
      vega += q.vega ?? 0;
    }
    return { expiry: slice.expiry, dte: slice.dte, delta, gamma, vega };
  });
}

/**
 * Front-month expected move from the ATM straddle.
 *
 * Near-term ATM straddle ≈ 0.8 · S · σ · √T  (BS ATM approx),
 * while 1σ move = S · σ · √T, so:
 *   1σ ≈ straddle / 0.8
 *
 * Fallback when no liquid straddle: S · atmIV · √T (continuous yearFractionFromSlice).
 *
 * probTouch ≈ one-sided barrier touch of the +move level under zero-drift BM
 * (reflection): 2 · N(−d) with d = move / (S σ √T). Not a two-sided finish prob.
 */
export function impliedMove(snap: VolSnapshot) {
  if (snap.expiries.length === 0) return { move: 0, movePct: 0, probTouch: 0, straddle: 0 };
  const front = snap.expiries[0]!;
  const calls = front.calls;
  const puts = front.puts;

  // Prefer the ATM straddle (strike closest to spot with both call + put mids).
  let straddle = 0;
  let bestDist = Infinity;
  for (const c of calls) {
    if (!(c.mid != null && c.mid > 0)) continue;
    const p = puts.find((pp) => pp.strike === c.strike);
    if (!p || !(p.mid != null && p.mid > 0)) continue;
    const dist = Math.abs(c.strike - snap.spot);
    if (dist < bestDist) {
      bestDist = dist;
      straddle = (c.mid as number) + (p.mid as number);
    }
  }

  // 1σ: straddle ≈ 0.8 × 1σ  ⇒  1σ ≈ straddle / 0.8
  const T = yearFractionFromSlice(front);
  const move = straddle > 0
    ? straddle / 0.8
    : snap.spot * front.atmIV * Math.sqrt(T);
  const movePct = snap.spot > 0 ? move / snap.spot : 0;
  const sig = Math.max(front.atmIV > 0 ? front.atmIV : 0.2, 0.01);
  const d = move / (snap.spot * sig * Math.sqrt(T) + 1e-12);
  // Reflection principle: P(touch upper barrier at +move) for driftless BM.
  const probTouch = Math.min(0.99, Math.max(0, 2 * (1 - normCdf(Math.abs(d)))));

  return { move, movePct, probTouch, straddle };
}

/**
 * Calculates the max pain strike price
 * Max pain is the strike price at which option writers (sellers) would experience the least pain
 * (minimum total intrinsic value of options at expiration)
 * @param snap - Volatility snapshot containing option data
 * @returns The max pain strike price, or null if no data available
 */
export function maxPainStrike(snap: VolSnapshot): number | null {
  if (!snap.expiries[0]) return null;
  const slice = snap.expiries[0];
  const allStrikes = [...new Set([...slice.calls, ...slice.puts].map(q => q.strike))].sort((a, b) => a - b);

  let minPain = Infinity;
  let maxPain = allStrikes[0] ?? snap.spot;

  // Max pain = the settlement strike that minimises the aggregate intrinsic
  // value of outstanding options. For each candidate `strike`, assume the
  // underlying settles there: calls are ITM when settlement > K, puts when K > settlement.
  for (const strike of allStrikes) {
    let pain = 0;
    for (const q of [...slice.calls, ...slice.puts]) {
      if ((q.openInterest ?? 0) <= 0) continue;
      if (q.type === 'call') {
        pain += Math.max(0, strike - q.strike) * (q.openInterest ?? 0);
      } else {
        pain += Math.max(0, q.strike - strike) * (q.openInterest ?? 0);
      }
    }
    if (pain < minPain) {
      minPain = pain;
      maxPain = strike;
    }
  }

  return maxPain;
}

/**
 * Sum of listed option Greeks across the full chain (inventory scan).
 * This is NOT position / book risk — it scales with how many strikes are quoted.
 * Prefer multi-leg portfolio tools for real desk risk.
 */
export function portfolioGreeks(snap: VolSnapshot) {
  let delta = 0, gamma = 0, theta = 0, vega = 0;
  for (const slice of snap.expiries) {
    for (const q of [...slice.calls, ...slice.puts]) {
      delta += q.delta ?? 0;
      gamma += q.gamma ?? 0;
      theta += q.theta ?? 0;
      vega += q.vega ?? 0;
    }
  }
  return { delta, gamma, theta, vega };
}

/**
 * Calculates IV Rank and IV Percentile based on historical data
 * IV Rank shows where current IV falls within its historical range (0-1)
 * IV Percentile shows what percentage of historical values are below current IV
 * @param frames - Array of historical volatility snapshots
 * @param currentIdx - Index of the current frame in the history
 * @returns Object containing IV rank (0-1) and percentile (0-100)
 */
export function ivRank(frames: { snapshot: VolSnapshot }[], currentIdx: number): { rank: number; percentile: number } {
  if (frames.length < 2) return { rank: 0.5, percentile: 50 };
  const current = frames[currentIdx]?.snapshot;
  if (!current) return { rank: 0.5, percentile: 50 };

  const currentATM = current.expiries[0]?.atmIV ?? 0;
  const histIVs: number[] = [];
  for (const f of frames) {
    const iv = f.snapshot.expiries[0]?.atmIV;
    if (iv != null) histIVs.push(iv);
  }
  if (histIVs.length === 0) return { rank: 0.5, percentile: 50 };

  const min = Math.min(...histIVs);
  const max = Math.max(...histIVs);
  const rank = max - min === 0 ? 0.5 : (currentATM - min) / (max - min);
  const below = histIVs.filter(iv => iv <= currentATM).length;
  const percentile = (below / histIVs.length) * 100;

  return { rank: Math.max(0, Math.min(1, rank)), percentile };
}

/**
 * Weight for dealer exposure aggregates.
 * - oi: open interest (canonical SpotGamma-style)
 * - volume: session volume (fallback when free feeds zero OI)
 * - unit: 1 per listed contract with OI, volume, or non-zero gamma
 */
export type ExposureWeight = 'oi' | 'volume' | 'unit';

export type DealerMetric = 'gex' | 'dex' | 'vex' | 'charm';

export interface DealerPoint {
  strike: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
  /** $ delta notional (customer long OI): δ · S · w · mult */
  callDEX: number;
  putDEX: number;
  netDEX: number;
  /** Vanna × S × w × mult (vol×spot cross) */
  callVEX: number;
  putVEX: number;
  netVEX: number;
  /** Charm per day × S × w × mult ($ delta bleed / day) */
  callCharm: number;
  putCharm: number;
  netCharm: number;
}

export interface DealerExposure {
  points: DealerPoint[];
  totalGEX: number;
  totalDEX: number;
  totalVEX: number;
  totalCharm: number;
  gammaFlip: number | null;
  /** Call Resistance — strike of max call GEX (MenthorQ CR). */
  callWall: number | null;
  /** Put Support — strike of most negative put GEX (MenthorQ PS). */
  putWall: number | null;
  /**
   * High Vol Level — strike of max |net GEX| (vol magnet / key γ node).
   * MenthorQ-style HVL proxy from public OI; not proprietary.
   */
  highVolLevel: number | null;
  /** Weight actually applied (may auto-fallback from oi → volume/unit). */
  weight: ExposureWeight;
  /** True when caller asked for oi but feed had no OI. */
  weightFallback: boolean;
  unitNote: string;
}

/** One expiry row for MenthorQ-style matrix. */
export interface DealerExpiryRow {
  expiry: string;
  dte: number;
  totalGEX: number;
  totalDEX: number;
  gexShare: number;
  dexShare: number;
  callWall: number | null;
  putWall: number | null;
  highVolLevel: number | null;
  gammaFlip: number | null;
  /** Front ATM-style expected move when atmIV present. */
  expMove: number | null;
}

/** Profile series for dual-axis GEX/DEX charts. */
export interface DealerProfilePoint {
  strike: number;
  netGEX: number;
  netDEX: number;
  netCharm: number;
  /** Running sum of netGEX (low→high strikes). */
  gexCum: number;
  /** Running sum of netDEX. */
  dexCum: number;
  /** Running sum of netCharm. */
  charmCum: number;
}

type WeightableQuote = {
  openInterest: number | null;
  volume: number | null;
  gamma?: number | null;
};

function weightOf(q: WeightableQuote, mode: ExposureWeight): number {
  if (mode === 'unit') {
    if ((q.openInterest ?? 0) > 0 || (q.volume ?? 0) > 0) return 1;
    // Last resort when Yahoo zeroes both OI and volume on some rows
    return q.gamma != null && Math.abs(q.gamma) > 0 ? 1 : 0;
  }
  if (mode === 'volume') return Math.max(0, q.volume ?? 0);
  return Math.max(0, q.openInterest ?? 0);
}

/** Sum OI / volume across a snapshot — used to auto-pick a usable weight. */
function chainWeightTotals(snap: VolSnapshot): { oi: number; volume: number } {
  let oi = 0;
  let volume = 0;
  for (const slice of snap.expiries) {
    for (const q of [...slice.calls, ...slice.puts]) {
      oi += Math.max(0, q.openInterest ?? 0);
      volume += Math.max(0, q.volume ?? 0);
    }
  }
  return { oi, volume };
}

/**
 * Resolve weight mode. Free Yahoo often returns openInterest=0 for entire chains;
 * fall back to volume, then unit greeks so the dealer stack is never blank.
 */
export function resolveExposureWeight(
  snap: VolSnapshot,
  requested: ExposureWeight = 'oi',
): { weight: ExposureWeight; fallback: boolean; note: string } {
  if (requested === 'volume') {
    return {
      weight: 'volume',
      fallback: false,
      note: 'Volume-weighted · proxy when OI unavailable · not inventory',
    };
  }
  if (requested === 'unit') {
    return {
      weight: 'unit',
      fallback: false,
      note: 'Unit weight (1 per listed OI/vol/γ) · compare structure not size',
    };
  }
  const { oi, volume } = chainWeightTotals(snap);
  if (oi > 0) {
    return {
      weight: 'oi',
      fallback: false,
      note: 'OI-weighted · GEX = γ·S²·0.01·OI·mult (1% $gamma) · DEX/VEX use ×S',
    };
  }
  // P0 Fix: missing OI stays null — do not silently fall to volume/unit when caller requested OI (observed positioning).
  // Volume/unit are separate scenario modes; callers must explicitly request them.
  if (volume > 0) {
    return {
      weight: 'oi',
      fallback: true,
      note: 'OI missing — observed positioning unavailable. Switch to Volume-weighted scenario for proxy.',
    };
  }
  return {
    weight: 'oi',
    fallback: true,
    note: 'OI & volume missing — observed positioning unavailable (null). Use Unit scenario for structure only.',
  };
}

/**
 * Cumulative net-GEX zero-crossing (SpotGamma-style).
 * Aligned with macrovol-api `compute_gex_flip` — both use running sum low→high,
 * first −→≥0 cross; else strike of min |running sum|.
 * Exported for golden tests shared with Python.
 */
export function flipFromSeries(points: { strike: number; net: number }[]): number | null {
  if (points.length === 0) return null;
  let cumulative = 0;
  let prevCum = 0;
  let flip: number | null = null;
  for (const p of points) {
    prevCum = cumulative;
    cumulative += p.net;
    if (flip === null && prevCum < 0 && cumulative >= 0) flip = p.strike;
  }
  if (flip !== null) return flip;
  let best = points[0]!;
  let run = 0;
  let bestAbs = Infinity;
  for (const p of points) {
    run += p.net;
    if (Math.abs(run) < bestAbs) {
      bestAbs = Math.abs(run);
      best = p;
    }
  }
  return best.strike;
}

/**
 * Full dealer stack: GEX / DEX / VEX / Charm by strike.
 *
 * SpotGamma-style *naive* dealer convention (NOT pure “short all OI”):
 *   call GEX = +γ · S² · 0.01 · w · mult   ($ gamma for a 1% spot move)
 *   put  GEX = −γ · S² · 0.01 · w · mult
 *   ⇒ models dealers short calls / long puts — not inventory from a book.
 *   DEX = δ · S · w · mult
 *   VEX = vanna · S · w · mult
 *   Charm = charm · S · w · mult   ($ delta change per calendar day)
 *   where q.charm is already per calendar day (aligned with MacroVol / θ)
 *
 * Matches macrovol-api `greeks_calculator._gex_unit`.
 * weight 'oi' = open interest (default); 'unit' = 1 per listed contract with OI>0.
 */
export function dealerExposure(
  snap: VolSnapshot,
  opts?: {
    maxDte?: number;
    /** Keep only expiries with dte ≤ this (same as maxDte when both set — use one). */
    minDte?: number;
    /** Exact expiry ISO date (YYYY-MM-DD) to isolate one slice. */
    expiry?: string;
    weight?: ExposureWeight;
  },
): DealerExposure {
  const requested = opts?.weight ?? 'oi';
  const resolved = resolveExposureWeight(snap, requested);
  const weight = resolved.weight;
  const maxDte = opts?.maxDte;
  const minDte = opts?.minDte;
  const expiryFilter = opts?.expiry;
  const mult = snap.contractSize ?? 100;
  const S = snap.spot;

  type Acc = {
    callGEX: number; putGEX: number;
    callDEX: number; putDEX: number;
    callVEX: number; putVEX: number;
    callCharm: number; putCharm: number;
  };
  const map = new Map<number, Acc>();

  for (const slice of snap.expiries) {
    if (expiryFilter != null && slice.expiry !== expiryFilter) continue;
    if (maxDte != null && slice.dte > maxDte) continue;
    if (minDte != null && slice.dte < minDte) continue;
    for (const q of [...slice.calls, ...slice.puts]) {
      const w = weightOf(q, weight);
      if (w <= 0) continue;
      // P0 Fix: missing Greeks remain null — skip quote if gamma/delta missing (no zero substitution)
      if (q.gamma == null || q.delta == null) continue;
      const acc = map.get(q.strike) ?? {
        callGEX: 0, putGEX: 0,
        callDEX: 0, putDEX: 0,
        callVEX: 0, putVEX: 0,
        callCharm: 0, putCharm: 0,
      };
      // 1% dollar-gamma (SpotGamma): γ · S² · 0.01 · OI · mult
      const gexScale = S * S * 0.01 * w * mult;
      const notionalScale = S * w * mult;
      const gamma = q.gamma;
      const delta = q.delta;
      const vanna = q.vanna ?? null;
      // computeGreeks stores charm per calendar day (same unit as θ)
      const charmDay = q.charm ?? null;

      if (q.type === 'call') {
        acc.callGEX += gamma * gexScale;
        acc.callDEX += delta * notionalScale;
        if (vanna != null) acc.callVEX += vanna * notionalScale;
        if (charmDay != null) acc.callCharm += charmDay * notionalScale;
      } else {
        acc.putGEX -= gamma * gexScale; // dealer-style put GEX negative
        acc.putDEX += delta * notionalScale; // put δ already ≤ 0
        if (vanna != null) acc.putVEX += vanna * notionalScale;
        if (charmDay != null) acc.putCharm += charmDay * notionalScale;
      }
      map.set(q.strike, acc);
    }
  }

  const sorted = [...map.entries()].sort((a, b) => a[0] - b[0]);
  const points: DealerPoint[] = sorted.map(([strike, g]) => ({
    strike,
    callGEX: g.callGEX,
    putGEX: g.putGEX,
    netGEX: g.callGEX + g.putGEX,
    callDEX: g.callDEX,
    putDEX: g.putDEX,
    netDEX: g.callDEX + g.putDEX,
    callVEX: g.callVEX,
    putVEX: g.putVEX,
    netVEX: g.callVEX + g.putVEX,
    callCharm: g.callCharm,
    putCharm: g.putCharm,
    netCharm: g.callCharm + g.putCharm,
  }));

  let totalGEX = 0, totalDEX = 0, totalVEX = 0, totalCharm = 0;
  for (const p of points) {
    totalGEX += p.netGEX;
    totalDEX += p.netDEX;
    totalVEX += p.netVEX;
    totalCharm += p.netCharm;
  }

  const gammaFlip = flipFromSeries(points.map((p) => ({ strike: p.strike, net: p.netGEX })));
  const callWall = points.length
    ? [...points].sort((a, b) => b.callGEX - a.callGEX)[0]!.strike
    : null;
  const putWall = points.length
    ? [...points].sort((a, b) => a.putGEX - b.putGEX)[0]!.strike
    : null;
  let highVolLevel: number | null = null;
  if (points.length) {
    let best = points[0]!;
    let bestAbs = Math.abs(best.netGEX);
    for (const p of points) {
      const a = Math.abs(p.netGEX);
      if (a > bestAbs) {
        bestAbs = a;
        best = p;
      }
    }
    highVolLevel = best.strike;
  }

  return {
    points,
    totalGEX,
    totalDEX,
    totalVEX,
    totalCharm,
    gammaFlip,
    callWall,
    putWall,
    highVolLevel,
    weight,
    weightFallback: resolved.fallback,
    unitNote: resolved.note,
  };
}

/** Cumulative GEX/DEX profiles for dual-line MenthorQ-style charts. */
export function dealerProfiles(exposure: DealerExposure): DealerProfilePoint[] {
  let gexCum = 0;
  let dexCum = 0;
  let charmCum = 0;
  return exposure.points.map((p) => {
    gexCum += p.netGEX;
    dexCum += p.netDEX;
    charmCum += p.netCharm;
    return {
      strike: p.strike,
      netGEX: p.netGEX,
      netDEX: p.netDEX,
      netCharm: p.netCharm,
      gexCum,
      dexCum,
      charmCum,
    };
  });
}

/**
 * Per-expiry GEX/DEX matrix (MenthorQ-style). Shares of |book| for readability.
 */
export function dealerExposureByExpiry(
  snap: VolSnapshot,
  opts?: { weight?: ExposureWeight },
): DealerExpiryRow[] {
  const weight = opts?.weight ?? 'oi';
  const rows: DealerExpiryRow[] = [];
  for (const slice of snap.expiries) {
    const d = dealerExposure(snap, { expiry: slice.expiry, weight });
    const T = Math.max(slice.dte, 0) / 365;
    const expMove =
      slice.atmIV > 0 && T > 0
        ? snap.spot * slice.atmIV * Math.sqrt(T)
        : null;
    rows.push({
      expiry: slice.expiry,
      dte: slice.dte,
      totalGEX: d.totalGEX,
      totalDEX: d.totalDEX,
      gexShare: 0,
      dexShare: 0,
      callWall: d.callWall,
      putWall: d.putWall,
      highVolLevel: d.highVolLevel,
      gammaFlip: d.gammaFlip,
      expMove,
    });
  }
  const absG = rows.reduce((s, r) => s + Math.abs(r.totalGEX), 0);
  const absD = rows.reduce((s, r) => s + Math.abs(r.totalDEX), 0);
  for (const r of rows) {
    r.gexShare = absG > 0 ? Math.abs(r.totalGEX) / absG : 0;
    r.dexShare = absD > 0 ? Math.abs(r.totalDEX) / absD : 0;
  }
  return rows.sort((a, b) => a.dte - b.dte);
}

/**
 * Calculates gamma exposure (GEX) by strike (backward-compatible wrapper).
 * Prefer dealerExposure() for DEX / VEX / Charm.
 */
export function gammaExposure(
  snap: VolSnapshot,
  maxDte?: number,
): { points: { strike: number; callGEX: number; putGEX: number; netGEX: number }[]; totalGEX: number; gammaFlip: number | null } {
  const d = dealerExposure(snap, { maxDte });
  return {
    points: d.points.map((p) => ({
      strike: p.strike,
      callGEX: p.callGEX,
      putGEX: p.putGEX,
      netGEX: p.netGEX,
    })),
    totalGEX: d.totalGEX,
    gammaFlip: d.gammaFlip,
  };
}

/** Metric for strike × expiry dealer calendar (TRACE/VS3D-style cross-section). */
export type DealerCalendarMetric = 'gex' | 'dex' | 'vex' | 'charm';

export interface DealerCalendarGrid {
  rows: { expiry: string; dte: number }[];
  strikes: number[];
  /** values[rowIdx][strikeIdx] — null when no weight at that node. */
  values: (number | null)[][];
  min: number;
  max: number;
  metric: DealerCalendarMetric;
  weight: ExposureWeight;
  unitNote: string;
}

function metricFromPoint(
  p: DealerPoint,
  metric: DealerCalendarMetric,
): number {
  switch (metric) {
    case 'dex': return p.netDEX;
    case 'vex': return p.netVEX;
    case 'charm': return p.netCharm;
    default: return p.netGEX;
  }
}

/**
 * Strike × expiry dealer exposure grid (calendar GEX / charm heat).
 * Cross-section of the live chain by expiry — **not** multi-day TRACE history.
 * spotBand filters strikes around spot; maxStrikes / maxExpiries cap UI cost.
 */
export function dealerCalendarGrid(
  snap: VolSnapshot,
  metric: DealerCalendarMetric = 'gex',
  opts?: {
    weight?: ExposureWeight;
    /** Keep strikes within this fraction of spot (default 0.12). */
    spotBand?: number;
    maxStrikes?: number;
    maxExpiries?: number;
  },
): DealerCalendarGrid {
  const requested = opts?.weight ?? 'oi';
  const resolved = resolveExposureWeight(snap, requested);
  const weight = resolved.weight;
  const band = opts?.spotBand ?? 0.12;
  const maxStrikes = opts?.maxStrikes ?? 48;
  const maxExpiries = opts?.maxExpiries ?? 14;
  const S = snap.spot;

  const slices = [...snap.expiries]
    .sort((a, b) => a.dte - b.dte)
    .slice(0, maxExpiries);

  const perExp = slices.map((slice) => {
    const d = dealerExposure(snap, { expiry: slice.expiry, weight });
    const map = new Map<number, number>();
    for (const p of d.points) {
      if (band < Infinity && Math.abs(p.strike - S) / S > band) continue;
      map.set(p.strike, metricFromPoint(p, metric));
    }
    return { expiry: slice.expiry, dte: slice.dte, map };
  });

  const strikeSet = new Set<number>();
  for (const e of perExp) {
    for (const k of e.map.keys()) strikeSet.add(k);
  }
  let strikes = [...strikeSet].sort((a, b) => a - b);
  if (strikes.length > maxStrikes) {
    // Keep nearest to spot
    strikes = [...strikes]
      .sort((a, b) => Math.abs(a - S) - Math.abs(b - S))
      .slice(0, maxStrikes)
      .sort((a, b) => a - b);
  }

  const rows = perExp.map((e) => ({ expiry: e.expiry, dte: e.dte }));
  const values: (number | null)[][] = perExp.map((e) =>
    strikes.map((k) => {
      const v = e.map.get(k);
      return v != null && Number.isFinite(v) ? v : null;
    }),
  );

  let min = 0;
  let max = 0;
  let any = false;
  for (const row of values) {
    for (const v of row) {
      if (v == null || !Number.isFinite(v)) continue;
      if (!any) {
        min = max = v;
        any = true;
      } else {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }

  return {
    rows,
    strikes,
    values,
    min,
    max,
    metric,
    weight,
    unitNote: resolved.note,
  };
}

export interface ParityEdgeRow {
  expiry: string;
  dte: number;
  strike: number;
  callMid: number;
  putMid: number;
  /** C − P − (S e^{-qT} − K e^{-rT}) */
  residual: number;
  residualPctSpot: number;
  /** Bid/ask edge proxy: residual vs half-spread sum */
  tradeable: boolean;
  halfSpread: number;
}

/**
 * Put–call parity residual scan (European approximation).
 * residual > 0 ⇒ synthetic long stock (C−P) rich vs cash; < 0 ⇒ cheap.
 * tradeable only when |residual| > call/put half-spread sum (rough costs).
 */
export function scanParityEdges(
  snap: VolSnapshot,
  opts?: { maxDte?: number; bandPct?: number; maxRows?: number },
): ParityEdgeRow[] {
  const band = opts?.bandPct ?? 0.06;
  const maxDte = opts?.maxDte ?? 120;
  const maxRows = opts?.maxRows ?? 40;
  const rows: ParityEdgeRow[] = [];
  const r = snap.riskFreeRate;
  const q = snap.dividendYield;

  for (const slice of snap.expiries) {
    if (slice.dte > maxDte || slice.dte <= 0) continue;
    const T = yearFractionFromSlice(slice);
    const discS = snap.spot * Math.exp(-q * T);
    const putByK = new Map(slice.puts.map((p) => [p.strike, p]));
    for (const c of slice.calls) {
      if (Math.abs(c.strike / snap.spot - 1) > band) continue;
      const p = putByK.get(c.strike);
      if (!p || !(c.mid != null && c.mid > 0) || !(p.mid != null && p.mid > 0)) continue;
      const theo = discS - c.strike * Math.exp(-r * T);
      const residual = ((c.mid as number) - (p.mid as number)) - theo;
      const halfSpread =
        Math.max(0, ((c.ask ?? 0) - (c.bid ?? 0)) / 2) + Math.max(0, ((p.ask ?? 0) - (p.bid ?? 0)) / 2);
      rows.push({
        expiry: slice.expiry,
        dte: slice.dte,
        strike: c.strike,
        callMid: c.mid as number,
        putMid: p.mid as number,
        residual,
        residualPctSpot: residual / snap.spot,
        tradeable: Math.abs(residual) > halfSpread + 1e-9 && halfSpread > 0,
        halfSpread,
      });
    }
  }

  rows.sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));
  return rows.slice(0, maxRows);
}

/** Listed inventory by expiry (MM scan — not a position book). */
export function inventoryByExpiry(snap: VolSnapshot) {
  return snap.expiries.map((slice) => {
    let delta = 0, gamma = 0, vega = 0, theta = 0;
    let callOI: number | null = 0, putOI: number | null = 0;
    let callMissing = false, putMissing = false;
    for (const q of slice.calls) {
      delta += q.delta ?? 0;
      gamma += q.gamma ?? 0;
      vega += q.vega ?? 0;
      theta += q.theta ?? 0;
      if (q.openInterest == null) callMissing = true; else (callOI as number) += q.openInterest;
    }
    for (const q of slice.puts) {
      delta += q.delta ?? 0;
      gamma += q.gamma ?? 0;
      vega += q.vega ?? 0;
      theta += q.theta ?? 0;
      if (q.openInterest == null) putMissing = true; else (putOI as number) += q.openInterest;
    }
    if (callMissing) callOI = null;
    if (putMissing) putOI = null;
    return {
      expiry: slice.expiry,
      dte: slice.dte,
      atmIV: slice.atmIV,
      delta,
      gamma,
      vega,
      theta,
      callOI,
      putOI,
      pcr: callOI != null && callOI > 0 && putOI != null ? putOI / callOI : null,
      oiState: callMissing || putMissing ? (callMissing && putMissing && slice.calls.every((q) => q.openInterest == null) && slice.puts.every((q) => q.openInterest == null) ? 'missing' : 'partial') : 'observed',
    };
  });
}

/**
 * Close-to-close annualized realized vol (simple log returns).
 * needs ≥5 closes; returns null otherwise.
 */
export function realizedVolCloseToClose(closes: number[], periodsPerYear = 252): number | null {
  if (closes.length < 5) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1]!;
    const b = closes[i]!;
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 4) return null;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  let v = 0;
  for (const x of rets) v += (x - mean) ** 2;
  const std = Math.sqrt(v / (rets.length - 1));
  return std * Math.sqrt(periodsPerYear);
}

/** IV − RV premium (positive = IV rich vs realized). */
export function volRiskPremium(atmIV: number | null | undefined, rv: number | null): number | null {
  if (atmIV == null || rv == null || !(atmIV > 0) || !(rv > 0)) return null;
  return atmIV - rv;
}
