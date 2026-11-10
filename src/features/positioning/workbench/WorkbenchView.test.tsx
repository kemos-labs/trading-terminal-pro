/**
 * WorkbenchView component tests: unavailable path stays honest, controls gate
 * Run until explicit scenario inputs exist, and route integration renders one
 * frame (profile + gamma + charm) with linked-time and stale-edit behavior.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import fs from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WorkbenchView, ProfileTooltipContent } from './WorkbenchView';

(globalThis as unknown as { ResizeObserver: { observe(): void; unobserve(): void; disconnect(): void } }).ResizeObserver = {
  observe() {}, unobserve() {}, disconnect() {},
};

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  const ReactMod = await import('react');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) =>
      ReactMod.createElement('div', { 'data-testid': 'recharts-viewport-mock' }, children),
  };
});

const SNAPSHOT = {
  data: { symbol: 'TEST', spot: 100, expirations: ['2030-12-18'], quotes: [] },
};

function envelope() {
  const cell = (value: number | null) => ({ value, included: value == null ? 0 : 2, excludedExpired: 0, missing: value == null ? 2 : 0, reasons: value == null ? [] : [] });
  const grid = (metric: string, units: string) => ({
    symbol: 'TEST', metric, units,
    prices: [95, 100, 105],
    timesMs: [Date.parse('2026-01-05T12:00:00.000Z'), Date.parse('2027-01-05T12:00:00.000Z')],
    cells: [[cell(10), cell(9)], [cell(20), cell(18)], [cell(5), cell(4)]],
    totals: { included: 12, excludedExpired: 0, missing: 0 },
    methodology: {},
    quoteBasis: 'observed-snapshot+scenario-overrides',
    scenario: {},
    rowSelection: { totalContracts: 3, eligibleContracts: 3, usedContracts: 3, omittedContracts: 0, ineligibleContracts: 0, maxRows: 2000, truncated: false, selection: 'x', truncationReason: null },
    gridCells: { computed: 6, total: 6 },
    multiplierBasis: '100 scenario-multiplier',
    positionBasisAt: '2026-01-05T12:00:00.000Z',
    snapshotSource: ['yfinance'],
    ivBasis: 'venue-mark',
  });
  return {
    asOf: '2026-01-05T12:00:00.000Z',
    freshness: 'fresh',
    coverage: { state: 'complete', missing: [] },
    warnings: [],
    data: {
      symbol: 'TEST',
      frameId: 'TEST|2026-01-05T12:00:00.000Z|n=3|ref=1',
      referenceTimeMs: Date.parse('2026-01-05T12:00:00.000Z'),
      spotRef: 100,
      gex: grid('gex', '$/1% move'),
      charm: grid('charm', '$Δ/day'),
      profile: [
        { strike: 100, value: 5000, unit: '$/1% move', basis: 'OI-weighted exposure proxy (not observed dealer inventory)' },
        { strike: 110, value: null, unit: '$/1% move', basis: 'OI-weighted exposure proxy (not observed dealer inventory)' },
      ],
      profileBasis: 'per-strike signed GEX at spot 100',
      quoteBasis: 'observed-snapshot+scenario-overrides',
      scenario: {},
      rowSelection: { totalContracts: 3, eligibleContracts: 3, usedContracts: 3, omittedContracts: 0, ineligibleContracts: 0, maxRows: 2000, truncated: false, selection: 'x', truncationReason: null },
      gridCells: { computed: 12, total: 12 },
      multiplierBasis: '100 scenario-multiplier',
      positionBasisAt: '2026-01-05T12:00:00.000Z',
      snapshotSource: ['yfinance'],
      ivBasis: 'venue-mark',
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('WorkbenchView', () => {
  it('Run stays disabled until explicit scenario inputs exist (no prefilled observed data)', () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () => new Response(JSON.stringify(SNAPSHOT), { status: 200 }));
    render(<WorkbenchView initialSymbol="TEST" />);
    expect(screen.getByRole('button', { name: 'Run workbench' })).toBeDisabled();
  });

  it('unavailable snapshot path stays Unavailable without fabricating chain data', async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () => new Response('down', { status: 502 }));
    render(<WorkbenchView initialSymbol="TEST" />);
    fireEvent.click(screen.getByRole('button', { name: 'Load snapshot' }));
    expect(await screen.findByTestId('wb-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('wb-profile')).toBeNull();
  });

  it('renders one frame with linked time, stale-on-edit, and null-vs-zero honesty', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('/api/v1/analytics/positioning/workbench')) {
        return new Response(JSON.stringify(envelope()), { status: 200 });
      }
      return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    render(<WorkbenchView initialSymbol="TEST" />);
    fireEvent.click(screen.getByRole('button', { name: 'Load snapshot' }));
    await screen.findByText(/Snapshot spot:/);
    fireEvent.change(screen.getByLabelText('Risk-free rate'), { target: { value: '0.04' } });
    fireEvent.change(screen.getByLabelText('Carry rate'), { target: { value: '0.01' } });
    fireEvent.change(screen.getByLabelText('Contract multiplier'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Expiry instant UTC'), { target: { value: '2030-12-18T21:00:00.000Z' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run workbench' }));
    await screen.findByTestId('wb-profile');
    expect(screen.getByTestId('wb-grid-GAMMA')).toBeTruthy();
    expect(screen.getByTestId('wb-grid-CHARM')).toBeTruthy();
    // Null stays an em dash, never zero-filled; frame identity visible.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText(/TEST\|2026-01-05/)).toBeTruthy();
    // Linked time control present; editing marks result stale.
    expect(screen.getByLabelText('Linked valuation time across panels')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Horizon days'), { target: { value: '14' } });
    expect(await screen.findByText(/result stale until Run/)).toBeTruthy();
  });

  it('strike profile renders HIGH strike first (prices increase upward) and declares spot without a fake line', async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (input: unknown) => {
      if (String(input).includes('/api/v1/analytics/positioning/workbench')) {
        return new Response(JSON.stringify(envelope()), { status: 200 });
      }
      return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
    });
    render(<WorkbenchView initialSymbol="TEST" />);
    fireEvent.click(screen.getByRole('button', { name: 'Load snapshot' }));
    await screen.findByText(/Snapshot spot:/);
    fireEvent.change(screen.getByLabelText('Risk-free rate'), { target: { value: '0.04' } });
    fireEvent.change(screen.getByLabelText('Carry rate'), { target: { value: '0.01' } });
    fireEvent.change(screen.getByLabelText('Contract multiplier'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Expiry instant UTC'), { target: { value: '2030-12-18T21:00:00.000Z' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run workbench' }));
    await screen.findByTestId('wb-profile');
    const table = screen.getByLabelText('Strike profile values');
    const strikes = [...table.querySelectorAll('tbody th')].map((th) => th.textContent);
    expect(strikes[0]).toBe('110.0'); // highest strike at top
    expect(strikes[strikes.length - 1]).toBe('100.0');
    // Spot declared with truth about the category axis, never drawn as an exposure line at x=0.
    expect(screen.getByTestId('wb-profile-spot').textContent).toContain('between listed strikes 100–110');
  });

  it('invalid scenario input errors out without clamping, defaulting, or calling the workbench route', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('/api/v1/analytics/positioning/workbench')) {
        return new Response(JSON.stringify(envelope()), { status: 200 });
      }
      return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    render(<WorkbenchView initialSymbol="TEST" />);
    fireEvent.click(screen.getByRole('button', { name: 'Load snapshot' }));
    await screen.findByText(/Snapshot spot:/);
    fireEvent.change(screen.getByLabelText('Risk-free rate'), { target: { value: '0.04' } });
    fireEvent.change(screen.getByLabelText('Carry rate'), { target: { value: '0.01' } });
    fireEvent.change(screen.getByLabelText('Contract multiplier'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Expiry instant UTC'), { target: { value: '2030-12-18T21:00:00.000Z' } });
    fireEvent.change(screen.getByLabelText('Price range percent'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run workbench' }));
    expect(await screen.findByText(/must be a finite number in \(0, 100\]/)).toBeTruthy();
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('workbench')).length).toBe(0);
    // Budget overreach is also rejected up front, truthfully.
    fireEvent.change(screen.getByLabelText('Price range percent'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Price steps'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText('Time steps'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run workbench' }));
    expect(await screen.findByText(/exceeds the 10000-cell response bound/)).toBeTruthy();
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('workbench')).length).toBe(0);
  });

  it('calendar rejection: malformed YYYY-MM-DD date is refused client-side without calling the workbench route', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('/api/v1/analytics/positioning/workbench')) {
        return new Response(JSON.stringify(envelope()), { status: 200 });
      }
      return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    render(<WorkbenchView initialSymbol="TEST" />);
    fireEvent.click(screen.getByRole('button', { name: 'Load snapshot' }));
    await screen.findByText(/Snapshot spot:/);
    fireEvent.change(screen.getByLabelText('Risk-free rate'), { target: { value: '0.04' } });
    fireEvent.change(screen.getByLabelText('Carry rate'), { target: { value: '0.01' } });
    fireEvent.change(screen.getByLabelText('Contract multiplier'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Expiry instant UTC'), { target: { value: '2030-12-18T21:00:00.000Z' } });
    // Rolled/duplicate/mismatched dates are rejected by the route; a malformed
    // date-like never even leaves the client (no index-to-days mapping assumed).
    fireEvent.change(screen.getByLabelText('Calendar dates'), { target: { value: '20260105' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run workbench' }));
    expect(await screen.findByText(/must be YYYY-MM-DD/)).toBeTruthy();
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('workbench')).length).toBe(0);
  });

  it('calendar panel: dates ride the request, current/peak/domain render from the same frame', async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: { body?: string }) => {
      if (String(input).includes('/api/v1/analytics/positioning/workbench')) {
        const sent = JSON.parse(String(init?.body ?? '{}'));
        expect(sent.calendar).toEqual({ dates: ['2026-01-05', '2026-01-07'] });
        const env = envelope() as unknown as { data: Record<string, unknown> };
        env.data.calendar = {
          dates: ['2026-01-05', '2026-01-07'],
          instantsMs: [Date.parse('2026-01-05T12:00:00.000Z'), Date.parse('2026-01-07T12:00:00.000Z')],
          instants: ['2026-01-05T12:00:00.000Z', '2026-01-07T12:00:00.000Z'],
          clock: '12:00:00.000',
          prices: [95, 100, 105],
          cells: [
            [{ value: 10, included: 2, excludedExpired: 0, missing: 0, reasons: [] }, { value: 9, included: 2, excludedExpired: 0, missing: 0, reasons: [] }],
            [{ value: 20, included: 2, excludedExpired: 0, missing: 0, reasons: [] }, { value: null, included: 0, excludedExpired: 2, missing: 0, reasons: ['expired'] }],
            [{ value: 5, included: 2, excludedExpired: 0, missing: 0, reasons: [] }, { value: 4, included: 2, excludedExpired: 0, missing: 0, reasons: [] }],
          ],
          current: { spot: 100, instantMs: Date.parse('2026-01-05T12:00:00.000Z'), instant: '2026-01-05T12:00:00.000Z', value: 20000, unit: '$/1% move', reasons: [] },
          peak: { value: 20, price: 100, date: '2026-01-05', instantMs: Date.parse('2026-01-05T12:00:00.000Z'), instant: '2026-01-05T12:00:00.000Z' },
          domain: { min: 4, max: 20, symmetricAuto: false },
          colorSemantics: 'stable semantics',
          snapshotIdentity: 'TEST|2026-01-05T12:00:00.000Z|n=3|ref=1',
          budget: { total: 100 },
        };
        return new Response(JSON.stringify(env), { status: 200 });
      }
      return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    render(<WorkbenchView initialSymbol="TEST" />);
    fireEvent.click(screen.getByRole('button', { name: 'Load snapshot' }));
    await screen.findByText(/Snapshot spot:/);
    fireEvent.change(screen.getByLabelText('Risk-free rate'), { target: { value: '0.04' } });
    fireEvent.change(screen.getByLabelText('Carry rate'), { target: { value: '0.01' } });
    fireEvent.change(screen.getByLabelText('Contract multiplier'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Expiry instant UTC'), { target: { value: '2030-12-18T21:00:00.000Z' } });
    fireEvent.change(screen.getByLabelText('Calendar dates'), { target: { value: '2026-01-05, 2026-01-07' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run workbench' }));
    expect(await screen.findByTestId('wb-calendar')).toBeTruthy();
    expect(screen.getByTestId('wb-calendar-current').textContent).toContain('20');
    expect(screen.getByTestId('wb-calendar-peak').textContent).toContain('2026-01-05');
    expect(screen.getByTestId('wb-calendar-domain').textContent).toContain('12:00:00.000');
    // Null calendar cell renders as an em dash in the accessible table fallback, never zero-filled.
    expect(screen.getByTestId('wb-calendar').textContent).toContain('—');
  });

  it('calendar panel absent-by-default copy renders on narrow (mobile) widths without breaking desktop grids', async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (input: unknown) => {
      if (String(input).includes('/api/v1/analytics/positioning/workbench')) {
        return new Response(JSON.stringify(envelope()), { status: 200 });
      }
      return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
    });
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    render(<WorkbenchView initialSymbol="TEST" />);
    fireEvent.click(screen.getByRole('button', { name: 'Load snapshot' }));
    await screen.findByText(/Snapshot spot:/);
    fireEvent.change(screen.getByLabelText('Risk-free rate'), { target: { value: '0.04' } });
    fireEvent.change(screen.getByLabelText('Carry rate'), { target: { value: '0.01' } });
    fireEvent.change(screen.getByLabelText('Contract multiplier'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Expiry instant UTC'), { target: { value: '2030-12-18T21:00:00.000Z' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run workbench' }));
    await screen.findByTestId('wb-profile');
    // No calendar requested → honest empty state, desktop grids intact.
    expect(screen.getByTestId('wb-calendar').textContent).toContain('No calendar requested');
    expect(screen.getByTestId('wb-grid-GAMMA')).toBeTruthy();
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
  });

  it('T1 link group: request hint sent, server echo displayed, unlinked time keeps peer unchanged (A1)', async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: { body?: string }) => {
      if (String(input).includes('/api/v1/analytics/positioning/workbench')) {
        const sent = JSON.parse(String(init?.body ?? '{}'));
        expect(sent.linkGroup).toEqual({ id: 'wb-a', symbol: true, expiry: true, time: true, priceRange: false });
        const env = envelope() as unknown as { data: Record<string, unknown> };
        env.data.linkGroup = sent.linkGroup;
        return new Response(JSON.stringify(env), { status: 200 });
      }
      return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    render(<WorkbenchView initialSymbol="TEST" />);
    fireEvent.click(screen.getByRole('button', { name: 'Load snapshot' }));
    await screen.findByText(/Snapshot spot:/);
    fireEvent.change(screen.getByLabelText('Risk-free rate'), { target: { value: '0.04' } });
    fireEvent.change(screen.getByLabelText('Carry rate'), { target: { value: '0.01' } });
    fireEvent.change(screen.getByLabelText('Contract multiplier'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Expiry instant UTC'), { target: { value: '2030-12-18T21:00:00.000Z' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run workbench' }));
    await screen.findByTestId('wb-profile');
    // Linked by default: one shared slider, echo shows the hint.
    expect(screen.getByTestId('wb-link-echo').textContent).toContain('"time":true');
    expect(screen.getByLabelText('Linked valuation time across panels')).toBeTruthy();
    // Unlink time: peer grids get independent sliders; moving gamma leaves charm.
    fireEvent.click(screen.getByLabelText('Link time'));
    const gamma = screen.getByTestId('wb-time-gamma') as HTMLInputElement;
    const charm = screen.getByTestId('wb-time-charm') as HTMLInputElement;
    expect(gamma.value).toBe('0');
    expect(charm.value).toBe('0');
    fireEvent.change(gamma, { target: { value: '1' } });
    expect(gamma.value).toBe('1');
    expect(charm.value).toBe('0');
    // A2: unlinked symbol edit marks local stale without firing a peer fetch.
    const callsBefore = fetchMock.mock.calls.filter((c) => String(c[0]).includes('workbench')).length;
    fireEvent.click(screen.getByLabelText('Link symbol'));
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'AA' } });
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('workbench')).length).toBe(callsBefore);
  });

  it('T1 broken-link isolation: invalid id sends nothing and keeps the survivor frame (A3)', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('/api/v1/analytics/positioning/workbench')) {
        return new Response(JSON.stringify(envelope()), { status: 200 });
      }
      return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    render(<WorkbenchView initialSymbol="TEST" />);
    fireEvent.click(screen.getByRole('button', { name: 'Load snapshot' }));
    await screen.findByText(/Snapshot spot:/);
    fireEvent.change(screen.getByLabelText('Risk-free rate'), { target: { value: '0.04' } });
    fireEvent.change(screen.getByLabelText('Carry rate'), { target: { value: '0.01' } });
    fireEvent.change(screen.getByLabelText('Contract multiplier'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Expiry instant UTC'), { target: { value: '2030-12-18T21:00:00.000Z' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run workbench' }));
    await screen.findByTestId('wb-profile');
    const frameText = screen.getByText(/TEST\|2026-01-05/).textContent;
    const wbCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('workbench')).length;
    fireEvent.change(screen.getByLabelText('Link group id'), { target: { value: 'bad!id' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run workbench' }));
    expect(await screen.findByTestId('wb-link-error')).toBeTruthy();
    // No request left the client; the survivor panel keeps its prior frame and stays interactive.
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('workbench')).length).toBe(wbCalls);
    expect(screen.getByTestId('wb-profile')).toBeTruthy();
    expect(screen.getByText(/TEST\|2026-01-05/).textContent).toBe(frameText);
    expect(screen.getByLabelText('Linked valuation time across panels')).toBeTruthy();
  });

  it('T1 priceRange linkage moves hypothetical axes only; strike zoom stays independent (A4)', async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (input: unknown) => {
      if (String(input).includes('/api/v1/analytics/positioning/workbench')) {
        return new Response(JSON.stringify(envelope()), { status: 200 });
      }
      return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
    });
    render(<WorkbenchView initialSymbol="TEST" />);
    fireEvent.click(screen.getByRole('button', { name: 'Load snapshot' }));
    await screen.findByText(/Snapshot spot:/);
    fireEvent.change(screen.getByLabelText('Risk-free rate'), { target: { value: '0.04' } });
    fireEvent.change(screen.getByLabelText('Carry rate'), { target: { value: '0.01' } });
    fireEvent.change(screen.getByLabelText('Contract multiplier'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Expiry instant UTC'), { target: { value: '2030-12-18T21:00:00.000Z' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run workbench' }));
    await screen.findByTestId('wb-profile');
    const strikeRows = () => screen.getByLabelText('Strike profile values').querySelectorAll('tbody tr').length;
    expect(strikeRows()).toBe(2);
    // Default priceRange:false → charm owns an independent zoom; moving gamma zoom leaves charm + profile.
    expect(screen.getByLabelText('Charm zoom low')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Gamma zoom high'), { target: { value: '1' } });
    expect((screen.getByLabelText('Gamma zoom high') as HTMLInputElement).value).toBe('1');
    expect((screen.getByLabelText('Charm zoom high') as HTMLInputElement).value).toBe('2');
    expect(strikeRows()).toBe(2);
    // Linking priceRange collapses to the shared hypothetical-axis zoom.
    fireEvent.click(screen.getByLabelText('Link price range'));
    expect(screen.queryByLabelText('Charm zoom low')).toBeNull();
    expect(strikeRows()).toBe(2);
  });

  it('canvasCellColor maps magnitude to intensity monotonically and keeps zero distinct from null', async () => {
    const { canvasCellColor, resolveCanvasColors } = await import('../../../lib/chartTheme');
    const colors = resolveCanvasColors();
    const a = (s: string) => Number(/rgba\([^)]+, ?([0-9.]+)\)/.exec(s)?.[1] ?? NaN);
    const small = canvasCellColor(1, -100, 100, true, colors);
    const mid = canvasCellColor(50, -100, 100, true, colors);
    const big = canvasCellColor(100, -100, 100, true, colors);
    expect(a(small)).toBeLessThan(a(mid));
    expect(a(mid)).toBeLessThan(a(big));
    expect(a(big)).toBeGreaterThan(0.8); // full-magnitude cells are saturated, not flat
    const zero = canvasCellColor(0, -100, 100, true, colors);
    expect(a(zero)).toBeLessThan(a(small)); // zero faintest positive tint, null is hatched separately
    expect(a(canvasCellColor(-100, -100, 100, true, colors))).toBeGreaterThan(0.8);
  });
});

/** REF-02 T2: profile units switch over the same frame + truthful BALANCE/TEST disclosure. */
function enrichedEnvelope() {
  const env = envelope() as unknown as { data: { profile: Record<string, unknown>[] } };
  env.data.profile = [
    {
      strike: 100, value: 5000000, unit: '$/1% move',
      basis: 'OI-weighted exposure proxy (not observed dealer inventory)',
      contracts: 42, contractsCall: 50, contractsPut: -8,
      callGex: 6000000, putGex: -1000000,
    },
    {
      strike: 110, value: null, unit: '$/1% move',
      basis: 'OI-weighted exposure proxy (not observed dealer inventory)',
      contracts: null, contractsCall: null, contractsPut: null,
      callGex: null, putGex: null,
    },
  ];
  return env;
}

