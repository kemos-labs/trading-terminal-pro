import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CryptoPositioningView } from './CryptoPositioningView';
import { CryptoAssetContext, type CryptoAssetContextValue } from '../shell/CryptoShell';

const fetchDeribitMarket = vi.fn();
vi.mock('../../../api/deribit', () => ({ fetchDeribitMarket: (...args: unknown[]) => fetchDeribitMarket(...args) }));

function bundleFor(currency: string) {
  const now = Date.now();
  return {
    currency,
    indexPrice: 3000,
    coverage: 1,
    funding8h: null,
    fetchedAt: now,
    source: 'deribit' as const,
    instruments: [
      { instrument: `${currency}-01JAN27-3000-C`, kind: 'option' as const, expiryMs: now + 86400000, strike: 3000, optionType: 'call' as const, markIv: 0.5, openInterest: 10, bidPrice: 1, askPrice: 2, markPrice: 1.5, volume: 1, volumeUsd: 1, funding8h: null, timestamp: now, hasQuote: true, isStale: false, baseCurrency: currency, quoteCurrency: 'USD', settlementCurrency: 'USD', contractSize: 1, isInverse: false, lastPrice: 1.5, bidIv: 0.5, askIv: 0.5, feedIv: 0.5, midIv: null, bidIvDerived: null, askIvDerived: null, modelIv: null, indexPrice: 3000 },
    ],
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
  return render(<CryptoAssetContext.Provider value={v}><CryptoPositioningView /></CryptoAssetContext.Provider>);
}

beforeEach(() => {
  fetchDeribitMarket.mockReset();
  // @ts-ignore
  if (typeof globalThis.ResizeObserver === 'undefined') globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
});

describe('CryptoPositioningView context', () => {
  it('fetches ETH when context is ETH (no BTC fallback)', async () => {
    fetchDeribitMarket.mockResolvedValue(bundleFor('ETH'));
    renderWith(ctx({ rawAsset: 'ETH', validatedAsset: 'ETH', isUnsupported: false }));
    await waitFor(() => expect(fetchDeribitMarket).toHaveBeenCalledWith('ETH'));
    expect(fetchDeribitMarket).not.toHaveBeenCalledWith('BTC');
  });
  it('renders unsupported asset and never fetches', async () => {
    renderWith(ctx({ rawAsset: 'SOL', validatedAsset: null, isUnsupported: true }));
    expect(await screen.findByTestId('positioning-unsupported')).toBeInTheDocument();
    expect(fetchDeribitMarket).not.toHaveBeenCalled();
  });
  it('renders venue unavailable and never fetches', async () => {
    renderWith(ctx({ rawAsset: 'BTC', validatedAsset: 'BTC', isUnsupported: false, venue: null, rawVenue: 'binance', validatedVenue: null, isUnsupportedVenue: true }));
    expect(await screen.findByTestId('positioning-venue-unsupported')).toBeInTheDocument();
    expect(fetchDeribitMarket).not.toHaveBeenCalled();
  });
  it('mid-flight switch cancels old promise', async () => {
    let resolveBtc!: (v: ReturnType<typeof bundleFor>) => void;
    let resolveEth!: (v: ReturnType<typeof bundleFor>) => void;
    fetchDeribitMarket.mockImplementation((cur: string) => {
      if (cur === 'BTC') return new Promise(res => { resolveBtc = res; });
      if (cur === 'ETH') return new Promise(res => { resolveEth = res; });
      return Promise.resolve(bundleFor(cur));
    });
    const { rerender } = renderWith(ctx({ rawAsset: 'BTC', validatedAsset: 'BTC', isUnsupported: false }));
    await waitFor(() => expect(fetchDeribitMarket).toHaveBeenCalledWith('BTC'));
    rerender(<CryptoAssetContext.Provider value={ctx({ rawAsset: 'ETH', validatedAsset: 'ETH', isUnsupported: false })}><CryptoPositioningView /></CryptoAssetContext.Provider>);
    await waitFor(() => expect(fetchDeribitMarket).toHaveBeenCalledWith('ETH'));
    expect(fetchDeribitMarket).toHaveBeenCalledTimes(2);
    await act(async () => { resolveBtc(bundleFor('BTC')); });
    // should still be loading, not show BTC workstation
    expect(screen.queryByTestId('positioning-workstation')).not.toBeInTheDocument();
    expect(screen.getByText(/Loading positioning/)).toBeInTheDocument();
    await act(async () => { resolveEth(bundleFor('ETH')); });
    await waitFor(() => expect(screen.getByTestId('positioning-workstation')).toBeInTheDocument());
  });
});
