import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CryptoFlowView } from './CryptoFlowView';
import { CryptoAssetContext, type CryptoAssetContextValue } from '../shell/CryptoShell';

const fetchDeribitTrades = vi.fn();
vi.mock('../../../api/deribit', () => ({
  fetchDeribitTrades: (...args: unknown[]) => fetchDeribitTrades(...args),
}));

function tradesFor(currency: string) {
  const now = Date.now();
  return {
    trades: [
      { instrument: `${currency}-01JAN27-3000-C`, side: 'buy' as const, quantity: 1, price: 0.05, premiumNative: 0.05, nativeCurrency: currency, right: 'call' as const, timestamp: now, markIv: 0.5, expiry: '01JAN27' },
    ],
    fetchedAt: now,
  };
}
function ctx(o: Partial<CryptoAssetContextValue> & { rawAsset: string }): CryptoAssetContextValue {
  return {
    rawAsset: o.rawAsset,
    validatedAsset: (o.validatedAsset as CryptoAssetContextValue['validatedAsset']) ?? null,
    isUnsupported: o.isUnsupported ?? false,
    venue: (o.venue as CryptoAssetContextValue['venue']) ?? 'deribit',
    rawVenue: o.rawVenue ?? 'deribit',
    validatedVenue: (o.validatedVenue as CryptoAssetContextValue['validatedVenue']) ?? 'deribit',
    isUnsupportedVenue: o.isUnsupportedVenue ?? false,
    ...o,
  } as CryptoAssetContextValue;
}
function renderWith(v: CryptoAssetContextValue) {
  return render(<CryptoAssetContext.Provider value={v}><CryptoFlowView /></CryptoAssetContext.Provider>);
}

beforeEach(() => { fetchDeribitTrades.mockReset(); // @ts-ignore
  if (typeof globalThis.ResizeObserver === 'undefined') globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }; });

describe('CryptoFlowView context', () => {
  it('fetches ETH when context is ETH (no BTC fallback)', async () => {
    fetchDeribitTrades.mockResolvedValue(tradesFor('ETH'));
    renderWith(ctx({ rawAsset: 'ETH', validatedAsset: 'ETH', isUnsupported: false }));
    await waitFor(() => expect(fetchDeribitTrades).toHaveBeenCalledWith('ETH', 24, 100));
    expect(fetchDeribitTrades).not.toHaveBeenCalledWith('BTC', expect.anything(), expect.anything());
    await waitFor(() => expect(screen.getByTestId('flow-workstation')).toBeInTheDocument());
    // native currency label must be ETH, not BTC
    expect(screen.getByTestId('flow-workstation').textContent).toContain('ETH');
    expect(screen.getByTestId('flow-workstation').textContent).not.toMatch(/Premium \(BTC\)/);
  });

  it('renders unsupported asset and never fetches', async () => {
    renderWith(ctx({ rawAsset: 'SOL', validatedAsset: null, isUnsupported: true }));
    expect(await screen.findByTestId('flow-unsupported')).toBeInTheDocument();
    expect(fetchDeribitTrades).not.toHaveBeenCalled();
  });

  it('renders venue unavailable and never fetches', async () => {
    renderWith(ctx({ rawAsset: 'BTC', validatedAsset: 'BTC', isUnsupported: false, venue: null, rawVenue: 'binance', validatedVenue: null, isUnsupportedVenue: true }));
    expect(await screen.findByTestId('flow-venue-unsupported')).toBeInTheDocument();
    expect(fetchDeribitTrades).not.toHaveBeenCalled();
  });

  it('mid-flight switch cancels old promise', async () => {
    let resolveBtc!: (v: ReturnType<typeof tradesFor>) => void;
    let resolveEth!: (v: ReturnType<typeof tradesFor>) => void;
    fetchDeribitTrades.mockImplementation((cur: string) => {
      if (cur === 'BTC') return new Promise(res => { resolveBtc = res; });
      if (cur === 'ETH') return new Promise(res => { resolveEth = res; });
      return Promise.resolve(tradesFor(cur));
    });
    const { rerender } = renderWith(ctx({ rawAsset: 'BTC', validatedAsset: 'BTC', isUnsupported: false }));
    await waitFor(() => expect(fetchDeribitTrades).toHaveBeenCalledWith('BTC', 24, 100));
    rerender(<CryptoAssetContext.Provider value={ctx({ rawAsset: 'ETH', validatedAsset: 'ETH', isUnsupported: false })}><CryptoFlowView /></CryptoAssetContext.Provider>);
    await waitFor(() => expect(fetchDeribitTrades).toHaveBeenCalledWith('ETH', 24, 100));
    expect(fetchDeribitTrades).toHaveBeenCalledTimes(2);
    await act(async () => { resolveBtc(tradesFor('BTC')); });
    expect(screen.getByText(/Loading flow/)).toBeInTheDocument();
    await act(async () => { resolveEth(tradesFor('ETH')); });
    await waitFor(() => expect(screen.getByTestId('flow-workstation')).toBeInTheDocument());
    expect(screen.getByTestId('flow-workstation').textContent).toContain('ETH');
  });
});