async function runWorkbench(fetchMock: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole('button', { name: 'Load snapshot' }));
  await screen.findByText(/Snapshot spot:/);
  fireEvent.change(screen.getByLabelText('Risk-free rate'), { target: { value: '0.04' } });
  fireEvent.change(screen.getByLabelText('Carry rate'), { target: { value: '0.01' } });
  fireEvent.change(screen.getByLabelText('Contract multiplier'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Expiry instant UTC'), { target: { value: '2030-12-18T21:00:00.000Z' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run workbench' }));
  await screen.findByTestId('wb-profile');
  return fetchMock.mock.calls.filter((c) => String(c[0]).includes('workbench')).length;
}

describe('WorkbenchView REF-02 T2', () => {
  it('T2-U1: units toggle switches header/table units with no refetch and no stale flag', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('/api/v1/analytics/positioning/workbench')) {
        return new Response(JSON.stringify(enrichedEnvelope()), { status: 200 });
      }
      return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    render(<WorkbenchView initialSymbol="TEST" />);
    const callsAfterRun = await runWorkbench(fetchMock);
    expect(callsAfterRun).toBe(1);
    const frameText = screen.getByText(/TEST\|2026-01-05/).textContent;
    // Default is gex: header, echo, and table carry GEX units.
    expect(screen.getByText(/STRIKE PROFILE · signed GEX/)).toBeTruthy();
    expect(screen.getByTestId('wb-profile-units-echo').textContent).toContain('unit: gex');
    expect(screen.getByTestId('wb-profile-units-gex').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Strike profile values').textContent).toContain('GEX $/1%');
    // Toggle to contracts: same frame, no fetch, no stale-edit banner (presentation switch only).
    fireEvent.click(screen.getByTestId('wb-profile-units-contracts'));
    expect(screen.getByText(/STRIKE PROFILE · net contracts/)).toBeTruthy();
    expect(screen.getByTestId('wb-profile-units-echo').textContent).toContain('unit: contracts');
    expect(screen.getByTestId('wb-profile-units-contracts').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Strike profile values').textContent).toContain('(contracts)');
    // Highest strike still at top; null row is an em dash, never zero-filled.
    const table = screen.getByLabelText('Strike profile values');
    const strikes = [...table.querySelectorAll('tbody th')].map((th) => th.textContent);
    expect(strikes[0]).toBe('110.0');
    expect(table.textContent).toContain('—');
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('workbench')).length).toBe(callsAfterRun);
    expect(screen.getByText(/TEST\|2026-01-05/).textContent).toBe(frameText);
    expect(screen.queryByText(/result stale until Run/)).toBeNull();
    // Toggle back: still no fetch.
    fireEvent.click(screen.getByTestId('wb-profile-units-gex'));
    expect(screen.getByText(/STRIKE PROFILE · signed GEX/)).toBeTruthy();
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('workbench')).length).toBe(callsAfterRun);
  });

  it('T2-U2: hover renderer shows exact strike with call/put/combined, units, and context', () => {
    const row = {
      strike: 4400, label: '4400.0', value: 5000000, raw: 5000000,
      contracts: 42, contractsCall: 50, contractsPut: -8,
      callGex: 6000000, putGex: -1000000,
    };
    // The real tooltip content component renders straight from a Recharts-shaped payload.
    const { unmount } = render(
      <ProfileTooltipContent
        active payload={[{ payload: row }]} units="gex"
        spotRef={4405.25} expiryLabel="2030-12-18"
        asOf="2026-01-05T12:00:00.000Z" source={['yfinance']}
      />,
    );
    const tip = screen.getByTestId('wb-profile-tooltip');
    expect(tip.textContent).toContain('strike 4400.0');
    expect(tip.textContent).toContain('GEX net +5.00M $/1%');
    expect(tip.textContent).toContain('call +6.00M');
    expect(tip.textContent).toContain('put -1.00M');
    expect(tip.textContent).toContain('contracts net +42');
    expect(tip.textContent).toContain('spot 4405.25');
    expect(tip.textContent).toContain('expiry 2030-12-18');
    expect(tip.textContent).toContain('as-of 2026-01-05T12:00:00.000Z');
    expect(tip.textContent).toContain('yfinance');
    expect(tip.textContent).toContain('not observed dealer inventory');
    unmount();
    // Contracts units: contracts primary, GEX secondary; missing stays unavailable, never zero.
    render(
      <ProfileTooltipContent
        active payload={[{ payload: row }]} units="contracts"
        spotRef={4405.25} expiryLabel="2030-12-18"
        asOf="2026-01-05T12:00:00.000Z" source={['yfinance']}
      />,
    );
    const tipC = screen.getByTestId('wb-profile-tooltip');
    expect(tipC.textContent).toContain('contracts net +42 · call +50 · put -8');
    expect(tipC.textContent).toContain('GEX net +5.00M $/1%');
    cleanup();
    const nullRow = {
      strike: 110, label: '110.0', value: null, raw: null,
      contracts: null, contractsCall: null, contractsPut: null,
      callGex: null, putGex: null,
    };
    render(<ProfileTooltipContent active payload={[{ payload: nullRow }]} units="gex" />);
    expect(screen.getByTestId('wb-profile-tooltip').textContent).toContain('unavailable (never zero-filled)');
  });

  it('T2-U3: BALANCE/TEST Unavailable disclosure is keyboard-reachable with no overlay drawn', async () => {
    let captured: unknown = null;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (input: unknown) => {
      if (String(input).includes('/api/v1/analytics/positioning/workbench')) {
        const env = enrichedEnvelope() as unknown as { warnings: string[] };
        env.warnings = [...(env.warnings ?? []), 'BALANCE/TEST: unavailable — no sourced rule or user placement; not inferred from public OI'];
        captured = env;
        return new Response(JSON.stringify(env), { status: 200 });
      }
      return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
    });
    render(<WorkbenchView initialSymbol="TEST" />);
    await runWorkbench(vi.fn());
    const block = screen.getByTestId('wb-balance-test');
    expect(block.textContent).toContain('BALANCE/TEST — Unavailable');
    expect(block.textContent).toContain('requires explicit rules or user-placed annotations');
    expect(block.textContent).toContain('This is not observed dealer positioning');
    // No overlay is drawn or simulated: no canvas/overlay testid exists.
    expect(screen.queryByTestId('wb-balance-overlay')).toBeNull();
    expect(block.querySelector('canvas')).toBeNull();
    // Keyboard-reachable disclosure with a status role.
    expect(block.getAttribute('tabindex')).toBe('0');
    expect(block.getAttribute('role')).toBe('status');
    (block as HTMLElement).focus();
    expect(document.activeElement).toBe(block);
    // Server envelope carries the matching provenance warning.
    expect(JSON.stringify(captured)).toContain('BALANCE/TEST: unavailable');
  });

  it('T2-U4: legacy Book netGex bars preserved (source assertion) + T1 linkGroup still works', async () => {
    // Preservation without rendering PositioningView: the legacy horizontal
    // netGex bar path must still exist exactly where T1 left it.
    const legacy = fs.readFileSync(join(process.cwd(), 'src/components/views/PositioningView.tsx'), 'utf8');
    expect(legacy).toContain('dataKey="netGex"');
    expect(legacy).toContain('Net GEX $M');
    expect(legacy).toContain('ReferenceLine');
    // T1 regression: the workbench still sends the linkGroup hint and shows the server echo.
    const fetchMock = vi.fn(async (input: unknown, init?: { body?: string }) => {
      if (String(input).includes('/api/v1/analytics/positioning/workbench')) {
        const sent = JSON.parse(String(init?.body ?? '{}'));
        expect(sent.linkGroup).toEqual({ id: 'wb-a', symbol: true, expiry: true, time: true, priceRange: false });
        const env = enrichedEnvelope() as unknown as { data: Record<string, unknown> };
        env.data.linkGroup = sent.linkGroup;
        return new Response(JSON.stringify(env), { status: 200 });
      }
      return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    render(<WorkbenchView initialSymbol="TEST" />);
    await runWorkbench(fetchMock);
    expect(screen.getByTestId('wb-link-group')).toBeTruthy();
    expect(screen.getByTestId('wb-link-echo').textContent).toContain('\"time\":true');
    expect(screen.getByTestId('wb-balance-test')).toBeTruthy();
    expect(screen.getByTestId('wb-profile-units-contracts')).toBeTruthy();
  });
});

