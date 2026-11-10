/**
 * exposureGrid tests — independent closed-form / finite-difference references.
 *
 * The reference math below is derived locally in this file (own erf-based
 * N(x), textbook BS-Merton gamma, finite-difference charm) and does NOT
 * import src/lib/math/greeks.ts, norm.ts or adapters.ts. The grid engine is
 * checked THROUGH buildExposureGrid only, extracting implied Greeks from
 * cell values. Kernel correctness itself is therefore tested, not mirrored.
 */
import { describe, expect, it } from 'vitest';
import {
  buildExposureGrid,
  EXPOSURE_GRID_MAX_EVALS,
  type ExposureGridQuote,
} from './exposureGrid';

const MSYR = 365.25 * 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0); // fixed valuation anchor

// Own standard-normal CDF (Abramowitz–Stegun 7.1.26, |err| < 7.5e-8).
function Ncdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const s = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + s * y);
}
const npdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

// Textbook BS-Merton gamma (per $), independent of the implementation.
function refGamma(S: number, K: number, T: number, r: number, q: number, sig: number): number {
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sig * sig) * T) / (sig * Math.sqrt(T));
  return (Math.exp(-q * T) * npdf(d1)) / (S * sig * Math.sqrt(T));
}
// Textbook delta, then charm_raw = -dΔ/dT via central difference (elapsed-time convention).
function refDelta(side: 'call' | 'put', S: number, K: number, T: number, r: number, q: number, sig: number): number {
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sig * sig) * T) / (sig * Math.sqrt(T));
  const df = Math.exp(-q * T);
  return side === 'call' ? df * Ncdf(d1) : -df * Ncdf(-d1);
}
function refCharmRaw(side: 'call' | 'put', S: number, K: number, T: number, r: number, q: number, sig: number): number {
  const h = Math.min(1e-4, T / 4);
  return -(refDelta(side, S, K, T + h, r, q, sig) - refDelta(side, S, K, T - h, r, q, sig)) / (2 * h);
}

function q(
  type: 'call' | 'put',
  strike: number,
  Tdays: number,
  over: Partial<ExposureGridQuote> = {},
): ExposureGridQuote {
  return {
    type,
    strike,
    expiryMs: T0 + (Tdays * 24 * 3600 * 1000 * 365.25) / 365.25, // exact Tdays in ms
    modelId: 'spot-european',
    openInterest: 100,
    multiplier: 100,
    iv: 0.2,
    ivProvenance: 'solved-mid',
    r: 0.04,
    q: 0.01,
    ...over,
  };
}
// Exact T in engine year basis for a quote built by q().
function engT(days: number): number {
  return (days * 24 * 3600 * 1000) / MSYR;
}

