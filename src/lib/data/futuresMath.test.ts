/**
 * Futures-desk math tests: premium / APR / DTE / EOM universe / term structure
 * plus the useDeribitFutures hook end-to-end against a stubbed fetch
 * (fixtures stand in for the real /api/deribit-market/* payloads).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  MS_PER_DAY,
  annualizedFundingPct,
  aprPct,
  aprPctFromPremium,
  buildBasisRows,
  dteDays,
  filterEndOfMonthExpiries,
  futuresKind,
  premiumPct,
  premiumUsd,
  tenorLabel,
  termStructurePoints,
} from './futuresMath';
import type { DeribitFutureInstrument, DeribitFutureTicker } from './deribitFutures';
import { useDeribitFutures } from '../../hooks/useDeribitFutures';

const INDEX = 100_000;
/** May 1st 2027 08:00 UTC */
const NOW = Date.UTC(2027, 4, 1, 8);
const EXP_JUN_MID = Date.UTC(2027, 5, 15, 8); // 45d out — NOT month end
const EXP_JUN_EOM = Date.UTC(2027, 5, 25, 8); // 55d out — latest June expiry
const EXP_JUL_EOM = Date.UTC(2027, 6, 30, 8); // 90d out — July expiry
const PERP_SENTINEL = 32503708800000;

function inst(
  name: string,
  settlementPeriod: string,
  expiration: number,
): DeribitFutureInstrument {
  return {
    instrument_name: name,
    settlement_period: settlementPeriod,
    expiration_timestamp: expiration,
    is_active: true,
    tick_size: 0.5,
    contract_size: 10,
    instrument_type: 'reversed',
    base_currency: 'BTC',
    quote_currency: 'USD',
  };
}

function ticker(
  mark: number | null,
  extra: Partial<DeribitFutureTicker> = {},
): DeribitFutureTicker {
  return {
    instrument_name: extra.instrument_name ?? 'x',
    state: 'open',
    mark_price: mark,
    index_price: INDEX,
    last_price: mark,
    best_bid_price: mark,
    best_ask_price: mark,
    open_interest: 1_000_000,
    volume: 123.5,
    volume_usd: 12_350_000,
    price_change_pct: 0.42,
    funding_8h: null,
    current_funding: null,
    ...extra,
  };
}

const INSTRUMENTS: DeribitFutureInstrument[] = [
  inst('BTC-PERPETUAL', 'perpetual', PERP_SENTINEL),
  inst('BTC-15JUN27', 'day', EXP_JUN_MID),
  inst('BTC-25JUN27', 'month', EXP_JUN_EOM),
  inst('BTC-30JUL27', 'month', EXP_JUL_EOM),
];

const TICKERS: Record<string, DeribitFutureTicker> = {
  'BTC-PERPETUAL': ticker(99_950, {
    instrument_name: 'BTC-PERPETUAL',
    funding_8h: 0.0001,
    current_funding: 0.00009,
  }),
  'BTC-15JUN27': ticker(100_250, { instrument_name: 'BTC-15JUN27' }), // +0.25%
  'BTC-25JUN27': ticker(101_000, { instrument_name: 'BTC-25JUN27' }), // +1.00%
  'BTC-30JUL27': ticker(98_500, { instrument_name: 'BTC-30JUL27' }), // −1.50%
};

describe('premium math', () => {
  it('computes $ and % premium over the index', () => {
    expect(premiumUsd(101_000, 100_000)).toBe(1_000);
    expect(premiumPct(101_000, 100_000)).toBeCloseTo(1, 12);
    expect(premiumPct(98_500, 100_000)).toBeCloseTo(-1.5, 12);
  });

  it('fails closed on missing or degenerate inputs', () => {
    expect(premiumUsd(null, 100)).toBeNull();
    expect(premiumUsd(101, undefined)).toBeNull();
    expect(premiumUsd(101, 0)).toBeNull();
    expect(premiumPct(101, NaN as unknown as number)).toBeNull();
    expect(premiumPct(null, 100)).toBeNull();
  });
});

