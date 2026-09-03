/**
 * Section registry ids must remain the single source of truth for desk sections
 * so jumpDeskSection / red function bar / deep-links all drive one store value.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import {
  buildSnapshot,
  buildSurfaceGrid,
} from '../../lib/options/synthetic';
import { sviReadout } from '../../lib/options/surfaceTools';
import { diagnoseArbitrage } from '../../lib/options/noarb';
import {
  VOL_SECTIONS,
  GREEKS_SECTIONS,
  POSITIONING_SECTIONS,
  RATES_SECTIONS,
  jumpDeskSection,
  sectionsForTab,
} from '../../config/deskNav';
import { VolStructureView } from './VolStructureView';
import { GreeksView } from './GreeksView';
import { PositioningView } from './PositioningView';
import { RatesView } from './RatesView';
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
(globalThis as unknown as { IntersectionObserver: typeof IntersectionObserverStub }).IntersectionObserver =
  IntersectionObserverStub as unknown as typeof IntersectionObserver;

// jsdom has no layout engine, so recharts' ResponsiveContainer always measures
// 0x0 and warns. Render a fixed-size empty frame instead: charts stay
// unrendered in jsdom exactly as today (real chart rendering is asserted by
// Playwright geometry checks), without the environmental warning.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  const React = await import('react');
  return {
    ...actual,
    ResponsiveContainer: ({ height }: { height?: number | string }) =>
      React.createElement('div', {
        'data-testid': 'recharts-viewport-mock',
        style: { width: 800, height: typeof height === 'number' ? height : 400 },
      }),
  };
});

function seedSnapshot(tab: 'vol' | 'desk' | 'positioning' | 'rates' = 'vol') {
  const snapshot = buildSnapshot('SPY', Date.now(), 100, 0, 0);
  const surface = buildSurfaceGrid(snapshot);
  useTerminalStore.setState({
    symbol: 'SPY',
    snapshot,
    surface,
    sviReadout: sviReadout(surface, snapshot.spot),
    arbResult: diagnoseArbitrage(surface, snapshot.spot),
    historicalFrames: [],
    frameIndex: 0,
    isPlaying: false,
    speed: 1,
    source: 'demo',
    liveAvailable: false,
    loading: false,
    lastUpdate: Date.now(),
    activeTab: tab,
    displayMode: 'strike',
    selectedExpiry: null,
    playbackInterval: null,
    refreshInterval: null,
    chainAvailable: true,
    chainUsed: 'yfinance',
    lastChainUpdate: Date.now(),
  });
}

describe('desk section ids are store-driven (no duplicate in-view bars)', () => {
  beforeEach(() => {
    seedSnapshot();
    Element.prototype.scrollIntoView = () => {};
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('VolStructureView renders with VOL_SECTIONS in registry; active from store', () => {
    useTerminalStore.setState({ activeTab: 'vol', deskSectionId: 'vol-sub-surface' });
    render(<VolStructureView />);
    for (const s of VOL_SECTIONS) {
      expect(sectionsForTab('vol').some((x) => x.id === s.id)).toBe(true);
    }
    expect(useTerminalStore.getState().deskSectionId).toBe('vol-sub-surface');
  });

  it('Vol · Greeks registry hosts full Greeks desk', () => {
    useTerminalStore.setState({ activeTab: 'vol', deskSectionId: 'vol-sub-greeks' });
    render(<GreeksView />);
    expect(GREEKS_SECTIONS.map((s) => s.id)).toEqual(['vol-sub-greeks']);
    for (const s of GREEKS_SECTIONS) {
      expect(sectionsForTab('vol').some((x) => x.id === s.id)).toBe(true);
    }
    expect(useTerminalStore.getState().deskSectionId).toBe('vol-sub-greeks');
  });

  it('PositioningView registry + store section (Book default)', () => {
    useTerminalStore.setState({ activeTab: 'positioning', deskSectionId: 'pos-sub-chain' });
    render(<PositioningView />);
    for (const s of POSITIONING_SECTIONS) {
      expect(sectionsForTab('positioning').some((x) => x.id === s.id)).toBe(true);
    }
    expect(POSITIONING_SECTIONS.map((s) => s.id)).toEqual(['pos-sub-chain', 'pos-sub-tools']);
    expect(useTerminalStore.getState().deskSectionId).toBe('pos-sub-chain');
  });

  it('RatesView modes in registry; no DeskSubNav / chrome duplicate bar', async () => {
    useTerminalStore.setState({ activeTab: 'rates', deskSectionId: 'rates-mode-funding' });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    render(<RatesView />);
    // Drain rejected-fetch resolutions inside act so panel setStates never land after the test.
    await act(async () => {});
    // Funding mode mounts macro
    expect(document.getElementById('sec-macro')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(RATES_SECTIONS.length).toBe(4);
    expect(RATES_SECTIONS.length).toBe(sectionsForTab('rates').length);
    // Red bar owns modes — no in-view RATES chrome strip
    expect(document.querySelector('[data-desk-chrome]')).toBeNull();
  });

  it('jumpDeskSection sets store section (vol)', () => {
    useTerminalStore.setState({ activeTab: 'vol', deskSectionId: 'vol-sub-surface' });
    render(<VolStructureView />);
    let next: string | null = null;
    act(() => {
      next = jumpDeskSection('vol', 1);
    });
    expect(next).toBe('vol-sub-smile');
    expect(useTerminalStore.getState().deskSectionId).toBe('vol-sub-smile');
  });

  it('setDeskSection clears when id not in current tab registry', () => {
    useTerminalStore.setState({ activeTab: 'vol', deskSectionId: 'vol-sub-surface' });
    act(() => {
      useTerminalStore.getState().setDeskSection('sec-macro');
    });
    expect(useTerminalStore.getState().deskSectionId).toBeNull();
  });

  it('Vol · Greeks stays on vol-sub-greeks; legacy desk-ws-analyze remaps to Vol', async () => {
    useTerminalStore.setState({ activeTab: 'vol', deskSectionId: 'vol-sub-surface' });
    render(<VolStructureView />);
    await act(async () => {
      useTerminalStore.getState().setDeskSection('vol-sub-greeks');
    });
    expect(useTerminalStore.getState().activeTab).toBe('vol');
    expect(useTerminalStore.getState().deskSectionId).toBe('vol-sub-greeks');

    await act(async () => {
      useTerminalStore.getState().setDeskSection('desk-ws-analyze');
    });
    expect(useTerminalStore.getState().activeTab).toBe('vol');
    expect(useTerminalStore.getState().deskSectionId).toBe('vol-sub-greeks');
  });
});

