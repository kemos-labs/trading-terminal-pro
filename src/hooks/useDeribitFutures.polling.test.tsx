import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDeribitFutures, useDeribitFundingHistory } from './useDeribitFutures';
import { fetchFundingHistory, fetchIndexPrice, fetchTickers, listFutures } from '../lib/data/deribitFutures';

vi.mock('../lib/data/deribitFutures', () => ({
  fetchFundingHistory: vi.fn(),
  fetchIndexPrice: vi.fn(),
  fetchTickers: vi.fn(),
  listFutures: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

describe('Deribit hook polling ownership', () => {
  it('polls futures actively, suppresses hidden ticks, resumes once, and cleans up', async () => {
    vi.useFakeTimers();
    vi.mocked(listFutures).mockResolvedValue([]);
    vi.mocked(fetchTickers).mockResolvedValue({});
    vi.mocked(fetchIndexPrice).mockResolvedValue(null);
    const { unmount } = renderHook(() => useDeribitFutures('BTC', { refreshMs: 5_000 }));
    await act(async () => { await Promise.resolve(); });
    expect(listFutures).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(listFutures).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(listFutures).toHaveBeenCalledTimes(2);
    const calls = listFutures.mock.calls.length;
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(listFutures).toHaveBeenCalledTimes(calls);
  });

  it('settles hidden initial funding state without provider calls, then polls and cleans up', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const { result, unmount } = renderHook(() => useDeribitFundingHistory({ days: 7, refreshMs: 30_000 }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.loading).toBe(false);
    expect(fetchFundingHistory).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchFundingHistory).toHaveBeenCalledTimes(1);
    const calls = fetchFundingHistory.mock.calls.length;
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchFundingHistory).toHaveBeenCalledTimes(calls);
  });

  it('does not overlap a pending visible initial futures request', async () => {
    vi.useFakeTimers();
    let resolve: (() => void) | undefined;
    vi.mocked(listFutures).mockImplementation(() => new Promise((done) => { resolve = done; }));
    vi.mocked(fetchTickers).mockResolvedValue({});
    vi.mocked(fetchIndexPrice).mockResolvedValue(null);
    const { unmount } = renderHook(() => useDeribitFutures('BTC', { refreshMs: 5_000 }));
    expect(listFutures).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(listFutures).toHaveBeenCalledTimes(1);
    resolve?.();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(listFutures).toHaveBeenCalledTimes(2);
    unmount();
  });
});
