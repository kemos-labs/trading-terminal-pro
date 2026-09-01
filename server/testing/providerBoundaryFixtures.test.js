import { afterEach, describe, expect, it } from 'vitest';
import { installProviderBoundaryFixtures } from './providerBoundaryFixtures.js';

const realFetch = global.fetch;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  global.fetch = realFetch;
  process.env.NODE_ENV = originalNodeEnv;
});

describe('provider-boundary E2E fixtures', () => {
  it('fails closed outside the test environment', () => {
    process.env.NODE_ENV = 'production';
    expect(() => installProviderBoundaryFixtures('success')).toThrow(/NODE_ENV=test/);
  });

  it('serves populated, finite rates and exact listed SERFF fixtures', async () => {
    process.env.NODE_ENV = 'test';
    installProviderBoundaryFixtures('success');

    const history = await fetch('http://127.0.0.1:8765/api/rates/basis-history').then((response) => response.json());
    expect(history.history).toHaveLength(60);
    expect(history.history.every((row) => [row.sofr, row.effr, row.iorb].every(Number.isFinite))).toBe(true);

    const stir = await fetch('http://127.0.0.1:8765/api/stir/strip').then((response) => response.json());
    expect(stir.sr1).toHaveLength(4);
    expect(stir.zq).toHaveLength(4);
    expect(stir.serff_board).toHaveLength(4);
    for (const row of stir.serff_board) {
      expect(row).toMatchObject({ kind: 'serff', ratio: '1:1' });
      expect(row.legs[0]).toMatch(/^SR1/);
      expect(row.legs[1]).toMatch(/^ZQ/);
      expect(row.price_spread).toBeCloseTo(-row.last_bps / 100, 8);
    }

    const jgb = await fetch('http://127.0.0.1:8765/api/rates/jgb-curve').then((response) => response.json());
    expect(jgb.points).toHaveLength(5);
    expect(jgb.points.every((row) => Number.isFinite(row.today) && Number.isFinite(row.historical))).toBe(true);
  });
});
