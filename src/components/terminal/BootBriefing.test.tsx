/**
 * BootBriefing escape-hatch tests.
 * Regression: the 6s auto-enter timer was disarmed by every parent
 * re-render (inline onEnter prop → new enter identity → effect cleanup),
 * trapping users on the landing at 80% while the chain warmed.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { BootBriefing } from './BootBriefing';

// Warm feeds never settle: entering must not depend on them.
vi.mock('../../lib/macrovol/api', () => ({
  macrovolApi: {
    ratesSummary: () => new Promise(() => {}),
    macroSummary: () => new Promise(() => {}),
    macroStress: () => new Promise(() => {}),
    ratesFx: () => new Promise(() => {}),
    ratesAuctions: () => new Promise(() => {}),
    cryptoSpot: () => new Promise(() => {}),
  },
}));

describe('BootBriefing escape hatch', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-enters after 6s even when onEnter identity changes on every render', async () => {
    vi.useFakeTimers();
    const onEnter = vi.fn();
    const view = render(<BootBriefing heavyReady={false} onEnter={() => onEnter()} />);
    // Simulate a busy parent (live store ticks): fresh callback identity
    // plus one elapsed second, six times over. A timer tied to the callback
    // identity would be disarmed on every pass and never fire.
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      act(() => {
        view.rerender(<BootBriefing heavyReady={false} onEnter={() => onEnter()} />);
      });
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('enters shortly after heavy desks report ready', async () => {
    vi.useFakeTimers();
    const onEnter = vi.fn();
    const view = render(<BootBriefing heavyReady={false} onEnter={onEnter} />);
    view.rerender(<BootBriefing heavyReady={true} onEnter={onEnter} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('never enters twice', async () => {
    vi.useFakeTimers();
    const onEnter = vi.fn();
    const view = render(<BootBriefing heavyReady={false} onEnter={onEnter} />);
    view.rerender(<BootBriefing heavyReady={true} onEnter={onEnter} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });
});
