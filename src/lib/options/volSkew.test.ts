import { describe, it, expect } from 'vitest';
import { closestDelta, atmQuote, wingMatrix, riskReversalRows, atmTermRows, forwardVolMatrix, FWD_VOL_FORMULA, FWD_VOL_YEAR_FRACTION, FWD_VOL_UNITS, SKEW_BUCKET_TARGET, SKEW_PROVENANCE_NOTE } from './volSkew';
import { forwardVol } from '../math/carry/forwardVol';
import type { VolSnapshot } from './types';

function q(delta: number | null, iv: number | null, strike?: number) { return { delta, iv, strike: strike ?? 100 }; }

function snap(): VolSnapshot {
  return {
    symbol: 'SPY', spot: 500, riskFreeRate: 0.04, dividendYield: 0.01, timestamp: Date.now(),
    expiries: [
      {
        expiry: '2026-09-19', dte: 10, atmIV: 0.2, calls: [
          { strike: 500, expiry: '2026-09-19', type: 'call', bid: 1, ask: 2, last: 1.5, mid: 1.5, iv: 0.20, delta: 0.50, gamma: 0.01, theta: -0.1, vega: 0.5, volume: 100, openInterest: 1000 } as any,
          { strike: 520, expiry: '2026-09-19', type: 'call', bid: 0.5, ask: 0.6, last: 0.55, mid: 0.55, iv: 0.22, delta: 0.25, gamma: 0.01, theta: -0.1, vega: 0.5, volume: 10, openInterest: 100 } as any,
          { strike: 540, expiry: '2026-09-19', type: 'call', bid: 0.2, ask: 0.3, last: 0.25, mid: 0.25, iv: 0.30, delta: 0.10, gamma: 0.01, theta: -0.1, vega: 0.5, volume: 5, openInterest: 50 } as any,
          { strike: 510, expiry: '2026-09-19', type: 'call', bid: 0.8, ask: 0.9, last: 0.85, mid: 0.85, iv: 3.5, delta: 0.30, gamma: 0.01, theta: -0.1, vega: 0.5, volume: 10, openInterest: 10 } as any,
        ], puts: [
          { strike: 500, expiry: '2026-09-19', type: 'put', bid: 1, ask: 2, last: 1.5, mid: 1.5, iv: 0.21, delta: -0.49, gamma: 0.01, theta: -0.1, vega: 0.5, volume: 100, openInterest: 1000 } as any,
          { strike: 480, expiry: '2026-09-19', type: 'put', bid: 0.5, ask: 0.6, last: 0.55, mid: 0.55, iv: 0.24, delta: -0.25, gamma: 0.01, theta: -0.1, vega: 0.5, volume: 10, openInterest: 100 } as any,
          { strike: 460, expiry: '2026-09-19', type: 'put', bid: 0.2, ask: 0.3, last: 0.25, mid: 0.25, iv: 0.32, delta: -0.10, gamma: 0.01, theta: -0.1, vega: 0.5, volume: 5, openInterest: 50 } as any,
        ]
      },
      {
        expiry: '2026-10-17', dte: 38, atmIV: 0.19, calls: [
          { strike: 500, expiry: '2026-10-17', type: 'call', bid: 1, ask: 2, last: 1.5, mid: 1.5, iv: 0.19, delta: 0.51, gamma: 0.01, theta: -0.1, vega: 0.5, volume: 100, openInterest: 1000 } as any,
        ], puts: [
          { strike: 500, expiry: '2026-10-17', type: 'put', bid: 1, ask: 2, last: 1.5, mid: 1.5, iv: 0.195, delta: -0.48, gamma: 0.01, theta: -0.1, vega: 0.5, volume: 100, openInterest: 1000 } as any,
        ]
      },
    ]
  };
}

