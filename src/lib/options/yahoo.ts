import type { VolSnapshot, ExpirySlice, OptionQuote } from './types';
import { solveImpliedVol } from '../math/impliedVol';
import { greeksEuropean } from '../math/greeks';
import { asDecimalRate, asDecimalVol, asYearFraction, thetaPerDay, vegaPerVolPoint } from '../math/units';
import { fitSVI, sviIv } from '../math/surface/sviFit';
import { DATA_CONFIG, VALIDATION_CONFIG } from '../../config/constants';
import { yearFractionToExpiry, calendarDte } from './time';
import { estimateParityDividend, blendDividendYield } from './parity';

export interface YahooRawOption {
  strike: number;
  expiry: string;
  type: 'call' | 'put';
  bid: number | null;
  ask: number | null;
  last: number | null;
  iv: number | null;
  /** Nullable — missing stays null, not 0 */
  volume: number | null;
  openInterest: number | null;
  /** Per-field provenance when source provides it */
  provenance?: 'observed' | 'derived' | 'model' | 'unavailable';
}

export interface YahooResponse {
  symbol: string;
  spot: number;
  expirations: string[];
  quotes: YahooRawOption[];
  timestamp: number;
}

/** Optional build controls for per-tenor rates and parity dividend. */
export interface BuildSnapshotOptions {
  maxExpiries?: number;
  now?: number;
  /** Per-tenor risk-free rate r(T). Defaults to flat `r`. */
  rateForT?: (T: number) => number;
  /** When true (default), blend put–call parity implied dividend into q. */
  useParityDividend?: boolean;
}

const { MIN_IV, MAX_IV } = VALIDATION_CONFIG.ranges;

/** Reject markets wider than this relative spread (ask-bid)/mid. */
const MAX_REL_SPREAD = 0.55;
/** Absolute floor: always accept if abs spread is tiny (penny names). */
const MAX_ABS_SPREAD_ALWAYS_OK = 0.05;

/** Executable mid: only when both sides positive and not crossed. One-sided or last is NOT a mid. */
function pickMid(raw: YahooRawOption): number | null {
  const hasBid = raw.bid != null && raw.bid > 0 && isFinite(raw.bid);
  const hasAsk = raw.ask != null && raw.ask > 0 && isFinite(raw.ask);
  if (hasBid && hasAsk && (raw.ask as number) >= (raw.bid as number)) {
    return ((raw.bid as number) + (raw.ask as number)) / 2;
  }
  return null;
}

/** True when the quote is too wide / crossed to trust for IV. Null bid/ask or one-sided = poor liquidity for mid IV. */
function isPoorLiquidity(raw: YahooRawOption, mid: number): boolean {
  const hasBid = raw.bid != null && raw.bid > 0;
  const hasAsk = raw.ask != null && raw.ask > 0;
  if (!(hasBid && hasAsk)) return true; // one-sided → not executable mid
  if ((raw.ask as number) < (raw.bid as number)) return true;
  const spread = (raw.ask as number) - (raw.bid as number);
  if (spread <= MAX_ABS_SPREAD_ALWAYS_OK) return false;
  return spread / mid > MAX_REL_SPREAD;
}

function intrinsic(
  type: 'call' | 'put',
  spot: number,
  strike: number,
  T: number,
  r: number,
  q: number,
): number {
  if (type === 'call') return Math.max(spot * Math.exp(-q * T) - strike * Math.exp(-r * T), 0);
  return Math.max(strike * Math.exp(-r * T) - spot * Math.exp(-q * T), 0);
}

/** Canonical IV solve — no tolerance, no proxy, uses exact bounds */
function solveCanonicalIV(
  type: 'call' | 'put',
  price: number,
  spot: number,
  strike: number,
  T: number,
  r: number,
  q: number,
): number | null {
  if (!(price > 0) || !(T > 0) || !(spot > 0) || !(strike > 0)) return null;
  const res = solveImpliedVol(type, spot, strike, asYearFraction(T), asDecimalRate(r), asDecimalRate(q), price);
  if (!res.ok) return null;
  const iv = res.sigma as unknown as number;
  if (!isFinite(iv) || iv <= 0) return null;
  if (iv < MIN_IV || iv > MAX_IV) return null;
  return iv;
}

