import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { VolStructureView } from './VolStructureView';

const mockState: Record<string, any> = {
  deskSectionId: 'vol-sub-surface', snapshot: null, loading: false, fmpHistory: null, chainUsed: 'yfinance', symbol: 'SPY', setDeskContext: vi.fn(),
};
vi.mock('../../store/terminalStore', () => ({
  useTerminalStore: (sel: any) => sel(mockState),
}));
vi.mock('../../lib/market/deskJump', () => ({ consumeDeskJumpOnMount: vi.fn() }));
vi.mock('../common/GexLevelsStrip', () => ({ GexLevelsStrip: () => <div /> }));
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) => <div data-testid="recharts-viewport-mock">{children}</div>,
  };
});
if (!(globalThis as any).ResizeObserver) {
  (globalThis as any).ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
}

function makeSnap(stale = false, extraExpiries = 0) {
  const base = {
    symbol: 'SPY', spot: 500, riskFreeRate: 0.04, dividendYield: 0.01,
    timestamp: stale ? Date.now() - 97*3600_000 : Date.now(),
    expiries: [
      {
        expiry: '2026-09-19', dte: 10, atmIV: 0.2,
        calls: [
          { strike:505, expiry:'2026-09-19', type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.20, delta:0.50, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 },
          { strike:520, expiry:'2026-09-19', type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.22, delta:0.25, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 },
        ], puts: [
          { strike:495, expiry:'2026-09-19', type:'put', bid:1, ask:2, last:1.5, mid:1.5, iv:0.21, delta:-0.49, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 },
          { strike:480, expiry:'2026-09-19', type:'put', bid:1, ask:2, last:1.5, mid:1.5, iv:0.24, delta:-0.25, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 },
          { strike:460, expiry:'2026-09-19', type:'put', bid:1, ask:2, last:1.5, mid:1.5, iv:0.32, delta:-0.10, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 },
        ]
      },
      {
        expiry: '2026-10-17', dte: 38, atmIV: 0.2,
        calls: [{ strike:500, expiry:'2026-10-17', type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.19, delta:0.51, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 }],
        puts: [{ strike:500, expiry:'2026-10-17', type:'put', bid:1, ask:2, last:1.5, mid:1.5, iv:0.195, delta:-0.48, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 }],
      },
    ]
  } as any;
  for (let i=0;i<extraExpiries;i++) base.expiries.push({ expiry:`2027-01-${String(i+1).padStart(2,'0')}`, dte: 60+i*7, atmIV:0.2, calls:[{ strike:500, expiry:`2027-01-${String(i+1).padStart(2,'0')}`, type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.2, delta:0.5, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 }], puts:[{ strike:500, expiry:`2027-01-${String(i+1).padStart(2,'0')}`, type:'put', bid:1, ask:2, last:1.5, mid:1.5, iv:0.2, delta:-0.5, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 }] });
  return base;
}

