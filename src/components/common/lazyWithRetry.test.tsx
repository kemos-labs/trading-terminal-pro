import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { lazyWithRetry } from './lazyWithRetry';

/** Minimal error boundary: surfaces thrown chunk errors instead of hanging. */
class ProbeBoundary extends React.Component<
  { children: React.ReactNode },
  { error: unknown | null }
> {
  state = { error: null as unknown | null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    if (this.state.error) return <div data-testid="chunk-error">chunk failed</div>;
    return this.props.children;
  }
}

describe('lazyWithRetry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders after transient chunk failures', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const View = lazyWithRetry(
      () => {
        calls++;
        if (calls < 3) return Promise.reject(new Error(`chunk 404 (attempt ${calls})`));
        return Promise.resolve({ default: () => <div data-testid="chunk-ok">ready</div> });
      },
      { retries: 3, delayMs: 1000 },
    );
    render(
      <ProbeBoundary>
        <React.Suspense fallback={<div>loading</div>}>
          <View />
        </React.Suspense>
      </ProbeBoundary>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByTestId('chunk-ok')).toBeTruthy();
    expect(calls).toBe(3);
  });

  it('surfaces persistent chunk failure to the error boundary instead of hanging', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const View = lazyWithRetry(
      () => {
        calls++;
        return Promise.reject(new Error('chunk gone'));
      },
      { retries: 1, delayMs: 1000 },
    );
    render(
      <ProbeBoundary>
        <React.Suspense fallback={<div>loading</div>}>
          <View />
        </React.Suspense>
      </ProbeBoundary>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByTestId('chunk-error')).toBeTruthy();
    // Initial try + 1 retry, then it stops — no infinite refetch loop.
    expect(calls).toBe(2);
  });
});