function buildOptionQuote(
  raw: YahooRawOption,
  expiry: string,
  _dte: number,
  spot: number,
  T: number,
  r: number,
  q: number,
  midIv: number | null,
  extra: { feedIv: number | null; bidIv: number | null; askIv: number | null; modelIv: number | null },
): OptionQuote {
  // Use midIv as primary for Greeks; if missing, skip Greeks (null) — never fabricate.
  let delta: number | null = null, gamma: number | null = null, theta: number | null = null, vega: number | null = null;
  let vanna: number | null = null, charm: number | null = null;
  if (midIv != null && midIv > 0 && T > 0) {
    const rawG = greeksEuropean(raw.type, spot, raw.strike, asYearFraction(T), asDecimalRate(r), asDecimalRate(q), asDecimalVol(midIv));
    delta = rawG.delta;
    gamma = rawG.gamma;
    // Units: raw per year/per 1 vol → display per day/per vol point via branded adapters
    theta = (thetaPerDay(rawG.theta as unknown as import('../math/units').RawThetaPerYear) as unknown as number);
    vega = (vegaPerVolPoint(rawG.vega as unknown as import('../math/units').RawVegaPerVol) as unknown as number);
    // vanna/charm adapters
    // Canonical vanna is per 1.0 volatility (raw scale), identical across feeds.
    vanna = rawG.vanna as unknown as number;
    charm = (rawG.charm as unknown as number) / 365;
  }
  const mid = pickMid(raw);
  const hasMid = mid != null && midIv != null;
  return {
    strike: raw.strike, expiry, type: raw.type,
    bid: raw.bid ?? null, ask: raw.ask ?? null, last: raw.last ?? null,
    mid: mid,
    provenance: hasMid ? 'derived' : 'unavailable',
    priceBasis: hasMid ? 'mid' : 'none',
    feedIv: extra.feedIv,
    observedIv: extra.feedIv,
    midIv: midIv,
    bidIv: extra.bidIv,
    askIv: extra.askIv,
    modelIv: extra.modelIv,
    iv: midIv,
    delta, gamma, theta, vega,
    vanna, charm, volga: null, speed: null, rho: null, veta: null, color: null, zomma: null, ultima: null,
    openInterest: raw.openInterest ?? null, volume: raw.volume ?? null,
  };
}

type RawWithMid = YahooRawOption & { mid: number };

function normalizeFeedIv(rawIv: number | null): number | null {
  if (rawIv == null || !isFinite(rawIv)) return null;
  let v = rawIv;
  if (v > 1.5) v = v / 100; // percent → decimal, once
  if (!isFinite(v) || v <= 0) return null;
  if (v < MIN_IV || v > MAX_IV) return null;
  return v;
}

function filterArbFreeQuotes(
  type: 'call' | 'put',
  rawList: YahooRawOption[],
  spot: number,
  T: number,
  r: number,
  q: number,
): RawWithMid[] {
  const valid: RawWithMid[] = [];
  for (const raw of rawList) {
    const mid = pickMid(raw);
    if (mid == null || mid <= 0 || !isFinite(mid)) continue;
    const hasBid = raw.bid != null && raw.bid > 0;
    const hasAsk = raw.ask != null && raw.ask > 0;
    if (hasBid && hasAsk && (raw.bid as number) > (raw.ask as number)) continue;
    if (isPoorLiquidity(raw, mid)) continue;
    const intr = intrinsic(type, spot, raw.strike, T, r, q);
    // Canonical: no 0.99 tolerance — strict below intrinsic fails (solver will also fail)
    if (mid < intr - 1e-12) continue;
    valid.push({ ...raw, mid });
  }
  return valid;
}

interface ComputedIVs {
  midIv: number | null;
  bidIv: number | null;
  askIv: number | null;
  feedIv: number | null;
}

