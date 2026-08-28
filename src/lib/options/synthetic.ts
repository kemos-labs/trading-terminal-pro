import type { VolSnapshot, ExpirySlice, OptionQuote, SurfaceGrid } from './types';
import { computeGreeks } from './greeks';
import { DATA_CONFIG } from '../../config/constants';
import { interpolateSurface } from './interpolate';
import { yearFractionFromSlice } from './time';

const PRESETS = DATA_CONFIG.SYMBOL_PRESETS;

function defaultFor(symbol: string) {
  return PRESETS[symbol as keyof typeof PRESETS] ?? { spot: 100, iv30: 0.25 };
}

function isPresetSymbol(symbol: string): symbol is keyof typeof PRESETS {
  return symbol in PRESETS;
}

function buildExpiries(): { expiry: string; dte: number }[] {
  const now = new Date();
  const dtes = DATA_CONFIG.EXPIRY_DTES;
  return dtes.map(d => {
    const dt = new Date(now);
    dt.setDate(dt.getDate() + d);
    return { expiry: dt.toISOString().slice(0, 10), dte: d };
  });
}

function buildStrikes(spot: number): number[] {
  const strikes: number[] = [];
  const step = spot * DATA_CONFIG.strikes.STEP_RATIO;
  const half = DATA_CONFIG.strikes.HALF_STRIKES;
  const base = Math.round(spot / step) * step;
  for (let i = -half; i <= half; i++) {
    strikes.push(Math.round((base + i * step) * 100) / 100);
  }
  return strikes.filter(s => s > 0);
}

function isCrypto(symbol: string): boolean {
  const s = symbol.toUpperCase();
  return s === 'BTC' || s === 'ETH' || s === 'IBIT' || s === 'BITO' || s === 'MSTR' || s === 'COIN' || s === 'GBTC';
}

function modelIV(
  expiryIdx: number,
  totalExpiries: number,
  strike: number,
  spot: number,
  atmIV: number,
  crypto = false,
): number {
  const k = Math.log(strike / spot);
  if (crypto) {
    // Crypto smile: higher wings, mild risk-reversal that can flip with regime.
    // Put skew softer than equities; OTM calls often rich (upside chase).
    const wing = 0.12 * k * k;
    const rr = -0.04 * k; // slight put wing still, but weaker than SPX
    const term = 0.04 * (1 - expiryIdx / totalExpiries) * k;
    return Math.max(0.05, atmIV + wing + rr + term);
  }
  const termSkew = 0.08 * (1 - expiryIdx / totalExpiries);
  const smirk = 0.02 * k * k;
  const skew = termSkew * k;
  return Math.max(0.01, atmIV + skew + smirk);
}

export function buildSnapshot(
  symbol: string,
  now: number,
  spot: number,
  _level: number,
  eventVol: number,
): VolSnapshot {
  const preset = defaultFor(symbol);
  const crypto = isCrypto(symbol);
  const r = DATA_CONFIG.market.RISK_FREE_RATE;
  // Crypto has no dividend; carry comes from funding / futures basis.
  const q = crypto ? 0 : DATA_CONFIG.market.DIVIDEND_YIELD;

  const expiries = buildExpiries();
  const slices: ExpirySlice[] = [];

  const baseIV = preset.iv30 + eventVol;
  const atmIVs = expiries.map((_, i) => {
    const termPremium = (crypto ? 0.04 : 0.02) * Math.exp(-i / 2);
    const earnings = symbol === 'SPY' || crypto ? 0 : 0.03 * Math.exp(-i / 3);
    // Crypto: inverted-ish short-term vol spike
    const frontBump = crypto && i < 2 ? 0.03 : 0;
    return Math.max(0.01, baseIV + termPremium + earnings + frontBump);
  });

  for (let ei = 0; ei < expiries.length; ei++) {
    const { expiry, dte } = expiries[ei]!;
    const atmIV = atmIVs[ei]!;
    const T = yearFractionFromSlice({ expiry, dte });
    if (T <= 0) continue;

    const expStrikes = buildStrikes(spot);
    const calls: OptionQuote[] = [];
    const puts: OptionQuote[] = [];

    for (const strike of expStrikes) {
      const iv = modelIV(ei, expiries.length, strike, spot, atmIV, crypto);
      const g = computeGreeks('call', spot, strike, T, r, q, iv);
      const putG = computeGreeks('put', spot, strike, T, r, q, iv);

      const spread = 0.01 + iv * 0.05 * strike * Math.sqrt(T);
      const oi = Math.round(10000 * Math.exp(-Math.abs(strike - spot) / (spot * 0.1)) * (1 + 10 * Math.random()));
      const vol = Math.round(oi * (0.1 + 0.9 * Math.random()));

      calls.push({
        strike, expiry, type: 'call',
        bid: Math.max(0.01, g.price - spread),
        ask: g.price + spread,
        last: g.price,
        mid: g.price,
        iv, delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega,
        vanna: g.vanna, charm: g.charm, volga: g.volga, speed: g.speed,
        rho: g.rho, veta: g.veta, color: g.color, zomma: g.zomma, ultima: g.ultima,
        openInterest: oi, volume: vol,
      });

      puts.push({
        strike, expiry, type: 'put',
        bid: Math.max(0.01, putG.price - spread),
        ask: putG.price + spread,
        last: putG.price,
        mid: putG.price,
        iv, delta: putG.delta, gamma: putG.gamma, theta: putG.theta, vega: putG.vega,
        vanna: putG.vanna, charm: putG.charm, volga: putG.volga, speed: putG.speed,
        rho: putG.rho, veta: putG.veta, color: putG.color, zomma: putG.zomma, ultima: putG.ultima,
        openInterest: oi, volume: vol,
      });
    }

    slices.push({ expiry, dte, calls, puts, atmIV });
  }

  return {
    symbol, spot, riskFreeRate: r, dividendYield: q,
    timestamp: now, expiries: slices,
  };
}