describe('exposureGrid engine', () => {
  it('A: single call/put $GEX and $charm match independent closed form; put-GEX negated, gamma nonnegative', () => {
    const T = engT(30);
    const grid = buildExposureGrid({
      quotes: [q('call', 100, 30), q('put', 100, 30)],
      prices: [100],
      timesMs: [T0],
      metric: 'gex',
    });
    const gCall = refGamma(100, 100, T, 0.04, 0.01, 0.2);
    const expCall = gCall * 100 * 100 * 0.01 * 100 * 100;
    expect(grid.cells[0]![0]!.value).not.toBeNull();
    // Both quotes contribute: call +g, put −g → net ≈ 0 at same strike.
    expect(Math.abs(grid.cells[0]![0]!.value!)).toBeLessThan(Math.abs(expCall) * 1e-9 + 1e-6);

    const callOnly = buildExposureGrid({
      quotes: [q('call', 100, 30)],
      prices: [100],
      timesMs: [T0],
      metric: 'gex',
    });
    const putOnly = buildExposureGrid({
      quotes: [q('put', 100, 30)],
      prices: [100],
      timesMs: [T0],
      metric: 'gex',
    });
    expect(callOnly.cells[0]![0]!.value).toBeCloseTo(expCall, 8);
    // Raw gamma nonnegative ⇒ put $GEX is exactly the negated magnitude (proxy convention only).
    expect(putOnly.cells[0]![0]!.value).toBeCloseTo(-expCall, 8);
    expect(gCall).toBeGreaterThan(0);

    const charmCall = buildExposureGrid({
      quotes: [q('call', 100, 30)],
      prices: [100],
      timesMs: [T0],
      metric: 'charm',
    });
    const raw = refCharmRaw('call', 100, 100, T, 0.04, 0.01, 0.2);
    const expCharm = (raw / 365) * 100 * 100 * 100;
    const got = charmCall.cells[0]![0]!.value!;
    // FD reference carries O(h²) truncation: assert tight relative band, not 1ulp.
    expect(Math.abs(got - expCharm) / Math.abs(expCharm)).toBeLessThan(1e-5);
    // Day unit is /365 on the raw annual elapsed-time derivative.
    expect(Math.abs(got - expCharm) / Math.abs(expCharm)).toBeLessThan(1e-6);
  });

  it('C: ATM gamma rises as expiry nears (no monotonic-decay); far OTM collapses — never limit-0 at ATM', () => {
    const days = [60, 30, 7, 1];
    const gammas = days.map((d) => {
      const g = buildExposureGrid({
        quotes: [q('call', 100, d)],
        prices: [100],
        timesMs: [T0],
        metric: 'gex',
      });
      const v = g.cells[0]![0]!.value!;
      return v / (100 * 100 * 0.01 * 100 * 100); // implied gamma
    });
    for (let i = 1; i < gammas.length; i++) {
      expect(gammas[i]).toBeGreaterThan(gammas[i - 1]!); // blow-up, not decay
    }
    // Cross-check against independent closed form (kernel correctness itself).
    expect(gammas[1]).toBeCloseTo(refGamma(100, 100, engT(30), 0.04, 0.01, 0.2), 8);
    // Far OTM near expiry collapses toward zero while ATM stays large.
    const otm = buildExposureGrid({
      quotes: [q('call', 120, 0.5), q('call', 80, 0.5)],
      prices: [100],
      timesMs: [T0],
      metric: 'gex',
    });
    const atm = buildExposureGrid({
      quotes: [q('call', 100, 0.5)],
      prices: [100],
      timesMs: [T0],
      metric: 'gex',
    });
    expect(Math.abs(otm.cells[0]![0]!.value!)).toBeLessThan(Math.abs(atm.cells[0]![0]!.value!) / 100);
    expect(Math.abs(atm.cells[0]![0]!.value!)).toBeGreaterThan(0);
  });

  it('expiry exclusion is an exact-instant policy, separate from analytic limits', () => {
    const expiry = T0 + 10 * 24 * 3600 * 1000;
    const quote = q('call', 100, 30, { expiryMs: expiry });
    const before = buildExposureGrid({
      quotes: [quote],
      prices: [100],
      timesMs: [expiry - 1],
      metric: 'gex',
    });
    const at = buildExposureGrid({
      quotes: [quote],
      prices: [100],
      timesMs: [expiry],
      metric: 'gex',
    });
    const after = buildExposureGrid({
      quotes: [quote],
      prices: [100],
      timesMs: [expiry + 60_000],
      metric: 'gex',
    });
    expect(before.cells[0]![0]!.value).not.toBeNull();
    expect(before.cells[0]![0]!.included).toBe(1);
    for (const g of [at, after]) {
      expect(g.cells[0]![0]!.value).toBeNull(); // excluded, not valid 0
      expect(g.cells[0]![0]!.excludedExpired).toBe(1);
      expect(g.cells[0]![0]!.reasons).toContain('expired');
      expect(g.totals.included).toBe(0);
    }
  });

  it('D: null propagation — missing/invalid IV, r/q, OI, expiry; zero OI is valid 0; overflow fails closed', () => {
    const base = { prices: [100], timesMs: [T0] as number[], metric: 'gex' as const };
    const nullCases: Partial<ExposureGridQuote>[] = [
      { iv: null },
      { iv: 0 },
      { iv: NaN },
      { r: null },
      { q: null },
      { openInterest: null },
      { openInterest: -5 },
      { expiryMs: null },
      { expiryMs: NaN },
    ];
    for (const over of nullCases) {
      const g = buildExposureGrid({ ...base, timesMs: [T0], quotes: [q('call', 100, 30, over)] });
      expect(g.cells[0]![0]!.value).toBeNull();
      expect(g.cells[0]![0]!.included).toBe(0);
      expect(g.totals.included).toBe(0);
    }
    // Invalid multiplier: fail-closed with dedicated reason (distinct from missing OI).
    const badMult = buildExposureGrid({
      ...base,
      timesMs: [T0],
      quotes: [q('call', 100, 30, { multiplier: NaN })],
    });
    expect(badMult.cells[0]![0]!.value).toBeNull();
    expect(badMult.cells[0]![0]!.reasons).toContain('invalid-multiplier');
    // Zero OI: valid short-circuit → 0 with included count (distinct from missing).
    const zero = buildExposureGrid({
      ...base,
      timesMs: [T0],
      quotes: [q('call', 100, 30, { openInterest: 0 })],
    });
    expect(zero.cells[0]![0]!.value).toBe(0);
    expect(zero.cells[0]![0]!.included).toBe(1);
    // Overflow: astronomic OI → null + overflow reason, never Infinity.
    const huge = buildExposureGrid({
      ...base,
      timesMs: [T0],
      quotes: [q('call', 100, 30, { openInterest: 1e308 })],
    });
    expect(huge.cells[0]![0]!.value).toBeNull();
    expect(huge.cells[0]![0]!.reasons).toContain('non-finite-exposure-overflow');
    // Partial totals explicit: one good + one missing → value from good only.
    const partial = buildExposureGrid({
      ...base,
      timesMs: [T0],
      quotes: [q('call', 100, 30), q('put', 105, 30, { iv: null })],
    });
    expect(partial.cells[0]![0]!.value).not.toBeNull();
    expect(partial.cells[0]![0]!.included).toBe(1);
    expect(partial.cells[0]![0]!.missing).toBe(1);
    // All-unavailable can never become valid 0.
    const allNull = buildExposureGrid({
      ...base,
      timesMs: [T0],
      quotes: [q('call', 100, 30, { iv: null })],
    });
    expect(allNull.cells[0]![0]!.value).toBeNull();
    expect(allNull.cells[0]![0]!.value).not.toBe(0);
  });

  it('futures-european is explicit unsupported-model, never silently spot-priced', () => {
    const g = buildExposureGrid({
      quotes: [q('call', 100, 30, { modelId: 'futures-european' })],
      prices: [100],
      timesMs: [T0],
      metric: 'gex',
    });
    expect(g.cells[0]![0]!.value).toBeNull();
    expect(g.cells[0]![0]!.reasons).toContain('unsupported-model');
    expect(g.warnings.some((w) => w.startsWith('unsupported-model'))).toBe(true);
  });

  it('hypothetical prices outside the listed strike band stay valid', () => {
    const g = buildExposureGrid({
      quotes: [q('call', 100, 30), q('put', 100, 30)],
      prices: [50, 200],
      timesMs: [T0],
      metric: 'gex',
    });
    for (const row of g.cells) {
      expect(row[0]!.value).not.toBeNull();
      expect(Number.isFinite(row[0]!.value!)).toBe(true);
    }
    // Independent check at S*=200: call dominates, positive net.
    const T = engT(30);
    const exp = refGamma(200, 100, T, 0.04, 0.01, 0.2) * 200 * 200 * 0.01 * 100 * 100
      - refGamma(200, 100, T, 0.04, 0.01, 0.2) * 200 * 200 * 0.01 * 100 * 100;
    expect(g.cells[1]![0]!.value).toBeCloseTo(exp, 4);
  });

  it('rejects bad axes rather than freezing: duplicates, non-monotone, non-positive, oversize', () => {
    const ok = { quotes: [q('call', 100, 30)], timesMs: [T0], metric: 'gex' as const };
    expect(() => buildExposureGrid({ ...ok, prices: [100, 100] })).toThrow(RangeError);
    expect(() => buildExposureGrid({ ...ok, prices: [110, 100] })).toThrow(RangeError);
    expect(() => buildExposureGrid({ ...ok, prices: [0] })).toThrow(RangeError);
    expect(() => buildExposureGrid({ ...ok, prices: [-5] })).toThrow(RangeError);
    expect(() =>
      buildExposureGrid({ ...ok, prices: [100], timesMs: [T0, T0] }),
    ).toThrow(RangeError);
    expect(() =>
      buildExposureGrid({ ...ok, prices: [100], timesMs: [NaN] }),
    ).toThrow(RangeError);
    expect(() =>
      buildExposureGrid({ quotes: [q('call', 100, 30)], prices: [100], timesMs: [T0], metric: 'gex', }),
    ).not.toThrow();
    // Computational bound enforced.
    const big = Array.from({ length: 600 }, (_, i) => 50 + i);
    expect(() =>
      buildExposureGrid({ quotes: [q('call', 100, 30)], prices: big, timesMs: [T0], metric: 'gex' }),
    ).toThrow(RangeError);
    expect(EXPOSURE_GRID_MAX_EVALS).toBeGreaterThan(0);
  });

  it('frozen inputs immutable; outputs deterministic; grid cell matches independent single-cell profile', () => {
    const input = {
      quotes: [q('call', 100, 30), q('put', 105, 30)],
      prices: [95, 100, 105],
      timesMs: [T0, T0 + 86_400_000],
      metric: 'gex' as const,
      positionBasisAt: '2026-09-01T12:00:00Z',
      settlementRule: 'test-wall',
    };
    Object.freeze(input.quotes);
    Object.freeze(input.prices);
    Object.freeze(input.timesMs);
    for (const qq of input.quotes) Object.freeze(qq);
    const a = buildExposureGrid(input);
    const b = buildExposureGrid(input);
    expect(a).toEqual(b);
    expect(input.prices).toEqual([95, 100, 105]);
    expect(input.quotes[0]!.openInterest).toBe(100);
    // Methodology records the frozen scenario basis and proxy warning.
    expect(a.methodology.positionBasis).toContain('frozen-OI-at-2026-09-01');
    expect(a.methodology.proxyWarning).toMatch(/not observed dealer/i);
    // Selected cell (S*=105, t*=T0) matches fully independent evaluation.
    const T = engT(30);
    const expCall = refGamma(105, 100, T, 0.04, 0.01, 0.2) * 105 * 105 * 0.01 * 100 * 100;
    const expPut = -refGamma(105, 105, T, 0.04, 0.01, 0.2) * 105 * 105 * 0.01 * 100 * 100;
    expect(a.cells[2]![0]!.value).toBeCloseTo(expCall + expPut, 4);
  });

  it('charm follows elapsed-time derivative sign/day unit; charm ≠ gamma field', () => {
    const T = engT(30);
    const gex = buildExposureGrid({
      quotes: [q('call', 100, 30)],
      prices: [100],
      timesMs: [T0],
      metric: 'gex',
    });
    const charm = buildExposureGrid({
      quotes: [q('call', 100, 30)],
      prices: [100],
      timesMs: [T0],
      metric: 'charm',
    });
    const gv = gex.cells[0]![0]!.value!;
    const cv = charm.cells[0]![0]!.value!;
    // Different quantities, different units — charm is $Δ/day, gex is $/1%.
    expect(gv).toBeGreaterThan(0);
    expect(cv).not.toBeCloseTo(gv, 0);
    // Independent FD reference for the charm cell (validates kernel too).
    const raw = refCharmRaw('call', 100, 100, T, 0.04, 0.01, 0.2);
    expect(Math.abs(cv - (raw / 365) * 100 * 100 * 100) / Math.abs(cv)).toBeLessThan(1e-5);
    expect(charm.units).toBe('$Δ/day');
    expect(gex.units).toBe('$/1% move');
  });

  it('DEX golden vector: signed kernel delta × S × OI × mult; call ≥ 0, put ≤ 0, no side negation', () => {
    const T = engT(30);
    const call = buildExposureGrid({
      quotes: [q('call', 100, 30)],
      prices: [100],
      timesMs: [T0],
      metric: 'dex',
    });
    const put = buildExposureGrid({
      quotes: [q('put', 100, 30)],
      prices: [100],
      timesMs: [T0],
      metric: 'dex',
    });
    const cv = call.cells[0]![0]!.value!;
    const pv = put.cells[0]![0]!.value!;
    const expCall = refDelta('call', 100, 100, T, 0.04, 0.01, 0.2) * 100 * 100 * 100;
    const expPut = refDelta('put', 100, 100, T, 0.04, 0.01, 0.2) * 100 * 100 * 100;
    expect(cv).toBeCloseTo(expCall, 4);
    expect(pv).toBeCloseTo(expPut, 4);
    expect(cv).toBeGreaterThan(0);
    expect(pv).toBeLessThan(0);
    expect(call.units).toBe('$Δ notional');
    expect(call.methodology.dexUnits).toMatch(/signed kernel/);
    // Combined cell is the signed sum (delta already carries the sign).
    const both = buildExposureGrid({
      quotes: [q('call', 100, 30), q('put', 100, 30)],
      prices: [100],
      timesMs: [T0],
      metric: 'dex',
    });
    expect(both.cells[0]![0]!.value).toBeCloseTo(cv + pv, 6);
  });

  it('DEX null semantics: missing/expired/unsupported/non-finite stay null, never zero-filled', () => {
    const base = { prices: [100], timesMs: [T0], metric: 'dex' as const };
    expect(buildExposureGrid({ ...base, quotes: [q('call', 100, 30, { iv: null })] }).cells[0]![0]!.value).toBeNull();
    expect(buildExposureGrid({ ...base, quotes: [q('call', 100, 30, { r: null })] }).cells[0]![0]!.value).toBeNull();
    expect(buildExposureGrid({ ...base, quotes: [q('call', 100, 30, { openInterest: null })] }).cells[0]![0]!.value).toBeNull();
    expect(buildExposureGrid({ ...base, quotes: [q('call', 100, 30, { expiryMs: null })] }).cells[0]![0]!.value).toBeNull();
    expect(buildExposureGrid({ ...base, quotes: [q('call', 100, 30, { modelId: 'futures-european' })] }).cells[0]![0]!.value).toBeNull();
    // Expired at the exact instant excludes.
    expect(buildExposureGrid({ prices: [100], timesMs: [T0], metric: 'dex', quotes: [q('call', 100, 30, { expiryMs: T0 })] }).cells[0]![0]).toMatchObject({ value: null, excludedExpired: 1 });
    // Zero OI is a valid included zero.
    expect(buildExposureGrid({ ...base, quotes: [q('call', 100, 30, { openInterest: 0 })] }).cells[0]![0]).toMatchObject({ value: 0, included: 1 });
    // Non-finite delta fails closed.
    expect(buildExposureGrid({ ...base, quotes: [q('call', 100, 30, { iv: Infinity as unknown as number })] }).cells[0]![0]!.value).toBeNull();
  });
});
