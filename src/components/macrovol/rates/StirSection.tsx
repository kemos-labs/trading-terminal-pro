import { useMemo, useRef, type ReactNode } from 'react';
import type { ImplyRead, StirContract, StirStripData } from '../../../lib/macrovol/api';
import { DataBadge } from '../DataBadge';
import { CollapsibleSection } from '../../terminal/CollapsibleSection';
import { ImplyChip } from '../../common/ImplyDrawer';
import { EmptyState } from '../../common/EmptyState';
import { ExportCsvButton } from '../../common/ExportCsvButton';
import {
  useBoardFocus,
  useRegisterBoard,
  type FocusableBoardApi,
} from '../../../hooks/useBoardFocus';
import { SerffBoard } from './SerffBoard';
import { CalendarPacksBoard } from './CalendarPacksBoard';
import { SofrFuturesCurve, type SofrCurvePoint } from './SofrFuturesCurve';

/** Dense CME-style header cells — fill full width (no fixed-width dead gutter). */
const SR3_COLS =
  'grid grid-cols-[0.9fr_1fr_0.85fr_0.85fr_0.85fr_0.75fr_0.75fr_0.9fr_0.9fr_0.75fr_1.2fr] gap-x-1 items-center';

function fmtPx(v: number | null | undefined, d = 2): string {
  return v != null && Number.isFinite(v) ? v.toFixed(d) : '—';
}

/** Count contracts whose source is exactly the observed token 'live'.
 * Absent, empty, null, uppercase, or whitespace-padded values are not live. */
export function countLiveContracts(rows: StirContract[] | undefined): number {
  return (rows || []).filter((c) => c.source === 'live').length;
}

/** Map one STIR leg's fetched contracts to curve points (REF07/N3a-small plumbing). */
export function toLegCurve(rows: StirContract[] | undefined, sofr: number | null): SofrCurvePoint[] {
  return (rows || []).map((c) => {
    const settlePx = c.settlement ?? c.prev_close ?? null;
    const prior =
      settlePx != null && Number.isFinite(settlePx) && settlePx > 50 ? 100 - settlePx : null;
    const implied = c.implied_rate ?? null;
    const finiteImplied = implied != null && Number.isFinite(implied) ? implied : null;
    const finiteLast = c.last_price != null && Number.isFinite(c.last_price) ? c.last_price : null;
    // Pass through optional reference-quarter provenance only when a finite non-empty
    // source string is present; absent/empty/non-string values stay null (Unavailable).
    const refs = c as { ref_start?: unknown; ref_end?: unknown };
    const refStart =
      typeof refs.ref_start === 'string' && refs.ref_start.trim() !== '' ? refs.ref_start : null;
    const refEnd =
      typeof refs.ref_end === 'string' && refs.ref_end.trim() !== '' ? refs.ref_end : null;
    return {
      x: c.month || c.contract,
      rate: implied,
      prior,
      vsSofr: sofr != null && finiteImplied != null ? (finiteImplied - sofr) * 100 : null,
      source: c.source,
      contract: c.contract,
      ref_start: refStart,
      ref_end: refEnd,
      futures_price: finiteLast ?? (finiteImplied != null ? 100 - finiteImplied : null),
    };
  });
}

function fmtNet(v: number | null | undefined, d = 3): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v >= 0 ? `+${v.toFixed(d)}` : v.toFixed(d);
}

