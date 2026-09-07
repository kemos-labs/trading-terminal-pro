/**
 * Regression: global terminal shell must stay mounted on Crypto workflows.
 *
 * Guards like `{activeTab !== 'crypto' && <TerminalHeader/>}` trap users in a
 * nested Crypto shell with no desk navigation, account controls, or build
 * identity. These tests render the real TerminalLayout with the crypto tab
 * active and assert on rendered landmarks/controls — not on source text.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TerminalLayout } from './TerminalLayout';
import { useTerminalStore } from '../../store/terminalStore';
import { EMPTY_PROVENANCE } from '../../lib/data/freshness';
import { TABS } from '../terminal/tabs';

function seedCryptoTab() {
  window.history.pushState({}, '', '/?desk=crypto&view=overview&asset=BTC&venue=deribit');
  try {
    sessionStorage.setItem('boot.seen', '1');
  } catch {
    /* ignore */
  }
  useTerminalStore.setState({
    activeTab: 'crypto',
    symbol: 'BTC',
    source: 'live',
    loading: false,
    snapshot: null,
    chainAvailable: false,
    chainAttempted: true,
    spotAttempted: true,
    chainUsed: 'none',
    spotSource: 'none',
    lastSpotUpdate: 0,
    lastChainUpdate: 0,
    fmpQuote: null,
    liveRFR: null,
    provenance: { ...EMPTY_PROVENANCE },
    deskSectionId: null,
    historicalFrames: [],
  });
}

describe('TerminalLayout on crypto', () => {
  beforeEach(() => {
    seedCryptoTab();
  });

  it('keeps the global header and function menu mounted', async () => {
    render(<TerminalLayout />);
    // Global top chrome (symbol/account/session/build identity).
    expect(screen.getByRole('banner')).toBeInTheDocument();
    // Global desk navigation + command surface.
    expect(
      screen.getByRole('toolbar', { name: 'Main desks and sections' }),
    ).toBeInTheDocument();
    // Function area still hosts the crypto desk (async lazy shell).
    expect(await screen.findByTestId('crypto-v2-shell')).toBeInTheDocument();
  });

  it('exposes exactly one banner landmark (no duplicate crypto banner)', async () => {
    render(<TerminalLayout />);
    await screen.findByTestId('crypto-v2-shell');
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    // Crypto asset/venue context is preserved as a labelled region instead.
    expect(
      screen.getByRole('region', { name: 'Crypto market context' }),
    ).toBeInTheDocument();
  });

  it('keeps all six crypto workflow controls reachable beside global chrome', async () => {
    render(<TerminalLayout />);
    await screen.findByTestId('crypto-v2-shell');
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(screen.getByRole('tab', { name: /Overview/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Trade & Risk/ })).toBeInTheDocument();
    // Global chrome did not displace the workflow panel.
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  });

  it('Home desk control exits crypto back to the launchpad', async () => {
    render(<TerminalLayout />);
    await screen.findByTestId('crypto-v2-shell');
    const home = TABS.find((t) => t.id === 'home')!;
    fireEvent.click(screen.getByTitle(`${home.label} (${home.hotkey})`));
    expect(useTerminalStore.getState().activeTab).toBe('home');
    await waitFor(() => {
      expect(screen.getByRole('main')).toHaveAttribute('aria-label', 'Home launchpad');
    });
  });
});
