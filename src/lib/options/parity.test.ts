import { describe, it, expect } from 'vitest';
import {
  forwardFromParity,
  impliedDividendYield,
  estimateParityDividend,
  blendDividendYield,
} from './parity';
import { priceGreeksMarket } from '../math/adapters';

describe('forwardFromParity / impliedDividendYield', () => {
  const S = 100;
  const r = 0.05;
  const q = 0.02;
  const T = 0.5;
  const F = S * Math.exp((r - q) * T);

  it('recovers forward from fair BS call/put mids', () => {
    const K = 100;
    const vol = 0.2;
    const c = priceGreeksMarket('call', S, K, T, r, q, vol).price;
    const p = priceGreeksMarket('put', S, K, T, r, q, vol).price;
    const f = forwardFromParity(c, p, K, T, r);
    expect(f).toBeCloseTo(F, 4);
  });

  it('recovers dividend yield from F and S', () => {
    const iq = impliedDividendYield(S, F, T, r);
    expect(iq).not.toBeNull();
    expect(iq!).toBeCloseTo(q, 5);
  });

  it('rejects absurd forwards', () => {
    expect(impliedDividendYield(100, 200, 0.25, 0.05)).toBeNull();
  });
});

describe('estimateParityDividend', () => {
  const S = 550;
  const r = 0.05;
  const q = 0.013;
  const T = 30 / 365.25;
  const vol = 0.18;

  function mids(strikes: number[]) {
    const calls = [];
    const puts = [];
    for (const K of strikes) {
      calls.push({ strike: K, mid: priceGreeksMarket('call', S, K, T, r, q, vol).price });
      puts.push({ strike: K, mid: priceGreeksMarket('put', S, K, T, r, q, vol).price });
    }
    return { calls, puts };
  }

  it('estimates q near the true dividend from ATM pairs', () => {
    const { calls, puts } = mids([530, 540, 550, 560, 570]);
    const res = estimateParityDividend(calls, puts, S, T, r);
    expect(res).not.toBeNull();
    expect(res!.dividendYield).toBeCloseTo(q, 2);
    expect(res!.forward).toBeCloseTo(S * Math.exp((r - q) * T), 1);
    expect(res!.samples).toBeGreaterThanOrEqual(3);
  });

  it('returns null without put/call pairs', () => {
    expect(estimateParityDividend([{ strike: 100, mid: 5 }], [], 100, T, r)).toBeNull();
  });
});

describe('blendDividendYield', () => {
  it('returns seed when parity missing', () => {
    expect(blendDividendYield(0.02, null)).toBe(0.02);
  });

  it('weights parity when RMSE is tight', () => {
    const blended = blendDividendYield(0.02, {
      forward: 100,
      dividendYield: 0.01,
      samples: 3,
      rmse: 0.01,
    });
    expect(blended).toBeCloseTo(0.25 * 0.02 + 0.75 * 0.01, 5);
  });
});
