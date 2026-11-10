import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CryptoOverviewView } from './CryptoOverviewView';
import type { FreeCryptoMarket } from '../../../api/freeCrypto';
import type { DeribitMarketBundle } from '../../../api/deribit';

const deribit = vi.fn();
const free = vi.fn();
vi.mock('../../../api/deribit', () => ({ fetchDeribitMarket: (...args: unknown[]) => deribit(...args) }));
vi.mock('../../../api/freeCrypto', () => ({ fetchFreeCryptoMarket: (...args: unknown[]) => free(...args) }));

const bundle = { currency: 'BTC', indexPrice: 100, instruments: [], coverage: 1, funding8h: 0.001, fetchedAt: Date.now(), source: 'deribit' } as DeribitMarketBundle;
const market = (venues: string[]) => ({ currency: 'BTC', symbol: 'BTCUSDT', venues: venues.map(venue => ({ venue, symbol: 'BTCUSDT', mark: 100, index: 100, last: 100, funding8h: 0, openInterest: 1, volume24hUsd: 1, change24hPct: 0, fetchedAt: Date.now() })), fetchedAt: Date.now(), source: 'free-exchanges', note: 'Public exchange data; free alternative to Velo, not Velo-normalized.' }) as FreeCryptoMarket;

beforeEach(() => { deribit.mockReset(); free.mockReset(); });

describe('CryptoOverviewView provider states', () => {
  it('shows loading instead of unavailable initially', () => {
    deribit.mockReturnValue(new Promise(() => {})); free.mockReturnValue(new Promise(() => {}));
    render(<CryptoOverviewView />); expect(screen.getByTestId('deribit-loading')).toBeInTheDocument(); expect(screen.queryByText('Deribit unavailable')).not.toBeInTheDocument();
  });
  it('renders both providers successfully', async () => {
    deribit.mockResolvedValue(bundle); free.mockResolvedValue(market(['Binance Futures', 'Bybit Linear'])); render(<CryptoOverviewView />);
    await waitFor(() => expect(screen.getByText('Binance + Bybit')).toBeInTheDocument()); expect(screen.getByText('Free multi-venue snapshot')).toBeInTheDocument();
  });
  it('keeps free data visible when Deribit fails', async () => {
    deribit.mockRejectedValue(new Error('offline')); free.mockResolvedValue(market(['Binance Futures', 'Bybit Linear'])); render(<CryptoOverviewView />);
    await waitFor(() => expect(screen.getByText('Deribit unavailable')).toBeInTheDocument()); expect(screen.getByTestId('free-market-snapshot')).toBeInTheDocument();
  });
  it('keeps Deribit visible when free provider fails', async () => {
    deribit.mockResolvedValue(bundle); free.mockRejectedValue(new Error('offline')); render(<CryptoOverviewView />);
    await waitFor(() => expect(screen.getByTestId('free-market-unavailable')).toBeInTheDocument()); expect(screen.getByText('Regime Strip')).toBeInTheDocument();
  });
  it.each(['Binance Futures', 'Bybit Linear'])('labels a one-venue %s response Partial', async (venue) => {
    deribit.mockReturnValue(new Promise(() => {})); free.mockResolvedValue(market([venue])); render(<CryptoOverviewView />);
    await waitFor(() => expect(screen.getByText('Partial')).toBeInTheDocument()); expect(screen.getAllByText(venue).length).toBeGreaterThan(0); expect(screen.queryByText('Binance + Bybit')).not.toBeInTheDocument();
  });
  it('recomposes expiry depth and top-OI panels from the fetched bundle only', async () => {
    const now = Date.now();
    const instruments = [30, 60].flatMap((dte, e) => [59000, 60000, 61000].flatMap((strike, s) => (['call', 'put'] as const).map((right, r) => ({
      instrument: `BTC-01${e === 0 ? 'JAN' : 'FEB'}26-${strike}-${right === 'call' ? 'C' : 'P'}`,
      kind: 'option', strike, expiryMs: now + dte * 86_400_000,
      mark_price: 0.05, openInterest: 100 + e * 50 + s * 10 + r, hasQuote: true,
    }))));
    deribit.mockResolvedValue({ ...bundle, instruments });
    free.mockResolvedValue(market(['Binance Futures', 'Bybit Linear']));
    render(<CryptoOverviewView />);
    await waitFor(() => expect(screen.getByTestId('overview-expiries')).toBeInTheDocument());
    expect(screen.getByTestId('overview-top-oi')).toBeInTheDocument();
    // 12 options per expiry across 2 expiries, all from the same bundle fetch.
    expect(deribit).toHaveBeenCalledTimes(1);
    // Rows render canonical instrument names (contract field `instrument`).
    expect(screen.getByTestId('overview-top-oi').textContent).toMatch(/BTC-01FEB26-61000-P/);
    // Required labels survive recomposition.
    expect(screen.getByText('Free multi-venue snapshot')).toBeInTheDocument();
    expect(screen.getByText('Public exchange data; free alternative to Velo, not Velo-normalized.')).toBeInTheDocument();
  });
  it('shows honest unavailable states instead of zero-filled panels when the bundle is empty', async () => {
    deribit.mockResolvedValue(bundle);
    free.mockResolvedValue(market(['Binance Futures', 'Bybit Linear']));
    render(<CryptoOverviewView />);
    await waitFor(() => expect(screen.getByTestId('overview-expiries')).toBeInTheDocument());
    expect(screen.getByText(/No dated expiries listed/)).toBeInTheDocument();
    expect(screen.getByText(/No reported OI — unavailable, not zero/)).toBeInTheDocument();
  });
  it('retains the required Velo alternative labels', async () => {
    deribit.mockReturnValue(new Promise(() => {})); free.mockResolvedValue(market(['Binance Futures'])); render(<CryptoOverviewView />);
    await waitFor(() => expect(screen.getByText('Public exchange data; free alternative to Velo, not Velo-normalized.')).toBeInTheDocument());
  });
  it('uses a flex column + auto-rows-fr grid so the 2x2 cards stretch and avoid ~50% dead space (desktop-crypto-v2-overview)', async () => {
    const fs = await import('node:fs');
    const p = await import('node:path');
    const text = fs.readFileSync(p.join(import.meta.dirname, 'CryptoOverviewView.tsx'), 'utf8');
    expect(text).toMatch(/flex.*flex-col/);
    expect(text).toContain('flex-1');
    expect(text).toContain('auto-rows-fr');
    // Cards must stretch inside the grid
    expect(text).toContain('flex flex-col rounded border p-3');
    deribit.mockResolvedValue(bundle); free.mockResolvedValue(market(['Binance Futures', 'Bybit Linear']));
    render(<CryptoOverviewView />);
    await waitFor(() => expect(screen.getByTestId('overview-workstation')).toBeInTheDocument());
    const ws = screen.getByTestId('overview-workstation');
    expect(ws.className).toContain('flex');
    expect(ws.className).toContain('flex-col');
    expect(ws.className).toContain('lg:min-h-[640px]');
    expect(ws.className).toContain('xl:min-h-[660px]');
  });
});
