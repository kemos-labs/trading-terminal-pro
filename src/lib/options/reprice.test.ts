import { describe, it, expect } from 'vitest';
import { repriceSnapshotAtSpot } from './reprice';
import { priceGreeksMarket } from '../math/adapters';
import { yearFractionFromSlice } from './time';
import type { VolSnapshot } from './types';

function makeSnap(spot: number, gammaAtSpot: number): VolSnapshot {
  // ATM call at given spot with fixed IV — gamma scales ~1/S.
  const iv = 0.2;
  const expiry = '2026-08-01';
  const dte = 30;
  const T = yearFractionFromSlice({ expiry, dte }, 1);
  const r = 0.05;
  const q = 0.01;
  const g = priceGreeksMarket('call', spot, 100, T, r, q, iv);
  // Sanity: caller may pass expected gamma
  void gammaAtSpot;
  return {
    symbol: 'TEST',
    spot,
    riskFreeRate: r,
    dividendYield: q,
    timestamp: 1,
    expiries: [
      {
        expiry,
        dte,
        atmIV: iv,
        riskFreeRate: r,
        dividendYield: q,
        calls: [
          {
            strike: 100,
            expiry,
            type: 'call',
            bid: 1,
            ask: 1.1,
            last: 1.05,
            mid: 1.05,
            iv,
            delta: g.delta,
            gamma: g.gamma,
            theta: g.theta,
            vega: g.vega,
            vanna: g.vanna,
            charm: g.charm,
            volga: g.volga,
            speed: g.speed,
            rho: g.rho,
            veta: g.veta,
            color: g.color,
            zomma: g.zomma,
            ultima: g.ultima,
            openInterest: 1000,
            volume: 10,
          },
        ],
        puts: [],
      },
    ],
  };
}

describe('repriceSnapshotAtSpot', () => {
  it('recomputes gamma at new spot (sticky IV, continuous T)', () => {
    const snap = makeSnap(100, 0);
    const oldGamma = snap.expiries[0]!.calls[0]!.gamma!;
    const ts = 2;
    const next = repriceSnapshotAtSpot(snap, 110, { timestamp: ts });
    expect(next.spot).toBe(110);
    expect(next.timestamp).toBe(ts);
    const newGamma = next.expiries[0]!.calls[0]!.gamma!;
    const T = yearFractionFromSlice(snap.expiries[0]!, ts);
    const expected = priceGreeksMarket('call', 110, 100, T, 0.05, 0.01, 0.2).gamma;
    expect(newGamma).toBeCloseTo(expected, 6);
    expect(newGamma).not.toBeCloseTo(oldGamma, 6);
    // Original snap not mutated
    expect(snap.expiries[0]!.calls[0]!.gamma).toBe(oldGamma);
  });

  it('returns same reference when spot unchanged within eps', () => {
    const snap = makeSnap(100, 0);
    const next = repriceSnapshotAtSpot(snap, 100);
    expect(next).toBe(snap);
  });

  it('leaves quotes without IV untouched', () => {
    const snap = makeSnap(100, 0);
    const bare = {
      ...snap.expiries[0]!.calls[0]!,
      iv: null,
      delta: 0.5,
      gamma: 0.01,
    };
    const withBare: VolSnapshot = {
      ...snap,
      expiries: [{ ...snap.expiries[0]!, calls: [bare], puts: [] }],
    };
    const next = repriceSnapshotAtSpot(withBare, 110);
    expect(next.expiries[0]!.calls[0]!.gamma).toBe(0.01);
    expect(next.expiries[0]!.calls[0]!.delta).toBe(0.5);
  });
});