/** REF-03 T3: optional observed-history candle overlay on the existing calendar panel. */
function calendarCandleEnvelope() {
  const env = envelope() as unknown as { data: Record<string, unknown> };
  const cell = (value: number | null, reasons: string[] = []) => ({
    value, included: value == null ? 0 : 2, excludedExpired: value == null ? 2 : 0,
    missing: 0, reasons,
  });
  env.data.calendar = {
    dates: ['2026-01-05', '2026-01-07'],
    instantsMs: [Date.parse('2026-01-05T12:00:00.000Z'), Date.parse('2026-01-07T12:00:00.000Z')],
    instants: ['2026-01-05T12:00:00.000Z', '2026-01-07T12:00:00.000Z'],
    clock: '12:00:00.000',
    prices: [95, 100, 105],
    cells: [
      [cell(10), cell(9)],
      [cell(20), cell(null, ['expired'])],
      [cell(5), cell(4)],
    ],
    current: { spot: 100, instantMs: Date.parse('2026-01-05T12:00:00.000Z'), instant: '2026-01-05T12:00:00.000Z', value: 20000, unit: '$/1% move', reasons: [] },
    peak: { value: 20, price: 100, date: '2026-01-05', instantMs: Date.parse('2026-01-05T12:00:00.000Z'), instant: '2026-01-05T12:00:00.000Z' },
    domain: { min: 4, max: 20, symmetricAuto: false },
    colorSemantics: 'stable semantics',
    snapshotIdentity: 'TEST|2026-01-05T12:00:00.000Z|n=3|ref=1',
    budget: { total: 100 },
  };
  return env;
}

