/**
 * Tests for options analytics functions
 */

import { describe, it, expect } from 'vitest';
import {
  portfolioGreeks,
  impliedMove,
  maxPainStrike,
  gammaExposure,
  ivRank,
  dealerExposure,
  dealerExposureByExpiry,
  dealerProfiles,
  dealerCalendarGrid,
  greeksProfile,
  resolveExposureWeight,
  scanParityEdges,
  realizedVolCloseToClose,
  inventoryByExpiry,
  flipFromSeries,
} from './analytics';
import type { VolSnapshot } from './types';

describe('Portfolio Greeks', () => {
  it('should calculate portfolio Greeks correctly', () => {
    const snapshot: VolSnapshot = {
      symbol: 'TEST',
      spot: 100,
      riskFreeRate: 0.05,
      dividendYield: 0.01,
      timestamp: Date.now(),
      expiries: [
        {
          expiry: '2024-01-01',
          dte: 30,
          atmIV: 0.2,
          calls: [
            {
              strike: 100,
              expiry: '2024-01-01',
              type: 'call',
              bid: 2.0,
              ask: 2.5,
              last: 2.25,
              mid: 2.25,
              iv: 0.2,
              delta: 0.5,
              gamma: 0.1,
              theta: -0.05,
              vega: 0.3,
              vanna: 0.02,
              charm: -0.01,
              volga: 0.05,
              speed: -0.01,
              rho: 0.1,
              veta: -0.02,
              color: -0.01,
              zomma: 0.02,
              ultima: -0.01,
              openInterest: 1000,
              volume: 500,
            },
          ],
          puts: [],
        },
      ],
    };

    const greeks = portfolioGreeks(snapshot);
    
    expect(greeks.delta).toBeCloseTo(0.5, 4);
    expect(greeks.gamma).toBeCloseTo(0.1, 4);
    expect(greeks.theta).toBeCloseTo(-0.05, 4);
    expect(greeks.vega).toBeCloseTo(0.3, 4);
  });

  it('should handle empty snapshots', () => {
    const snapshot: VolSnapshot = {
      symbol: 'TEST',
      spot: 100,
      riskFreeRate: 0.05,
      dividendYield: 0.01,
      timestamp: Date.now(),
      expiries: [],
    };

    const greeks = portfolioGreeks(snapshot);
    
    expect(greeks.delta).toBe(0);
    expect(greeks.gamma).toBe(0);
    expect(greeks.theta).toBe(0);
    expect(greeks.vega).toBe(0);
  });
});

describe('Implied Move', () => {
  it('should calculate implied move from straddle', () => {
    const snapshot: VolSnapshot = {
      symbol: 'TEST',
      spot: 100,
      riskFreeRate: 0.05,
      dividendYield: 0.01,
      timestamp: Date.now(),
      expiries: [
        {
          expiry: '2024-01-01',
          dte: 30,
          atmIV: 0.2,
          calls: [
            {
              strike: 100,
              expiry: '2024-01-01',
              type: 'call',
              bid: 2.0,
              ask: 2.5,
              last: 2.25,
              mid: 2.25,
              iv: 0.2,
              delta: 0.5,
              gamma: 0.1,
              theta: -0.05,
              vega: 0.3,
              vanna: 0.02,
              charm: -0.01,
              volga: 0.05,
              speed: -0.01,
              rho: 0.1,
              veta: -0.02,
              color: -0.01,
              zomma: 0.02,
              ultima: -0.01,
              openInterest: 1000,
              volume: 500,
            },
          ],
          puts: [
            {
              strike: 100,
              expiry: '2024-01-01',
              type: 'put',
              bid: 2.0,
              ask: 2.5,
              last: 2.25,
              mid: 2.25,
              iv: 0.2,
              delta: -0.5,
              gamma: 0.1,
              theta: -0.05,
              vega: 0.3,
              vanna: 0.02,
              charm: -0.01,
              volga: 0.05,
              speed: -0.01,
              rho: -0.1,
              veta: -0.02,
              color: -0.01,
              zomma: 0.02,
              ultima: -0.01,
              openInterest: 1000,
              volume: 500,
            },
          ],
        },
      ],
    };

    const move = impliedMove(snapshot);
    
    expect(move.straddle).toBeCloseTo(4.5, 4); // 2.25 + 2.25
    // 1σ ≈ straddle / 0.8
    expect(move.move).toBeCloseTo(4.5 / 0.8, 4);
    expect(move.movePct).toBeCloseTo((4.5 / 0.8) / 100, 4);
    // Barrier touch under BM (not a hard-coded constant)
    expect(move.probTouch).toBeGreaterThan(0);
    expect(move.probTouch).toBeLessThanOrEqual(0.99);
  });

  it('should handle empty snapshots', () => {
    const snapshot: VolSnapshot = {
      symbol: 'TEST',
      spot: 100,
      riskFreeRate: 0.05,
      dividendYield: 0.01,
      timestamp: Date.now(),
      expiries: [],
    };

    const move = impliedMove(snapshot);
    
    expect(move.move).toBe(0);
    expect(move.movePct).toBe(0);
    expect(move.probTouch).toBe(0);
    expect(move.straddle).toBe(0);
  });
});

