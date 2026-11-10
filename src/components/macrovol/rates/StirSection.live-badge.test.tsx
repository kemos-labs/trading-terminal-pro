import { describe, expect, it } from 'vitest';
import type { StirContract } from '../../../lib/macrovol/api';
import { countLiveContracts } from './StirSection';

function mk(source?: string): StirContract {
  return {
    contract: 'SFR6',
    month: 'Jun 26',
    last_price: 96.0,
    settlement: null,
    implied_rate: 4.0,
    source,
  } as unknown as StirContract;
}

describe('countLiveContracts (REF07-F1b live-badge honesty)', () => {
  it('counts only the exact observed token "live"', () => {
    expect(countLiveContracts([mk('live'), mk('live'), mk('settled')])).toBe(2);
  });

  it('does not count absent, undefined, null-equivalent, empty, uppercase or padded sources', () => {
    expect(
      countLiveContracts([mk(), mk(undefined), mk(''), mk('LIVE'), mk(' live'), mk('live ')]),
    ).toBe(0);
  });

  it('handles missing or empty rows and preserves valid zero counts', () => {
    expect(countLiveContracts(undefined)).toBe(0);
    expect(countLiveContracts([])).toBe(0);
    expect(countLiveContracts([mk('settled'), mk('fallback')])).toBe(0);
  });

  // REF07-F1c: SR1/Treasury-shaped rows with value presence (implied_rate / last_price)
  // are not live unless the exact `source === 'live'` token is observed.
  it('SR1-shaped rows with non-null implied_rate count only exact-live sources', () => {
    const sr1Rows = [
      mk('live'),
      mk('LIVE'),
      mk(' live'),
      mk('settled'),
      mk('fallback'),
      mk(''),
      mk(undefined),
    ];
    expect(countLiveContracts(sr1Rows)).toBe(1);
    // A row with a value but missing source field must not count.
    const noSource = { ...mk('live'), source: undefined } as unknown as StirContract;
    expect(countLiveContracts([noSource])).toBe(0);
  });

  it('Treasury-shaped rows with non-null last_price count only exact-live sources', () => {
    const tsyRows = [
      mk('live'),
      mk('LIVE'),
      mk('live '),
      mk('delayed'),
      mk(null as unknown as string),
      mk(''),
    ];
    expect(countLiveContracts(tsyRows)).toBe(1);
    expect(countLiveContracts(undefined)).toBe(0);
  });
});