describe('volSkew', () => {
  it('closestDelta picks nearest within tolerance', () => {
    const qs = [q(0.20,0.2,500), q(0.26,0.22,510), q(0.30,0.25,520)];
    expect(closestDelta(qs,0.25,0.14)?.iv).toBe(0.22);
  });
  it('closestDelta null when outside tolerance', () => {
    expect(closestDelta([q(0.05,0.2)],0.25,0.14)).toBeNull();
  });
  it('filters iv >3 and non-finite', () => {
    expect(closestDelta([q(0.25,3.1), q(0.25,Infinity), q(0.25,0), q(0.25,NaN)],0.25)).toBeNull();
  });
  it('filters null delta', () => {
    expect(closestDelta([q(null,0.2)],0.25)).toBeNull();
  });
  it('atmQuote uses 0.5 band 0.15', () => {
    expect(atmQuote([q(0.40,0.2), q(0.50,0.22)],1)?.iv).toBe(0.22);
    expect(atmQuote([q(0.30,0.2)],1)).toBeNull();
  });
  it('wingMatrix null holes and exposes strike/delta metadata', () => {
    const wm = wingMatrix(snap());
    expect(wm.rows[0]!.cells['25ΔC']).toBeCloseTo(0.22);
    expect(wm.rows[0]!.legs['25ΔC'].strike).toBe(520);
    expect(wm.rows[0]!.legs['25ΔC'].delta).toBeCloseTo(0.25);
    expect(wm.rows[1]!.cells['10ΔC']).toBeNull();
    expect(wm.rows[1]!.legs['10ΔC'].strike).toBeNull();
  });
  it('RR exposes per-leg strike/delta metadata', () => {
    const rr = riskReversalRows(snap());
    expect(rr[0]!.rr).toBeCloseTo(-0.02);
    expect(rr[0]!.c25Strike).toBe(520);
    expect(rr[0]!.p25Strike).toBe(480);
    expect(rr[0]!.c25Delta).toBeCloseTo(0.25);
  });
  it('RR null when leg missing', () => {
    const s = snap();
    const rr = riskReversalRows(s);
    expect(rr[1]!.rr).toBeNull();
  });
  it('iv>3 filtered in wings', () => {
    const wm = wingMatrix(snap());
    expect(wm.rows[0]!.cells['25ΔC']).toBeCloseTo(0.22);
  });
  it('ATM proxy null when leg missing and exposes differing strikes', () => {
    const s: VolSnapshot = { symbol:'SPY', spot:500, riskFreeRate:0.04, dividendYield:0.01, timestamp:Date.now(), expiries:[{ expiry:'2026-09-19', dte:10, atmIV:0.2, calls:[{ strike:505, expiry:'2026-09-19', type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.2, delta:0.5, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any], puts:[] }] };
    expect(wingMatrix(s).rows[0]!.cells['ATM']).toBeNull();
    const sw = snap();
    const row = wingMatrix(sw).rows[0]!;
    expect(row.cells['ATM']).toBeCloseTo(0.205);
    // ATM proxy may use different strikes — expose both
    expect(row.atmCallStrike).toBe(500);
    expect(row.atmPutStrike).toBe(500);
    // Force differing strikes scenario
    const diff: VolSnapshot = { symbol:'SPY', spot:500, riskFreeRate:0.04, dividendYield:0.01, timestamp:Date.now(), expiries:[{ expiry:'2026-09-19', dte:10, atmIV:0.2, calls:[{ strike:510, expiry:'2026-09-19', type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.20, delta:0.52, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any], puts:[{ strike:490, expiry:'2026-09-19', type:'put', bid:1, ask:2, last:1.5, mid:1.5, iv:0.22, delta:-0.48, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any] }] };
    const drow = wingMatrix(diff).rows[0]!;
    expect(drow.atmCallStrike).toBe(510);
    expect(drow.atmPutStrike).toBe(490);
    expect(drow.atmCallStrike).not.toBe(drow.atmPutStrike);
  });
  it('ATM term exposes call/put strike/delta proxy metadata', () => {
    const term = atmTermRows(snap());
    expect(term[0]!.atmCallStrike).toBe(500);
    expect(term[0]!.atmPutStrike).toBe(500);
    const missing: VolSnapshot = { symbol:'SPY', spot:500, riskFreeRate:0.04, dividendYield:0.01, timestamp:Date.now(), expiries:[{ expiry:'2026-09-19', dte:10, atmIV:0.2, calls:[{ strike:500, expiry:'2026-09-19', type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.2, delta:0.5, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any], puts:[] }] };
    expect(atmTermRows(missing)[0]!.atmIv).toBeNull();
  });
  it('overlapping bucket reuses same quote when sparse', () => {
    const s: VolSnapshot = { symbol:'SPY', spot:500, riskFreeRate:0.04, dividendYield:0.01, timestamp:Date.now(), expiries:[{ expiry:'2026-09-19', dte:10, atmIV:0.2, calls:[{ strike:500, expiry:'2026-09-19', type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.2, delta:0.18, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any], puts:[{ strike:500, expiry:'2026-09-19', type:'put', bid:1, ask:2, last:1.5, mid:1.5, iv:0.21, delta:-0.18, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any] }] };
    const wm = wingMatrix(s);
    // Same put with Δ -0.18 is within 0.08 of -0.10 and 0.14 of -0.25 → reused
    expect(wm.rows[0]!.legs['10ΔP'].strike).toBe(500);
    expect(wm.rows[0]!.legs['25ΔP'].strike).toBe(500);
    expect(wm.rows[0]!.reused).toBe(true);
    expect(wm.rows[0]!.reuseGroups.join(',')).toContain('10ΔP');
  });
  it('expiry cap exposes totalAvailable vs displayed', () => {
    const many: VolSnapshot = { symbol:'SPY', spot:500, riskFreeRate:0.04, dividendYield:0.01, timestamp:Date.now(), expiries: Array.from({ length: 15 }, (_,i)=>({ expiry:`2026-0${(i%9)+1}-19`, dte:10+i*7, atmIV:0.2, calls:[{ strike:500, expiry:`2026-0${(i%9)+1}-19`, type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.2, delta:0.5, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any], puts:[{ strike:500, expiry:`2026-0${(i%9)+1}-19`, type:'put', bid:1, ask:2, last:1.5, mid:1.5, iv:0.2, delta:-0.5, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any] })) };
    const wm = wingMatrix(many, 10);
    expect(wm.totalAvailable).toBe(15);
    expect(wm.displayed).toBe(10);
    expect(wm.capped).toBe(true);
    expect(wm.rows.length).toBe(10);
  });
  it('empty snapshot wingMin null', () => {
    const wm = wingMatrix({ symbol:'SPY', spot:500, riskFreeRate:0.04, dividendYield:0.01, timestamp:Date.now(), expiries:[] });
    expect(wm.wingMin).toBeNull();
  });
  it('expired/nonfinite DTE does not clamp to zero — forward null with reason', () => {
    const s: VolSnapshot = { symbol:'SPY', spot:500, riskFreeRate:0.04, dividendYield:0.01, timestamp:Date.now(), expiries:[
      { expiry:'2026-09-09', dte:10, atmIV:0.2, calls:[{ strike:500, expiry:'2026-09-09', type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.20, delta:0.5, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any], puts:[{ strike:500, expiry:'2026-09-09', type:'put', bid:1, ask:2, last:1.5, mid:1.5, iv:0.20, delta:-0.5, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any] },
      { expiry:'2026-09-10', dte:0, atmIV:0.2, calls:[{ strike:500, expiry:'2026-09-10', type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.22, delta:0.5, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any], puts:[{ strike:500, expiry:'2026-09-10', type:'put', bid:1, ask:2, last:1.5, mid:1.5, iv:0.22, delta:-0.5, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any] },
    ] };
    const term = atmTermRows(s);
    expect(term[1]!.fwdIv).toBeNull();
    expect(term[1]!.fwdUnavailableReason).toMatch(/expired|DTE/i);
    const nonfinite: VolSnapshot = { symbol:'SPY', spot:500, riskFreeRate:0.04, dividendYield:0.01, timestamp:Date.now(), expiries:[
      { expiry:'2026-09-09', dte:10, atmIV:0.2, calls:[{ strike:500, expiry:'2026-09-09', type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.20, delta:0.5, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any], puts:[{ strike:500, expiry:'2026-09-09', type:'put', bid:1, ask:2, last:1.5, mid:1.5, iv:0.20, delta:-0.5, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any] },
      { expiry:'2026-09-10', dte:NaN as unknown as number, atmIV:0.2, calls:[{ strike:500, expiry:'2026-09-10', type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.22, delta:0.5, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any], puts:[{ strike:500, expiry:'2026-09-10', type:'put', bid:1, ask:2, last:1.5, mid:1.5, iv:0.22, delta:-0.5, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any] },
    ] };
    const t2 = atmTermRows(nonfinite);
    expect(t2[1]!.fwdIv).toBeNull();
    expect(t2[1]!.fwdUnavailableReason).toMatch(/nonfinite|expired/i);
  });
  it('non-increasing DTE forward unavailable', () => {
    const s: VolSnapshot = { symbol:'SPY', spot:500, riskFreeRate:0.04, dividendYield:0.01, timestamp:Date.now(), expiries:[
      { expiry:'2026-09-19', dte:30, atmIV:0.2, calls:[{ strike:500, expiry:'2026-09-19', type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.2, delta:0.5, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any], puts:[{ strike:500, expiry:'2026-09-19', type:'put', bid:1, ask:2, last:1.5, mid:1.5, iv:0.2, delta:-0.5, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any] },
      { expiry:'2026-09-10', dte:20, atmIV:0.2, calls:[{ strike:500, expiry:'2026-09-10', type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.22, delta:0.5, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any], puts:[{ strike:500, expiry:'2026-09-10', type:'put', bid:1, ask:2, last:1.5, mid:1.5, iv:0.22, delta:-0.5, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 } as any] },
    ] };
    const term = atmTermRows(s);
    expect(term[1]!.fwdIv).toBeNull();
    expect(term[1]!.fwdUnavailableReason).toMatch(/non-increasing/i);
  });
  it('provenance note declares derived method', () => {
    expect(SKEW_PROVENANCE_NOTE).toMatch(/Derived/);
    expect(SKEW_PROVENANCE_NOTE).toMatch(/solved mid/);
    expect(SKEW_BUCKET_TARGET['25ΔC']).toBe(0.25);
    expect(SKEW_BUCKET_TARGET['ATM']).toBeNull();
  });
  it('finite-or-null for fwd when variance invalid', () => {
    const term = atmTermRows(snap());
    expect(term[0]!.fwdIv).toBeNull();
    expect(term[1]!.fwdIv == null || (Number.isFinite(term[1]!.fwdIv!) && term[1]!.fwdIv! >0)).toBe(true);
  });
});

describe('forwardVol scalar REF-06 policy', () => {
  it('any negative forward variance — including tiny negatives — is null, never clamped zero', () => {
    // Large negative: classic calendar-arbitrage violation.
    expect(forwardVol(0.6, 0.5, 0.1, 1.0)).toBeNull();
    // Tiny negative (-5e-13 band that the old epsilon clamp mapped to 0).
    const tinyBelow = Math.sqrt((0.01 - 5e-13) / 0.5);
    expect(forwardVol(0.2, 0.25, tinyBelow, 0.5)).toBeNull();
  });
  it('exact zero forward variance with distinct increasing T remains 0', () => {
    expect(forwardVol(0, 0.25, 0, 0.5)).toBe(0);
  });
  it('T2<=T1 and nonfinite inputs are null', () => {
    expect(forwardVol(0.2, 0.5, 0.2, 0.5)).toBeNull();
    expect(forwardVol(0.2, 0.6, 0.2, 0.5)).toBeNull();
    expect(forwardVol(NaN, 0.25, 0.2, 0.5)).toBeNull();
    expect(forwardVol(0.2, 0.25, Infinity, 0.5)).toBeNull();
  });
  it('valid total-variance golden vector', () => {
    // T1=30/365, T2=60/365, s1=0.20, s2=0.25 → fwdVar=(0.125-0.04)*T1 → fv=sqrt(0.085).
    expect(forwardVol(0.2, 30 / 365, 0.25, 60 / 365)).toBeCloseTo(Math.sqrt(0.085), 10);
  });
});

describe('forwardVolMatrix REF-06', () => {
  function legQuote(iv: number, delta: number, strike = 500, expiry = '2026-01-01') {
    return { strike, expiry, type: delta > 0 ? 'call' : 'put', bid: 1, ask: 2, last: 1.5, mid: 1.5, iv, delta, gamma: 0.01, theta: -0.1, vega: 0.5, volume: 10, openInterest: 10 } as any;
  }
  function fwdSnap(legs: { dte: number; iv: number | null }[]): VolSnapshot {
    return {
      symbol: 'SPY', spot: 500, riskFreeRate: 0.04, dividendYield: 0.01, timestamp: Date.now(),
      expiries: legs.map((l, i) => ({
        expiry: `2026-${String(i + 1).padStart(2, '0')}-19`,
        dte: l.dte,
        atmIV: l.iv ?? 0.2,
        calls: l.iv == null ? [] : [legQuote(l.iv, 0.5)],
        puts: l.iv == null ? [] : [legQuote(l.iv, -0.5)],
      })),
    };
  }
  it('pairwise upper triangle with golden value; diagonal/lower structurally blank', () => {
    const m = forwardVolMatrix(fwdSnap([{ dte: 30, iv: 0.2 }, { dte: 60, iv: 0.25 }, { dte: 90, iv: 0.22 }]));
    expect(m.legs.length).toBe(3);
    expect(m.originLabel).toBe('SPOT');
    expect(m.formula).toBe(FWD_VOL_FORMULA);
    expect(m.yearFraction).toBe(FWD_VOL_YEAR_FRACTION);
    expect(m.units).toBe(FWD_VOL_UNITS);
    expect(m.ivBasis).toBe('derived-solved-mid');
    // Golden: (0,1) matches the scalar golden vector.
    expect(m.cells[0]![1]!.value).toBeCloseTo(Math.sqrt(0.085), 10);
    expect(m.cells[0]![1]!.structural).toBe(false);
    expect(m.cells[0]![1]!.reason).toBeNull();
    // Successive chain present alongside full pairwise triangle.
    expect(m.cells[1]![2]!.value).not.toBeNull();
    // Diagonal + lower triangle: structural blanks, never computed.
    for (let i = 0; i < 3; i++) for (let j = 0; j <= i; j++) {
      expect(m.cells[i]![j]!.structural).toBe(true);
      expect(m.cells[i]![j]!.value).toBeNull();
      expect(m.cells[i]![j]!.reason).toBe('structural');
    }
    expect(m.validCount).toBe(3);
  });
  it('negative forward variance cell is unavailable, never zero', () => {
    // var collapses faster than T grows → negative forward variance.
    const m = forwardVolMatrix(fwdSnap([{ dte: 30, iv: 0.6 }, { dte: 90, iv: 0.1 }]));
    expect(m.cells[0]![1]!.value).toBeNull();
    expect(m.cells[0]![1]!.structural).toBe(false);
    expect(m.cells[0]![1]!.reason).toBe('variance invalid/negative');
    expect(m.validCount).toBe(0);
  });
  it('non-increasing DTE, expired/nonfinite DTE, and missing legs are unavailable with reasons', () => {
    const dec = forwardVolMatrix(fwdSnap([{ dte: 30, iv: 0.2 }, { dte: 20, iv: 0.2 }]));
    expect(dec.cells[0]![1]!.value).toBeNull();
    expect(dec.cells[0]![1]!.reason).toBe('non-increasing DTE');
    const expired = forwardVolMatrix(fwdSnap([{ dte: 30, iv: 0.2 }, { dte: 0, iv: 0.2 }]));
    expect(expired.cells[0]![1]!.value).toBeNull();
    expect(expired.cells[0]![1]!.reason).toBe('expired/nonfinite DTE');
    const nonfinite = forwardVolMatrix(fwdSnap([{ dte: 30, iv: 0.2 }, { dte: NaN as unknown as number, iv: 0.2 }]));
    expect(nonfinite.cells[0]![1]!.value).toBeNull();
    expect(nonfinite.cells[0]![1]!.reason).toBe('expired/nonfinite DTE');
    const missing = forwardVolMatrix(fwdSnap([{ dte: 30, iv: 0.2 }, { dte: 60, iv: null }]));
    expect(missing.cells[0]![1]!.value).toBeNull();
    expect(missing.cells[0]![1]!.reason).toBe('ATM leg missing');
  });
  it('empty and single-expiry snapshots yield no forwards', () => {
    const empty = forwardVolMatrix(fwdSnap([]));
    expect(empty.legs).toEqual([]);
    expect(empty.cells).toEqual([]);
    expect(empty.validCount).toBe(0);
    const single = forwardVolMatrix(fwdSnap([{ dte: 30, iv: 0.2 }]));
    expect(single.cells.length).toBe(1);
    expect(single.cells[0]![0]!.structural).toBe(true);
    expect(single.cells[0]![0]!.value).toBeNull();
    expect(single.validCount).toBe(0);
  });
  it('cells carry leg expiries, strikes, deltas, T, units, formula, and ivBasis', () => {
    const m = forwardVolMatrix(fwdSnap([{ dte: 30, iv: 0.2 }, { dte: 60, iv: 0.25 }]));
    const c = m.cells[0]![1]!;
    expect(c.startDte).toBe(30);
    expect(c.endDte).toBe(60);
    expect(c.startT).toBeCloseTo(30 / 365, 12);
    expect(c.endT).toBeCloseTo(60 / 365, 12);
    expect(c.startAtmIv).toBeCloseTo(0.2, 12);
    expect(c.endAtmIv).toBeCloseTo(0.25, 12);
    expect(c.startAtmCallStrike).toBe(500);
    expect(c.endAtmPutStrike).toBe(500);
    expect(c.startAtmCallDelta).toBeCloseTo(0.5, 12);
    expect(c.endAtmPutDelta).toBeCloseTo(-0.5, 12);
    expect(c.formula).toBe(FWD_VOL_FORMULA);
    expect(c.yearFraction).toBe(FWD_VOL_YEAR_FRACTION);
    expect(c.units).toBe(FWD_VOL_UNITS);
    expect(c.ivBasis).toBe('derived-solved-mid');
  });
  it('nullability sweep: no NaN/Infinity anywhere, values finite or null', () => {
    const m = forwardVolMatrix(fwdSnap([
      { dte: 30, iv: 0.2 }, { dte: 20, iv: 0.25 }, { dte: 0, iv: 0.3 },
      { dte: 60, iv: null }, { dte: 90, iv: 0.6 }, { dte: 120, iv: 0.1 },
    ]));
    for (const row of m.cells) for (const c of row) {
      expect(c.value == null || Number.isFinite(c.value)).toBe(true);
      if (c.value != null) expect(c.value).toBeGreaterThanOrEqual(0);
      for (const n of [c.startT, c.endT, c.startAtmIv, c.endAtmIv]) {
        expect(n == null || Number.isFinite(n)).toBe(true);
      }
    }
    // JSON transport must never carry NaN/Infinity.
    const roundTripped = JSON.parse(JSON.stringify({ legs: m.legs, cells: m.cells }));
    expect(roundTripped.cells.flat().every((c: { value: number | null }) => c.value == null || Number.isFinite(c.value))).toBe(true);
  });
});
