import { describe, it, expect } from 'vitest';
import {
  classifyDomainFreshness,
  classifyFreshnessFromIso,
  FRESHNESS_THRESHOLDS,
  kindFromProvenance,
  makeProvenance,
  worstFreshnessKind,
} from './freshness';

describe('classifyDomainFreshness', () => {
  const now = 1_700_000_000_000;

  it('returns demo/down/unknown overrides', () => {
    expect(classifyDomainFreshness(now, 'spot', { demo: true, nowMs: now })).toBe('demo');
    expect(classifyDomainFreshness(now, 'spot', { down: true, nowMs: now })).toBe('down');
    expect(classifyDomainFreshness(null, 'spot', { nowMs: now })).toBe('unknown');
    expect(classifyDomainFreshness(0, 'chain', { nowMs: now })).toBe('unknown');
  });

  it('classifies spot thresholds', () => {
    const t = FRESHNESS_THRESHOLDS.spot;
    expect(classifyDomainFreshness(now - 10_000, 'spot', { nowMs: now })).toBe('live');
    expect(classifyDomainFreshness(now - t.delayedMs - 1, 'spot', { nowMs: now })).toBe('delayed');
    expect(classifyDomainFreshness(now - t.staleMs - 1, 'spot', { nowMs: now })).toBe('stale');
    expect(classifyDomainFreshness(now - t.expiredMs - 1, 'spot', { nowMs: now })).toBe('expired');
  });

  it('applies leave-LIVE hysteresis', () => {
    // Age slightly past delayed but previous was live → stay live at 1.2×
    const delayed = FRESHNESS_THRESHOLDS.spot.delayedMs;
    const age = delayed + 1_000; // still < 1.2 * delayed (54s)
    expect(
      classifyDomainFreshness(now - age, 'spot', {
        nowMs: now,
        previousKind: 'live',
        leaveLiveFactor: 1.2,
      }),
    ).toBe('live');
  });

  it('macro domain matches 15m/30m order of magnitude', () => {
    expect(FRESHNESS_THRESHOLDS.macro.delayedMs).toBe(900_000);
    expect(FRESHNESS_THRESHOLDS.macro.staleMs).toBe(1_800_000);
  });
});

describe('classifyFreshnessFromIso', () => {
  it('defaults stale at 30m (DataBadge alignment)', () => {
    const iso = new Date(Date.now() - 20 * 60_000).toISOString();
    expect(classifyFreshnessFromIso(iso)).toBe('delayed');
    const older = new Date(Date.now() - 45 * 60_000).toISOString();
    expect(classifyFreshnessFromIso(older)).toBe('stale');
  });

  it('treats YYYY-MM-DD observation dates as daily prints (not false EXPIRED at T+3)', () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 3);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const obs = `${yyyy}-${mm}-${dd}`;
    const kind = classifyFreshnessFromIso(obs);
    expect(kind === 'live' || kind === 'delayed').toBe(true);
    expect(kind).not.toBe('expired');
  });
});

describe('makeProvenance', () => {
  it('builds store record', () => {
    const p = makeProvenance('chain', 'yfinance', Date.now(), { label: 'chain:yf' });
    expect(p.domain).toBe('chain');
    expect(p.source).toBe('yfinance');
    expect(p.kind).toBe('live');
    expect(p.asOfMs).toBeTruthy();
  });
});

