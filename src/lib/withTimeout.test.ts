import { describe, it, expect, vi, afterEach } from 'vitest';
import { withTimeout } from './withTimeout';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves the timeout value when the promise hangs', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<string>(() => {}), 100_000, 'timed-out');
    const assertion = expect(pending).resolves.toBe('timed-out');
    await vi.advanceTimersByTimeAsync(100_001);
    await assertion;
  });

  it('resolves the real value when the promise beats the clock', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(Promise.resolve('fast'), 100_000, 'timed-out');
    await expect(pending).resolves.toBe('fast');
  });

  it('propagates rejections that beat the clock', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 100_000, 'timed-out')).rejects.toThrow('boom');
  });
});