function BoardShell({
  title,
  badge,
  actions,
  children,
  className = '',
  scrollKey,
  scrollLabel,
  hint,
}: {
  title: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  scrollKey?: string;
  scrollLabel?: string;
  hint?: ReactNode;
}) {
  return (
    <div className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded border border-border bg-background/30 ${className}`}>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-background/60 px-1.5 py-0.5">
        <div className="min-w-0 flex-1 font-mono text-type-2xs font-semibold leading-tight text-foreground">
          {title}
          {badge != null && (
            <span className="ml-1.5 font-normal text-muted-foreground">{badge}</span>
          )}
        </div>
        {hint}
        {actions}
      </div>
      <div className="min-h-0 flex-1 overflow-auto" tabIndex={0} role="region" aria-label={scrollLabel ?? 'Scrollable data'} data-board-scroll={scrollKey} style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y' }}>{children}</div>
    </div>
  );
}

function DenseTableHead({ cols, trackClass = '' }: { cols: string[]; trackClass?: string }) {
  return (
    <div className={`sticky top-0 z-[1] grid border-b border-border bg-card/95 px-1.5 py-0.5 font-mono text-type-2xs text-muted-foreground ${trackClass}`}
      style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}
      data-track={trackClass || undefined}
    >
      {cols.map((c, i) => (
        <span
          key={c}
          className={i === 0 || i === 1 ? 'truncate text-left' : 'truncate text-right'}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

function DenseRow({
  cells,
  emphasize,
  onClick,
  selected,
  trackClass = '',
  identClass = '',
  numClass = '',
}: {
  cells: { text: string; className?: string; align?: 'left' | 'right' }[];
  emphasize?: boolean;
  onClick?: () => void;
  selected?: boolean;
  trackClass?: string;
  identClass?: string;
  numClass?: string;
}) {
  return (
    <div
      onClick={onClick}
      className={`grid items-center border-b border-border/40 px-1.5 py-0.5 font-mono text-type-2xs hover:bg-muted/20 ${
        onClick ? 'cursor-default' : ''
      } ${selected ? 'focus-ring-term-inset bg-primary/10' : ''} ${emphasize ? 'font-semibold' : ''} ${trackClass}`}
      style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
      data-track={trackClass || undefined}
    >
      {cells.map((cell, i) => (
        <span
          key={i}
          className={`truncate tabular-nums ${
            cell.align === 'left' || i < 2 ? 'text-left' : 'text-right'
          } ${cell.className || ''} ${i < 2 ? identClass : numClass}`}
        >
          {cell.text}
        </span>
      ))}
    </div>
  );
}

export function StirSection({
  stir,
  stirChart,
  onOpenImply,
}: {
  stir: StirStripData | null;
  /** Dual SOFR futures path (live + prior settle). Rendered above SR3 board. */
  stirChart: {
    x: string;
    rate: number | null;
    prior?: number | null;
    vsSofr: number | null;
    source?: string;
    contract?: string;
  }[];
  onOpenImply: (i: ImplyRead) => void;
}) {
  const { focused: stirFocused, rowIndex: stirRow, focusRow: focusStir } = useBoardFocus('stir-sr3');
  const sr3Ref = useRef<{ month: string; ticker: string; implied: number }[]>([]);
  const stirFocusApi = useMemo<FocusableBoardApi>(() => ({
    scrollToRow: () => {},
    getCellText: (row) => {
      const r = sr3Ref.current[row];
      return r ? `${r.ticker} ${r.implied}` : '';
    },
    rowCount: () => sr3Ref.current.length,
    colKeys: () => ['ticker', 'implied'],
  }), []);
  useRegisterBoard('stir-sr3', stirFocusApi);

  const liveSr3 = useMemo(
    () => (stir?.sr3 || []).filter((c) => c.implied_rate != null),
    [stir?.sr3],
  );
  const liveSr1 = useMemo(
    () => (stir?.sr1 || []).filter((c) => c.implied_rate != null),
    [stir?.sr1],
  );
  const liveTsy = useMemo(
    () => (stir?.treasury_futures || []).filter((c) => c.last_price != null),
    [stir?.treasury_futures],
  );

  sr3Ref.current = liveSr3.map((x) => ({
    month: x.month || '',
    ticker: x.ticker || x.contract,
    implied: x.implied_rate!,
  }));

  /**
   * REF07/N3a-small prop plumbing: map the already-fetched stir.sr1 / stir.zq
   * rows into curve points. No fetch, no math change — null/non-finite values
   * pass through untouched; availability is decided by the curve component.
   */
  const sr1Curve = useMemo<SofrCurvePoint[]>(
    () => toLegCurve(stir?.sr1, stir?.sofr ?? null),
    [stir?.sr1, stir?.sofr],
  );
  const zqCurve = useMemo<SofrCurvePoint[]>(
    () => toLegCurve(stir?.zq, stir?.sofr ?? null),
    [stir?.zq, stir?.sofr],
  );

  return (
    <CollapsibleSection
      id="sec-stir"
      className="order-4"
      title="STIR PATH (SOFR FUTURES)"
      apis={['yfinance', 'NYFed', 'FRED']}
      defaultOpen
      storageKey="rates.sec.stir"
      subtitle="Implied = 100 − price · dual path on CURVES · boards fill the desk"
    >
      {/* Compact strip implies + path stats — one dense row, no wasted cards */}
      {stir?.path && (
        <div className="mt-1 grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
          {stir.path.imply && (
            <div className="col-span-3 flex flex-wrap items-center gap-1.5 rounded border border-border bg-background/40 px-1.5 py-1 sm:col-span-4 md:col-span-6 xl:col-span-2">
              <span className="text-type-2xs text-muted-foreground">STRIP</span>
              <ImplyChip imply={stir.path.imply} onOpen={onOpenImply} />
              {stir.path.front_imply && (
                <ImplyChip imply={stir.path.front_imply} compact onOpen={onOpenImply} />
              )}
            </div>
          )}
          {[
            {
              label: 'SOFR',
              value: stir.sofr != null ? `${stir.sofr.toFixed(2)}%` : '—',
              cls: '',
            },
            {
              label: 'Path Δ',
              value:
                stir.path.path_change_bps != null
                  ? `${stir.path.path_change_bps >= 0 ? '+' : ''}${stir.path.path_change_bps}bp`
                  : '—',
              cls: (stir.path.path_change_bps ?? 0) < 0 ? 'text-up' : 'text-warn',
            },
            {
              label: '≈25bp',
              value:
                stir.path.approx_25bp_cuts_priced != null
                  ? `${Math.abs(stir.path.approx_25bp_cuts_priced).toFixed(2)}${
                      stir.path.approx_25bp_cuts_priced > 0
                        ? 'c'
                        : stir.path.approx_25bp_cuts_priced < 0
                          ? 'h'
                          : ''
                    }`
                  : '—',
              cls: '',
            },
            {
              label: 'Front vs S',
              value:
                stir.path.front_vs_sofr_bps != null
                  ? `${stir.path.front_vs_sofr_bps >= 0 ? '+' : ''}${stir.path.front_vs_sofr_bps}bp`
                  : '—',
              cls: '',
            },
            {
              label: 'End rate',
              value:
                stir.path.back?.implied_rate != null
                  ? `${Number(stir.path.back.implied_rate).toFixed(2)}%`
                  : '—',
              cls: '',
              sub: stir.path.back?.month || stir.path.back?.contract,
            },
            {
              label: 'Live',
              value: `${stir.live_count ?? liveSr3.length}/${stir.total_sr3 ?? liveSr3.length}`,
              cls: 'text-up',
            },
          ].map((c) => (
            <div key={c.label} className="rounded border border-border/80 px-1.5 py-1">
              <div className="text-type-2xs leading-none text-muted-foreground">{c.label}</div>
              <div className={`text-sm font-bold tabular-nums leading-tight ${c.cls}`}>{c.value}</div>
              {c.sub && (
                <div className="truncate text-type-2xs text-muted-foreground">{c.sub}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/*
        Invest free space: wide = SR3 left + (SR1 / Tsy) right column that stretches.
        No duplicate path chart (CurvesBoard owns the dual SOFR path).
      */}
      {/* Responsive STIR identifier readability (<=560px): SR3/SR1 keep a common
          header/body track with minimum column widths inside the existing
          board-local scrollers. Identifiers wrap instead of truncating to
          ellipsis; desktop/tablet layout above the boundary is unchanged.
          Treasury presentation is untouched. */}
      <style>{`
.stir-scroll-hint { display: none; }
@media (max-width: 560px) {
  .stir-scroll-hint { display: inline-block; }
  .stir-sr3-track {
    grid-template-columns: minmax(104px, 1.1fr) minmax(104px, 1.2fr) repeat(8, minmax(68px, 0.9fr)) minmax(110px, 1.2fr) !important;
    min-width: 860px;
  }
  .stir-sr1-track {
    grid-template-columns: minmax(104px, 1.1fr) minmax(104px, 1.2fr) repeat(6, minmax(68px, 0.9fr)) !important;
    min-width: 620px;
  }
  .stir-sr3-track .stir-ident,
  .stir-sr1-track .stir-ident {
    white-space: normal !important;
    overflow: visible !important;
    text-overflow: clip !important;
    overflow-wrap: anywhere !important;
    word-break: break-word !important;
  }
  .stir-sr3-track .stir-num,
  .stir-sr1-track .stir-num {
    overflow: visible !important;
    text-overflow: clip !important;
    white-space: nowrap !important;
  }
}
`}</style>
      {/* REF07 independent-leg reachability: the curve (with its existing per-leg
          controls) is always mounted so SR1/ZQ legs stay selectable when SR3
          is empty. Boards below keep their guarded layout/empty-state wording. */}
      <div className="mt-1.5">
        <SofrFuturesCurve
          data={stirChart}
          sr1Data={sr1Curve}
          zqData={zqCurve}
          asOf={stir?.as_of}
          height={260}
        />
      </div>
      {liveSr3.length > 0 ? (
        <>
          <div className="mt-1.5 grid grid-cols-1 items-stretch gap-1.5 xl:grid-cols-12">
          {/* ── 3M SOFR (SR3) — primary strip, takes most width ── */}
          <BoardShell
            className="xl:col-span-7 2xl:col-span-8"
            scrollKey="stir-sr3"
            scrollLabel="SR3 SOFR futures board data"
            hint={<span aria-hidden="true" className="stir-scroll-hint font-mono text-type-2xs text-muted-foreground">Scroll → for full strip</span>}
            title="3M SOFR FUTURES (SFR / SR3) · CME board"
            badge={`${countLiveContracts(liveSr3)} live${
              liveSr3.some((c) => c.source === 'settled')
                ? ` · ${liveSr3.filter((c) => c.source === 'settled').length} settled`
                : ''
            }`}
            actions={
              <ExportCsvButton
                filename={`sr3-strip-${new Date().toISOString().slice(0, 10)}`}
                headers={[
                  'Month', 'Ticker', 'Last', 'Change', 'Settlement',
                  'High', 'Low', 'Volume', 'Implied%', 'vsSOFR_bp',
                ]}
                rows={liveSr3.map((c) => {
                  const vs =
                    stir?.sofr != null && c.implied_rate != null
                      ? (c.implied_rate - stir.sofr) * 100
                      : null;
                  const net = c.net ?? c.change;
                  const last =
                    c.last_price ?? (c.implied_rate != null ? 100 - c.implied_rate : null);
                  const sett = c.settlement ?? c.prev_close;
                  return [
                    c.month, c.ticker || c.contract,
                    last, net, sett, c.high, c.low, c.volume,
                    c.implied_rate, vs != null ? vs.toFixed(1) : null,
                  ];
                })}
              />
            }
          >
            <div className={`${SR3_COLS} stir-sr3-track sticky top-0 z-[1] border-b border-border bg-card/95 px-1.5 py-0.5 font-mono text-type-2xs text-muted-foreground`} data-board="stir-sr3-head">
              <span className="stir-ident">Month</span>
              <span className="stir-ident">Ticker</span>
              <span className="text-right">Last</span>
              <span className="text-right">Chg</span>
              <span className="text-right">Sett</span>
              <span className="text-right">Hi</span>
              <span className="text-right">Lo</span>
              <span className="text-right">Vol</span>
              <span className="text-right">Impl%</span>
              <span className="text-right">vsS</span>
              <span>Imply</span>
            </div>
            {/* Natural-height rows: no virtualized empty viewport */}
            <div className="divide-y divide-border/30">
              {liveSr3.map((c, index) => {
                const vs =
                  stir?.sofr != null && c.implied_rate != null
                    ? (c.implied_rate - stir.sofr) * 100
                    : null;
                const net = c.net ?? c.change;
                const last =
                  c.last_price ?? (c.implied_rate != null ? 100 - c.implied_rate : null);
                const sett = c.settlement ?? c.prev_close;
                const ptImply = (stir?.path?.points || []).find(
                  (p) => p.contract === c.contract,
                )?.imply;
                return (
                  <div
                    key={c.contract}
                    onClick={() => focusStir(index, 'ticker')}
                    className={`${SR3_COLS} stir-sr3-track cursor-default px-1.5 py-[3px] font-mono text-type-2xs hover:bg-muted/20 ${
                      stirFocused && index === stirRow
                        ? 'focus-ring-term-inset bg-primary/10'
                        : ''
                    }`}
                    data-board="stir-sr3-row"
                  >
                    <span className={`truncate stir-ident ${c.source === 'settled' ? 'text-zinc-400' : 'text-muted-foreground'}`}>
                      {c.month}
                      {c.source === 'settled' ? ' · set' : ''}
                    </span>
                    <span className={`truncate stir-ident font-bold ${c.source === 'settled' ? 'text-zinc-400' : 'text-foreground'}`}>
                      {c.ticker || c.contract}
                    </span>
                    <span className="text-right tabular-nums font-semibold stir-num">
                      {fmtPx(last)}
                    </span>
                    <span
                      className={`text-right tabular-nums stir-num ${
                        net == null ? '' : net >= 0 ? 'text-up' : 'text-down'
                      }`}
                    >
                      {fmtNet(net)}
                    </span>
                    <span className="text-right tabular-nums text-muted-foreground stir-num">
                      {fmtPx(sett)}
                    </span>
                    <span className="text-right tabular-nums stir-num">{fmtPx(c.high)}</span>
                    <span className="text-right tabular-nums stir-num">{fmtPx(c.low)}</span>
                    <span className="text-right tabular-nums stir-num">
                      {c.volume != null ? c.volume.toLocaleString() : '—'}
                    </span>
                    <span className="text-right tabular-nums font-semibold stir-num">
                      {c.implied_rate!.toFixed(3)}
                    </span>
                    <span
                      className={`text-right tabular-nums stir-num ${
                        vs != null && vs < 0
                          ? 'text-up'
                          : vs != null && vs > 0
                            ? 'text-warn'
                            : ''
                      }`}
                    >
                      {vs != null ? `${vs >= 0 ? '+' : ''}${vs.toFixed(0)}` : '—'}
                    </span>
                    <span className="min-w-0 truncate">
                      <ImplyChip imply={ptImply} compact onOpen={onOpenImply} />
                    </span>
                  </div>
                );
              })}
            </div>
          </BoardShell>

          {/* ── Right stack: SR1 + Treasury fill remaining height ── */}
          <div className="grid min-h-0 grid-rows-2 gap-1.5 xl:col-span-5 2xl:col-span-4">
            <BoardShell
              title="1M SOFR (SR1) strip · SERFF near legs"
              badge={`${countLiveContracts(liveSr1)} live`}
              scrollKey="stir-sr1"
              scrollLabel="SR1 SOFR futures board data"
              hint={<span aria-hidden="true" className="stir-scroll-hint font-mono text-type-2xs text-muted-foreground">Scroll → for full strip</span>}
            >
              {liveSr1.length === 0 ? (
                <EmptyState
                  kind="no-data"
                  compact
                  title="No live SR1"
                  body="Strip empty or delayed — not silent zeros."
                />
              ) : (
                <>
                  <DenseTableHead
                    cols={['Month', 'Ticker', 'Last', 'Chg', 'Hi', 'Lo', 'Vol', 'Impl%']}
                    trackClass="stir-sr1-track"
                  />
                  {liveSr1.map((c) => (
                    <DenseRow
                      key={c.contract}
                      trackClass="stir-sr1-track"
                      identClass="stir-ident"
                      numClass="stir-num"
                      cells={[
                        { text: c.month || '—', align: 'left', className: 'text-muted-foreground' },
                        {
                          text: c.ticker || c.contract,
                          align: 'left',
                          className: 'font-bold text-foreground',
                        },
                        {
                          text: fmtPx(
                            c.last_price ?? (c.implied_rate != null ? 100 - c.implied_rate : null),
                          ),
                        },
                        {
                          text: fmtNet(c.net),
                          className:
                            c.net == null ? '' : c.net >= 0 ? 'text-up' : 'text-down',
                        },
                        { text: fmtPx(c.high) },
                        { text: fmtPx(c.low) },
                        {
                          text: c.volume != null ? c.volume.toLocaleString() : '—',
                        },
                        {
                          text: c.implied_rate != null ? c.implied_rate.toFixed(3) : '—',
                          className: 'font-semibold',
                        },
                      ]}
                    />
                  ))}
                </>
              )}
            </BoardShell>

            <BoardShell
              title="TREASURY FUTURES · ZT / ZF / ZN / TN / ZB / UB"
              badge={`${liveTsy.length} live`}
            >
              {liveTsy.length === 0 ? (
                <div className="p-2 text-type-2xs text-muted-foreground">
                  No live Treasury futures
                </div>
              ) : (
                <>
                  <DenseTableHead
                    cols={['Product', 'CC', 'Last', 'Chg', 'Hi', 'Lo', 'Vol']}
                  />
                  {liveTsy.map((c: StirContract) => (
                    <DenseRow
                      key={c.contract}
                      emphasize
                      cells={[
                        {
                          text: c.product || c.month || '—',
                          align: 'left',
                          className: 'text-muted-foreground',
                        },
                        {
                          text: c.ticker || c.contract,
                          align: 'left',
                          className: 'font-bold text-foreground',
                        },
                        { text: fmtPx(c.last_price, 4), className: 'font-semibold' },
                        {
                          text: fmtNet(c.net, 4),
                          className:
                            c.net == null ? '' : c.net >= 0 ? 'text-up' : 'text-down',
                        },
                        { text: fmtPx(c.high, 4) },
                        { text: fmtPx(c.low, 4) },
                        {
                          text: c.volume != null ? c.volume.toLocaleString() : '—',
                        },
                      ]}
                    />
                  ))}
                  {/* Fill leftover with a compact continuum strip so the panel isn't empty */}
                  {liveTsy.length > 0 && liveTsy.length < 10 && (
                    <div className="mt-auto border-t border-border/50 px-1.5 py-1 font-mono text-type-2xs text-muted-foreground">
                      <div className="mb-0.5 text-type-2xs uppercase tracking-wide text-zinc-400">
                        Curve continuum (last)
                      </div>
                      <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
                        {liveTsy.map((c) => (
                          <div
                            key={`chip-${c.contract}`}
                            className="rounded border border-border/60 bg-background/50 px-1 py-0.5 text-center"
                          >
                            <div className="truncate font-bold text-foreground">
                              {(c.ticker || c.contract).slice(0, 4)}
                            </div>
                            <div className="tabular-nums text-foreground">
                              {fmtPx(c.last_price, 2)}
                            </div>
                            <div
                              className={`tabular-nums ${
                                c.net == null
                                  ? 'text-muted-foreground'
                                  : c.net >= 0
                                    ? 'text-up'
                                    : 'text-down'
                              }`}
                            >
                              {fmtNet(c.net, 3)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </BoardShell>
          </div>
          </div>
        </>
      ) : (
        <div className="mt-1.5 rounded border border-border bg-background/40 p-2 text-type-xs text-muted-foreground">
          No live SOFR futures quotes — strip left empty rather than inventing rates.
        </div>
      )}

      {stir?.serff_board && stir.serff_board.length > 0 && (
        <div className="mt-1.5">
          <SerffBoard rows={stir.serff_board} onOpenImply={onOpenImply} />
        </div>
      )}

      {stir && (
        <div className="mt-1.5">
          <CalendarPacksBoard stir={stir} onOpenImply={onOpenImply} />
        </div>
      )}

      <DataBadge
        asOf={stir?.as_of}
        source={stir?.source || 'yfinance'}
        note={stir?.path?.note || stir?.quality_note || undefined}
        className="mt-1.5"
      />
    </CollapsibleSection>
  );
}
