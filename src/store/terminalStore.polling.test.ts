import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REFRESH_CONFIG } from '../config/constants';
import { startRefreshLoop } from './terminalStore';

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

describe('terminalStore refresh polling ownership', () => {
  it('counts active refreshes, suppresses hidden ticks, resumes once, and stops on disposer', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    let stop: (() => void) | null = null;
    startRefreshLoop(
      () => ({ refresh } as never),
      (partial) => { stop = partial.refreshInterval; },
      'live',
    );
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_CONFIG.LIVE_INTERVAL_MS * 2); });
    expect(refresh).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_CONFIG.LIVE_INTERVAL_MS * 2); });
    expect(refresh).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_CONFIG.LIVE_INTERVAL_MS); });
    expect(refresh).toHaveBeenCalledTimes(3);
    stop?.();
    await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_CONFIG.LIVE_INTERVAL_MS * 2); });
    expect(refresh).toHaveBeenCalledTimes(3);
  });
});
