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
  it('retains the required Velo alternative labels', async () => {
    deribit.mockReturnValue(new Promise(() => {})); free.mockResolvedValue(market(['Binance Futures'])); render(<CryptoOverviewView />);
    await waitFor(() => expect(screen.getByText('Public exchange data; free alternative to Velo, not Velo-normalized.')).toBeInTheDocument());
  });
});
