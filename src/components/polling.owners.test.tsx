import { act, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SharedDeskStrip } from './common/SharedDeskStrip';
import { KsaMarketView } from './views/KsaMarketView';
import { fetchDeskPack } from '../lib/data/deskFeedsClient';
import { fetchKsaBoardClient } from '../lib/data/ksaClient';

vi.mock('../lib/data/deskFeedsClient', () => ({ fetchDeskPack: vi.fn() }));
vi.mock('../lib/data/ksaClient', async () => {
  const actual = await vi.importActual<typeof import('../lib/data/ksaClient')>('../lib/data/ksaClient');
  return { ...actual, fetchKsaBoardClient: vi.fn() };
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

const deskPack = { symbol: 'SPY', derived: { realized_vol_20d_pct: 12 } };
const board = { session: { label: 'Open', isOpen: true }, tasi: { index_value: 12_000, change_pct: 0.2 } };

describe('mounted polling owners', () => {
  it('SharedDeskStrip pauses hidden, resumes once, and stops after unmount', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchDeskPack).mockResolvedValue(deskPack);
    const { unmount } = render(<SharedDeskStrip symbol="SPY" />);
    await act(async () => { await Promise.resolve(); });
    expect(fetchDeskPack).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchDeskPack).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchDeskPack).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchDeskPack).toHaveBeenCalledTimes(2);
  });

  it('SharedDeskStrip does not overlap a pending request on interval ticks', async () => {
    vi.useFakeTimers();
    let resolve: ((value: typeof deskPack) => void) | undefined;
    vi.mocked(fetchDeskPack).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { unmount } = render(<SharedDeskStrip symbol="SPY" />);
    expect(fetchDeskPack).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchDeskPack).toHaveBeenCalledTimes(1);
    resolve?.(deskPack);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchDeskPack).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('KsaMarketView pauses hidden, resumes once, and stops after unmount', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchKsaBoardClient).mockResolvedValue(board as never);
    const { unmount } = render(<KsaMarketView />);
    await act(async () => { await Promise.resolve(); });
    expect(fetchKsaBoardClient).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(fetchKsaBoardClient).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(fetchKsaBoardClient).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(fetchKsaBoardClient).toHaveBeenCalledTimes(2);
  });
});