describe('DTE + APR', () => {
  it('returns fractional DTE and null for past/perp-less expiries', () => {
    expect(dteDays(EXP_JUN_EOM, NOW)).toBeCloseTo(55, 9);
    expect(dteDays(NOW - MS_PER_DAY, NOW)).toBeNull();
    expect(dteDays(0, NOW)).toBeNull();
    expect(dteDays(null, NOW)).toBeNull();
  });

  it('annualizes premium with the simple 365/DTE convention', () => {
    // +1% over 55d ⇒ 1 × 365/55 = 6.636…%
    expect(aprPctFromPremium(1, 55)).toBeCloseTo(6.6363636, 6);
    // −1.5% over 90d ⇒ −6.0833…%
    expect(aprPctFromPremium(-1.5, 90)).toBeCloseTo(-6.0833333, 6);
    expect(aprPctFromPremium(null, 55)).toBeNull();
    expect(aprPctFromPremium(1, null)).toBeNull();
    expect(aprPctFromPremium(1, 0)).toBeNull();
  });

  it('composes prices → APR directly', () => {
    const got = aprPct(101_000, 100_000, EXP_JUN_EOM, NOW);
    expect(got).toBeCloseTo((1000 / 100_000) * 100 * (365 / 55), 6);
    expect(aprPct(null, 100_000, EXP_JUN_EOM, NOW)).toBeNull();
  });

  it('annualizes the 8h funding rate (×3×365×100)', () => {
    expect(annualizedFundingPct(0.0001)).toBeCloseTo(10.95, 9); // 0.01%/8h ⇒ 10.95% p.a.
    expect(annualizedFundingPct(-0.00005)).toBeCloseTo(-5.475, 9);
    expect(annualizedFundingPct(null)).toBeNull();
  });
});

describe('instrument classification', () => {
  it('flags perpetuals by settlement period or name suffix', () => {
    expect(futuresKind(INSTRUMENTS[0]!)).toBe('PERPETUAL');
    expect(futuresKind(inst('ETH-PERPETUAL', 'unknown', 0))).toBe('PERPETUAL');
    expect(futuresKind(INSTRUMENTS[1]!)).toBe('FUTURE');
    expect(tenorLabel('BTC-PERPETUAL')).toBe('PERP');
    expect(tenorLabel('BTC-25JUN27')).toBe('25JUN27');
  });
});

describe('buildBasisRows', () => {
  const rows = buildBasisRows({
    instruments: [
      ...INSTRUMENTS,
      inst('BTC-24SEP27', 'quarter', Date.UTC(2027, 8, 24, 8)), // no ticker on purpose
    ],
    tickers: TICKERS,
    indexPrice: INDEX,
    nowMs: NOW,
  });

  it('produces one sorted row per instrument (perp first, then by expiry)', () => {
    expect(rows.map((r) => r.instrument)).toEqual([
      'BTC-PERPETUAL',
      'BTC-15JUN27',
      'BTC-25JUN27',
      'BTC-30JUL27',
      'BTC-24SEP27',
    ]);
  });

  it('keeps the perp honest: funding annualized, no DTE, no APR', () => {
    const perp = rows[0]!;
    expect(perp.kind).toBe('PERPETUAL');
    expect(perp.dte).toBeNull();
    expect(perp.aprPct).toBeNull();
    expect(perp.funding8h).toBeCloseTo(0.0001, 12);
    expect(perp.fundingAnnualizedPct).toBeCloseTo(10.95, 9);
    expect(perp.premiumPct).toBeCloseTo(-0.05, 9); // 99_950 vs 100_000
  });

  it('computes premium/APR per tenor from mark vs index', () => {
    const jun15 = rows[1]!;
    expect(jun15.dte).toBeCloseTo(45, 9);
    expect(jun15.premiumPct).toBeCloseTo(0.25, 9);
    expect(jun15.aprPct).toBeCloseTo(0.25 * (365 / 45), 6);

    const jun25 = rows[2]!;
    expect(jun25.premiumUsd).toBe(1_000);
    expect(jun25.aprPct).toBeCloseTo(365 / 55, 6);

    const jul30 = rows[3]!;
    expect(jul30.change24hPct).toBeCloseTo(0.42, 9); // Deribit stats.price_change passthrough
    expect(jul30.aprPct).toBeLessThan(0);
  });

  it('renders a ticker-less instrument as null columns, not zeros', () => {
    const orphan = rows.at(-1)!;
    expect(orphan.mark).toBeNull();
    expect(orphan.premiumUsd).toBeNull();
    expect(orphan.volumeBase).toBeNull();
    expect(orphan.openInterestUsd).toBeNull();
  });
});

