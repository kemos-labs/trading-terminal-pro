import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CryptoVolatilityView } from './CryptoVolatilityView';
import { CryptoAssetContext, CryptoShell, type CryptoAssetContextValue } from '../shell/CryptoShell';

const fetchDeribitMarket = vi.fn();
vi.mock('../../../api/deribit', () => ({
  fetchDeribitMarket: (...args: unknown[]) => fetchDeribitMarket(...args),
}));

function bundleFor(currency: string) {
  const now = Date.now();
  return {
    currency,
    indexPrice: 65000,
    coverage: 1,
    funding8h: null,
    fetchedAt: now,
    source: 'deribit' as const,
    instruments: [
      {
        instrument: `${currency}-01JAN27-65000-C`,
        baseCurrency: currency,
        quoteCurrency: 'USD',
        settlementCurrency: 'USD',
        contractSize: 1,
        kind: 'option' as const,
        expiryMs: now + 30 * 864e5,
        strike: 65000,
        optionType: 'call' as const,
        isInverse: false,
        bidPrice: 100,
        askPrice: 110,
        markPrice: 105,
        lastPrice: 105,
        bidIv: 0.5,
        askIv: 0.52,
        markIv: 0.51,
        feedIv: 0.51,
        midIv: null,
        bidIvDerived: null,
        askIvDerived: null,
        modelIv: null,
        indexPrice: 65000,
        openInterest: 100,
        volume: 10,
        volumeUsd: 1000,
        funding8h: null,
        timestamp: now,
        hasQuote: true,
        isStale: false,
      },
    ],
  };
}

function ctx(overrides: Partial<CryptoAssetContextValue> & { rawAsset: string }): CryptoAssetContextValue {
  const defaults: CryptoAssetContextValue = {
    rawAsset: overrides.rawAsset,
    validatedAsset: (overrides.validatedAsset as CryptoAssetContextValue['validatedAsset']) ?? null,
    isUnsupported: overrides.isUnsupported ?? false,
    venue: overrides.venue ?? 'deribit',
    rawVenue: overrides.rawVenue ?? 'deribit',
    validatedVenue: (overrides.validatedVenue as CryptoAssetContextValue['validatedVenue']) ?? 'deribit',
    isUnsupportedVenue: overrides.isUnsupportedVenue ?? false,
  };
  return { ...defaults, ...overrides } as CryptoAssetContextValue;
}

function renderWithAsset(value: CryptoAssetContextValue) {
  return render(
    <CryptoAssetContext.Provider value={value}>
      <CryptoVolatilityView />
    </CryptoAssetContext.Provider>,
  );
}

beforeEach(() => {
  fetchDeribitMarket.mockReset();
  window.history.pushState({}, '', '/?desk=crypto&view=volatility&asset=BTC&venue=deribit');
});