function computeIVs(
  type: 'call' | 'put',
  quotes: RawWithMid[],
  spot: number,
  T: number,
  r: number,
  q: number,
): (RawWithMid & ComputedIVs)[] {
  const out: (RawWithMid & ComputedIVs)[] = [];
  for (const raw of quotes) {
    const feedIv = normalizeFeedIv(raw.iv);
    // Independently invert each valid price — never estimate bid/ask from mid
    const midIv = solveCanonicalIV(type, raw.mid, spot, raw.strike, T, r, q);
    const bidIv = raw.bid != null && raw.bid > 0 ? solveCanonicalIV(type, raw.bid, spot, raw.strike, T, r, q) : null;
    const askIv = raw.ask != null && raw.ask > 0 ? solveCanonicalIV(type, raw.ask, spot, raw.strike, T, r, q) : null;
    // Primary IV is midIv; if missing, do NOT silently fall back to feedIv as solved — keep feed separate
    // Only keep raw if midIv exists; otherwise skip (no 0.99 fallback)
    if (midIv == null) {
      // Do not use feedIv as solved — mark as unavailable, keep feed for display only
      // Still allow row if feedIv exists? No — for Greeks we need solved midIv, so skip
      continue;
    }
    // Reject pathological wing IVs far from ATM
    const moneyness = Math.abs(Math.log(raw.strike / spot));
    if (moneyness > 0.35 && midIv > 1.2) continue;
    out.push({ ...raw, midIv, bidIv, askIv, feedIv, iv: midIv });
  }
  return out;
}

/**
 * ATM IV via OTM wing interpolation:
 *  - K >= spot → call IV
 *  - K <= spot → put IV
 * Linear interpolate in strike at K = spot.
 */
export function computeAtmIV(
  calls: { strike: number; iv: number }[],
  puts: { strike: number; iv: number }[],
  spot: number,
): number | null {
  const points: { k: number; iv: number }[] = [];
  for (const c of calls) {
    if (c.strike >= spot * 0.999) points.push({ k: c.strike, iv: c.iv });
  }
  for (const p of puts) {
    if (p.strike <= spot * 1.001) points.push({ k: p.strike, iv: p.iv });
  }

  if (points.length === 0) {
    const nearest = (qs: { strike: number; iv: number }[]) => {
      if (qs.length === 0) return null;
      return qs.reduce((a, b) =>
        Math.abs(a.strike - spot) <= Math.abs(b.strike - spot) ? a : b,
      );
    };
    const nc = nearest(calls);
    const np = nearest(puts);
    if (nc && np) return (nc.iv + np.iv) / 2;
    if (nc) return nc.iv;
    if (np) return np.iv;
    return null;
  }

  points.sort((a, b) => a.k - b.k);
  const dedup: { k: number; iv: number }[] = [];
  for (const p of points) {
    const last = dedup[dedup.length - 1];
    if (last && Math.abs(last.k - p.k) < 1e-9) {
      last.iv = (last.iv + p.iv) / 2;
    } else {
      dedup.push({ ...p });
    }
  }

  const lo = [...dedup].reverse().find((p) => p.k <= spot) ?? dedup[0]!;
  const hi = dedup.find((p) => p.k >= spot) ?? dedup[dedup.length - 1]!;
  if (Math.abs(lo.k - hi.k) < 1e-9) return lo.iv;
  const w = (spot - lo.k) / (hi.k - lo.k);
  return lo.iv * (1 - w) + hi.iv * w;
}

function smoothWings(
  _type: 'call' | 'put',
  quotes: (RawWithMid & ComputedIVs)[],
  spot: number,
  T: number,
  r: number,
  q: number,
  expiry: string,
  dte: number,
): OptionQuote[] {
  if (quotes.length === 0) return [];
  // Use forward moneyness k=ln(K/F) for SVI (canonical) — not spot
  const forward = spot * Math.exp((r - q) * T);
  const strikes = quotes.map((q) => q.strike);
  const ivs = quotes.map((q) => q.midIv as number);
  // Fit SVI on total variance w = IV²·T using forward
  const fit = fitSVI(strikes, ivs, forward, T);
  const out: OptionQuote[] = [];
  for (const raw of quotes) {
    let modelIv: number | null = null;
    if (fit) {
      const k = Math.log(raw.strike / forward);
      const fitted = sviIv(fit.params, k, T);
      if (isFinite(fitted) && fitted > 0) {
        modelIv = Math.max(MIN_IV, Math.min(MAX_IV, fitted));
      }
    }
    // Never overwrite solved midIv with model — keep separate
    out.push(buildOptionQuote(raw, expiry, dte, spot, T, r, q, raw.midIv ?? null, { feedIv: raw.feedIv ?? null, bidIv: raw.bidIv ?? null, askIv: raw.askIv ?? null, modelIv }));
  }
  return out;
}