describe('delayed provenance constraint', () => {
  const now = 1_700_000_000_000;
  it('delayed source with fresh fetch (age 0) remains delayed even when previousKind=live', () => {
    const kind = classifyDomainFreshness(now, 'chain', { nowMs: now, previousKind: 'live', sourceKind: 'delayed' });
    expect(kind).toBe('delayed');
  });
  it('delayed never upgrades to live via hysteresis but can age to stale/expired', () => {
    const t = FRESHNESS_THRESHOLDS.chain;
    // Fresh -> delayed
    expect(classifyDomainFreshness(now, 'chain', { nowMs: now, sourceKind: 'delayed' })).toBe('delayed');
    // Aged past staleMs -> stale (natural downgrade allowed)
    expect(classifyDomainFreshness(now - t.staleMs - 1000, 'chain', { nowMs: now, sourceKind: 'delayed' })).toBe('stale');
    // Aged past expiredMs -> expired
    expect(classifyDomainFreshness(now - t.expiredMs - 1000, 'chain', { nowMs: now, sourceKind: 'delayed' })).toBe('expired');
  });
  it('stale/expired/down/unknown never upgrade to live even with fresh fetch', () => {
    for (const src of ['stale', 'expired', 'down', 'unknown'] as const) {
      const k = classifyDomainFreshness(now, 'chain', { nowMs: now, sourceKind: src, previousKind: 'live' });
      expect(k).not.toBe('live');
      expect(k).toBe(src === 'down' ? 'down' : src);
    }
  });
  it('malformed sourceKind degrades to unknown, not live', () => {
    const k = classifyDomainFreshness(now, 'chain', { nowMs: now, sourceKind: 'bogus' as never });
    expect(k).toBe('unknown');
  });
  it('unknown observation time stays unknown even with source live', () => {
    expect(classifyDomainFreshness(null, 'chain', { nowMs: now, sourceKind: 'live' })).toBe('unknown');
    expect(classifyDomainFreshness(null, 'chain', { nowMs: now, sourceKind: 'delayed' })).toBe('delayed');
  });
});

describe('kindFromProvenance header recompute (D1 sourceKind threading)', () => {
  const now = 1_700_000_000_000;
  it('delayed provenance with fresh asOf (age 0) and previousKind delayed stays delayed, not live', () => {
    // Header path: previousKind=stored kind, asOfMs=fresh server asOf, sourceKind threaded via opts.
    expect(
      kindFromProvenance('delayed', now, 'chain', {
        demo: false,
        down: false,
        nowMs: now,
        sourceKind: 'delayed',
      }),
    ).toBe('delayed');
    expect(
      kindFromProvenance('delayed', now, 'spot', {
        demo: false,
        down: false,
        nowMs: now,
        sourceKind: 'delayed',
      }),
    ).toBe('delayed');
  });
});

describe('kindFromProvenance header recompute', () => {
  const now = 1_700_000_000_000;
  it('delayed snapshot with fresh asOf and previousKind delayed stays delayed only when sourceKind is threaded', () => {
    const freshAsOf = now; // age 0
    const withSource = kindFromProvenance('delayed', freshAsOf, 'chain', {
      nowMs: now,
      sourceKind: 'delayed',
    });
    expect(withSource).toBe('delayed');
    const withoutSource = kindFromProvenance('delayed', freshAsOf, 'chain', { nowMs: now });
    expect(withoutSource).toBe('live');
    expect(kindFromProvenance('live', freshAsOf, 'spot', { nowMs: now, sourceKind: 'delayed' })).toBe('delayed');
  });
  it('summary worstFreshnessKind stays delayed when chain is delayed', () => {
    const now2 = 1_700_000_000_000;
    const spotKind = kindFromProvenance('delayed', now2, 'spot', { nowMs: now2, sourceKind: 'delayed' });
    const chainKind = kindFromProvenance('delayed', now2, 'chain', { nowMs: now2, sourceKind: 'delayed' });
    expect(worstFreshnessKind(spotKind, chainKind)).toBe('delayed');
  });
});

describe('worstFreshnessKind', () => {  it('returns min rank (down < expired < stale < delayed < unknown < live)', () => {
    expect(worstFreshnessKind('live', 'delayed')).toBe('delayed');
    expect(worstFreshnessKind('live', 'stale', 'delayed')).toBe('stale');
    expect(worstFreshnessKind('unknown', 'live')).toBe('unknown');
    expect(worstFreshnessKind('expired', 'down', 'live')).toBe('down');
    expect(worstFreshnessKind('live')).toBe('live');
  });

  it('ranks demo with stale (worse than delayed)', () => {
    expect(worstFreshnessKind('demo', 'delayed')).toBe('demo');
    expect(worstFreshnessKind('delayed', 'demo')).toBe('demo');
    // same rank as stale — either may win; both must beat delayed/live
    const demoVsStale = worstFreshnessKind('demo', 'stale');
    expect(demoVsStale === 'demo' || demoVsStale === 'stale').toBe(true);
    expect(worstFreshnessKind('demo', 'live')).toBe('demo');
  });

  it('returns unknown for empty input', () => {
    expect(worstFreshnessKind()).toBe('unknown');
  });
});