describe('VolStructureView skew corrections', () => {
  beforeEach(() => {
    mockState.loading = false; mockState.snapshot = null; mockState.fmpHistory = null; mockState.chainUsed='yfinance'; mockState.symbol='SPY';
    history.replaceState(null,'','/');
  });
  it('loading state', () => {
    mockState.loading = true;
    render(<VolStructureView />);
    expect(screen.getByTestId('vol-skew-section')).toBeInTheDocument();
  });
  it('wings table shows strike and delta per selected leg', () => {
    mockState.snapshot = makeSnap();
    render(<VolStructureView />);
    const cell = screen.getByTestId('vol-skew-cell-0-25ΔC');
    expect(cell.textContent).toMatch(/520/);
    expect(cell.textContent).toMatch(/0\.25/);
    expect(cell.getAttribute('title')).toMatch(/strike 520/);
    expect(cell.getAttribute('title')).toMatch(/Derived/);
  });
  it('ATM proxy labelled as 50Δ average at possibly different strikes', () => {
    mockState.snapshot = makeSnap();
    render(<VolStructureView />);
    expect(screen.getByTestId('vol-skew-atm-label').textContent).toMatch(/50Δ proxy/);
    expect(screen.getByTestId('vol-skew-atm-label').textContent).toMatch(/different strikes/);
    // tooltip for ATM cell discloses strikes
    const atmCell = screen.getByTestId('vol-skew-cell-0-ATM');
    expect(atmCell.getAttribute('title')).toMatch(/different strikes|call strike/);
  });
  it('ATM null when leg missing — shows dash with unavailable tooltip', () => {
    const s = makeSnap();
    s.expiries[0].puts = [];
    mockState.snapshot = s;
    render(<VolStructureView />);
    const atmCell = screen.getByTestId('vol-skew-cell-0-ATM');
    expect(atmCell.textContent).toContain('—');
    expect(atmCell.getAttribute('title')).toMatch(/null when either leg missing/);
  });
  it('overlapping bucket reuse is disclosed', () => {
    const s: any = { symbol:'SPY', spot:500, riskFreeRate:0.04, dividendYield:0.01, timestamp:Date.now(), expiries:[{ expiry:'2026-09-19', dte:10, atmIV:0.2, calls:[{ strike:500, expiry:'2026-09-19', type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.20, delta:0.50, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 }, { strike:520, expiry:'2026-09-19', type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.22, delta:0.18, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 }], puts:[{ strike:480, expiry:'2026-09-19', type:'put', bid:1, ask:2, last:1.5, mid:1.5, iv:0.24, delta:-0.18, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 }] }] };
    mockState.snapshot = s;
    render(<VolStructureView />);
    expect(screen.getByTestId('vol-skew-reuse-note')).toBeInTheDocument();
  });
  it('expiry cap displayed vs available coverage', () => {
    mockState.snapshot = makeSnap(false, 12); // total 14 >10
    render(<VolStructureView />);
    expect(screen.getByTestId('vol-skew-cap')).toBeInTheDocument();
    expect(screen.getByTestId('vol-skew-cap').textContent).toMatch(/14/);
    expect(screen.getByTestId('vol-skew-wings-cap')).toBeInTheDocument();
  });
  it('expired/nonfinite DTE forward stays null with reason, not clamped', () => {
    const s: any = { symbol:'SPY', spot:500, riskFreeRate:0.04, dividendYield:0.01, timestamp:Date.now(), expiries:[
      { expiry:'2026-09-19', dte:10, atmIV:0.2, calls:[{ strike:500, expiry:'2026-09-19', type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.20, delta:0.50, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 }], puts:[{ strike:500, expiry:'2026-09-19', type:'put', bid:1, ask:2, last:1.5, mid:1.5, iv:0.20, delta:-0.50, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 }] },
      { expiry:'2026-09-01', dte:0, atmIV:0.2, calls:[{ strike:500, expiry:'2026-09-01', type:'call', bid:1, ask:2, last:1.5, mid:1.5, iv:0.22, delta:0.50, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 }], puts:[{ strike:500, expiry:'2026-09-01', type:'put', bid:1, ask:2, last:1.5, mid:1.5, iv:0.22, delta:-0.50, gamma:0.01, theta:-0.1, vega:0.5, volume:10, openInterest:10 }] },
    ]};
    mockState.snapshot = s;
    const { container } = render(<VolStructureView />);
    expect(container.textContent).toMatch(/expired\/nonfinite DTE/);
    expect(container.textContent).not.toMatch(/Infinity|NaN/);
  });
  it('derived labels present and no observed-only claim', () => {
    mockState.snapshot = makeSnap();
    const { container } = render(<VolStructureView />);
    expect(container.textContent).toMatch(/Derived/);
    expect(container.textContent).not.toMatch(/Observed mark IV only/);
    expect(container.textContent).not.toMatch(/ATM IV \(obs\)/);
  });
  it('symbol/provider labels use current selection, not hardcoded SPY only', () => {
    mockState.snapshot = { ...makeSnap(), symbol: 'AAPL' };
    mockState.symbol = 'AAPL';
    mockState.chainUsed = 'fmp';
    render(<VolStructureView />);
    expect(screen.getByTestId('vol-skew-section').textContent).toMatch(/AAPL/);
    expect(screen.getByTestId('vol-skew-section').textContent).toMatch(/FMP/);
  });
  it('provider-down/no-snapshot reflects current symbol/provider', () => {
    mockState.snapshot = null; mockState.loading = false; mockState.symbol='QQQ'; mockState.chainUsed='yfinance';
    render(<VolStructureView />);
    const txt = screen.getByTestId('vol-skew-section').textContent ?? '';
    expect(txt).toMatch(/QQQ/);
    expect(txt).toMatch(/yfinance/);
  });
  it('RR bar and accessible derived table with strike/delta', () => {
    mockState.snapshot = makeSnap();
    render(<VolStructureView />);
    expect(screen.getByTestId('vol-skew-rr-bar')).toBeInTheDocument();
    expect(screen.getByLabelText('25 delta risk reversal derived')).toBeInTheDocument();
    expect(screen.getByTestId('vol-skew-section').textContent).toMatch(/520 @/);
  });
  it('j/k navigation retained', () => {
    mockState.snapshot = makeSnap();
    render(<VolStructureView />);
    const wrap = screen.getByTestId('vol-skew-wings-wrap');
    wrap.focus();
    fireEvent.keyDown(wrap, { key: 'j' });
    expect(screen.getByTestId('vol-skew-wings-row-1')).toHaveAttribute('aria-selected','true');
    fireEvent.keyDown(wrap, { key: 'k' });
    expect(screen.getByTestId('vol-skew-wings-row-0')).toHaveAttribute('aria-selected','true');
  });
  it('surface panel and skew diagnostics stack without clamping (mobile 3D-row overlap guard)', () => {
    mockState.snapshot = makeSnap();
    render(<VolStructureView />);
    const root = screen.getByTestId('vol-structure-view');
    // Middle section keeps grow-to-fill but must never clamp below content height
    // (min-h-0 + flex-1 collapses it to 0px at 390px, letting the skew RR SVG
    // paint over the surface 3D header row). jsdom has no layout, so lock the class contract.
    const mid = Array.from(root.children).find((el) => el.classList.contains('min-h-fit')) as HTMLElement | undefined;
    expect(mid).toBeTruthy();
    expect(mid!.classList.contains('shrink-0')).toBe(true);
    expect(mid!.classList.contains('flex-1')).toBe(true);
    expect(mid!.classList.contains('min-h-0')).toBe(false);
    // Skew diagnostics remain a following sibling section (sequential stacking, root scrolls).
    const skew = screen.getByTestId('vol-skew-section');
    expect(skew).toBeInTheDocument();
    expect(mid!.contains(skew)).toBe(false);
    expect(skew.compareDocumentPosition(mid!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    // Preserved accessibility contracts.
    expect(screen.getByTestId('vol-skew-wings-wrap')).toHaveAttribute('role', 'region');
    expect(screen.getByTestId('vol-skew-wings-wrap')).toHaveAttribute('tabindex', '0');
  });
  it('no NaN Infinity rendered', () => {
    mockState.snapshot = makeSnap();
    const { container } = render(<VolStructureView />);
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });
});