describe('Max Pain Strike', () => {
  it('should calculate max pain strike correctly', () => {
    const snapshot: VolSnapshot = {
      symbol: 'TEST',
      spot: 100,
      riskFreeRate: 0.05,
      dividendYield: 0.01,
      timestamp: Date.now(),
      expiries: [
        {
          expiry: '2024-01-01',
          dte: 30,
          atmIV: 0.2,
          calls: [
            {
              strike: 95,
              expiry: '2024-01-01',
              type: 'call',
              bid: 6.0,
              ask: 6.5,
              last: 6.25,
              mid: 6.25,
              iv: 0.2,
              delta: 0.8,
              gamma: 0.1,
              theta: -0.05,
              vega: 0.3,
              vanna: 0.02,
              charm: -0.01,
              volga: 0.05,
              speed: -0.01,
              rho: 0.1,
              veta: -0.02,
              color: -0.01,
              zomma: 0.02,
              ultima: -0.01,
              openInterest: 100,
              volume: 50,
            },
            {
              strike: 105,
              expiry: '2024-01-01',
              type: 'call',
              bid: 1.0,
              ask: 1.5,
              last: 1.25,
              mid: 1.25,
              iv: 0.2,
              delta: 0.2,
              gamma: 0.1,
              theta: -0.05,
              vega: 0.3,
              vanna: 0.02,
              charm: -0.01,
              volga: 0.05,
              speed: -0.01,
              rho: 0.1,
              veta: -0.02,
              color: -0.01,
              zomma: 0.02,
              ultima: -0.01,
              openInterest: 100,
              volume: 50,
            },
          ],
          puts: [
            {
              strike: 95,
              expiry: '2024-01-01',
              type: 'put',
              bid: 1.0,
              ask: 1.5,
              last: 1.25,
              mid: 1.25,
              iv: 0.2,
              delta: -0.2,
              gamma: 0.1,
              theta: -0.05,
              vega: 0.3,
              vanna: 0.02,
              charm: -0.01,
              volga: 0.05,
              speed: -0.01,
              rho: -0.1,
              veta: -0.02,
              color: -0.01,
              zomma: 0.02,
              ultima: -0.01,
              openInterest: 100,
              volume: 50,
            },
            {
              strike: 105,
              expiry: '2024-01-01',
              type: 'put',
              bid: 6.0,
              ask: 6.5,
              last: 6.25,
              mid: 6.25,
              iv: 0.2,
              delta: -0.8,
              gamma: 0.1,
              theta: -0.05,
              vega: 0.3,
              vanna: 0.02,
              charm: -0.01,
              volga: 0.05,
              speed: -0.01,
              rho: -0.1,
              veta: -0.02,
              color: -0.01,
              zomma: 0.02,
              ultima: -0.01,
              openInterest: 100,
              volume: 50,
            },
          ],
        },
      ],
    };

    const maxPain = maxPainStrike(snapshot);
    
    // With symmetric OI at 95 and 105, max pain should be near the middle (100)
    expect(maxPain).toBeGreaterThanOrEqual(95);
    expect(maxPain).toBeLessThanOrEqual(105);
  });

  it('should handle empty snapshots', () => {
    const snapshot: VolSnapshot = {
      symbol: 'TEST',
      spot: 100,
      riskFreeRate: 0.05,
      dividendYield: 0.01,
      timestamp: Date.now(),
      expiries: [],
    };

    const maxPain = maxPainStrike(snapshot);
    expect(maxPain).toBeNull();
  });
});