describe('end-of-month universe + term structure', () => {
  const rows = buildBasisRows({
    instruments: INSTRUMENTS,
    tickers: TICKERS,
    indexPrice: INDEX,
    nowMs: NOW,
  });

  it('keeps only the latest expiry per UTC calendar month (perp dropped)', () => {
    const eom = filterEndOfMonthExpiries(rows);
    expect(eom.map((r) => r.instrument)).toEqual(['BTC-25JUN27', 'BTC-30JUL27']);
  });

  it('plots dated futures only, ordered by expiry, excluding the perp', () => {
    const pts = termStructurePoints(rows);
    expect(pts.map((p) => p.label)).toEqual(['15JUN27', '25JUN27', '30JUL27']);
    expect(pts.every((p) => p.expirationMs > NOW)).toBe(true);
    expect(pts[0]!.aprPct).toBeCloseTo(0.25 * (365 / 45), 6);
  });
});

describe('useDeribitFutures (mocked fetch through the proxy client)', () => {
  const fetchedAt = Date.now();

  beforeEach(() => {
    const respond = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown) =>
        ({ ok: true, status: 200, json: async () => body }) as Response;
      if (url.includes('/api/v1/market/crypto/BTC')) {
        const tickers = new Map(Object.values(TICKERS).map((t) => [t.instrument_name, t]));
        return json({ schemaVersion: 1, fetchedAt: new Date(fetchedAt).toISOString(), data: {
          currency: 'BTC', indexPrice: INDEX, funding8h: null,
          instruments: INSTRUMENTS.map((i) => {
            const t = tickers.get(i.instrument_name);
            return { instrument: i.instrument_name, baseCurrency: i.base_currency, quoteCurrency: i.quote_currency,
              contractSize: i.contract_size, settlementPeriod: i.settlement_period,
              kind: i.settlement_period === 'perpetual' ? 'perp' : 'future', expiryMs: i.expiration_timestamp,
              isInverse: i.instrument_type === 'reversed', bid: t?.best_bid_price ?? null, ask: t?.best_ask_price ?? null,
              mark: t?.mark_price ?? null, last: t?.last_price ?? null, indexPrice: t?.index_price ?? INDEX,
              openInterest: t?.open_interest ?? null, volume: t?.volume ?? null, funding8h: t?.funding_8h ?? null };
          }),
        }});
      }
      return json({ error: 'unexpected route' });
    });
    vi.stubGlobal('fetch', respond);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads instruments+tickers+index and derives basis rows end-to-end', async () => {
    const { result } = renderHook(() => useDeribitFutures('BTC', { refreshMs: 3_600_000 }));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.indexPrice).toBe(INDEX);
    expect(result.current.rows.map((r) => r.instrument)).toEqual([
      'BTC-PERPETUAL',
      'BTC-15JUN27',
      'BTC-25JUN27',
      'BTC-30JUL27',
    ]);

    const front = result.current.rows.find((r) => r.instrument === 'BTC-25JUN27')!;
    expect(front.mark).toBe(101_000);
    expect(front.premiumPct).toBeCloseTo(1, 9);
    // APR recomputed from the row's own DTE stays consistent with the formula.
    expect(front.aprPct!).toBeCloseTo(1 * (365 / front.dte!), 6);

    const perp = result.current.rows[0]!;
    expect(perp.aprPct).toBeNull();
    expect(perp.fundingAnnualizedPct).toBeCloseTo(10.95, 9);
  });

  it('fails closed with an error when every upstream route dies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({ ok: true, status: 200, json: async () => ({ error: 'Deribit down' }) }) as Response,
      ),
    );
    const { result } = renderHook(() => useDeribitFutures('ETH', { refreshMs: 3_600_000 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.rows).toEqual([]);
    expect(result.current.indexPrice).toBeNull();
  });
});
