import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDeribitMarket } from '../lib/data/deribitClient';
import { macrovolApi } from '../lib/macrovol/api';
import { shouldFetchCcy, summarizeDeribitTape, useCryptoDualBooks } from './useCryptoDualBooks';
import type { DeribitBookRow, DeribitMarketBundle } from '../lib/data/deribitClient';

vi.mock('../lib/data/deribitClient', async () => {
  const actual = await vi.importActual<typeof import('../lib/data/deribitClient')>('../lib/data/deribitClient');
  return { ...actual, fetchDeribitMarket: vi.fn() };
});
vi.mock('../lib/macrovol/api', () => ({ macrovolApi: { cryptoSpot: vi.fn() } }));
vi.mock('../store/terminalStore', () => ({
  useTerminalStore: (selector: (state: { symbol: string; snapshot: null }) => unknown) => selector({ symbol: 'BTC', snapshot: null }),
}));

const market = (): DeribitMarketBundle => ({
  currency: 'BTC', indexPrice: 75_000, fetchedAt: Date.now(), source: 'deribit',
  fundingAnn: null, futures: [], perp: null, options: [],
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

function option(instrument_name: string, mark_iv: number, open_interest: number, volume: number): DeribitBookRow {
  return {
    instrument_name,
    mark_iv,
    open_interest,
    volume,
    bid_price: null,
    ask_price: null,
    mid_price: null,
    mark_price: null,
    last: null,
    volume_usd: null,
    underlying_price: 75_000,
    estimated_delivery_price: null,
    interest_rate: null,
    creation_timestamp: null,
  };
}

describe('summarizeDeribitTape', () => {
  it('derives nearest-30D ATM IV and aggregate activity without rebuilding a snapshot', () => {
    const market: DeribitMarketBundle = {
      currency: 'BTC',
      indexPrice: 75_000,
      fetchedAt: Date.UTC(2026, 7, 1),
      source: 'deribit',
      fundingAnn: 0.05,
      futures: [],
      perp: null,
      options: [
        option('BTC-28AUG26-75000-C', 50, 10, 2),
        option('BTC-28AUG26-75000-P', 54, 20, 3),
        option('BTC-28AUG26-90000-C', 70, 5, 1),
        option('BTC-25SEP26-75000-C', 45, 7, 4),
      ],
    };

    expect(summarizeDeribitTape(market)).toEqual({
      atmIv30d: 0.52,
      totalOpenInterest: 42,
      volume24h: 10,
    });
  });

  it('keeps already-decimal IV values in decimal units', () => {
    const market: DeribitMarketBundle = {
      currency: 'ETH', indexPrice: 3_000, fetchedAt: Date.UTC(2026, 7, 1), source: 'deribit',
      fundingAnn: null, futures: [], perp: null,
      options: [
        option('ETH-28AUG26-3000-C', 0.6, 1, 0),
        option('ETH-28AUG26-3000-P', 0.64, 1, 0),
      ],
    };
    expect(summarizeDeribitTape(market).atmIv30d).toBeCloseTo(0.62);
  });
});

describe('shouldFetchCcy', () => {
  it('always fetches the active currency (every 30s cycle)', () => {
    expect(shouldFetchCcy(true, Date.now(), Date.now())).toBe(true);
  });

  it('skips the inactive currency until its half-rate window elapses', () => {
    expect(shouldFetchCcy(false, Date.now(), Date.now())).toBe(false);
    expect(shouldFetchCcy(false, 0, Date.now())).toBe(true);
    // Boundary: exactly INACTIVE_MS elapsed counts as due.
    expect(shouldFetchCcy(false, Date.now() - 60_000, Date.now())).toBe(true);
  });

  it('force always fetches (mount + dual-chart rebuild)', () => {
    expect(shouldFetchCcy(false, Date.now(), Date.now(), true)).toBe(true);
  });
});

describe('useCryptoDualBooks polling ownership', () => {
  it('fetches on the active cadence, pauses while hidden, resumes once, and cleans up', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchDeribitMarket).mockResolvedValue(market());
    vi.mocked(macrovolApi.cryptoSpot).mockResolvedValue({ btc: null, eth: null } as never);
    const { unmount } = renderHook(() => useCryptoDualBooks(false));
    await act(async () => { await Promise.resolve(); });
    expect(fetchDeribitMarket).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchDeribitMarket).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchDeribitMarket).toHaveBeenCalledTimes(4);
    const callsAfterResume = fetchDeribitMarket.mock.calls.length;
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(fetchDeribitMarket).toHaveBeenCalledTimes(callsAfterResume);
  });
});
