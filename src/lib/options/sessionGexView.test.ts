import { describe, expect, it } from 'vitest';
import {
  buildSessionGexMatrix,
  finiteOrNull,
  sessionMetricSupported,
  sessionTimeLabel,
} from './sessionGexView';
import type { GexSessionSeries } from './gexSession';

const T0 = new Date(2026, 8, 8, 9, 30).getTime();
const T1 = T0 + 5 * 60_000;

function seriesWith(points: GexSessionSeries['points']): GexSessionSeries {
  return { symbol: 'SPY', day: '2026-09-08', points };
}

const twoSample = seriesWith([
  {
    t: T0, totalGEX: 1e8, flip: 500, spot: 505,
    profile: [{ k: 500, g: 1e7 }, { k: 505, g: 0 }, { k: 510, g: -2e7 }],
    charmProfile: [{ k: 500, g: 1e5 }, { k: 505, g: 2e5 }],
  },
  {
    t: T1, totalGEX: 1.2e8, flip: 501, spot: 506,
    profile: [{ k: 500, g: 1.1e7 }, { k: 510, g: -2.1e7 }],
    charmProfile: [{ k: 500, g: 1.1e5 }, { k: 505, g: 2.1e5 }],
  },
]);

describe('buildSessionGexMatrix', () => {
  it('returns null for null series (no mocked history)', () => {
    expect(buildSessionGexMatrix(null, 'gex')).toBeNull();
  });

  it('returns null for a single sample (heat needs a time dimension)', () => {
    const one = seriesWith([{ t: T0, totalGEX: 1e8, flip: null, spot: 500, profile: [{ k: 500, g: 1 }] }]);
    expect(buildSessionGexMatrix(one, 'gex')).toBeNull();
  });

  it('builds strikes × times geometry with union strike set', () => {
    const m = buildSessionGexMatrix(twoSample, 'gex');
    expect(m?.strikes).toEqual([500, 505, 510]);
    expect(m?.times).toEqual([T0, T1]);
    expect(m?.rows).toHaveLength(3);
    expect(m?.cols).toHaveLength(2);
    expect(m?.cells).toHaveLength(3);
    expect(m?.cells[0]).toHaveLength(2);
    expect(m?.supported).toBe(true);
  });

  it('preserves null holes where a strike lacks a sample (never zero-filled)', () => {
    const m = buildSessionGexMatrix(twoSample, 'gex');
    // strike 505 present at T0 only
    expect(m?.cells[1]?.[0]?.value).toBe(0); // observed zero stays zero
    expect(m?.cells[1]?.[1]?.value).toBeNull(); // absent at T1 stays null
  });

  it('keeps observed zero as a valid value, distinct from missing', () => {
    const m = buildSessionGexMatrix(twoSample, 'gex');
    const zero = m?.cells[1]?.[0]?.value;
    expect(zero).toBe(0);
    expect(zero).not.toBeNull();
  });

  it('maps NaN/Infinity to null (finite-or-null invariant)', () => {
    const bad = seriesWith([
      { t: T0, totalGEX: 0, flip: null, spot: 500, profile: [{ k: 500, g: NaN }] },
      {
        t: T1, totalGEX: 0, flip: null, spot: 500,
        profile: [{ k: 500, g: Infinity }, { k: 505, g: -Infinity }],
      },
    ]);
    const m = buildSessionGexMatrix(bad, 'gex');
    expect(m?.cells[0]?.[0]?.value).toBeNull();
    expect(m?.cells[0]?.[1]?.value).toBeNull();
    expect(m?.cells[1]?.[1]?.value).toBeNull();
    for (const row of m?.cells ?? []) {
      for (const c of row) {
        expect(c.value == null || Number.isFinite(c.value)).toBe(true);
      }
    }
  });

  it('passes spot/flip through from the latest sample', () => {
    const m = buildSessionGexMatrix(twoSample, 'gex');
    expect(m?.spot).toBe(506);
    expect(m?.flip).toBe(501);
  });

  it('reads the charm profile for the charm metric', () => {
    const m = buildSessionGexMatrix(twoSample, 'charm');
    expect(m?.strikes).toEqual([500, 505]);
    expect(m?.cells[0]?.[0]?.value).toBe(1e5);
    expect(m?.cells[1]?.[1]?.value).toBe(2.1e5);
  });

  it('marks dex/vex unsupported with empty geometry (no invented history)', () => {
    for (const metric of ['dex', 'vex'] as const) {
      const m = buildSessionGexMatrix(twoSample, metric);
      expect(m?.supported).toBe(false);
      expect(m?.rows).toHaveLength(0);
      expect(m?.times).toEqual([T0, T1]);
    }
    expect(sessionMetricSupported('gex')).toBe(true);
    expect(sessionMetricSupported('charm')).toBe(true);
    expect(sessionMetricSupported('dex')).toBe(false);
  });

  it('reports coverage counts for partial badges', () => {
    const m = buildSessionGexMatrix(twoSample, 'gex');
    expect(m?.totalStrikes).toBe(3);
    expect(m?.withMetric).toBe(3);
    const sparse = seriesWith([
      { t: T0, totalGEX: 0, flip: null, spot: 500 },
      { t: T1, totalGEX: 0, flip: null, spot: 500, profile: [{ k: 500, g: 5 }] },
    ]);
    const m2 = buildSessionGexMatrix(sparse, 'gex');
    expect(m2?.totalStrikes).toBe(1);
    expect(m2?.withMetric).toBe(1);
  });

  it('labels columns with browser-local HH:MM sample time', () => {
    expect(sessionTimeLabel(T0)).toMatch(/^\d{2}:\d{2}$/);
    const m = buildSessionGexMatrix(twoSample, 'gex');
    expect(m?.cols[0]?.label).toBe(sessionTimeLabel(T0));
  });

  it('finiteOrNull keeps zero, drops NaN/Infinity/undefined', () => {
    expect(finiteOrNull(0)).toBe(0);
    expect(finiteOrNull(-3.5)).toBe(-3.5);
    expect(finiteOrNull(NaN)).toBeNull();
    expect(finiteOrNull(Infinity)).toBeNull();
    expect(finiteOrNull(null)).toBeNull();
    expect(finiteOrNull(undefined)).toBeNull();
  });

  it('labels session exposure as derived OI-weighted proxy, never observed OI-weighted', () => {
    const m = buildSessionGexMatrix(twoSample, 'gex');
    expect(m).not.toBeNull();
    for (const row of m!.cells) {
      for (const c of row) {
        // source must carry derived/model language and never claim observed OI-weighted
        expect(c.source).toBe('browser session sample (derived from OI, model dealer convention)');
        expect(c.source.toLowerCase()).not.toContain('observed oi-weighted');
        // assumption retains proxy disclaimer, distinct from observed inventory
        expect(c.assumption.toLowerCase()).toContain('not observed dealer inventory');
        // raw OI provenance stays separate: assumption mentions OI-weighted proxy
        expect(c.assumption.toLowerCase()).toContain('oi-weighted');
      }
    }
  });

  it('fails if any cell source reintroduces observed OI-weighted mislabel', () => {
    const m = buildSessionGexMatrix(twoSample, 'charm');
    const allSources = (m?.cells ?? []).flat().map((c) => c.source).join(' | ');
    expect(allSources).not.toMatch(/observed OI-weighted/i);
    expect(allSources).toMatch(/derived from OI/i);
  });
});
