import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { activeExpiryMs, CryptoVolatilityView } from './CryptoVolatilityView';
import { CryptoAssetContext, type CryptoAssetContextValue } from '../shell/CryptoShell';

const fetchDeribitMarket = vi.fn();
let throwOnRender = false;
vi.mock('../../../api/deribit', () => ({
  fetchDeribitMarket: (...a: unknown[]) => fetchDeribitMarket(...a),
}));
vi.mock('../../../components/charts/IvSurface3D', () => ({
  default: () => {
    if (throwOnRender) throw new Error('WebGL boom');
    return React.createElement('div', { 'data-testid': 'iv-surface-3d' }, 'mock-3d');
  },
}));

function ctx(over: Partial<CryptoAssetContextValue> & { rawAsset: string }): CryptoAssetContextValue {
  return {
    rawAsset: over.rawAsset,
    validatedAsset: (over.validatedAsset as CryptoAssetContextValue['validatedAsset']) ?? null,
    isUnsupported: over.isUnsupported ?? false,
    venue: over.venue ?? 'deribit',
    rawVenue: over.rawVenue ?? 'deribit',
    validatedVenue: (over.validatedVenue as CryptoAssetContextValue['validatedVenue']) ?? 'deribit',
    isUnsupportedVenue: over.isUnsupportedVenue ?? false,
    ...over,
  } as CryptoAssetContextValue;
}
function bundleFor(currency: string, opts: { expiries?: number; strikes?: number[] } = {}) {
  const now = Date.now();
  const strikes = opts.strikes ?? [60000, 65000];
  const nExp = opts.expiries ?? 2;
  const instruments: ReturnType<typeof bundleFor>['instruments'] = [] as unknown as ReturnType<typeof bundleFor>['instruments'];
  // @ts-expect-error helper
  const list: unknown[] = [];
  for (let e = 0; e < nExp; e++) {
    const expiryMs = now + (10 + e * 10) * 864e5;
    for (const k of strikes) {
      list.push({
        instrument: `${currency}-${expiryMs}-${k}-C`,
        baseCurrency: currency, quoteCurrency: 'USD', settlementCurrency: 'USD', contractSize: 1,
        kind: 'option', expiryMs, strike: k, optionType: 'call', isInverse: false,
        bidPrice: 10, askPrice: 12, markPrice: 11, lastPrice: 11,
        bidIv: 0.5, askIv: 0.52, markIv: 0.51, feedIv: 0.51, midIv: null, bidIvDerived: null, askIvDerived: null, modelIv: null,
        indexPrice: 65000, openInterest: 10, volume: 1, volumeUsd: 100, funding8h: null, timestamp: now, hasQuote: true, isStale: false,
      });
    }
  }
  return {
    currency, indexPrice: 65000, instruments: list as never, coverage: 1, funding8h: null, fetchedAt: now, source: 'deribit' as const,
  };
}
function renderWith(value: CryptoAssetContextValue) {
  return render(React.createElement(CryptoAssetContext.Provider, { value }, React.createElement(CryptoVolatilityView)));
}
beforeEach(() => { fetchDeribitMarket.mockReset(); throwOnRender = false; window.history.pushState({}, '', '/?desk=crypto&view=volatility&asset=BTC&venue=deribit'); });

describe('crypto volatility expiry scope', () => {
  it('excludes expired and exactly-expiring contracts from active analytics', () => {
    const now = Date.UTC(2026, 8, 1);
    expect(activeExpiryMs(now - 1, now)).toBe(false);
    expect(activeExpiryMs(now, now)).toBe(false);
    expect(activeExpiryMs(now + 1, now)).toBe(true);
  });
});

describe('crypto 3d gate', () => {
  it('renders Open 3D collapsed and no canvas before activation', async () => {
    fetchDeribitMarket.mockResolvedValue(bundleFor('BTC'));
    renderWith(ctx({ rawAsset: 'BTC', validatedAsset: 'BTC', isUnsupported: false }));
    await waitFor(() => expect(screen.getByTestId('open-3d-crypto-surface')).toBeInTheDocument());
    expect(screen.getByTestId('open-3d-crypto-surface')).toHaveTextContent('Open 3D');
    expect(screen.queryByTestId('iv-surface-3d')).not.toBeInTheDocument();
    expect(screen.queryByTestId('crypto-3d-container')).not.toBeInTheDocument();
  });
  it('click Open 3D lazy-loads surface and Close removes it', async () => {
    fetchDeribitMarket.mockResolvedValue(bundleFor('BTC'));
    renderWith(ctx({ rawAsset: 'BTC', validatedAsset: 'BTC', isUnsupported: false }));
    await waitFor(() => expect(screen.getByTestId('open-3d-crypto-surface')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('open-3d-crypto-surface'));
    await waitFor(() => expect(screen.getByTestId('iv-surface-3d')).toBeInTheDocument());
    expect(screen.getByTestId('open-3d-crypto-surface')).toHaveTextContent('Close 3D');
    fireEvent.click(screen.getByTestId('open-3d-crypto-surface'));
    expect(screen.queryByTestId('iv-surface-3d')).not.toBeInTheDocument();
  });
  it('insufficient surface shows unavailable fallback not blank', async () => {
    fetchDeribitMarket.mockResolvedValue(bundleFor('BTC', { expiries: 1 }));
    renderWith(ctx({ rawAsset: 'BTC', validatedAsset: 'BTC', isUnsupported: false }));
    await waitFor(() => expect(screen.getByTestId('open-3d-crypto-surface')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('open-3d-crypto-surface'));
    await waitFor(() => expect(screen.getByTestId('crypto-3d-unavailable')).toBeInTheDocument());
    expect(screen.queryByTestId('iv-surface-3d')).not.toBeInTheDocument();
  });
  it('unsupported asset never shows 3D entry', async () => {
    renderWith(ctx({ rawAsset: 'SOL', validatedAsset: null, isUnsupported: true }));
    expect(await screen.findByTestId('vol-unsupported')).toBeInTheDocument();
    expect(screen.queryByTestId('open-3d-crypto-surface')).not.toBeInTheDocument();
  });
  it('WebGL/render throw shows accessible fallback table and never blanks', async () => {
    throwOnRender = true;
    fetchDeribitMarket.mockResolvedValue(bundleFor('BTC'));
    renderWith(ctx({ rawAsset: 'BTC', validatedAsset: 'BTC', isUnsupported: false }));
    await waitFor(() => expect(screen.getByTestId('open-3d-crypto-surface')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('open-3d-crypto-surface'));
    await waitFor(() => expect(screen.getByTestId('crypto-3d-error-fallback')).toBeInTheDocument());
    expect(screen.getByLabelText('Observed IV fallback table')).toBeInTheDocument();
    expect(screen.queryByTestId('iv-surface-3d')).not.toBeInTheDocument();
    // still shows volatility workstation shell, not blank
    expect(screen.getByTestId('volatility-workstation')).toBeInTheDocument();
  });
});