describe('CryptoVolatilityView asset context', () => {
  it('fetches BTC when context is BTC', async () => {
    fetchDeribitMarket.mockResolvedValue(bundleFor('BTC'));
    renderWithAsset(ctx({ rawAsset: 'BTC', validatedAsset: 'BTC', isUnsupported: false }));
    await waitFor(() => expect(fetchDeribitMarket).toHaveBeenCalledWith('BTC'));
    await waitFor(() => expect(screen.getByTestId('vol-asset-badge')).toHaveTextContent('BTC'));
    expect(fetchDeribitMarket).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('vol-unsupported')).not.toBeInTheDocument();
  });

  it('fetches ETH when context is ETH (no BTC fallback)', async () => {
    fetchDeribitMarket.mockResolvedValue(bundleFor('ETH'));
    renderWithAsset(ctx({ rawAsset: 'ETH', validatedAsset: 'ETH', isUnsupported: false }));
    await waitFor(() => expect(fetchDeribitMarket).toHaveBeenCalledWith('ETH'));
    await waitFor(() => expect(screen.getByTestId('vol-asset-badge')).toHaveTextContent('ETH'));
    expect(fetchDeribitMarket).not.toHaveBeenCalledWith('BTC');
    expect(screen.queryByTestId('vol-unsupported')).not.toBeInTheDocument();
  });

  it('renders unavailable for unsupported asset and never fetches BTC', async () => {
    renderWithAsset(ctx({ rawAsset: 'SOL', validatedAsset: null, isUnsupported: true }));
    expect(await screen.findByTestId('vol-unsupported')).toBeInTheDocument();
    expect(screen.getByText(/Unsupported asset/)).toBeInTheDocument();
    expect(fetchDeribitMarket).not.toHaveBeenCalled();
  });

  it('renders unavailable for malformed query and never fetches', async () => {
    renderWithAsset(ctx({ rawAsset: '$$$', validatedAsset: null, isUnsupported: true }));
    expect(await screen.findByTestId('vol-unsupported')).toBeInTheDocument();
    expect(fetchDeribitMarket).not.toHaveBeenCalled();
  });

  it('preserves loading state before fetch resolves', async () => {
    fetchDeribitMarket.mockReturnValue(new Promise(() => {}));
    renderWithAsset(ctx({ rawAsset: 'BTC', validatedAsset: 'BTC', isUnsupported: false }));
    expect(screen.getByText(/Loading volatility term/)).toBeInTheDocument();
  });

  it('non-Deribit venue renders venue unavailable and never fetches, with no contradictory Deribit claim', async () => {
    renderWithAsset(ctx({ rawAsset: 'BTC', validatedAsset: 'BTC', isUnsupported: false, venue: 'deribit', rawVenue: 'binance', validatedVenue: null, isUnsupportedVenue: true }));
    expect(await screen.findByTestId('vol-venue-unsupported')).toBeInTheDocument();
    expect(screen.getByText(/Unsupported venue/)).toBeInTheDocument();
    expect(fetchDeribitMarket).not.toHaveBeenCalled();
    // badge with contradictory "BTC · binance" must not appear; no Source: Deribit alongside binance
    expect(screen.queryByTestId('vol-asset-badge')).not.toBeInTheDocument();
    expect(screen.queryByText(/BTC · binance/)).not.toBeInTheDocument();
  });

  it('mid-flight context switch: old promise cannot overwrite new asset', async () => {
    let resolveBtc!: (v: ReturnType<typeof bundleFor>) => void;
    let resolveEth!: (v: ReturnType<typeof bundleFor>) => void;
    fetchDeribitMarket.mockImplementation((cur: string) => {
      if (cur === 'BTC') return new Promise(res => { resolveBtc = res; });
      if (cur === 'ETH') return new Promise(res => { resolveEth = res; });
      return Promise.resolve(bundleFor(cur));
    });

    const { rerender } = renderWithAsset(ctx({ rawAsset: 'BTC', validatedAsset: 'BTC', isUnsupported: false }));
    await waitFor(() => expect(fetchDeribitMarket).toHaveBeenCalledWith('BTC'));

    // Switch to ETH before BTC resolves
    rerender(
      <CryptoAssetContext.Provider value={ctx({ rawAsset: 'ETH', validatedAsset: 'ETH', isUnsupported: false })}>
        <CryptoVolatilityView />
      </CryptoAssetContext.Provider>,
    );
    await waitFor(() => expect(fetchDeribitMarket).toHaveBeenCalledWith('ETH'));
    expect(fetchDeribitMarket).toHaveBeenCalledTimes(2);

    // Resolve old BTC first — should be ignored
    await act(async () => { resolveBtc(bundleFor('BTC')); });
    // Still loading (ETH pending), no BTC badge leaked
    expect(screen.queryByTestId('vol-asset-badge')).not.toBeInTheDocument();
    expect(screen.getByText(/Loading volatility term/)).toBeInTheDocument();

    // Resolve ETH — badge must be ETH
    await act(async () => { resolveEth(bundleFor('ETH')); });
    await waitFor(() => expect(screen.getByTestId('vol-asset-badge')).toHaveTextContent('ETH'));
    expect(screen.getByTestId('vol-asset-badge').textContent).not.toContain('BTC');
  });

  it('shell-level URL asset ETH wiring into volatility fetch/badge', async () => {
    window.history.pushState({}, '', '/?desk=crypto&view=volatility&asset=ETH&venue=deribit');
    fetchDeribitMarket.mockResolvedValue(bundleFor('ETH'));
    render(<CryptoShell />);
    await waitFor(() => expect(fetchDeribitMarket).toHaveBeenCalledWith('ETH'));
    await waitFor(() => expect(screen.getByTestId('vol-asset-badge')).toHaveTextContent('ETH'));
    expect(fetchDeribitMarket).not.toHaveBeenCalledWith('BTC');
    // badge shows canonical deribit, not arbitrary venue text
    expect(screen.getByTestId('vol-asset-badge').textContent).toMatch(/ETH.*deribit/i);
  });

  it('popstate sync updates asset and venue in strip and subsequent fetch', async () => {
    window.history.pushState({}, '', '/?desk=crypto&view=volatility&asset=BTC&venue=deribit');
    fetchDeribitMarket.mockResolvedValue(bundleFor('BTC'));
    render(<CryptoShell />);
    await waitFor(() => expect(fetchDeribitMarket).toHaveBeenCalledWith('BTC'));
    fetchDeribitMarket.mockClear();
    fetchDeribitMarket.mockResolvedValue(bundleFor('ETH'));

    // Navigate to ETH via history + popstate
    await act(async () => {
      window.history.pushState({}, '', '/?desk=crypto&view=volatility&asset=ETH&venue=deribit');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => expect(screen.getByTestId('crypto-context-strip').textContent).toMatch(/ETH/));
    await waitFor(() => expect(fetchDeribitMarket).toHaveBeenCalledWith('ETH'));
    await waitFor(() => expect(screen.getByTestId('vol-asset-badge')).toHaveTextContent('ETH'));
  });
});
