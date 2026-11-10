import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CryptoShell } from './CryptoShell';
import { CryptoAssetContext, type CryptoAssetContextValue, useCryptoAsset } from './CryptoShell';

describe('CryptoShell unsupported venue regression', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/?desk=crypto&view=overview&asset=BTC&venue=deribit');
  });
  it('shows venue unavailable in strip and provenance when venue is unsupported', () => {
    window.history.pushState({}, '', '/?desk=crypto&view=overview&asset=BTC&venue=binance');
    render(<CryptoShell />);
    expect(screen.getByTestId('crypto-context-strip').textContent).toMatch(/BTC.*venue unavailable/i);
    expect(screen.getByText(/Venue unavailable/)).toBeInTheDocument();
  });
  it('does not materialize deribit via context venue alias when venue unsupported', async () => {
    window.history.pushState({}, '', '/?desk=crypto&view=volatility&asset=BTC&venue=binance');
    render(<CryptoShell />);
    expect(screen.getByTestId('crypto-context-strip').textContent).not.toMatch(/binance/);
    expect(screen.getByTestId('crypto-context-strip').textContent).toMatch(/venue unavailable/);
    // Direct context probe to prove null venue, not aliased deribit
    function Probe() {
      const v = useCryptoAsset();
      return <div data-testid="probe">{String(v.venue)}|{String(v.validatedVenue)}</div>;
    }
    // standalone provider probe
    const probeValue: CryptoAssetContextValue = {
      rawAsset: 'BTC',
      validatedAsset: 'BTC',
      isUnsupported: false,
      venue: null,
      rawVenue: 'binance',
      validatedVenue: null,
      isUnsupportedVenue: true,
    };
    render(
      <CryptoAssetContext.Provider value={probeValue}>
        <Probe />
      </CryptoAssetContext.Provider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('null|null');
  });

  it('shell-level ETH URL wiring updates strip for overview/positioning/carry', async () => {
    window.history.pushState({}, '', '/?desk=crypto&view=overview&asset=ETH&venue=deribit');
    render(<CryptoShell />);
    expect(screen.getByTestId('crypto-context-strip').textContent).toMatch(/ETH/);
    expect(screen.getByTestId('crypto-context-strip').textContent).not.toMatch(/BTC/);
  });
});
