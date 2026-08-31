import { describe, expect, it } from 'vitest';
import {
  expirySummaries,
  premiumMatrix,
  scannerRows,
  standingPremiumUsd,
  type PremiumChain,
} from './premiumMath';
import type { OptionQuote } from '../options/types';

const q = (over: Partial<OptionQuote>): OptionQuote => ({
  strike: 100,
  expiry: '2026-03-20',
  type: 'call',
  bid: 1.0,
  ask: 1.4,
  mid: 1.2,
  last: 1.1,
  iv: 0.4,
  delta: 0.5,
  gamma: 0.01,
  theta: -0.02,
  vega: 0.1,
  openInterest: 10,
  volume: 5,
  instrument: 'BTC-20260320-100-C',
  ...over,
} as OptionQuote);

const chain = (calls: OptionQuote[], puts: OptionQuote[] = [], spot = 100): PremiumChain => ({
  spot,
  expiries: [{ expiry: '2026-03-20', dte: 30, calls, puts }],
});

describe('premiumMath — missing OI is null/partial, observed zero is zero (C1)', () => {
  it('standing premium: missing OI → null, observed zero → 0, positive OI → mark × OI', () => {
    expect(standingPremiumUsd(q({ openInterest: null }))).toBeNull();
    expect(standingPremiumUsd(q({ openInterest: 0 }))).toBe(0);
    expect(standingPremiumUsd(q({ openInterest: 10 }))).toBeCloseTo(1.2 * 10, 10);
  });

  it('matrix cells distinguish missing OI from a zero premium', () => {
    const res = premiumMatrix(chain([q({ openInterest: null }), q({ strike: 105, openInterest: 0 })]));
    // Strikes are descending (rows); each row has one cell per expiry.
    const zeroCell = res.cells[0]![0]!;   // strike 105 — observed zero OI
    const missingCell = res.cells[1]![0]!; // strike 100 — missing OI
    expect(missingCell.premium).toBeNull();
    expect(missingCell.oiMissing).toBe(true);
    expect(zeroCell.premium).toBe(0);
    expect(zeroCell.oiMissing).toBe(false);
  });

  it('scanner rows keep openInterest null when missing and never coerce to 0', () => {
    const rows = scannerRows(chain([q({ openInterest: null }), q({ strike: 105, openInterest: 0 })]));
    const missing = rows.find((r) => r.strike === 100)!;
    const zero = rows.find((r) => r.strike === 105)!;
    expect(missing.openInterest).toBeNull();
    expect(missing.premiumUsd).toBeNull();
    expect(zero.openInterest).toBe(0);
    expect(zero.premiumUsd).toBe(0);
  });

  it('scanner oiMin filter never treats missing OI as satisfying the bound', () => {
    const rows = scannerRows(chain([q({ openInterest: null })]), { oiMin: 1 });
    expect(rows).toHaveLength(0);
  });

  it('expiry summaries carry OI coverage state (full/partial/missing)', () => {
    const full = expirySummaries(chain([q({ openInterest: 3 }), q({ strike: 105, openInterest: 4 })]))[0]!;
    expect(full.oiCoverage).toBe('full');
    expect(full.totalOi).toBe(7);
    const partial = expirySummaries(chain([q({ openInterest: 3 }), q({ strike: 105, openInterest: null })]))[0]!;
    expect(partial.oiCoverage).toBe('partial');
    expect(partial.totalOi).toBe(3);
    expect(partial.oiMissing).toBe(1);
    const missing = expirySummaries(chain([q({ openInterest: null })]))[0]!;
    expect(missing.oiCoverage).toBe('missing');
    expect(missing.totalOi).toBe(0);
  });

  it('matrix outputs contain no NaN or Infinity anywhere', () => {
    const res = premiumMatrix(
      chain([
        q({ openInterest: null }),
        q({ strike: 105, openInterest: 0 }),
        q({ strike: 95, iv: null, delta: null }),
      ]),
    );
    const walk = (v: unknown): void => {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(res);
  });
});
