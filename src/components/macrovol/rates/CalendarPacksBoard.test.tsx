import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { CalendarPacksBoard } from './CalendarPacksBoard';
import type { StirStripData } from '../../../lib/macrovol/api';

class ResizeObserverStub {
  cb: unknown;
  constructor(cb: unknown) {
    this.cb = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-ignore
globalThis.ResizeObserver = ResizeObserverStub;
// @ts-ignore
global.ResizeObserver = ResizeObserverStub;

function makeStir(spreads: StirStripData['spreads']['spreads']): StirStripData {
  return {
    sr3: [],
    zq: [],
    live_count: 0,
    total_sr3: 0,
    spreads: { spreads, note: 'test' },
  } as unknown as StirStripData;
}

const noop = () => {};

describe('CalendarPacksBoard SERFF title truth (REF10)', () => {
  it('labels the listed SERFF section SR1 − ZQ 1:1 with no SOFR FUT − EFFR / synth wording', () => {
    const stir = makeStir([
      {
        name: 'SERFFZ6',
        kind: 'serff',
        legs: ['SR1Z6', 'ZQZ6'],
        ratio: '1:1',
        rate_bps: 13.0,
        price_spread: -0.13,
        imply: null,
      },
    ]);
    const { container } = render(<CalendarPacksBoard stir={stir} onOpenImply={noop} />);
    const text = container.textContent ?? '';
    // Authoritative listed-SERFF wording present.
    expect(text).toMatch(/SR1 − ZQ/);
    expect(text).toMatch(/same delivery month/);
    expect(text).toMatch(/1:1/);
    // Stale cash-EFFR / synth wording absent everywhere in the board.
    expect(text).not.toMatch(/SOFR FUT/);
    expect(text).not.toMatch(/EFFR/);
    expect(text).not.toMatch(/synth when ZQ offline/i);
    expect(text).not.toMatch(/SYNTH/i);
    // Listed row exposes its exact legs.
    expect(text).toMatch(/SR1Z6/);
    expect(text).toMatch(/ZQZ6/);
    expect(screen.getByText('SERFFZ6')).toBeTruthy();
  });

  it('keeps a null exact-leg row Unavailable (never zero) without a synth badge', () => {
    const stir = makeStir([
      {
        name: 'SERFFZ6',
        kind: 'serff',
        legs: ['SR1Z6', 'ZQZ6'],
        ratio: '1:1',
        rate_bps: null,
        price_spread: null,
        note: 'SERFFZ6 Unavailable — missing exact leg(s): ZQZ6. No proxy substitution.',
        imply: null,
      },
    ]);
    const { container } = render(<CalendarPacksBoard stir={stir} onOpenImply={noop} />);
    const text = container.textContent ?? '';
    expect(text).toMatch(/Unavailable/);
    expect(text).toMatch(/—/);
    expect(text).not.toMatch(/\+0\.0/);
    expect(text).not.toMatch(/SYNTH/i);
    expect(text).not.toMatch(/NaN|Infinity/);
  });

  it('preserves a valid zero spread as +0.0', () => {
    const stir = makeStir([
      {
        name: 'SERFFZ6',
        kind: 'serff',
        legs: ['SR1Z6', 'ZQZ6'],
        ratio: '1:1',
        rate_bps: 0,
        price_spread: 0,
        imply: null,
      },
    ]);
    const { container } = render(<CalendarPacksBoard stir={stir} onOpenImply={noop} />);
    expect(container.textContent).toMatch(/\+0\.0/);
  });

  it('excludes derived-proxy cash-EFFR rows from the SERFF section', () => {
    const stir = makeStir([
      {
        name: 'SERFFZ6',
        kind: 'serff',
        legs: ['SR1Z6', 'ZQZ6'],
        ratio: '1:1',
        rate_bps: 13.0,
        price_spread: -0.13,
        imply: null,
      },
      {
        name: 'SR1Z6−EFFR (proxy)',
        kind: 'derived-proxy',
        legs: ['SR1Z6', 'EFFR (cash)'],
        ratio: '1:1',
        rate_bps: 5.0,
        price_spread: -0.05,
        note: 'Derived, non-listed, non-executable proxy — not SERFF.',
        imply: null,
      },
    ]);
    const { container } = render(<CalendarPacksBoard stir={stir} onOpenImply={noop} />);
    const text = container.textContent ?? '';
    expect(screen.getByText('SERFFZ6')).toBeTruthy();
    expect(text).not.toMatch(/EFFR \(proxy\)/);
    expect(text).not.toMatch(/EFFR \(cash\)/);
  });
});