/**
 * Build a volatility snapshot from a raw option chain.
 * Uses per-tenor r(T) and put–call parity dividend when configured.
 */
export function buildYahooSnapshot(
  data: YahooResponse,
  r: number,
  q: number,
  maxExpiriesOrOpts: number | BuildSnapshotOptions = 12,
  nowArg?: number,
): VolSnapshot | null {
  // Backward-compatible overload: (data, r, q, maxExpiries, now)
  let maxExpiries = 12;
  let now = Date.now();
  let rateForT: ((T: number) => number) | undefined;
  let useParityDividend = true;

  if (typeof maxExpiriesOrOpts === 'number') {
    maxExpiries = maxExpiriesOrOpts;
    if (nowArg != null) now = nowArg;
  } else if (maxExpiriesOrOpts && typeof maxExpiriesOrOpts === 'object') {
    maxExpiries = maxExpiriesOrOpts.maxExpiries ?? 12;
    now = maxExpiriesOrOpts.now ?? Date.now();
    rateForT = maxExpiriesOrOpts.rateForT;
    useParityDividend = maxExpiriesOrOpts.useParityDividend !== false;
  }

  if (!data.quotes || data.quotes.length < 5) return null;
  // Fail-closed: never invent spot from an arbitrary strike (wrong IVs for entire surface).
  if (!(data.spot > 0) || !Number.isFinite(data.spot)) return null;

  const expiryMap = new Map<string, { calls: YahooRawOption[]; puts: YahooRawOption[] }>();
  for (const quote of data.quotes) {
    if (!expiryMap.has(quote.expiry)) {
      expiryMap.set(quote.expiry, { calls: [], puts: [] });
    }
    const bucket = expiryMap.get(quote.expiry)!;
    if (quote.type === 'call') bucket.calls.push(quote);
    else bucket.puts.push(quote);
  }

  const slices: ExpirySlice[] = [];
  const qSamples: number[] = [];

  for (const [expiry, bucket] of expiryMap) {
    const T = yearFractionToExpiry(expiry, now);
    if (T == null || T <= 0) continue;
    const dte = calendarDte(expiry, now);
    if (dte <= 0 && T < 1 / (365 * 24)) continue;

    const rT = rateForT ? rateForT(T) : r;

    // Seed pass with profile/seed q to get liquid mids.
    let qEff = q;
    let rawCalls = filterArbFreeQuotes('call', bucket.calls, data.spot, T, rT, qEff);
    let rawPuts = filterArbFreeQuotes('put', bucket.puts, data.spot, T, rT, qEff);

    let forward: number | undefined;
    if (useParityDividend) {
      const parity = estimateParityDividend(rawCalls, rawPuts, data.spot, T, rT);
      if (parity) {
        qEff = blendDividendYield(q, parity);
        forward = parity.forward;
        qSamples.push(qEff);
        // Re-filter with refined q (intrinsic bounds).
        rawCalls = filterArbFreeQuotes('call', bucket.calls, data.spot, T, rT, qEff);
        rawPuts = filterArbFreeQuotes('put', bucket.puts, data.spot, T, rT, qEff);
      }
    }

    const callIVs = computeIVs('call', rawCalls, data.spot, T, rT, qEff);
    const putIVs = computeIVs('put', rawPuts, data.spot, T, rT, qEff);

    const calls = smoothWings('call', callIVs, data.spot, T, rT, qEff, expiry, dte);
    const puts = smoothWings('put', putIVs, data.spot, T, rT, qEff, expiry, dte);

    if (calls.length > 0 || puts.length > 0) {
      const atmIV = computeAtmIV(
        callIVs.map((c) => ({ strike: c.strike, iv: c.midIv as number })),
        putIVs.map((p) => ({ strike: p.strike, iv: p.midIv as number })),
        data.spot,
      );
      // No silent 20% ATM — skip tenor if we cannot estimate from market IVs.
      if (atmIV == null || !(atmIV > 0) || !Number.isFinite(atmIV)) continue;
      slices.push({
        expiry,
        dte: Math.max(dte, 1),
        calls,
        puts,
        atmIV,
        forward,
        riskFreeRate: rT,
        dividendYield: qEff,
      });
    }
  }

  slices.sort((a, b) => a.dte - b.dte);

  // Snapshot-level q: median of parity-refined tenors, else seed.
  let snapQ = q;
  if (qSamples.length > 0) {
    const sorted = [...qSamples].sort((a, b) => a - b);
    snapQ = sorted[Math.floor(sorted.length / 2)]!;
  }
  // Snapshot-level r: front tenor (or seed).
  const snapR = slices[0]?.riskFreeRate ?? r;

  return {
    symbol: data.symbol,
    spot: data.spot,
    riskFreeRate: snapR,
    dividendYield: snapQ,
    timestamp: data.timestamp || now,
    expiries: slices.slice(0, maxExpiries),
    surfaceSource: 'live',
  };
}

