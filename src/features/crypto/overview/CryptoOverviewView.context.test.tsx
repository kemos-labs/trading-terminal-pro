import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CryptoOverviewView } from './CryptoOverviewView';
import { CryptoAssetContext, type CryptoAssetContextValue } from '../shell/CryptoShell';
import type { DeribitMarketBundle } from '../../../api/deribit';
import type { FreeCryptoMarket } from '../../../api/freeCrypto';

const deribit = vi.fn();
const free = vi.fn();
vi.mock('../../../api/deribit', () => ({ fetchDeribitMarket: (...args: unknown[]) => deribit(...args) }));
vi.mock('../../../api/freeCrypto', () => ({ fetchFreeCryptoMarket: (...args: unknown[]) => free(...args) }));

function bundleFor(currency: string): DeribitMarketBundle {
  return {
    currency,
    indexPrice: 65000,
    coverage: 1,
    funding8h: 0.001,
    fetchedAt: Date.now(),
    source: 'deribit',
    instruments: [],
  } as DeribitMarketBundle;
}
function freeFor(currency: string): FreeCryptoMarket {
  return {
    currency: currency as 'BTC' | 'ETH',
    symbol: `${currency}USDT`,
    venues: [{ venue: 'Binance Futures', symbol: `${currency}USDT`, mark: 100, index: 100, last: 100, funding8h: 0, openInterest: 1, volume24hUsd: 1, change24hPct: 0, fetchedAt: Date.now() } as never, { venue: 'Bybit Linear', symbol: `${currency}USDT`, mark: 100, index: 100, last: 100, funding8h: 0, openInterest: 1, volume24hUsd: 1, change24hPct: 0, fetchedAt: Date.now() } as never],
    fetchedAt: Date.now(),
    source: 'free-exchanges',
    note: 'Public exchange data; free alternative to Velo, not Velo-normalized.',
  };
}
function ctx(overrides: Partial<CryptoAssetContextValue> & { rawAsset: string }): CryptoAssetContextValue {
  return {
    rawAsset: overrides.rawAsset,
    validatedAsset: (overrides.validatedAsset as CryptoAssetContextValue['validatedAsset']) ?? null,
    isUnsupported: overrides.isUnsupported ?? false,
    venue: (overrides.venue as CryptoAssetContextValue['venue']) ?? 'deribit',
    rawVenue: overrides.rawVenue ?? 'deribit',
    validatedVenue: (overrides.validatedVenue as CryptoAssetContextValue['validatedVenue']) ?? 'deribit',
    isUnsupportedVenue: overrides.isUnsupportedVenue ?? false,
    ...overrides,
  } as CryptoAssetContextValue;
}
function renderWith(v: CryptoAssetContextValue) {
  return render(<CryptoAssetContext.Provider value={v}><CryptoOverviewView /></CryptoAssetContext.Provider>);
}

beforeEach(() => { deribit.mockReset(); free.mockReset(); });

describe('CryptoOverviewView context', () => {
  it('fetches ETH for both providers when context is ETH', async () => {
    deribit.mockResolvedValue(bundleFor('ETH'));
    free.mockResolvedValue(freeFor('ETH'));
    renderWith(ctx({ rawAsset: 'ETH', validatedAsset: 'ETH', isUnsupported: false }));
    await waitFor(() => expect(deribit).toHaveBeenCalledWith('ETH'));
    await waitFor(() => expect(free).toHaveBeenCalledWith('ETH'));
    expect(deribit).not.toHaveBeenCalledWith('BTC');
    expect(free).not.toHaveBeenCalledWith('BTC');
    await waitFor(() => expect(screen.getByText(/ETH · Deribit/)).toBeInTheDocument());
    expect(screen.getByText('Free multi-venue snapshot')).toBeInTheDocument();
    expect(screen.getByText('Public exchange data; free alternative to Velo, not Velo-normalized.')).toBeInTheDocument();
  });

  it('renders unsupported asset and never fetches', async () => {
    renderWith(ctx({ rawAsset: 'SOL', validatedAsset: null, isUnsupported: true }));
    expect(await screen.findByTestId('overview-unsupported')).toBeInTheDocument();
    expect(deribit).not.toHaveBeenCalled();
    expect(free).not.toHaveBeenCalled();
  });

  it('renders venue unavailable and never fetches Deribit but still handles free path via venue-independent guard', async () => {
    // venue unsupported: Deribit must not be called; free also depends on asset but not venue, so if asset is BTC it would still fetch free.
    // In this test asset is BTC supported, venue binance unsupported -> deribit blocked, free allowed
    free.mockResolvedValue(freeFor('BTC'));
    renderWith(ctx({ rawAsset: 'BTC', validatedAsset: 'BTC', isUnsupported: false, venue: null, rawVenue: 'binance', validatedVenue: null, isUnsupportedVenue: true }));
    expect(await screen.findByTestId('overview-venue-unsupported')).toBeInTheDocument();
    expect(deribit).not.toHaveBeenCalled();
    // free should still be fetched because venue unsupported does not block free
    await waitFor(() => expect(free).toHaveBeenCalledWith('BTC'));
  });

  it('mid-flight cancellation: old BTC promise cannot overwrite ETH', async () => {
    let resolveBtc!: (v: DeribitMarketBundle) => void;
    let resolveEth!: (v: DeribitMarketBundle) => void;
    deribit.mockImplementation((cur: string) => {
      if (cur === 'BTC') return new Promise(res => { resolveBtc = res; });
      if (cur === 'ETH') return new Promise(res => { resolveEth = res; });
      return Promise.resolve(bundleFor(cur));
    });
    free.mockResolvedValue(freeFor('BTC'));
    const { rerender } = renderWith(ctx({ rawAsset: 'BTC', validatedAsset: 'BTC', isUnsupported: false }));
    await waitFor(() => expect(deribit).toHaveBeenCalledWith('BTC'));
    // switch to ETH before BTC resolves
    free.mockResolvedValue(freeFor('ETH'));
    rerender(<CryptoAssetContext.Provider value={ctx({ rawAsset: 'ETH', validatedAsset: 'ETH', isUnsupported: false })}><CryptoOverviewView /></CryptoAssetContext.Provider>);
    await waitFor(() => expect(deribit).toHaveBeenCalledWith('ETH'));
    expect(deribit).toHaveBeenCalledTimes(2);
    await act(async () => { resolveBtc(bundleFor('BTC')); });
    // BTC result should be ignored, still no ETH badge
    expect(screen.queryByText(/BTC · Deribit/)).not.toBeInTheDocument();
    await act(async () => { resolveEth(bundleFor('ETH')); });
    await waitFor(() => expect(screen.getByText(/ETH · Deribit/)).toBeInTheDocument());
  });
});
