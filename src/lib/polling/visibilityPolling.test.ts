import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startVisibilityPolling } from './visibilityPolling';

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

describe('startVisibilityPolling', () => {
  it('runs active cadence, pauses hidden, resumes once, prevents overlap, and cleans up', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const calls: number[] = [];
    const stop = startVisibilityPolling(() => {
      calls.push(Date.now());
      return new Promise<void>((resolve) => { release = resolve; });
    }, 1_000);
    expect(calls).toHaveLength(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(calls).toHaveLength(1);
    release?.();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(calls).toHaveLength(2);
    stop();
    release?.();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(calls).toHaveLength(2);
  });

  it('releases the guard after synchronous throws and asynchronous rejection', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const stop = startVisibilityPolling(() => {
      calls += 1;
      if (calls === 1) throw new Error('sync failure');
      if (calls === 2) return Promise.reject(new Error('async failure'));
      return undefined;
    }, 1_000);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(calls).toBe(4);
    stop();
  });
});
