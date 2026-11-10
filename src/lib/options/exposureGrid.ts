/**
 * Exposure-grid engine (REF-03/04 prerequisite): hypothetical underlying price
 * × valuation UTC instant → signed OI-weighted exposure scenario field.
 *
 * Pure, deterministic, side-effect free. Reprices gamma and elapsed-time charm
 * PER CELL from model inputs via the audited `priceGreeksMarket` kernel — never
 * by interpolating sampled current Greeks.
 *
 * Scenario basis (recorded in methodology): frozen OI at snapshot event time,
 * sticky frozen per-quote IV (solved-or-venue-mark, selected by caller).
 *
 * Sign convention `signed-greek-oi-proxy` (matches `dealerExposure`):
 *   call $GEX = +γ·S²·0.01·OI·mult ; put $GEX = −γ·S²·0.01·OI·mult
 *   (dealers-short-calls/long-puts proxy — NOT observed dealer inventory).
 *   Raw gamma itself stays nonnegative. Charm (per-day, raw −dΔ/dT /365)
 *   keeps its signed value for both calls and puts (no put negation).
 *   DEX (delta pressure, $Δ notional) = signed kernel δ·S·OI·mult for both
 *   sides — call δ ≥ 0 and put δ ≤ 0 already carry the sign, so no
 *   call/put negation is applied (matches `dealerExposure` callDEX/putDEX).
 *
 * Expiry policy: each quote carries an explicit trustworthy expiry UTC instant
 * (epoch ms) plus settlement/model identifiers. A valuation instant at or past
 * the expiry instant excludes that quote (null contribution, counted) — no
 * 16:00-ET inference, no stale-dte reuse, no one-second residual clamps.
 *
 * Model separation: `spot-european` (BS-Merton via `priceGreeksMarket`) and
 * `futures-european` (Black-76) are NEVER substituted for each other. The repo
 * currently exposes only price/forward-delta for Black-76
 * (`src/lib/math/black76.ts`), with no audited gamma/charm adapter — so
 * `futures-european` quotes yield an explicit `unsupported-model` exclusion,
 * leaving model expansion open.
 */

import { priceGreeksMarket } from '../math/adapters';

export type ExposureGridMetric = 'gex' | 'charm' | 'dex';

/** Pricing model identity carried per quote. Only spot-european is priced. */
export type ExposureModelId = 'spot-european' | 'futures-european' | (string & {});

export interface ExposureGridQuote {
  type: 'call' | 'put';
  strike: number;
  /** Trustworthy expiry UTC instant (epoch ms). Null/NaN → unavailable. */
  expiryMs: number | null;
  /** Venue settlement convention label, e.g. 'US-equity 16:00 ET'. Recorded only. */
  settlement?: string;
  /** Pricing model identity. Anything but 'spot-european' is unsupported. */
  modelId: ExposureModelId;
  /** Frozen OI at snapshot event time. Null → unavailable (never defaulted). */
  openInterest: number | null;
  /** Contracts multiplier. Verified per-contract value only; null/NaN/non-positive → invalid-multiplier (never defaulted). An explicit caller-supplied scenario multiplier may be bound by the API layer; it is never observed. */
  multiplier: number | null;
  /** Frozen sticky IV (decimal, solved-or-venue-mark per caller). Provenance below. */
  iv: number | null;
  /** Where the frozen IV came from — recorded per cell, never overwritten. */
  ivProvenance?: 'solved-mid' | 'solved-bid' | 'solved-ask' | 'venue-mark' | 'unavailable';
  /** Validated continuous rate for spot-european. Null → unavailable. */
  r: number | null;
  /** Validated continuous dividend/carry for spot-european. Null → unavailable. */
  q: number | null;
}

export type ExposureExclusionReason =
  | 'missing-expiry'
  | 'expired'
  | 'unsupported-model'
  | 'missing-iv'
  | 'missing-rates'
  | 'invalid-spot-strike'
  | 'missing-oi'
  | 'invalid-multiplier'
  | 'non-finite-exposure-overflow';

export interface ExposureGridCell {
  /** Signed $ exposure, or null when no quote contributed (never valid 0). */
  value: number | null;
  included: number;
  excludedExpired: number;
  missing: number;
  reasons: ExposureExclusionReason[];
}

export interface ExposureGrid {
  prices: number[];
  timesMs: number[];
  metric: ExposureGridMetric;
  /** cells[priceIdx][timeIdx] — price-major to mirror quote evaluation order. */
  cells: ExposureGridCell[][];
  totals: { included: number; excludedExpired: number; missing: number };
  units: string;
  methodology: {
    version: 'exposure-grid/v1';
    signConvention: 'signed-greek-oi-proxy';
    positionBasis: string;
    ivBasis: 'sticky-frozen-per-quote';
    timeBasis: string;
    charmUnits: 'raw -dΔ/dT per year; per-day = raw/365; dollar-per-day = per-day·S·OI·mult';
    gexUnits: '$ per 1% underlying move (γ·S²·0.01·OI·mult)';
    dexUnits: '$Δ notional (signed kernel δ·S·OI·mult; call δ ≥ 0, put δ ≤ 0, no side negation)';
    settlementRule: string;
    modelSupport: 'spot-european priced; futures-european unsupported (no audited gamma/charm adapter)';
    proxyWarning: 'OI-weighted exposure proxy (not observed dealer inventory)';
  };
  warnings: string[];
}

