import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invalidateYfCache } from './yfinanceClient';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const mod = await import('./yfinanceClient');

function res(data: unknown, ok = true) {
  return { ok, text: () => Promise.resolve(JSON.stringify(data)), json: () => Promise.resolve(data) };
}

describe('yfinanceClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateYfCache();
  });

  it('normalises yfinance history bars', async () => {
    mockFetch.mockResolvedValueOnce(
      res({ symbol: 'SPY', bars: [{ date: '2026-01-02', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }] }),
    );
    const bars = await mod.fetchYfHistory('SPY');
    expect(bars).toEqual([{ date: '2026-01-02', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]);
    expect(mockFetch).toHaveBeenCalledWith('/api/yf/history/SPY');
  });

  it('returns null when history is empty', async () => {
    mockFetch.mockResolvedValueOnce(res({ symbol: 'SPY', bars: [] }));
    expect(await mod.fetchYfHistory('SPY')).toBeNull();
  });

  it('drops missing/non-finite OHLCV fields but preserves observed zero volume', async () => {
    mockFetch.mockResolvedValueOnce(res({ symbol: 'SPY', bars: [
      { date: '2026-01-02', open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 },
      { date: '2026-01-03', open: '', high: 2, low: 0.5, close: 1.5, volume: 4 },
      { date: '2026-01-04', open: null, high: false, low: 0.5, close: 1.5, volume: 4 },
      { date: '2026-01-05', open: 1, high: 2, low: 0.5, close: 'Infinity', volume: 4 },
    ] }));
    expect(await mod.fetchYfHistory('SPY')).toEqual([{ date: '2026-01-02', open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 }]);
  });

  it('maps yfinance info to FmpProfile', async () => {
    mockFetch.mockResolvedValueOnce(
      res({ symbol: 'AAPL', companyName: 'Apple', marketCap: 3e12, sector: 'Tech', beta: 1.2, range: '100 - 200' }),
    );
    const p = await mod.fetchYfInfo('AAPL');
    expect(p?.companyName).toBe('Apple');
    expect(p?.marketCap).toBe(3e12);
    expect(p?.sector).toBe('Tech');
  });

  it('does not propagate non-finite info numerics', async () => {
    mockFetch.mockResolvedValueOnce(res({ symbol: 'BAD', companyName: 'Bad', marketCap: NaN, beta: Infinity }));
    const info = await mod.fetchYfInfo('BAD');
    expect(info?.marketCap).toBeUndefined();
    expect(info?.beta).toBeUndefined();
  });
});