function candleFetch(history: unknown, status = 200) {
  return vi.fn(async (input: unknown) => {
    if (String(input).includes('/api/yf/history/')) {
      if (status !== 200) return new Response('down', { status });
      return new Response(JSON.stringify(history), { status: 200 });
    }
    if (String(input).includes('/api/v1/analytics/positioning/workbench')) {
      return new Response(JSON.stringify(calendarCandleEnvelope()), { status: 200 });
    }
    return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
  });
}

async function runCalendar() {
  fireEvent.click(screen.getByRole('button', { name: 'Load snapshot' }));
  await screen.findByText(/Snapshot spot:/);
  fireEvent.change(screen.getByLabelText('Risk-free rate'), { target: { value: '0.04' } });
  fireEvent.change(screen.getByLabelText('Carry rate'), { target: { value: '0.01' } });
  fireEvent.change(screen.getByLabelText('Contract multiplier'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Expiry instant UTC'), { target: { value: '2030-12-18T21:00:00.000Z' } });
  fireEvent.change(screen.getByLabelText('Calendar dates'), { target: { value: '2026-01-05, 2026-01-07' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run workbench' }));
  await screen.findByTestId('wb-calendar');
}

const flush = () => new Promise((r) => setTimeout(r, 30));

describe('WorkbenchView REF-03 T3 candles', () => {
  it('(a) one matching bar produces one overlay column with exact date and OHLC-derived geometry', async () => {
    (globalThis as { fetch?: unknown }).fetch = candleFetch({
      symbol: 'TEST',
      bars: [{ date: '2026-01-05', open: 98, high: 102, low: 97, close: 101, volume: 1000 }],
    });
    render(<WorkbenchView initialSymbol="TEST" />);
    await runCalendar();
    // Wick renders only for the observed column; retry until the history fetch settles.
    const wick = await screen.findByTestId('wb-candle-2026-01-05-wick');
    const col = screen.getByTestId('wb-candle-2026-01-05');
    expect(col.getAttribute('data-observed')).toBe('true');
    expect(col.getAttribute('data-open')).toBe('98');
    expect(col.getAttribute('data-high')).toBe('102');
    expect(col.getAttribute('data-low')).toBe('97');
    expect(col.getAttribute('data-close')).toBe('101');
    // Geometry derives from the bar's own OHLC against calendar prices [95,100,105]:
    // high 102 -> top 30%, low 97 -> 80%; body open 98 / close 101 -> top 40%, height 30%.
    expect((wick as HTMLElement).style.top).toBe('30%');
    expect((wick as HTMLElement).style.height).toBe('50%');
    const body = screen.getByTestId('wb-candle-2026-01-05-body');
    expect((body as HTMLElement).style.top).toBe('40%');
    expect((body as HTMLElement).style.height).toBe('30%');
    const overlayLabel = screen.getByTestId('wb-candle-overlay').getAttribute('aria-label')?.toLowerCase() ?? '';
    expect(overlayLabel).toContain('observed ohlc');
    expect(overlayLabel).toContain('only where');
  });

  it('(b) an unobserved/future date produces no candle and a modeled/unavailable disclosure', async () => {
    (globalThis as { fetch?: unknown }).fetch = candleFetch({
      symbol: 'TEST',
      bars: [{ date: '2026-01-05', open: 98, high: 102, low: 97, close: 101, volume: 1000 }],
    });
    render(<WorkbenchView initialSymbol="TEST" />);
    await runCalendar();
    await screen.findByTestId('wb-candle-2026-01-05-wick');
    const future = screen.getByTestId('wb-candle-2026-01-07');
    expect(future.getAttribute('data-observed')).toBe('false');
    expect(screen.queryByTestId('wb-candle-2026-01-07-wick')).toBeNull();
    expect(screen.queryByTestId('wb-candle-2026-01-07-body')).toBeNull();
    const note = screen.getByTestId('wb-candle-disclosure');
    expect(note.textContent).toContain('modeled scenarios, not observed prices');
    expect(note.getAttribute('tabindex')).toBe('0');
  });

  it('(c) malformed/non-finite bars are ignored', async () => {
    (globalThis as { fetch?: unknown }).fetch = candleFetch({
      symbol: 'TEST',
      bars: [
        { date: '2026-01-05', open: 0, high: -1, low: 'x', close: null, volume: 5 },
        { date: 'not-a-date', open: 1, high: 2, low: 1, close: 1.5, volume: 5 },
        { date: '2026-01-07', open: 0, high: 2, low: 1, close: 1.5, volume: 5 },
      ],
    });
    render(<WorkbenchView initialSymbol="TEST" />);
    await runCalendar();
    await flush();
    // Every bar fails the finite-positive-OHLC / exact-date rule; nothing observed.
    expect(screen.queryByTestId('wb-candle-2026-01-05-wick')).toBeNull();
    expect(screen.queryByTestId('wb-candle-2026-01-07-wick')).toBeNull();
    const note = screen.getByTestId('wb-candle-disclosure');
    expect(note.getAttribute('data-candle-state')).toBe('unavailable');
    expect(note.textContent).toContain('Actual price history unavailable');
  });

  it('(d) no history preserves the calendar result and renders the unavailable disclosure', async () => {
    (globalThis as { fetch?: unknown }).fetch = candleFetch(null, 500);
    render(<WorkbenchView initialSymbol="TEST" />);
    await runCalendar();
    await flush();
    // Calendar result intact despite history failure.
    expect(screen.getByTestId('wb-calendar-current').textContent).toContain('20');
    expect(screen.getByTestId('wb-calendar-peak').textContent).toContain('2026-01-05');
    expect(screen.getByTestId('wb-calendar-domain').textContent).toContain('same frame');
    expect(screen.queryByTestId('wb-candle-2026-01-05-wick')).toBeNull();
    const note = screen.getByTestId('wb-candle-disclosure');
    expect(note.getAttribute('data-candle-state')).toBe('unavailable');
    expect(note.textContent).toContain('Actual price history unavailable — candle overlay not shown; modeled columns remain scenarios, not observed prices.');
    expect(note.textContent).not.toContain('Live');
  });

  it('(f) candle overlay shares HeatGrid plot gutters padL=54 padR=8 and column count matches calendar dates', async () => {
    (globalThis as { fetch?: unknown }).fetch = candleFetch({
      symbol: 'TEST',
      bars: [{ date: '2026-01-05', open: 98, high: 102, low: 97, close: 101, volume: 1000 }],
    });
    render(<WorkbenchView initialSymbol="TEST" />);
    await runCalendar();
    await screen.findByTestId('wb-candle-2026-01-05-wick');
    const overlay = screen.getByTestId('wb-candle-overlay');
    expect(overlay.getAttribute('data-pad-l')).toBe('54');
    expect(overlay.getAttribute('data-pad-r')).toBe('8');
    expect(overlay.getAttribute('data-columns')).toBe('2');
    // Overlay uses measured gutter padding to align column centers with HeatGrid formula padL+(i+0.5)*((width-padL-padR)/n)
    expect((overlay as HTMLElement).style.paddingLeft).toBe('54px');
    expect((overlay as HTMLElement).style.paddingRight).toBe('8px');
    // Every calendar date has a column with index attribute for objective center measurement
    expect(screen.getByTestId('wb-candle-2026-01-05').getAttribute('data-col-index')).toBe('0');
    expect(screen.getByTestId('wb-candle-2026-01-07').getAttribute('data-col-index')).toBe('1');
    // Price orientation upward: wick top 30% for 102 against [95,105] span
    expect((screen.getByTestId('wb-candle-2026-01-05-wick') as HTMLElement).style.top).toBe('30%');
  });

  it('(g) stale cache response renders no candle and a visible Stale disclosure with age while preserving calendar', async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (input: unknown) => {
      if (String(input).includes('/api/yf/history/')) {
        return new Response(JSON.stringify({
          symbol: 'TEST',
          bars: [{ date: '2026-01-05', open: 98, high: 102, low: 97, close: 101, volume: 1000 }],
          cache: { state: 'stale', hit: true, ageMs: 95000, stale: true, coalesced: false, providerError: 'upstream-error' },
          coverage: { observed: 1, dropped: 0 },
        }), { status: 200 });
      }
      if (String(input).includes('/api/v1/analytics/positioning/workbench')) {
        return new Response(JSON.stringify(calendarCandleEnvelope()), { status: 200 });
      }
      return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
    });
    render(<WorkbenchView initialSymbol="TEST" />);
    await runCalendar();
    await flush();
    // No candle rendered from stale data
    expect(screen.queryByTestId('wb-candle-2026-01-05-wick')).toBeNull();
    expect(screen.queryByTestId('wb-candle-2026-01-05-body')).toBeNull();
    // Calendar result preserved
    expect(screen.getByTestId('wb-calendar-current').textContent).toContain('20');
    expect(screen.getByTestId('wb-calendar-peak').textContent).toContain('2026-01-05');
    // Stale disclosure visible, focusable, contains Stale and age/reason, not Live
    const note = screen.getByTestId('wb-candle-disclosure');
    expect(note.getAttribute('data-stale')).toBe('true');
    expect(note.textContent).toContain('Stale');
    expect(note.textContent).toMatch(/95s|age/);
    expect(note.getAttribute('tabindex')).toBe('0');
    expect(note.textContent).not.toContain('Live');
  });

  it('(e) stale copy is gone; calendar header/current/peak/domain/same-frame, null-vs-zero and mobile wb-calendar remain', async () => {
    (globalThis as { fetch?: unknown }).fetch = candleFetch({ symbol: 'TEST', bars: [] }, 404);
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    render(<WorkbenchView initialSymbol="TEST" />);
    await runCalendar();
    expect(screen.queryByText(/calendar surface are unimplemented/)).toBeNull();
    expect(screen.queryByText(/history, and calendar surface/)).toBeNull();
    expect(screen.getByText(/shown only where a verified bar matches an exact calendar date/)).toBeTruthy();
    const cal = screen.getByTestId('wb-calendar');
    expect(cal.textContent).toContain('CALENDAR GAMMA');
    expect(screen.getByTestId('wb-calendar-current')).toBeTruthy();
    expect(screen.getByTestId('wb-calendar-peak')).toBeTruthy();
    expect(screen.getByTestId('wb-calendar-domain').textContent).toContain('same frame');
    expect(cal.textContent).toContain('—');
    expect(screen.getByTestId('wb-candle-disclosure')).toBeTruthy();
    expect(screen.getByTestId('wb-grid-GAMMA')).toBeTruthy();
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
  });

  it('(F1) calendar title keeps the full UTC-clock disclaimer and wraps on 390px mobile', async () => {
    (globalThis as { fetch?: unknown }).fetch = candleFetch({ symbol: 'TEST', bars: [] }, 404);
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    render(<WorkbenchView initialSymbol="TEST" />);
    await runCalendar();
    const title = screen.getByTestId('wb-calendar-title');
    // Complete semantic disclaimer preserved verbatim in the rendered mobile UI.
    expect(title.textContent).toContain('scenario valuation at the reference UTC clock — not exchange settlement');
    expect(title.textContent).toContain('CALENDAR GAMMA');
    // Mobile layout behavior: wrapping enabled, truncation disabled.
    const cls = title.getAttribute('class') ?? '';
    expect(cls).toMatch(/break-words/);
    expect(cls).toMatch(/whitespace-normal/);
    expect(cls).not.toMatch(/truncate/);
    expect(cls).not.toMatch(/nowrap/);
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
  });

  it('(F2) calendar title sticks to the nested scrollport so it stays painted at 390px mobile', async () => {
    (globalThis as { fetch?: unknown }).fetch = candleFetch({ symbol: 'TEST', bars: [] }, 404);
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    render(<WorkbenchView initialSymbol="TEST" />);
    await runCalendar();
    const title = screen.getByTestId('wb-calendar-title');
    // Scroll-anchoring contract: the title remains anchored at the scrollport top when the
    // taller-than-viewport calendar section is centered or partially scrolled, instead of
    // parking above the clip edge underneath the persistent GEX/print strips.
    const cls = title.getAttribute('class') ?? '';
    expect(cls).toMatch(/(^|\s)sticky(\s|$)/);
    expect(cls).toMatch(/top-0/);
    // Opaque page background + stacking so grid rows scrolling underneath never show through.
    expect(cls).toMatch(/bg-background/);
    expect(cls).not.toMatch(/bg-transparent/);
    expect(cls).toMatch(/z-10/);
    // Section-level scroll margin keeps programmatic scrolls clear of the persistent strips.
    expect(screen.getByTestId('wb-calendar').getAttribute('class') ?? '').toMatch(/scroll-mt-2/);
    // Anchoring never abbreviates the semantic disclaimer.
    expect(title.textContent).toContain('scenario valuation at the reference UTC clock — not exchange settlement');
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
  });
});

/** REF-04 T4a: keyboard-operable gamma↔DEX pressure selector over the same frame, no refetch. */
function dexEnvelope() {
  const env = envelope() as unknown as { data: Record<string, unknown> };
  const gex = env.data.gex as { cells: { value: number | null }[][] };
  env.data.dex = {
    ...(gex as unknown as Record<string, unknown>),
    metric: 'dex',
    units: '$Δ notional',
    cells: [[{ value: 1100, included: 2, excludedExpired: 0, missing: 0, reasons: [] }, { value: 990, included: 2, excludedExpired: 0, missing: 0, reasons: [] }], [{ value: 2200, included: 2, excludedExpired: 0, missing: 0, reasons: [] }, { value: 1980, included: 2, excludedExpired: 0, missing: 0, reasons: [] }], [{ value: 550, included: 2, excludedExpired: 0, missing: 0, reasons: [] }, { value: 440, included: 2, excludedExpired: 0, missing: 0, reasons: [] }]],
    methodology: { version: 'exposure-grid/v1', dexUnits: '$Δ notional (signed kernel δ·S·OI·mult; call δ ≥ 0, put δ ≤ 0, no side negation)' },
  };
  return env;
}

describe('WorkbenchView REF-04 T4a', () => {
  it('T4a-U1: pressure selector switches GAMMA↔DEX grids locally with distinct units and no refetch', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('/api/v1/analytics/positioning/workbench')) {
        return new Response(JSON.stringify(dexEnvelope()), { status: 200 });
      }
      return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    render(<WorkbenchView initialSymbol="TEST" />);
    const callsAfterRun = await runWorkbench(fetchMock);
    expect(callsAfterRun).toBe(1);
    const frameText = screen.getByText(/TEST\|2026-01-05/).textContent;
    // Default is gamma with its own units, legend, and methodology.
    expect(screen.getByTestId('wb-grid-GAMMA')).toBeTruthy();
    expect(screen.queryByTestId('wb-grid-DEX-Δ')).toBeNull();
    expect(screen.getByTestId('wb-pressure-gex').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('wb-pressure-echo').textContent).toContain('metric: gex ($/1% move)');
    // Switch to DEX: distinct grid, units, labels, and methodology — same frame, no fetch, no stale flag.
    fireEvent.click(screen.getByTestId('wb-pressure-dex'));
    expect(screen.getByTestId('wb-grid-DEX-Δ')).toBeTruthy();
    expect(screen.queryByTestId('wb-grid-GAMMA')).toBeNull();
    expect(screen.getByTestId('wb-pressure-dex').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('wb-pressure-echo').textContent).toContain('metric: dex ($Δ notional)');
    expect(screen.getByTestId('wb-pressure-echo').textContent).toContain('no refetch');
    // Charm panel is untouched and the frame identity is unchanged.
    expect(screen.getByTestId('wb-grid-CHARM')).toBeTruthy();
    expect(screen.getByText(/TEST\|2026-01-05/).textContent).toBe(frameText);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('workbench')).length).toBe(callsAfterRun);
    expect(screen.queryByText(/result stale until Run/)).toBeNull();
    // Keyboard: ArrowLeft on DEX returns to gamma; radio roles are exposed.
    fireEvent.keyDown(screen.getByTestId('wb-pressure-dex'), { key: 'ArrowLeft' });
    expect(screen.getByTestId('wb-grid-GAMMA')).toBeTruthy();
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('workbench')).length).toBe(callsAfterRun);
  });

  it('T4a-U2: missing DEX grid renders an Unavailable disclosure, never a fabricated fallback', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('/api/v1/analytics/positioning/workbench')) {
        return new Response(JSON.stringify(envelope()), { status: 200 });
      }
      return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    render(<WorkbenchView initialSymbol="TEST" />);
    await runWorkbench(fetchMock);
    fireEvent.click(screen.getByTestId('wb-pressure-dex'));
    const note = await screen.findByTestId('wb-dex-unavailable');
    expect(note.textContent).toContain('DEX unavailable for this frame');
    expect(note.textContent).toContain('no fallback grid is fabricated');
    expect(screen.queryByTestId('wb-grid-DEX-Δ')).toBeNull();
    // Charm of the same frame remains rendered; switching back restores gamma.
    expect(screen.getByTestId('wb-grid-CHARM')).toBeTruthy();
    fireEvent.click(screen.getByTestId('wb-pressure-gex'));
    expect(screen.getByTestId('wb-grid-GAMMA')).toBeTruthy();
  });
});

