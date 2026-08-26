import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TerminalHeader } from './TerminalHeader';
import { useTerminalStore } from '../../store/terminalStore';
import { EMPTY_PROVENANCE } from '../../lib/data/freshness';

describe('TerminalHeader', () => {
  it('renders compact LIVE mode label and data freshness (demo disabled)', () => {
    useTerminalStore.setState({
      symbol: 'SPY',
      source: 'live',
      loading: false,
      fmpQuote: null,
      liveRFR: null,
      snapshot: null,
      chainAvailable: false,
      chainUsed: 'none',
      spotSource: 'none',
      lastSpotUpdate: 0,
      lastChainUpdate: 0,
      provenance: { ...EMPTY_PROVENANCE },
    });
    render(<TerminalHeader />);
    expect(screen.getByText('SPY')).toBeTruthy();
    const modeChip = screen.getByLabelText(
      'LIVE-only terminal — market feeds only; no demo mode.',
    );
    expect(modeChip).toBeTruthy();
    expect(modeChip.textContent).toMatch(/LIVE/);
    // Product mode is muted — not an up/green freshness pill
    expect(modeChip.className).toMatch(/text-muted-foreground/);
    expect(modeChip.className).not.toMatch(/text-up|bg-up/);
    // Missing feeds → down (fail-closed); chip label is API DOWN
    expect(screen.getByLabelText('Data freshness: down')).toBeTruthy();
    expect(screen.getAllByText('API DOWN').length).toBeGreaterThan(0);
    // Rich title on the data chip itself (not swallowed by nested default title)
    expect(screen.getByTitle(/Spot: down · Chain: down/)).toBeTruthy();
    // No DEMO
    expect(screen.queryByText('DEMO')).toBeNull();
  });

  it('data summary is worst of live spot + missing chain (never greener than StatusBar)', () => {
    const now = Date.now();
    useTerminalStore.setState({
      symbol: 'SPY',
      source: 'live',
      loading: false,
      fmpQuote: null,
      liveRFR: null,
      snapshot: null,
      chainAvailable: false,
      chainUsed: 'none',
      spotSource: 'fmp',
      lastSpotUpdate: now,
      lastChainUpdate: 0,
      provenance: {
        ...EMPTY_PROVENANCE,
        spot: {
          domain: 'spot',
          source: 'fmp',
          asOfMs: now,
          fetchedAtMs: now,
          kind: 'live',
        },
      },
    });
    render(<TerminalHeader />);
    expect(
      screen.getByLabelText('LIVE-only terminal — market feeds only; no demo mode.'),
    ).toBeTruthy();
    // chain missing → down; worst(live, down) = down
    expect(screen.getByLabelText('Data freshness: down')).toBeTruthy();
  });

  it('calls onOpenShortcuts when keyboard button is clicked', () => {
    useTerminalStore.setState({
      symbol: 'SPY',
      source: 'live',
      loading: false,
      fmpQuote: null,
      liveRFR: null,
      snapshot: null,
      chainAvailable: false,
      chainUsed: 'none',
      spotSource: 'none',
      lastSpotUpdate: 0,
      lastChainUpdate: 0,
      provenance: { ...EMPTY_PROVENANCE },
    });
    const onOpenShortcuts = vi.fn();
    render(<TerminalHeader onOpenShortcuts={onOpenShortcuts} />);
    fireEvent.click(screen.getByTitle('Shortcuts (?)'));
    expect(onOpenShortcuts).toHaveBeenCalledTimes(1);
  });

  it('shows FMP spot in compact header (company name omitted for space)', () => {
    useTerminalStore.setState({
      symbol: 'SPY',
      source: 'live',
      loading: false,
      fmpQuote: {
        symbol: 'SPY', name: 'State Street SPDR S&P 500 ETF', price: 500,
        changePercentage: 0, change: 0, dayLow: 0, dayHigh: 0,
        yearHigh: 0, yearLow: 0, volume: 0, marketCap: 0,
        priceAvg50: 0, priceAvg200: 0, exchange: 'AMEX',
        open: 0, previousClose: 0, timestamp: Date.now(),
      },
      liveRFR: null,
      snapshot: null,
      chainAvailable: false,
      chainUsed: 'none',
      spotSource: 'none',
      lastSpotUpdate: 0,
      lastChainUpdate: 0,
      provenance: { ...EMPTY_PROVENANCE },
    });
    render(<TerminalHeader />);
    expect(screen.getByText('500.00')).toBeTruthy();
    expect(screen.queryByText('State Street SPDR S&P 500 ETF')).toBeNull();
  });

  it('shows compact live RFR when available (lg+)', () => {
    useTerminalStore.setState({
      symbol: 'SPY',
      source: 'live',
      loading: false,
      fmpQuote: null,
      liveRFR: 0.0398,
      snapshot: null,
      chainAvailable: false,
      chainUsed: 'none',
      spotSource: 'none',
      lastSpotUpdate: 0,
      lastChainUpdate: 0,
      provenance: { ...EMPTY_PROVENANCE },
    });
    const { container } = render(<TerminalHeader />);
    // Top-bar RFR from former StatusBar (fmtPct)
    expect(container.textContent).toMatch(/RFR:3\.98%/);
  });

  it('shows BBG-style world clocks (NY · LDN · TYO)', () => {
    useTerminalStore.setState({
      symbol: 'SPY',
      source: 'live',
      loading: false,
      fmpQuote: null,
      liveRFR: null,
      snapshot: null,
      chainAvailable: false,
      chainUsed: 'none',
      spotSource: 'none',
      lastSpotUpdate: 0,
      lastChainUpdate: 0,
      provenance: { ...EMPTY_PROVENANCE },
    });
    const { container } = render(<TerminalHeader />);
    const clocks = container.querySelector('span[title*="Desk clocks"]');
    expect(clocks).toBeTruthy();
    // Each zone renders a HH:MM time in its timezone
    expect(clocks!.textContent).toMatch(/NY \d{2}:\d{2}/);
    expect(clocks!.textContent).toMatch(/LDN \d{2}:\d{2}/);
    expect(clocks!.textContent).toMatch(/TYO \d{2}:\d{2}/);
  });
});