describe('IV Rank', () => {
  it('should calculate IV rank correctly', () => {
    const frames = [
      {
        snapshot: {
          symbol: 'TEST',
          spot: 100,
          riskFreeRate: 0.05,
          dividendYield: 0.01,
          timestamp: Date.now(),
          expiries: [
            {
              expiry: '2024-01-01',
              dte: 30,
              atmIV: 0.15,
              calls: [],
              puts: [],
            },
          ],
        },
      },
      {
        snapshot: {
          symbol: 'TEST',
          spot: 100,
          riskFreeRate: 0.05,
          dividendYield: 0.01,
          timestamp: Date.now(),
          expiries: [
            {
              expiry: '2024-01-01',
              dte: 30,
              atmIV: 0.20,
              calls: [],
              puts: [],
            },
          ],
        },
      },
      {
        snapshot: {
          symbol: 'TEST',
          spot: 100,
          riskFreeRate: 0.05,
          dividendYield: 0.01,
          timestamp: Date.now(),
          expiries: [
            {
              expiry: '2024-01-01',
              dte: 30,
              atmIV: 0.25,
              calls: [],
              puts: [],
            },
          ],
        },
      },
    ];

    // Current IV is 0.20 (middle value)
    const result = ivRank(frames, 1);
    
    expect(result.rank).toBeCloseTo(0.5, 4);
    expect(result.percentile).toBeCloseTo(66.67, 2); // 2 out of 3 values are <= 0.20
  });

  it('should handle insufficient data', () => {
    const frames = [
      {
        snapshot: {
          symbol: 'TEST',
          spot: 100,
          riskFreeRate: 0.05,
          dividendYield: 0.01,
          timestamp: Date.now(),
          expiries: [],
        },
      },
    ];

    const result = ivRank(frames, 0);
    
    expect(result.rank).toBe(0.5);
    expect(result.percentile).toBe(50);
  });
});

describe('Gamma Exposure', () => {
  it('should calculate gamma exposure correctly', () => {
    const snapshot: VolSnapshot = {
      symbol: 'TEST',
      spot: 100,
      riskFreeRate: 0.05,
      dividendYield: 0.01,
      timestamp: Date.now(),
      expiries: [
        {
          expiry: '2024-01-01',
          dte: 30,
          atmIV: 0.2,
          calls: [
            {
              strike: 100,
              expiry: '2024-01-01',
              type: 'call',
              bid: 2.0,
              ask: 2.5,
              last: 2.25,
              mid: 2.25,
              iv: 0.2,
              delta: 0.5,
              gamma: 0.1,
              theta: -0.05,
              vega: 0.3,
              vanna: 0.02,
              charm: -0.01,
              volga: 0.05,
              speed: -0.01,
              rho: 0.1,
              veta: -0.02,
              color: -0.01,
              zomma: 0.02,
              ultima: -0.01,
              openInterest: 1000,
              volume: 500,
            },
          ],
          puts: [
            {
              strike: 100,
              expiry: '2024-01-01',
              type: 'put',
              bid: 2.0,
              ask: 2.5,
              last: 2.25,
              mid: 2.25,
              iv: 0.2,
              delta: -0.5,
              gamma: 0.1,
              theta: -0.05,
              vega: 0.3,
              vanna: 0.02,
              charm: -0.01,
              volga: 0.05,
              speed: -0.01,
              rho: -0.1,
              veta: -0.02,
              color: -0.01,
              zomma: 0.02,
              ultima: -0.01,
              openInterest: 500,
              volume: 250,
            },
          ],
        },
      ],
    };

    const gex = gammaExposure(snapshot);
    
    expect(gex.points).toHaveLength(1);
    expect(gex.points[0]?.strike).toBe(100);
    // Dealer convention: calls positive, puts negative.
    expect(gex.points[0]!.callGEX).toBeGreaterThan(0);
    expect(gex.points[0]!.putGEX).toBeLessThan(0);
    expect(gex.totalGEX).toBeGreaterThan(0);
    expect(gex.gammaFlip).toBeGreaterThanOrEqual(100);
  });

  it('should handle empty snapshots', () => {
    const snapshot: VolSnapshot = {
      symbol: 'TEST',
      spot: 100,
      riskFreeRate: 0.05,
      dividendYield: 0.01,
      timestamp: Date.now(),
      expiries: [],
    };

    const gex = gammaExposure(snapshot);
    
    expect(gex.points).toHaveLength(0);
    expect(gex.totalGEX).toBe(0);
    expect(gex.gammaFlip).toBeNull();
  });
});

