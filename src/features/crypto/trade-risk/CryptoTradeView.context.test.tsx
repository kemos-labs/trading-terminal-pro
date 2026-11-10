import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CryptoTradeView } from './CryptoTradeView';
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
    funding8h: null,
    fetchedAt: now,
    source: 'deribit' as const,
    instruments: [
      { instrument: `${currency}-PERP`, kind: 'perp' as const, markPrice: 3000, bidPrice: 2999, askPrice: 3001, hasQuote: true, timestamp: now } as never,
      { instrument: `${currency}-01JAN27-3000-C`, kind: 'option' as const, expiryMs: now + 30 * 864e5, strike: 3000, optionType: 'call' as const, bidPrice: 10, askPrice: 12, markPrice: 11, markIv: 0.5, bidIv: 0.49, askIv: 0.51, openInterest: 100, hasQuote: true } as never,
      { instrument: `${currency}-01JAN27-3000-P`, kind: 'option' as const, expiryMs: now + 30 * 864e5, strike: 3000, optionType: 'put' as const, bidPrice: 10, askPrice: 12, markPrice: 11, markIv: 0.5, bidIv: 0.49, askIv: 0.51, openInterest: 100, hasQuote: true } as never,
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
  return render(<CryptoAssetContext.Provider value={v}><CryptoTradeView /></CryptoAssetContext.Provider>);
}

beforeEach(() => { fetchDeribitMarket.mockReset(); });

describe('CryptoTradeView context', () => {
  it('fetches ETH when context is ETH and labels use ETH currency', async () => {
    fetchDeribitMarket.mockResolvedValue(bundleFor('ETH'));
    renderWith(ctx({ rawAsset: 'ETH', validatedAsset: 'ETH', isUnsupported: false }));
    await waitFor(() => expect(fetchDeribitMarket).toHaveBeenCalledWith('ETH'));
    expect(fetchDeribitMarket).not.toHaveBeenCalledWith('BTC');
    await waitFor(() => expect(screen.getByTestId('trade-risk-workstation')).toBeInTheDocument());
    expect(screen.getByText(/Premium in ETH/)).toBeInTheDocument();
  });

  it('renders unsupported asset and never fetches', async () => {
    renderWith(ctx({ rawAsset: 'SOL', validatedAsset: null, isUnsupported: true }));
    expect(await screen.findByTestId('trade-unsupported')).toBeInTheDocument();
    expect(fetchDeribitMarket).not.toHaveBeenCalled();
  });

  it('renders venue unavailable and never fetches', async () => {
    renderWith(ctx({ rawAsset: 'BTC', validatedAsset: 'BTC', isUnsupported: false, venue: null, rawVenue: 'binance', validatedVenue: null, isUnsupportedVenue: true }));
    expect(await screen.findByTestId('trade-venue-unsupported')).toBeInTheDocument();
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
    rerender(<CryptoAssetContext.Provider value={ctx({ rawAsset: 'ETH', validatedAsset: 'ETH', isUnsupported: false })}><CryptoTradeView /></CryptoAssetContext.Provider>);
    await waitFor(() => expect(fetchDeribitMarket).toHaveBeenCalledWith('ETH'));
    expect(fetchDeribitMarket).toHaveBeenCalledTimes(2);
    await act(async () => { resolveBtc(bundleFor('BTC')); });
    expect(screen.getByText(/Loading chain/)).toBeInTheDocument();
    await act(async () => { resolveEth(bundleFor('ETH')); });
    await waitFor(() => expect(screen.getByTestId('trade-risk-workstation')).toBeInTheDocument());
    expect(screen.getByText(/Premium in ETH/)).toBeInTheDocument();
  });

  it('ETH leg premium and Greeks labels use ETH, not BTC', async () => {
    fetchDeribitMarket.mockResolvedValue(bundleFor('ETH'));
    renderWith(ctx({ rawAsset: 'ETH', validatedAsset: 'ETH', isUnsupported: false }));
    await waitFor(() => expect(screen.getByTestId('trade-risk-workstation')).toBeInTheDocument());
    // Show model layer to reveal leg premium and Greeks
    screen.getByRole('button', { name: /Show model layer/ }).click();
    await waitFor(() => expect(screen.getByTestId('trade-model-layer')).toBeInTheDocument());
    // add a leg to see premium label
    screen.getByRole('button', { name: /\+ Leg/ }).click();
    await waitFor(() => expect(screen.getByTestId('trade-leg-greeks')).toBeInTheDocument());
    expect(screen.getByTestId('trade-model-layer').textContent).toContain('ETH');
    expect(screen.getByTestId('trade-model-layer').textContent).not.toMatch(/Leg premium total:.*BTC/);
    expect(screen.getByTestId('trade-leg-greeks').textContent).toContain('per 1 ETH');
  });
});