/** REF-04 T4b: synchronized hover (exact-match only), workbench-local profile
    strike zoom, and truthful key-level state. Pure presentation over the
    shipped frame: no route/contract/OpenAPI/MCP change, no refetch. */
function t4bFetch(body: () => unknown) {
  return vi.fn(async (input: unknown) => {
    if (String(input).includes('/api/v1/analytics/positioning/workbench')) {
      return new Response(JSON.stringify(body()), { status: 200 });
    }
    return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
  });
}

function nullCellEnvelope() {
  const env = enrichedEnvelope() as unknown as { data: { gex: { cells: { value: number | null; included: number; excludedExpired: number; missing: number; reasons: string[] }[][] } } };
  env.data.gex.cells[1]![0] = { value: null, included: 0, excludedExpired: 2, missing: 2, reasons: ['expired'] };
  return env;
}

describe('WorkbenchView REF-04 T4b', () => {
  it('T4b-H1: profile→grid exact match shows sibling markers/readouts with each grid\'s own cell', async () => {
    (globalThis as { fetch?: unknown }).fetch = t4bFetch(() => enrichedEnvelope());
    render(<WorkbenchView initialSymbol="TEST" />);
    await runWorkbench(vi.fn());
    const frameText = screen.getByText(/TEST\|2026-01-05/).textContent;
    fireEvent.mouseEnter(screen.getByTestId('wb-profile-row-100.0'));
    const sync = screen.getByTestId('wb-hover-sync');
    expect(sync.getAttribute('role')).toBe('status');
    expect(sync.textContent).toContain('profile strike 100.0');
    expect(sync.textContent).toContain('GAMMA 100.00:');
    expect(sync.textContent).toContain('CHARM 100.00:');
    expect(sync.textContent).not.toContain('no matching hypothetical price node');
    expect(screen.getByTestId('wb-sync-mark-GAMMA').textContent).toContain('synced 100.00');
    expect(screen.getByTestId('wb-sync-mark-CHARM').textContent).toContain('synced 100.00');
    // Existing profile facts stay the source of call/put/combined truth.
    expect(screen.getByTestId('wb-profile-live').textContent).toContain('Strike 100.0');
    expect(screen.getByText(/TEST\|2026-01-05/).textContent).toBe(frameText);
  });

  it('T4b-H2: grid→profile exact match marks the listed strike with profile facts', async () => {
    (globalThis as { fetch?: unknown }).fetch = t4bFetch(() => enrichedEnvelope());
    render(<WorkbenchView initialSymbol="TEST" />);
    await runWorkbench(vi.fn());
    fireEvent.mouseEnter(screen.getByTestId('wb-grid-row-GAMMA-100.00'));
    const sync = screen.getByTestId('wb-hover-sync');
    expect(sync.textContent).toContain('GAMMA 100.00');
    expect(sync.textContent).toContain('profile strike 100.0');
    expect(sync.textContent).not.toContain('no matching listed strike');
    expect(screen.getByTestId('wb-sync-mark-profile').textContent).toContain('synced strike 100.0');
    expect(screen.getByTestId('wb-sync-mark-CHARM').textContent).toContain('synced 100.00');
  });

  it('T4b-H3: unmatched hypothetical/listed strikes state no-match and draw no marker', async () => {
    (globalThis as { fetch?: unknown }).fetch = t4bFetch(() => enrichedEnvelope());
    render(<WorkbenchView initialSymbol="TEST" />);
    await runWorkbench(vi.fn());
    // Listed strike 110 has no hypothetical price node: explicit message, no markers, no carried value.
    fireEvent.mouseEnter(screen.getByTestId('wb-profile-row-110.0'));
    let sync = screen.getByTestId('wb-hover-sync');
    expect(sync.textContent).toContain('profile strike 110.0');
    expect(sync.textContent).toContain('no matching hypothetical price node');
    expect(screen.queryByTestId('wb-sync-mark-GAMMA')).toBeNull();
    expect(screen.queryByTestId('wb-sync-mark-CHARM')).toBeNull();
    expect(screen.queryByTestId('wb-sync-mark-profile')).toBeNull();
    // Hypothetical-only price 95 names no listed strike: explicit message, no profile bar fabricated.
    fireEvent.mouseEnter(screen.getByTestId('wb-grid-row-GAMMA-95.00'));
    sync = screen.getByTestId('wb-hover-sync');
    expect(sync.textContent).toContain('no matching listed strike');
    expect(screen.queryByTestId('wb-sync-mark-profile')).toBeNull();
  });

  it('T4b-H4: null/expired sibling cell stays Unavailable with reasons, never zero-filled', async () => {
    (globalThis as { fetch?: unknown }).fetch = t4bFetch(() => nullCellEnvelope());
    render(<WorkbenchView initialSymbol="TEST" />);
    await runWorkbench(vi.fn());
    fireEvent.mouseEnter(screen.getByTestId('wb-profile-row-100.0'));
    const sync = screen.getByTestId('wb-hover-sync');
    expect(sync.textContent).toContain('GAMMA 100.00: Unavailable (expired)');
    expect(sync.textContent).toContain('CHARM 100.00:');
    expect(sync.textContent).not.toMatch(/GAMMA 100\.00: \+?0(\.0+)?( |$)/);
    expect(screen.getByTestId('wb-sync-mark-GAMMA')).toBeTruthy();
  });

  it('T4b-H5: mouse-leave/Escape clear the shared marker; selected-time/charm-time and frame stay', async () => {
    (globalThis as { fetch?: unknown }).fetch = t4bFetch(() => enrichedEnvelope());
    render(<WorkbenchView initialSymbol="TEST" />);
    await runWorkbench(vi.fn());
    const frameText = screen.getByText(/TEST\|2026-01-05/).textContent;
    const slider = screen.getByLabelText('Linked valuation time across panels') as HTMLInputElement;
    expect(slider.value).toBe('0');
    const row = screen.getByTestId('wb-profile-row-100.0');
    fireEvent.mouseEnter(row);
    expect(screen.getByTestId('wb-hover-sync').textContent).toContain('profile strike 100.0');
    fireEvent.mouseLeave(row);
    expect(screen.getByTestId('wb-hover-sync').textContent).toContain('No shared hover');
    expect(screen.queryByTestId('wb-sync-mark-GAMMA')).toBeNull();
    fireEvent.mouseEnter(row);
    fireEvent.keyDown(screen.getByTestId('wb-hover-sync'), { key: 'Escape' });
    expect(screen.getByTestId('wb-hover-sync').textContent).toContain('No shared hover');
    expect((screen.getByLabelText('Linked valuation time across panels') as HTMLInputElement).value).toBe('0');
    expect(screen.getByText(/TEST\|2026-01-05/).textContent).toBe(frameText);
    // Existing click-to-select time behavior is unchanged.
    fireEvent.change(screen.getByLabelText('Linked valuation time across panels'), { target: { value: '1' } });
    expect((screen.getByLabelText('Linked valuation time across panels') as HTMLInputElement).value).toBe('1');
  });

  it('T4b-Z1: profile zoom narrows chart/table together, clamps, leaves heatmap zoom/frame, Reset/Run restore', async () => {
    const fetchMock = t4bFetch(() => enrichedEnvelope());
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    render(<WorkbenchView initialSymbol="TEST" />);
    await runWorkbench(fetchMock);
    const wbCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('workbench')).length;
    expect(wbCalls()).toBe(1);
    const frameText = screen.getByText(/TEST\|2026-01-05/).textContent;
    const rows = () => screen.getByLabelText('Strike profile values').querySelectorAll('tbody tr').length;
    expect(rows()).toBe(2);
    expect(screen.getByTestId('wb-profile-zoom-echo').textContent).toContain('2 of 2 strikes');
    // Narrow to one strike: table follows, heatmap zoom and frame do not move.
    fireEvent.change(screen.getByTestId('wb-profile-zoom-hi'), { target: { value: '0' } });
    expect(rows()).toBe(1);
    expect(screen.getByTestId('wb-profile-zoom-echo').textContent).toContain('1 of 2 strikes');
    expect((screen.getByLabelText('Gamma zoom high') as HTMLInputElement).value).toBe('2');
    expect(screen.getByText(/TEST\|2026-01-05/).textContent).toBe(frameText);
    expect(wbCalls()).toBe(1);
    // Invalid range clamps instead of emptying or crashing.
    fireEvent.change(screen.getByTestId('wb-profile-zoom-lo'), { target: { value: '5' } });
    expect(rows()).toBe(1);
    // Reset views restores the full slice with no refetch.
    fireEvent.click(screen.getByRole('button', { name: 'Reset views' }));
    expect(rows()).toBe(2);
    expect(screen.getByTestId('wb-profile-zoom-echo').textContent).toContain('2 of 2 strikes');
    expect(wbCalls()).toBe(1);
    // A new Run restores the full range as well.
    fireEvent.change(screen.getByTestId('wb-profile-zoom-hi'), { target: { value: '0' } });
    expect(rows()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Run workbench' }));
    await screen.findByTestId('wb-profile');
    expect(rows()).toBe(2);
    expect(screen.getByText(/TEST\|2026-01-05/).textContent).toBe(frameText);
  });

  it('T4b-K1: wb-key-levels is role=status, focusable, Unavailable, with no drawn overlay', async () => {
    (globalThis as { fetch?: unknown }).fetch = t4bFetch(() => enrichedEnvelope());
    render(<WorkbenchView initialSymbol="TEST" />);
    await runWorkbench(vi.fn());
    const key = screen.getByTestId('wb-key-levels');
    expect(key.getAttribute('role')).toBe('status');
    expect(key.getAttribute('tabindex')).toBe('0');
    expect(key.textContent).toContain('Key levels — Unavailable');
    expect(key.textContent).toContain('no overlay is drawn');
    expect(key.textContent).toContain('out of scope');
    expect(screen.queryByTestId('wb-key-level-overlay')).toBeNull();
    expect(screen.queryByTestId('wb-key-level-line')).toBeNull();
    // wb-balance-test is preserved alongside.
    expect(screen.getByTestId('wb-balance-test')).toBeTruthy();
    // Shared status is keyboard reachable too.
    expect(screen.getByTestId('wb-hover-sync').getAttribute('tabindex')).toBe('0');
  });

  it('T4b-F1: hover/zoom/metric/unit/link interactions add zero requests and retain frame identity', async () => {
    const fetchMock = t4bFetch(() => dexEnvelope());
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    render(<WorkbenchView initialSymbol="TEST" />);
    await runWorkbench(fetchMock);
    const wbCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('workbench')).length;
    expect(wbCalls()).toBe(1);
    const frameText = screen.getByText(/TEST\|2026-01-05/).textContent;
    const linkEcho = screen.getByTestId('wb-link-echo').textContent;
    fireEvent.mouseEnter(screen.getByTestId('wb-profile-row-100.0'));
    fireEvent.mouseEnter(screen.getByTestId('wb-grid-row-GAMMA-100.00'));
    fireEvent.change(screen.getByTestId('wb-profile-zoom-hi'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('wb-profile-zoom-hi'), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('wb-pressure-dex'));
    fireEvent.mouseEnter(screen.getByTestId('wb-grid-row-DEX-Δ-100.00'));
    fireEvent.click(screen.getByTestId('wb-pressure-gex'));
    fireEvent.click(screen.getByTestId('wb-profile-units-contracts'));
    fireEvent.click(screen.getByTestId('wb-profile-units-gex'));
    fireEvent.click(screen.getByLabelText('Link price range'));
    expect(wbCalls()).toBe(1);
    expect(screen.getByText(/TEST\|2026-01-05/).textContent).toBe(frameText);
    expect(screen.getByTestId('wb-link-echo').textContent).toBe(linkEcho);
    expect(screen.getByTestId('wb-pressure-echo').textContent).toContain('no refetch');
    expect(screen.getByTestId('wb-profile-units-echo').textContent).toContain('no refetch');
    // Link toggles mark a local stale-edit hint (pre-existing assumption behavior)
    // without sending any request; the displayed frame and server echo are untouched.
    expect(screen.getByTestId('wb-link-echo').textContent).toBe(linkEcho);
  });
});
