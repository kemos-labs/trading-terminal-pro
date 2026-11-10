import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { PositioningView } from './PositioningView';
import { useTerminalStore } from '../../store/terminalStore';
import { buildSnapshot } from '../../lib/options/synthetic';
import { recordGexSession } from '../../lib/options/gexSession';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  const ReactMod = await import('react');
  return {
    ...actual,
    ResponsiveContainer: ({ height }: { height?: number | string }) =>
      ReactMod.createElement('div', {
        'data-testid': 'recharts-viewport-mock',
        style: { width: 800, height: typeof height === 'number' ? height : 400 },
      }),
  };
});

function seedStore(snapshotTs: number) {
  useTerminalStore.setState({
    symbol: 'SPY',
    snapshot: buildSnapshot('SPY', snapshotTs, 500, 0, 0),
    surface: null,
    sviReadout: null,
    arbResult: null,
    historicalFrames: [],
    frameIndex: 0,
    isPlaying: false,
    speed: 1,
    source: 'live',
    liveAvailable: false,
    loading: false,
    lastUpdate: snapshotTs,
    activeTab: 'positioning',
    deskSectionId: 'pos-sub-chain',
    displayMode: 'strike',
    selectedExpiry: null,
    playbackInterval: null,
    refreshInterval: null,
    chainAvailable: true,
    chainUsed: 'yfinance',
    spotSource: 'yfinance',
    historyMode: 'live',
    fmpHistory: null,
    historySource: 'none',
  } as Partial<ReturnType<typeof useTerminalStore.getState>> as never);
}

/** Two observed-style samples: 3 GEX strikes (one hole at second sample, one true zero). */
function seedSession() {
  recordGexSession('SPY', 505, 1e8, 500, {
    minGapMs: 0,
    profile: [
      { k: 500, g: 1e7 },
      { k: 505, g: 0 },
      { k: 510, g: -2e7 },
    ],
    charmProfile: [
      { k: 500, g: 1e5 },
      { k: 505, g: 2e5 },
    ],
  });
  recordGexSession('SPY', 506, 1.2e8, 501, {
    minGapMs: 0,
    profile: [
      { k: 500, g: 1.1e7 },
      { k: 510, g: -2.1e7 },
    ],
    charmProfile: [
      { k: 500, g: 1.1e5 },
      { k: 505, g: 2.1e5 },
    ],
  });
}

function section() {
  return screen.getByTestId('session-gex-section');
}

describe('PositioningView — Session GEX (P8-FLOW-GEX-01)', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    seedStore(Date.now());
  });

  afterEach(() => {
    cleanup();
  });

  it('empty session renders honest empty copy, never a mocked heat', () => {
    render(<PositioningView />);
    const s = section();
    expect(within(s).getByText(/No session history — collect at least 2 samples/)).toBeTruthy();
    expect(within(s).queryByTestId('session-gex-heat')).toBeNull();
    expect(s.textContent).toContain('not observed dealer inventory');
  });

  it('two samples render heat, profiles, count badge and strike×time table', () => {
    seedSession();
    render(<PositioningView />);
    const s = section();
    expect(within(s).getByTestId('session-gex-heat')).toBeTruthy();
    expect(within(s).getByTestId('session-gex-profiles')).toBeTruthy();
    expect(within(s).getByTestId('session-gex-count').textContent).toMatch(/Session 2 samples/);
    const table = within(s).getByTestId('session-gex-table');
    expect(table.getAttribute('role')).toBe('table');
    // 3 GEX strikes → 3 body rows, 2 sample columns + row header each
    expect(within(table).getAllByRole('row').length).toBe(1 + 3);
    expect(table.textContent).toContain('500');
  });

  it('metric switch GEX→Charm re-derives the table; DEX stays honestly unsupported', () => {
    seedSession();
    render(<PositioningView />);
    const s = section();
    fireEvent.click(within(s).getByRole('tab', { name: 'Charm' }));
    const charmTable = within(section()).getByTestId('session-gex-table');
    expect(within(charmTable).getAllByRole('row').length).toBe(1 + 2);
    fireEvent.click(within(section()).getByRole('tab', { name: 'DEX' }));
    expect(within(section()).getByText(/No stored DEX profile this session/)).toBeTruthy();
    expect(within(section()).queryByTestId('session-gex-heat')).toBeNull();
  });

  it('missing cells render — while observed zero stays a valid value', () => {
    seedSession();
    render(<PositioningView />);
    const table = within(section()).getByTestId('session-gex-table');
    const cells = within(table).getAllByRole('cell');
    const texts = cells.map((c) => c.textContent);
    // strike 505 absent at second sample → hole
    expect(texts).toContain('—');
    // observed zero at first sample is valid, not a hole
    expect(texts).toContain('0.00');
  });

  it('stale snapshot (97h) shows Stale; fresh shows Live', () => {
    seedSession();
    seedStore(Date.now() - 97 * 3600_000);
    render(<PositioningView />);
    expect(within(section()).getByText('Stale')).toBeTruthy();
    cleanup();
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    seedSession();
    seedStore(Date.now());
    render(<PositioningView />);
    expect(within(section()).getByText('Live')).toBeTruthy();
  });

  it('j/k moves focused strike, Enter pins — table highlights the focused row', () => {
    seedSession();
    render(<PositioningView />);
    const s = section();
    const focus = within(s).getByTestId('session-gex-focus');
    expect(focus.textContent).toContain('focused strike 500');
    fireEvent.keyDown(s, { key: 'j' });
    expect(within(section()).getByTestId('session-gex-focus').textContent).toContain('focused strike 505');
    fireEvent.keyDown(section(), { key: 'Enter' });
    expect(within(section()).getByTestId('session-gex-focus').textContent).toContain('strike 505');
    fireEvent.keyDown(section(), { key: 'k' });
    expect(within(section()).getByTestId('session-gex-focus').textContent).toContain('focused strike 500');
  });

  it('DEX/VEX unsupported copy uses derived OI proxy language, never observed OI-weighted', () => {
    seedSession();
    render(<PositioningView />);
    const s = section();
    fireEvent.click(within(s).getByRole('tab', { name: 'DEX' }));
    const dexSection = section();
    expect(within(dexSection).getByText(/No stored DEX profile this session/)).toBeTruthy();
    const dexText = dexSection.textContent ?? '';
    expect(dexText).toMatch(/derived from OI, model dealer convention/);
    expect(dexText).not.toMatch(/observed OI-weighted/i);
    fireEvent.click(within(dexSection).getByRole('tab', { name: 'VEX' }));
    const vexSection = section();
    expect(within(vexSection).getByText(/No stored VEX profile this session/)).toBeTruthy();
    expect((vexSection.textContent ?? '')).toMatch(/derived from OI, model dealer convention/);
    expect((vexSection.textContent ?? '')).not.toMatch(/observed OI-weighted/i);
  });

  it('visible session copy never claims observed OI-weighted exposure (regression for mislabel)', () => {
    seedSession();
    render(<PositioningView />);
    const s = section();
    // Header and any visible copy must not contain the mislabel
    expect((s.textContent ?? '')).not.toMatch(/observed OI-weighted/i);
    // Proxy disclaimer must remain: derived/ OI proxy, not observed inventory
    expect((s.textContent ?? '').toLowerCase()).toContain('not observed dealer inventory');
  });
});