/**
 * Which side of the chain feeds each strike on the surface mesh.
 * - otm: desk default — call when K ≥ S, put when K < S
 * - itm: opposite wing — put when K ≥ S, call when K < S
 * - all: average call+put IV when both liquid; else whichever the API has
 */
export type SurfaceWingMode = 'otm' | 'itm' | 'all';

export interface BuildSurfaceGridOptions {
  wingMode?: SurfaceWingMode;
}

function blendQuotes(call: OptionQuote | null, put: OptionQuote | null): OptionQuote | null {
  if (
    call &&
    put &&
    call.iv != null &&
    put.iv != null &&
    call.iv > 0 &&
    put.iv > 0 &&
    isFinite(call.iv) &&
    isFinite(put.iv)
  ) {
    return {
      ...call,
      iv: (call.iv + put.iv) / 2,
      mid: ((call.mid ?? 0) + (put.mid ?? 0)) / 2,
      bid: ((call.bid ?? 0) + (put.bid ?? 0)) / 2,
      ask: ((call.ask ?? 0) + (put.ask ?? 0)) / 2,
      last: ((call.last ?? 0) + (put.last ?? 0)) / 2,
      delta:
        call.delta != null && put.delta != null
          ? (call.delta + put.delta) / 2
          : (call.delta ?? put.delta),
    };
  }
  return call ?? put;
}

/**
 * Pick a quote for surface construction under the chosen wing mode.
 * Falls back to the other side when the preferred wing is missing.
 */
export function pickSurfaceQuote(
  slice: ExpirySlice,
  strike: number,
  spot: number,
  mode: SurfaceWingMode = 'otm',
): OptionQuote | null {
  const call = slice.calls.find(q => q.strike === strike) ?? null;
  const put = slice.puts.find(q => q.strike === strike) ?? null;
  if (mode === 'all') return blendQuotes(call, put);
  if (mode === 'itm') {
    // ITM: put above/at spot, call below spot
    if (strike >= spot) return put ?? call;
    return call ?? put;
  }
  // OTM (default): call above/at spot, put below spot
  if (strike >= spot) return call ?? put;
  return put ?? call;
}

export function buildSurfaceGrid(
  snapshot: VolSnapshot,
  opts: BuildSurfaceGridOptions = {},
): SurfaceGrid {
  const wingMode = opts.wingMode ?? 'otm';
  if (snapshot.expiries.length === 0) {
    return { expiries: [], dtes: [], strikes: [], iv: [], bid: [], ask: [], delta: [] };
  }

  const expiries = snapshot.expiries.map(e => e.expiry);
  const dtes = snapshot.expiries.map(e => e.dte);
  const spot = snapshot.spot;
  // Keep strikes in a usable moneyness band so deep-OTM junk doesn't warp SVI.
  const allStrikes = [...new Set(
    snapshot.expiries.flatMap(e => [...e.calls, ...e.puts].map(q => q.strike)),
  )].sort((a, b) => a - b);
  const lo = spot * 0.70;
  const hi = spot * 1.35;
  let strikes = allStrikes.filter(k => k >= lo && k <= hi);
  if (strikes.length < 5) strikes = allStrikes;

  const iv: (number | null)[][] = [];
  const bid: (number | null)[][] = [];
  const ask: (number | null)[][] = [];
  const delta: (number | null)[][] = [];

  for (const slice of snapshot.expiries) {
    const ivRow: (number | null)[] = [];
    const bidRow: (number | null)[] = [];
    const askRow: (number | null)[] = [];
    const deltaRow: (number | null)[] = [];

    for (const strike of strikes) {
      const q = pickSurfaceQuote(slice, strike, spot, wingMode);
      if (q && q.iv != null && isFinite(q.iv) && q.iv > 0) {
        ivRow.push(q.iv);
        bidRow.push(q.bid);
        askRow.push(q.ask);
        deltaRow.push(q.delta);
      } else {
        ivRow.push(null);
        bidRow.push(null);
        askRow.push(null);
        deltaRow.push(null);
      }
    }

    iv.push(ivRow);
    bid.push(bidRow);
    ask.push(askRow);
    delta.push(deltaRow);
  }

  // Route IVs through fitted SVI surface (no-arb constrained, interpolated, no zero-wells)
  const { iv: fittedIV } = interpolateSurface(strikes, snapshot.spot, iv, dtes);

  return { expiries, dtes, strikes, iv: fittedIV, bid, ask, delta };
}

export function generateHistory(
  symbol: string,
  frames: number = DATA_CONFIG.history.DEFAULT_FRAMES,
): { snapshot: VolSnapshot; surface: SurfaceGrid; timestamp: number }[] {
  const preset = defaultFor(symbol);
  let spot: number = preset.spot;
  const result: { snapshot: VolSnapshot; surface: SurfaceGrid; timestamp: number }[] = [];
  const now = Date.now();

  for (let i = 0; i < frames; i++) {
    const t = now - (frames - 1 - i) * DATA_CONFIG.history.FRAME_INTERVAL_MS;
    const eventVol = 0.08 * Math.sin(i / 8) + 0.04 * Math.sin(i / 3);
    spot += (Math.random() - 0.5) * spot * 0.005;
    spot = Math.max(spot, 1);

    const snap = buildSnapshot(symbol, t, spot, i / frames, eventVol);
    const surface = buildSurfaceGrid(snap);
    result.push({ snapshot: snap, surface, timestamp: t });
  }

  return result;
}

export function presetFor(symbol: string) {
  if (isPresetSymbol(symbol)) {
    return PRESETS[symbol];
  }
  return null;
}

export { PRESETS };