/**
 * Golden fixture shared with macrovol-api/services/test_greeks_calculator.py
 * (compute_gex_flip). Cumulative: -100 → -150 → -140 → +60 → +110 → flip @ 105.
 */
describe('flipFromSeries cumulative golden (aligned with Python)', () => {
  const GOLDEN = [
    { strike: 90, net: -100 },
    { strike: 95, net: -50 },
    { strike: 100, net: 10 },
    { strike: 105, net: 200 },
    { strike: 110, net: 50 },
  ];

  it('crosses zero on cumulative GEX at strike 105 (not pointwise ~99)', () => {
    expect(flipFromSeries(GOLDEN)).toBe(105);
  });

  it('falls back to min |running sum| when all positive', () => {
    expect(
      flipFromSeries([
        { strike: 90, net: 50 },
        { strike: 100, net: 80 },
        { strike: 110, net: 20 },
      ]),
    ).toBe(90);
  });

  it('returns null for empty series', () => {
    expect(flipFromSeries([])).toBeNull();
  });
});

describe('dealerExposure stack', () => {
  const snap: VolSnapshot = {
    symbol: 'TEST',
    spot: 100,
    riskFreeRate: 0.05,
    dividendYield: 0.01,
    timestamp: Date.now(),
    contractSize: 100,
    expiries: [
      {
        expiry: '2026-08-01',
        dte: 30,
        atmIV: 0.2,
        forward: 100,
        calls: [
          {
            strike: 100, expiry: '2026-08-01', type: 'call',
            bid: 2, ask: 2.2, last: 2.1, mid: 2.1, iv: 0.2,
            delta: 0.5, gamma: 0.04, theta: -0.05, vega: 0.1,
            vanna: 0.02, charm: -0.01, volga: 0.05, speed: 0, rho: 0.1,
            veta: 0, color: 0, zomma: 0, ultima: 0,
            openInterest: 1000, volume: 100,
          },
        ],
        puts: [
          {
            strike: 100, expiry: '2026-08-01', type: 'put',
            bid: 1.8, ask: 2.0, last: 1.9, mid: 1.9, iv: 0.2,
            delta: -0.5, gamma: 0.04, theta: -0.05, vega: 0.1,
            vanna: -0.02, charm: 0.01, volga: 0.05, speed: 0, rho: -0.1,
            veta: 0, color: 0, zomma: 0, ultima: 0,
            openInterest: 500, volume: 50,
          },
        ],
      },
    ],
  };

  it('computes GEX/DEX/VEX/Charm with OI weight', () => {
    const d = dealerExposure(snap);
    expect(d.points).toHaveLength(1);
    expect(d.points[0]!.callGEX).toBeGreaterThan(0);
    expect(d.points[0]!.putGEX).toBeLessThan(0);
    expect(d.totalDEX).not.toBe(0);
    expect(d.callWall).toBe(100);
    expect(d.putWall).toBe(100);
    expect(d.highVolLevel).toBe(100);
  });

  it('highVolLevel is strike of max |netGEX|', () => {
    const multi: VolSnapshot = {
      ...snap,
      expiries: [
        {
          ...snap.expiries[0]!,
          calls: [
            { ...snap.expiries[0]!.calls[0]!, strike: 100, openInterest: 100 },
            {
              ...snap.expiries[0]!.calls[0]!,
              strike: 105,
              openInterest: 5000,
              gamma: 0.05,
            },
          ],
          puts: [
            { ...snap.expiries[0]!.puts[0]!, strike: 100, openInterest: 50 },
            {
              ...snap.expiries[0]!.puts[0]!,
              strike: 95,
              openInterest: 100,
              gamma: 0.02,
            },
          ],
        },
      ],
    };
    const d = dealerExposure(multi);
    expect(d.highVolLevel).toBe(105);
    expect(d.callWall).toBe(105);
  });

  it('unit weight differs from OI weight magnitude', () => {
    const oi = dealerExposure(snap, { weight: 'oi' });
    const unit = dealerExposure(snap, { weight: 'unit' });
    expect(Math.abs(oi.totalGEX)).toBeGreaterThan(Math.abs(unit.totalGEX));
  });

  it('observed positioning unavailable when OI zero — does not silently fall to volume', () => {
    const noOi: VolSnapshot = {
      ...snap,
      expiries: snap.expiries.map((e) => ({
        ...e,
        calls: e.calls.map((q) => ({ ...q, openInterest: 0, volume: 200 })),
        puts: e.puts.map((q) => ({ ...q, openInterest: 0, volume: 100 })),
      })),
    };
    const resolved = resolveExposureWeight(noOi, 'oi');
    // P0 Fix: observed (oi) stays oi with fallback flag; volume is separate scenario mode
    expect(resolved.weight).toBe('oi');
    expect(resolved.fallback).toBe(true);
    const d = dealerExposure(noOi, { weight: 'oi' });
    expect(d.weight).toBe('oi');
    expect(d.weightFallback).toBe(true);
    expect(d.points.length).toBe(0); // no OI ⇒ no observed exposure
    expect(d.totalGEX).toBe(0);
    expect(d.unitNote).toMatch(/unavailable|observed/i);
    // Explicit volume scenario still works when requested
    const vol = dealerExposure(noOi, { weight: 'volume' });
    expect(vol.weight).toBe('volume');
    expect(vol.points.length).toBeGreaterThan(0);
    expect(vol.totalGEX).not.toBe(0);
  });

  it('dealerProfiles cumulates GEX/DEX/charm', () => {
    const d = dealerExposure(snap);
    const prof = dealerProfiles(d);
    expect(prof).toHaveLength(d.points.length);
    expect(prof[prof.length - 1]!.gexCum).toBeCloseTo(d.totalGEX, 6);
    expect(prof[prof.length - 1]!.dexCum).toBeCloseTo(d.totalDEX, 6);
    expect(prof[prof.length - 1]!.charmCum).toBeCloseTo(d.totalCharm, 6);
    expect(prof.every((p) => typeof p.netCharm === 'number')).toBe(true);
  });

  it('dealerExposureByExpiry returns shares', () => {
    const rows = dealerExposureByExpiry(snap);
    expect(rows.length).toBe(1);
    expect(rows[0]!.gexShare).toBe(1);
    expect(rows[0]!.highVolLevel).toBe(100);
  });

  it('dealerCalendarGrid builds strike × expiry for gex and charm', () => {
    const gex = dealerCalendarGrid(snap, 'gex');
    expect(gex.rows).toHaveLength(1);
    expect(gex.strikes).toContain(100);
    expect(gex.values[0]?.[0]).not.toBeNull();
    expect(gex.metric).toBe('gex');

    const charm = dealerCalendarGrid(snap, 'charm');
    expect(charm.metric).toBe('charm');
    expect(charm.strikes.length).toBeGreaterThan(0);
    // call charm −0.01 * scale + put charm 0.01 * scale → finite net
    const v = charm.values[0]?.[0];
    expect(v == null || Number.isFinite(v)).toBe(true);
  });

  it('greeksProfile supports charm and vanna', () => {
    const charm = greeksProfile(snap, 0, 'charm');
    expect(charm.strikes.length).toBe(2); // call + put at 100
    expect(charm.values.some((v) => v !== 0)).toBe(true);
    const vanna = greeksProfile(snap, 0, 'vanna');
    expect(vanna.strikes.length).toBe(2);
  });

  it('volume weight uses session volume', () => {
    const d = dealerExposure(snap, { weight: 'volume' });
    expect(d.weight).toBe('volume');
    expect(d.weightFallback).toBe(false);
    expect(d.points[0]!.callGEX).toBeGreaterThan(0);
  });

  it('scanParityEdges returns rows near ATM', () => {
    const rows = scanParityEdges(snap);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.strike).toBe(100);
  });

  it('inventoryByExpiry buckets greeks', () => {
    const inv = inventoryByExpiry(snap);
    expect(inv).toHaveLength(1);
    expect(inv[0]!.callOI).toBe(1000);
    expect(inv[0]!.putOI).toBe(500);
  });

  it('realizedVolCloseToClose needs enough samples', () => {
    expect(realizedVolCloseToClose([100, 101])).toBeNull();
    const series = Array.from({ length: 30 }, (_, i) => 100 * Math.exp(0.01 * Math.sin(i)));
    const rv = realizedVolCloseToClose(series);
    expect(rv).not.toBeNull();
    expect(rv!).toBeGreaterThan(0);
  });
});