// Client-side cache so the live refresh (every few seconds) doesn't re-hit the
// Python/yfinance proxy each cycle. Chain TTL is longer than spot — options
// don't meaningfully update every few seconds on free feeds.
interface YfChainCache {
  key: string;
  value: VolSnapshot | null;
  expiry: number;
  fetchedAt: number;
}
let yfChainCache: YfChainCache | null = null;
const YF_CHAIN_TTL = 45_000;

export function getYahooChainCacheAgeMs(): number | null {
  if (!yfChainCache) return null;
  return Date.now() - yfChainCache.fetchedAt;
}

export async function fetchYahooSnapshot(
  symbol: string,
  maxExpiries = 12,
  /** Prefer live treasury; DATA_CONFIG fallback only when caller has no curve. */
  r: number = DATA_CONFIG.market.RISK_FREE_RATE,
  /** Prefer profile/parity yield; DATA_CONFIG fallback only when caller has none. */
  q: number = DATA_CONFIG.market.DIVIDEND_YIELD,
  opts?: Omit<BuildSnapshotOptions, 'maxExpiries' | 'now'>,
): Promise<VolSnapshot | null> {
  const key = `${symbol.toUpperCase()}:${maxExpiries}:${r.toFixed(5)}:${q.toFixed(5)}:${opts?.rateForT ? 'term' : 'flat'}`;
  const now = Date.now();
  if (yfChainCache && yfChainCache.key === key && now < yfChainCache.expiry) {
    return yfChainCache.value;
  }
  try {
    const res = await fetch(`/api/options/${encodeURIComponent(symbol)}?max=${maxExpiries}`);
    if (!res.ok) {
      // Negative cache so auto-refresh doesn't stampede a dead proxy.
      // 30s keeps rate-limited Render IP from re-hammering yfinance every loop.
      yfChainCache = { key, value: null, expiry: now + 30_000, fetchedAt: now };
      return null;
    }

    const data: YahooResponse = await res.json();
    if (!data || !Array.isArray(data.quotes) || data.quotes.length < 5) {
      yfChainCache = { key, value: null, expiry: now + 4_000, fetchedAt: now };
      return null;
    }
    // Fail-closed: missing/zero spot → null snapshot (do not use a strike as spot).
    if (!(data.spot > 0) || !Number.isFinite(data.spot)) {
      yfChainCache = { key, value: null, expiry: now + 4_000, fetchedAt: now };
      return null;
    }
    const snap = buildYahooSnapshot(data, r, q, {
      maxExpiries,
      rateForT: opts?.rateForT,
      useParityDividend: opts?.useParityDividend,
    });
    // Only cache successful builds for the full TTL; empty/null gets a short TTL.
    const ok = !!snap && snap.expiries.length > 0;
    yfChainCache = {
      key,
      value: ok ? snap : null,
      expiry: now + (ok ? YF_CHAIN_TTL : 4_000),
      fetchedAt: now,
    };
    return ok ? snap : null;
  } catch {
    yfChainCache = { key, value: null, expiry: now + 4_000, fetchedAt: now };
    return null;
  }
}

/** Drop the cached yfinance chain so a forced refresh actually re-fetches. */
export function invalidateYahooChainCache() {
  yfChainCache = null;
}
