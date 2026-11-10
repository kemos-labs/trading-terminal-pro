import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CryptoCarryView } from './CryptoCarryView';
import { CryptoAssetContext, type CryptoAssetContextValue } from '../shell/CryptoShell';

const fetchDeribitMarket = vi.fn();
vi.mock('../../../api/deribit', () => ({
  fetchDeribitMarket: (...args: unknown[]) => fetchDeribitMarket(...args),
}));

function bundleFor(currency: string) {
  const now = Date.now();
  return {
    currency,
    indexPrice: 3000,
    coverage: 1,
    funding8h: 0.0001,
    fetchedAt: now,
    source: 'deribit' as const,
    instruments: [
      { instrument: `${currency}-PERP`, kind: 'perp' as const, markPrice: 3000, bidPrice: 2999, askPrice: 3001, indexPrice: 3000, funding8h: 0.0001, timestamp: now, hasQuote: true } as never,
      { instrument: `${currency}-27JUN25`, kind: 'future' as const, expiryMs: now + 30 * 864e5, markPrice: 3050, hasQuote: true } as never,
      { instrument: `${currency}-26DEC25`, kind: 'future' as const, expiryMs: now + 180 * 864e5, markPrice: 3100, hasQuote: true } as never,
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
  return render(<CryptoAssetContext.Provider value={v}><CryptoCarryView /></CryptoAssetContext.Provider>);
}

beforeEach(() => {
  fetchDeribitMarket.mockReset();
  // @ts-ignore
  if (typeof globalThis.ResizeObserver === 'undefined') globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { points: [] } }) }));
});

describe('CryptoCarryView context', () => {
  it('fetches ETH when context is ETH (no BTC fallback)', async () => {
    fetchDeribitMarket.mockResolvedValue(bundleFor('ETH'));
    renderWith(ctx({ rawAsset: 'ETH', validatedAsset: 'ETH', isUnsupported: false }));
    await waitFor(() => expect(fetchDeribitMarket).toHaveBeenCalledWith('ETH'));
    expect(fetchDeribitMarket).not.toHaveBeenCalledWith('BTC');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/market/crypto/ETH/funding'));
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/BTC/'));
  });

  it('renders unsupported asset and never fetches', async () => {
    renderWith(ctx({ rawAsset: 'SOL', validatedAsset: null, isUnsupported: true }));
    expect(await screen.findByTestId('carry-unsupported')).toBeInTheDocument();
    expect(fetchDeribitMarket).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('renders venue unavailable and never fetches', async () => {
    renderWith(ctx({ rawAsset: 'BTC', validatedAsset: 'BTC', isUnsupported: false, venue: null, rawVenue: 'binance', validatedVenue: null, isUnsupportedVenue: true }));
    expect(await screen.findByTestId('carry-venue-unsupported')).toBeInTheDocument();
    expect(fetchDeribitMarket).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('mid-flight switch cancels old promise and uses ETH bundle', async () => {
    let resolveBtc!: (v: ReturnType<typeof bundleFor>) => void;
    let resolveEth!: (v: ReturnType<typeof bundleFor>) => void;
    fetchDeribitMarket.mockImplementation((cur: string) => {
      if (cur === 'BTC') return new Promise(res => { resolveBtc = res; });
      if (cur === 'ETH') return new Promise(res => { resolveEth = res; });
      return Promise.resolve(bundleFor(cur));
    });
    const { rerender } = renderWith(ctx({ rawAsset: 'BTC', validatedAsset: 'BTC', isUnsupported: false }));
    await waitFor(() => expect(fetchDeribitMarket).toHaveBeenCalledWith('BTC'));
    rerender(<CryptoAssetContext.Provider value={ctx({ rawAsset: 'ETH', validatedAsset: 'ETH', isUnsupported: false })}><CryptoCarryView /></CryptoAssetContext.Provider>);
    await waitFor(() => expect(fetchDeribitMarket).toHaveBeenCalledWith('ETH'));
    expect(fetchDeribitMarket).toHaveBeenCalledTimes(2);
    await act(async () => { resolveBtc(bundleFor('BTC')); });
    expect(screen.getByText(/Loading carry/)).toBeInTheDocument();
    await act(async () => { resolveEth(bundleFor('ETH')); });
    await waitFor(() => expect(screen.getByTestId('carry-workstation')).toBeInTheDocument());
    expect(screen.getByTestId('carry-workstation').textContent).toContain('ETH-');
    expect(screen.getByTestId('carry-workstation').textContent).not.toContain('BTC-');
  });
});