export interface ExposureGridInput {
  quotes: ExposureGridQuote[];
  /** Hypothetical underlying prices, strictly increasing, all finite > 0. */
  prices: number[];
  /** Valuation UTC instants (epoch ms), strictly increasing, all finite. */
  timesMs: number[];
  metric: ExposureGridMetric;
  /** Frozen-OI snapshot event time label for methodology.positionBasis. */
  positionBasisAt?: string;
  /** Settlement rule string recorded in methodology (caller states it). */
  settlementRule?: string;
}

const MS_PER_YEAR_ACT365_25 = 365.25 * 24 * 3600 * 1000;
/** Hard bound on quote evaluations (prices × times × quotes). */
export const EXPOSURE_GRID_MAX_EVALS = 250_000;
export const EXPOSURE_GRID_MAX_AXIS = 500;

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Build the signed exposure scenario grid. Throws RangeError on malformed
 * axes/shape (caller must fix inputs, never freeze UI); per-quote data gaps
 * yield null cells with counts/reasons, never defaults.
 */
export function buildExposureGrid(input: ExposureGridInput): ExposureGrid {
  const { quotes, prices, timesMs, metric } = input;
  if (!Array.isArray(quotes) || !Array.isArray(prices) || !Array.isArray(timesMs)) {
    throw new RangeError('exposure-grid: quotes/prices/timesMs must be arrays');
  }
  if (prices.length === 0 || timesMs.length === 0) {
    throw new RangeError('exposure-grid: prices and timesMs must be non-empty');
  }
  if (prices.length > EXPOSURE_GRID_MAX_AXIS || timesMs.length > EXPOSURE_GRID_MAX_AXIS) {
    throw new RangeError('exposure-grid: axis exceeds max length');
  }
  for (let i = 0; i < prices.length; i++) {
    if (!isFiniteNum(prices[i]) || !(prices[i]! > 0)) {
      throw new RangeError(`exposure-grid: prices[${i}] must be finite > 0`);
    }
    if (i > 0 && !(prices[i]! > prices[i - 1]!)) {
      throw new RangeError('exposure-grid: prices must be strictly increasing (no duplicates)');
    }
  }
  for (let i = 0; i < timesMs.length; i++) {
    if (!isFiniteNum(timesMs[i])) {
      throw new RangeError(`exposure-grid: timesMs[${i}] must be finite`);
    }
    if (i > 0 && !(timesMs[i]! > timesMs[i - 1]!)) {
      throw new RangeError('exposure-grid: timesMs must be strictly increasing (no duplicates)');
    }
  }
  if (metric !== 'gex' && metric !== 'charm' && metric !== 'dex') {
    throw new RangeError("exposure-grid: metric must be 'gex', 'charm' or 'dex'");
  }
  if (prices.length * timesMs.length * Math.max(quotes.length, 1) > EXPOSURE_GRID_MAX_EVALS) {
    throw new RangeError('exposure-grid: grid size exceeds computational bound');
  }

  const warnings: string[] = [];
  let totalIncluded = 0;
  let totalExpired = 0;
  let totalMissing = 0;
  const reasonSet = new Set<ExposureExclusionReason>();

  const cells: ExposureGridCell[][] = prices.map((S) =>
    timesMs.map((t) => {
      let acc = 0;
      let included = 0;
      let excludedExpired = 0;
      let missing = 0;
      const reasons: ExposureExclusionReason[] = [];
      const note = (r: ExposureExclusionReason) => {
        if (!reasons.includes(r)) reasons.push(r);
        reasonSet.add(r);
      };

      for (const qq of quotes) {
        // 1. Expiry instant must be trustworthy and finite.
        if (!isFiniteNum(qq.expiryMs)) {
          missing++;
          note('missing-expiry');
          continue;
        }
        // 2. Exact-instant expiry comparison — expired quotes excluded.
        if (t >= (qq.expiryMs as number)) {
          excludedExpired++;
          note('expired');
          continue;
        }
        // 3. Model separation — never substitute spot ↔ futures.
        if (qq.modelId !== 'spot-european') {
          missing++;
          note('unsupported-model');
          continue;
        }
        // 4. Full finite-or-null validation before kernels. No defaults.
        if (!isFiniteNum(S) || !(S > 0) || !isFiniteNum(qq.strike) || !(qq.strike > 0)) {
          missing++;
          note('invalid-spot-strike');
          continue;
        }
        if (!isFiniteNum(qq.iv) || !(qq.iv as number > 0)) {
          missing++;
          note('missing-iv');
          continue;
        }
        if (!isFiniteNum(qq.r) || !isFiniteNum(qq.q)) {
          missing++;
          note('missing-rates');
          continue;
        }
        // OI: zero is a valid short-circuit (contributes 0, counts included).
        if (qq.openInterest == null) {
          missing++;
          note('missing-oi');
          continue;
        }
        if (!isFiniteNum(qq.openInterest) || (qq.openInterest as number) < 0) {
          missing++;
          note('missing-oi');
          continue;
        }
        if (!isFiniteNum(qq.multiplier) || !(qq.multiplier > 0)) {
          missing++;
          note('invalid-multiplier');
          continue;
        }
        if (qq.openInterest === 0) {
          included++;
          continue;
        }
        const T = ((qq.expiryMs as number) - t) / MS_PER_YEAR_ACT365_25;
        if (!isFiniteNum(T) || !(T > 0)) {
          missing++;
          note('missing-expiry');
          continue;
        }
        const g = priceGreeksMarket(
          qq.type,
          S,
          qq.strike,
          T,
          qq.r as number,
          qq.q as number,
          qq.iv as number,
        );
        const raw = metric === 'gex' ? g.gamma : metric === 'charm' ? g.charm : g.delta;
        if (!isFiniteNum(raw)) {
          missing++;
          note('non-finite-exposure-overflow');
          continue;
        }
        let contrib: number;
        if (metric === 'gex') {
          // Call+put-negative ONLY here: puts negate, calls stay positive.
          // Raw gamma itself is never negated.
          const sign = qq.type === 'call' ? 1 : -1;
          contrib = sign * raw * S * S * 0.01 * (qq.openInterest as number) * qq.multiplier;
        } else if (metric === 'dex') {
          // DEX keeps the kernel's signed delta for both sides (call ≥ 0,
          // put ≤ 0) — no put negation. Matches dealerExposure DEX.
          contrib = raw * S * (qq.openInterest as number) * qq.multiplier;
        } else {
          // Charm keeps its signed elapsed-time derivative for both sides.
          contrib = raw * S * (qq.openInterest as number) * qq.multiplier;
        }
        if (!isFiniteNum(contrib)) {
          missing++;
          note('non-finite-exposure-overflow');
          continue;
        }
        acc += contrib;
        if (!isFiniteNum(acc)) {
          // Overflowed accumulation fails closed: whole cell unavailable.
          missing += included + 1;
          included = 0;
          acc = 0;
          note('non-finite-exposure-overflow');
          break;
        }
        included++;
      }

      totalIncluded += included;
      totalExpired += excludedExpired;
      totalMissing += missing;
      // All-unavailable can never become valid 0.
      return {
        value: included > 0 ? acc : null,
        included,
        excludedExpired,
        missing,
        reasons,
      };
    }),
  );

  if (reasonSet.has('missing-iv')) warnings.push('positioning-proxy: some quotes lack valid frozen IV — cells null');
  if (reasonSet.has('missing-rates')) warnings.push('positioning-proxy: some quotes lack validated r/q — cells null, no rate defaults applied');
  if (reasonSet.has('missing-oi')) warnings.push('positioning-proxy: some quotes lack valid frozen OI — unavailable, never volume fallback');
  if (reasonSet.has('invalid-multiplier')) warnings.push('positioning-proxy: some quotes carry invalid contract multiplier — unavailable, no silent default');
  if (reasonSet.has('missing-expiry')) warnings.push('positioning-proxy: some quotes lack trustworthy expiry instant — unavailable');
  if (reasonSet.has('unsupported-model')) warnings.push('unsupported-model: futures-european quotes excluded — no audited gamma/charm adapter (Black-76 exposes price/forward-delta only)');
  if (reasonSet.has('non-finite-exposure-overflow')) warnings.push('non-finite-exposure-overflow: overflowed contributions excluded as null');
  if (reasonSet.has('expired')) warnings.push('expired contracts excluded at exact expiry instant; totals drop');

  return {
    prices: [...prices],
    timesMs: [...timesMs],
    metric,
    cells,
    totals: { included: totalIncluded, excludedExpired: totalExpired, missing: totalMissing },
    units: metric === 'gex' ? '$/1% move' : metric === 'dex' ? '$Δ notional' : '$Δ/day',
    methodology: {
      version: 'exposure-grid/v1',
      signConvention: 'signed-greek-oi-proxy',
      positionBasis: `frozen-OI-at-${input.positionBasisAt ?? 'snapshot-event-time'}`,
      ivBasis: 'sticky-frozen-per-quote',
      timeBasis: 'ACT/365.25 from explicit caller-supplied expiry UTC instant (no 16:00-ET inference)',
      charmUnits: 'raw -dΔ/dT per year; per-day = raw/365; dollar-per-day = per-day·S·OI·mult',
      gexUnits: '$ per 1% underlying move (γ·S²·0.01·OI·mult)',
      dexUnits: '$Δ notional (signed kernel δ·S·OI·mult; call δ ≥ 0, put δ ≤ 0, no side negation)',
      settlementRule: input.settlementRule ?? 'caller-stated; no default wall clock assumed',
      modelSupport: 'spot-european priced; futures-european unsupported (no audited gamma/charm adapter)',
      proxyWarning: 'OI-weighted exposure proxy (not observed dealer inventory)',
    },
    warnings,
  };
}
