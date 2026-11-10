import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

/** 12-row SERFF fixture: every row Unavailable with an exact missing-leg note. */
function serffUnavailableFixture(count: number): Parameters<typeof makeStir>[0] {
  return Array.from({ length: count }, (_, i) => ({
    name: `SERFF${i}`,
    kind: 'serff' as const,
    legs: [`SR1${i}`, `ZQ${i}`],
    ratio: '1:1',
    rate_bps: null,
    price_spread: null,
    note: `SERFF${i} Unavailable — missing exact leg(s): ZQ${i}. No proxy substitution.`,
    imply: null,
  }));
}

describe('CalendarPacksBoard SERFF responsive disclosure (REF10 correction)', () => {
  it('renders all 12 SERFF rows with full identifier text and full missing-leg note', () => {
    const stir = makeStir([
      {
        name: 'SERFFF7',
        kind: 'serff',
        legs: ['SR1F7', 'ZQF7'],
        ratio: '1:1',
        rate_bps: null,
        price_spread: null,
        note: 'SERFFF7 Unavailable — missing exact leg(s): ZQF7. No proxy substitution.',
        imply: null,
      },
      {
        name: 'SERFFG7',
        kind: 'serff',
        legs: ['SR1G7', 'ZQG7'],
        ratio: '1:1',
        rate_bps: null,
        price_spread: null,
        note: 'SERFFG7 Unavailable — missing exact leg(s): SR1G7, ZQG7. No proxy substitution.',
        imply: null,
      },
      {
        name: 'SERFFH7',
        kind: 'serff',
        legs: ['SR1H7', 'ZQH7'],
        ratio: '1:1',
        rate_bps: 2.5,
        price_spread: -0.025,
        imply: null,
      },
      {
        name: 'SERFFM6',
        kind: 'serff',
        legs: ['SR1M6', 'ZQM6'],
        ratio: '1:1',
        rate_bps: null,
        price_spread: null,
        note: 'SERFFM6 Unavailable — missing exact leg(s): SR1M6, ZQM6. No proxy substitution.',
        imply: null,
      },
      {
        name: 'SERFFM7',
        kind: 'serff',
        legs: ['SR1M7', 'ZQM7'],
        ratio: '1:1',
        rate_bps: null,
        price_spread: null,
        note: 'SERFFM7 Unavailable — missing exact leg(s): SR1M7. No proxy substitution.',
        imply: null,
      },
      {
        name: 'SERFFN6',
        kind: 'serff',
        legs: ['SR1N6', 'ZQN6'],
        ratio: '1:1',
        rate_bps: null,
        price_spread: null,
        note: 'SERFFN6 Unavailable — missing exact leg(s): SR1N6, ZQN6. No proxy substitution.',
        imply: null,
      },
      {
        name: 'SERFFQ6',
        kind: 'serff',
        legs: ['SR1Q6', 'ZQQ6'],
        ratio: '1:1',
        rate_bps: 8.1,
        price_spread: -0.081,
        imply: null,
      },
      {
        name: 'SERFFU6',
        kind: 'serff',
        legs: ['SR1U6', 'ZQU6'],
        ratio: '1:1',
        rate_bps: null,
        price_spread: null,
        note: 'SERFFU6 Unavailable — missing exact leg(s): ZQU6. No proxy substitution.',
        imply: null,
      },
      {
        name: 'SERFFV6',
        kind: 'serff',
        legs: ['SR1V6', 'ZQV6'],
        ratio: '1:1',
        rate_bps: 12.3,
        price_spread: -0.123,
        imply: null,
      },
      {
        name: 'SERFFX6',
        kind: 'serff',
        legs: ['SR1X6', 'ZQX6'],
        ratio: '1:1',
        rate_bps: null,
        price_spread: null,
        note: 'SERFFX6 Unavailable — missing exact leg(s): SR1X6, ZQX6. No proxy substitution.',
        imply: null,
      },
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
        name: 'SERFFH6',
        kind: 'serff',
        legs: ['SR1H6', 'ZQH6'],
        ratio: '1:1',
        rate_bps: 11.7,
        price_spread: -0.117,
        imply: null,
      },
    ]);
    const { container } = render(<CalendarPacksBoard stir={stir} onOpenImply={noop} />);
    const text = container.textContent ?? '';

    // All 12 SERFF identifiers present in full (no truncation to "SERF...")
    for (const id of [
      'SERFFF7', 'SERFFG7', 'SERFFH7', 'SERFFM6', 'SERFFM7', 'SERFFN6',
      'SERFFQ6', 'SERFFU6', 'SERFFV6', 'SERFFX6', 'SERFFZ6', 'SERFFH6',
    ]) {
      expect(text).toContain(id);
    }

    // All 12 rows reachable: the complete missing-data note text is present for null rows
    expect(text).toContain('SERFFF7 Unavailable — missing exact leg(s): ZQF7. No proxy substitution.');
    expect(text).toContain('SERFFG7 Unavailable — missing exact leg(s): SR1G7, ZQG7. No proxy substitution.');
    expect(text).toContain('SERFFM6 Unavailable — missing exact leg(s): SR1M6, ZQM6. No proxy substitution.');
    expect(text).toContain('SERFFM7 Unavailable — missing exact leg(s): SR1M7. No proxy substitution.');
    expect(text).toContain('SERFFN6 Unavailable — missing exact leg(s): SR1N6, ZQN6. No proxy substitution.');
    expect(text).toContain('SERFFU6 Unavailable — missing exact leg(s): ZQU6. No proxy substitution.');
    expect(text).toContain('SERFFX6 Unavailable — missing exact leg(s): SR1X6, ZQX6. No proxy substitution.');

    // "Unavailable" and "No proxy substitution" disclosures are present, not hidden
    expect(text).toContain('Unavailable');
    expect(text).toContain('No proxy substitution');
  });

  it('keeps the SERFF region keyboard-focusable, named, with list semantics for every row and no orphaned roles', () => {
    const stir = makeStir(serffUnavailableFixture(12));
    render(<CalendarPacksBoard stir={stir} onOpenImply={noop} />);

    // The SERFF row list region is keyboard-focusable and has a stable accessible name
    const serffRegion = screen.getByRole('region', { name: /SERFF spread rows/i });
    expect(serffRegion.getAttribute('tabindex')).toBe('0');

    // All 12 returned rows are present as listitems inside a single named list
    const lists = within(serffRegion).getAllByRole('list');
    expect(lists).toHaveLength(1);
    expect(within(lists[0]).getAllByRole('listitem')).toHaveLength(12);

    // No orphaned row role is emitted inside the SERFF region
    expect(within(serffRegion).queryAllByRole('row')).toHaveLength(0);
  });

  it('renders the shared Spread/Rate bps/Price spr/Implies/Note header inside the SERFF section', () => {
    const stir = makeStir(serffUnavailableFixture(2));
    render(<CalendarPacksBoard stir={stir} onOpenImply={noop} />);
    const header = screen.getByTestId('serff-column-header');
    for (const label of ['Spread', 'Rate bps', 'Price spr', 'Implies', 'Note']) {
      expect(header.textContent).toContain(label);
    }
  });

  it('keeps the five header labels ordered and all 12 SERFF rows/notes with a distinct Price spr / Implies gap', () => {
    const stir = makeStir(serffUnavailableFixture(12));
    render(<CalendarPacksBoard stir={stir} onOpenImply={noop} />);

    // All five labels remain present and in order after the layout adjustment.
    const header = screen.getByTestId('serff-column-header');
    const labels = [...header.querySelectorAll('span')].map((s) => s.textContent?.trim());
    expect(labels).toEqual(['Spread', 'Rate bps', 'Price spr', 'Implies', 'Note']);
    // The `Implies` label is indented so it cannot crowd the right-aligned `Price spr`
    // label, while `Spread`/`Note` and the fixed numeric columns stay untouched.
    const impliesLabel = [...header.querySelectorAll('span')][3];
    expect(impliesLabel.textContent?.trim()).toBe('Implies');
    expect(impliesLabel.className).toContain('pl-2');
    expect(header.className).toContain('grid-cols-[1.2fr_72px_72px_100px_1.4fr]');

    // The region still contains all 12 rows, each with its full identifier and disclosure.
    const region = screen.getByRole('region', { name: /SERFF spread rows/i });
    const items = within(region).getAllByRole('listitem');
    expect(items).toHaveLength(12);
    for (const item of items) {
      expect(item.querySelector('.serff-cell-name')?.textContent).toMatch(/^SERFF/);
      expect(item.textContent).toContain('Unavailable');
      expect(item.textContent).toContain('No proxy substitution');
    }
  });

  it('does not truncate SERFF identifier or note text at narrow width (DOM contains full text)', () => {
    const stir = makeStir([
      {
        name: 'SERFFM6',
        kind: 'serff',
        legs: ['SR1M6', 'ZQM6'],
        ratio: '1:1',
        rate_bps: null,
        price_spread: null,
        note: 'SERFFM6 Unavailable — missing exact leg(s): SR1M6, ZQM6. No proxy substitution.',
        imply: null,
      },
    ]);
    const { container } = render(<CalendarPacksBoard stir={stir} onOpenImply={noop} />);

    // Full identifier text present (not truncated to "SERF...")
    expect(container.textContent).toContain('SERFFM6');

    // Full note present including "Unavailable" and "No proxy substitution"
    expect(container.textContent).toContain('SERFFM6 Unavailable — missing exact leg(s): SR1M6, ZQM6. No proxy substitution.');
    expect(container.textContent).toContain('Unavailable');
    expect(container.textContent).toContain('No proxy substitution');
  });

  it('preserves cash/calendar/fly/pack/inter sections unchanged (no column merge)', () => {
    const stir = makeStir([
      // SERFF row
      {
        name: 'SERFFZ6',
        kind: 'serff',
        legs: ['SR1Z6', 'ZQZ6'],
        ratio: '1:1',
        rate_bps: 13.0,
        price_spread: -0.13,
        imply: null,
      },
      // Calendar row
      {
        name: 'SR1Z6-SR3Z6',
        kind: 'calendar',
        legs: ['SR1Z6', 'SR3Z6'],
        ratio: '1:1',
        rate_bps: -2.0,
        price_spread: 0.02,
        imply: null,
      },
      // Fly row
      {
        name: 'SR1Z6-SR2Z6-SR3Z6',
        kind: 'fly',
        legs: ['SR1Z6', 'SR2Z6', 'SR3Z6'],
        ratio: '1:1:1',
        rate_bps: 1.5,
        price_spread: -0.015,
        imply: null,
      },
      // Pack row
      {
        name: 'SR1Z6+SR3Z6/2',
        kind: 'pack',
        legs: ['SR1Z6', 'SR3Z6'],
        ratio: '1:1',
        rate_bps: 0.5,
        price_spread: -0.005,
        imply: null,
      },
      // Inter row
      {
        name: 'SR1Z6-SR3Z6',
        kind: 'inter',
        legs: ['SR1Z6', 'SR3Z6'],
        ratio: '1:1',
        rate_bps: -2.0,
        price_spread: 0.02,
        imply: null,
      },
      // Cash row
      {
        name: 'SOFRZ6-EFFRZ6',
        kind: 'cash',
        legs: ['SOFRZ6', 'EFFRZ6'],
        ratio: '1:1',
        rate_bps: 5.0,
        price_spread: -0.05,
        imply: null,
      },
    ]);
    const { container } = render(<CalendarPacksBoard stir={stir} onOpenImply={noop} />);
    const text = container.textContent ?? '';

    // Required section titles present
    expect(text).toContain('SERFF · SR1 − ZQ (same delivery month, 1:1)');
    expect(text).toContain('CALENDARS (reds / greens)');
    expect(text).toContain('BUTTERFLIES');
    expect(text).toContain('PACKS');
    expect(text).toContain('INTER (SR1−SR3 / SR−ZQ)');
    expect(text).toContain('CASH CORRIDOR (SOFR / EFFR / IORB)');

    // Column labels preserved
    expect(text).toContain('Spread');
    expect(text).toContain('Rate bps');
    expect(text).toContain('Price spr');
    expect(text).toContain('Implies');
    expect(text).toContain('Note');

    // SERFF row still correctly placed under SERFF section (not under cash)
    expect(text).toMatch(/SERFFZ6/);
  });

  it('preserves null Unavailable semantics for SERFF null spreads (never zero)', () => {
    const stir = makeStir([
      {
        name: 'SERFFM6',
        kind: 'serff',
        legs: ['SR1M6', 'ZQM6'],
        ratio: '1:1',
        rate_bps: null,
        price_spread: null,
        note: 'SERFFM6 Unavailable — missing exact leg(s): ZQM6. No proxy substitution.',
        imply: null,
      },
    ]);
    const { container } = render(<CalendarPacksBoard stir={stir} onOpenImply={noop} />);
    const text = container.textContent ?? '';

    expect(text).toContain('Unavailable');
    expect(text).toContain('—');
    // No fabricated zero spread
    expect(text).not.toMatch(/\+0\.0/);
    expect(text).not.toMatch(/-0\.0/);
    expect(text).not.toMatch(/NaN/);
    expect(text).not.toMatch(/Infinity/);
  });

  it('preserves valid zero SERFF spread as +0.0', () => {
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
    render(<CalendarPacksBoard stir={stir} onOpenImply={noop} />);
    // Derived-proxy rows must not appear in the SERFF section
    expect(screen.queryByText('SR1Z6−EFFR (proxy)')).toBeNull();
  });

  it('keeps the SERFF row containers and mobile style stable after the grid correction', () => {
    const stir = makeStir(serffUnavailableFixture(3));
    render(<CalendarPacksBoard stir={stir} onOpenImply={noop} />);

    expect(screen.getByTestId('serff-column-header')).toHaveClass('serff-grid');

    const rows = within(
      screen.getByRole('region', { name: /SERFF spread rows/i }),
    ).getAllByRole('listitem');
    for (const row of rows) {
      expect(row).toHaveClass('serff-grid');
    }

    // Mobile block documents the explicit stable grid and the SERFF name/no-wrap + note wrap rules.
    const styleEls = Array.from(document.querySelectorAll('style'));
    const styleText = styleEls.find((el) =>
      el.textContent?.includes('grid-template-columns: 68px 52px 56px 65px 96px'),
    )?.textContent ?? '';
    expect(styleText).toContain('grid-template-columns: 68px 52px 56px 65px 96px');
    expect(styleText).toContain('min-width: 337px');
    expect(styleText).toContain('white-space: nowrap');
    expect(styleText).not.toContain('text-overflow: ellipsis');
    expect(styleText).toContain('overflow-wrap: break-word');
    expect(styleText).toContain('word-break: normal');
  });
});
