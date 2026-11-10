/**
 * Vol desk — Focus (full panel) default; Split = surface + smile/term.
 * Greeks 1.0 lives here (not Trade). Fit is focus-only.
 */
import { useEffect, Suspense, useState, useCallback, useMemo, useRef } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useUrlSearchParam } from '../../hooks/useUrlSearchParam';
import { realizedVolCloseToClose } from '../../lib/options/analytics';
import { SKEW_DELTA_BUCKETS, SKEW_HISTORY_WINDOWS, wingMatrix, riskReversalRows, atmTermRows, fmtIvPct, fmtRR } from '../../lib/options/volSkew';
import { useTerminalStore } from '../../store/terminalStore';
import { ForwardVolMatrixSection } from './ForwardVolMatrix';
import { DeskLoading } from '../common/Skeleton';
import { EmptyState } from '../common/EmptyState';
import { SectionErrorBoundary } from '../common/SectionErrorBoundary';
import { UI_COPY } from '../../config/uiCopy';
import { GexLevelsStrip } from '../common/GexLevelsStrip';
import { lazyWithRetry } from '../common/lazyWithRetry';
import { consumeDeskJumpOnMount } from '../../lib/market/deskJump';
import { cn } from '../../lib/utils';

const SmileView = lazyWithRetry(() => import('./SmileView').then(m => ({ default: m.SmileView })));
const TermView = lazyWithRetry(() => import('./TermView').then(m => ({ default: m.TermView })));
const ArbitrageView = lazyWithRetry(() => import('./ArbitrageView').then(m => ({ default: m.ArbitrageView })));
const GreeksView = lazyWithRetry(() =>
  import('./GreeksView').then((m) => ({ default: m.GreeksView })),
);
const SurfaceMatrixView = lazyWithRetry(() => import('./SurfaceMatrixView').then(m => ({ default: m.SurfaceMatrixView })));


type Sub = 'surface' | 'smile' | 'term' | 'greeks' | 'quality';
type SidePanel = 'smile' | 'term';
type LayoutMode = 'split' | 'focus';

const SUBS: { id: Sub; label: string; blurb: string; domId: string }[] = [
  { id: 'surface', label: 'Surface', blurb: '3D IV mesh', domId: 'vol-sub-surface' },
  { id: 'smile', label: 'Smile / Skew', blurb: 'RR · fly · SVI', domId: 'vol-sub-smile' },
  { id: 'term', label: 'Term', blurb: 'ATM IV vs √DTE', domId: 'vol-sub-term' },
  { id: 'greeks', label: 'Greeks', blurb: 'Profiles · risk · BS-Merton', domId: 'vol-sub-greeks' },
  {
    id: 'quality',
    label: 'Surface Fit',
    blurb: 'Model convergence — validates SVI fit, not raw feed',
    domId: 'vol-sub-quality',
  },
];

const LAYOUT_KEY = 'ui.vol.layout';

/** Default Focus; only restore Split when user explicitly saved it. */
function loadLayout(): LayoutMode {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    if (v === 'split') return 'split';
    return 'focus';
  } catch {
    return 'focus';
  }
}

export function VolStructureView() {
  const deskSectionId = useTerminalStore((s) => s.deskSectionId);
  const setDeskContext = useTerminalStore((s) => s.setDeskContext);
  const snapshot = useTerminalStore((s) => s.snapshot);
  const loading = useTerminalStore((s) => s.loading);
  const chainUsed = useTerminalStore((s) => s.chainUsed);

  const sub: Sub = (SUBS.find((s) => s.domId === deskSectionId)?.id ?? 'surface') as Sub;
  const [layout, setLayout] = useState<LayoutMode>(loadLayout);
  const [side, setSide] = useState<SidePanel>(() =>
    sub === 'term' ? 'term' : 'smile',
  );

  useEffect(() => consumeDeskJumpOnMount(), []);

  // Deep-link: smile/term select side panel; greeks/quality force focus.
  useEffect(() => {
    if (sub === 'smile') setSide('smile');
    if (sub === 'term') setSide('term');
    if (sub === 'quality' || sub === 'greeks') setLayout('focus');
  }, [sub]);

  const persistLayout = useCallback((m: LayoutMode) => {
    setLayout(m);
    try {
      localStorage.setItem(LAYOUT_KEY, m);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const meta = SUBS.find((s) => s.id === sub);
    setDeskContext({
      id: meta?.domId ?? null,
      label: meta?.label ?? 'Surface',
      apis:
        sub === 'greeks'
          ? ['yfinance', 'FRED']
          : chainUsed === 'deribit'
            ? ['Deribit']
            : ['yfinance', 'FMP'],
    });
    return () => setDeskContext({ id: null, label: null, apis: [] });
  }, [sub, setDeskContext, chainUsed]);

  const hasSnapshot = !!snapshot;
  const showInlineLoading = loading && !hasSnapshot;
  const showEmpty = !hasSnapshot && !loading;

  const useSplit = layout === 'split' && sub !== 'quality' && sub !== 'greeks';
  const focusSub: Sub =
    sub === 'quality' || sub === 'greeks' || sub === 'smile' || sub === 'term' || sub === 'surface'
      ? sub
      : 'surface';
  // Smile/Term focus panels embed Recharts ResponsiveContainer at 100% height.
  // The flex chain above (min-h-fit wrapper + flex-1/min-h-0 frames) leaves only
  // 0-41px at narrow viewports, collapsing the charts to a strip/void while data
  // is present. A definite min-height on the smile/term focus container floors the
  // frame so the responsive container resolves to a usable chart height; the root
  // (overflow-y-auto) scrolls instead of clipping. Local to Volatility smile/term
  // focus — surface/greeks/quality/split layouts are untouched.

  return (
    <div data-testid="vol-structure-view" className="flex h-full flex-col overflow-y-auto overflow-x-hidden">
      {/* GEX strip + Split/Focus only — Surface/Smile/Term/Greeks/Fit on red bar. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-card/30">
        <GexLevelsStrip compact showSpark className="min-w-0 flex-1 border-0 bg-transparent" />
        <div className="flex shrink-0 gap-0.5 px-1">
          {useSplit && (
            <>
              {(['smile', 'term'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setSide(p);
                    useTerminalStore.getState().setDeskSection(p === 'smile' ? 'vol-sub-smile' : 'vol-sub-term');
                  }}
                  className={cn(
                    'rounded border px-1 py-0.5 font-mono text-type-2xs',
                    side === p
                      ? 'border-primary bg-secondary text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {p === 'smile' ? 'Sm' : 'Tm'}
                </button>
              ))}
            </>
          )}
          <button
            type="button"
            title="Split surface + smile/term"
            onClick={() => {
              persistLayout('split');
              if (sub === 'quality' || sub === 'greeks') {
                useTerminalStore.getState().setDeskSection('vol-sub-surface');
              }
            }}
            className={cn(
              'rounded border px-1 py-0.5 font-mono text-type-2xs',
              useSplit
                ? 'border-primary bg-secondary text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            Split
          </button>
          <button
            type="button"
            title="Full-screen active panel (default)"
            onClick={() => persistLayout('focus')}
            className={cn(
              'rounded border px-1 py-0.5 font-mono text-type-2xs',
              !useSplit
                ? 'border-primary bg-secondary text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            Focus
          </button>
        </div>
      </div>

      {/* min-h-fit: this section must never clamp below its content height. A flex-1/min-h-0 clamp collapses the box (to 0px at 390px) while Panel content overflows visibly, so the skew RR chart SVG paints over the SurfaceMatrixView 3D header row. fit-content keeps grow-to-fill but stacks sequentially with root scroll. */}
      <div className="min-h-fit shrink-0 flex-1">
        {showInlineLoading ? (
          <DeskLoading message={UI_COPY.load.chain} />
        ) : showEmpty ? (
          <div className="flex h-full items-center justify-center p-4">
            <EmptyState kind="no-data" title="No live surface" body={UI_COPY.empty.chain} />
          </div>
        ) : useSplit ? (
          <div className="flex h-full min-h-0 flex-col lg:flex-row">
            <div className="min-h-0 min-w-0 flex-[1.4] border-b border-border lg:border-b-0 lg:border-r">
              <SectionErrorBoundary name="Surface">
                <SurfaceMatrixView />
              </SectionErrorBoundary>
            </div>
            <div className="min-h-0 min-w-0 flex-1" key={side}>
              {side === 'smile' ? (
                <SectionErrorBoundary name="Smile">
                  <SmileView />
                </SectionErrorBoundary>
              ) : (
                <SectionErrorBoundary name="Term">
                  <TermView />
                </SectionErrorBoundary>
              )}
            </div>
          </div>
        ) : (
          <div
            className={
              focusSub === 'smile' || focusSub === 'term'
                ? 'h-full min-h-[520px] term-crossfade'
                : 'h-full min-h-0 term-crossfade'
            }
            key={focusSub}
          >
            {focusSub === 'surface' && (
              <SectionErrorBoundary name="Surface">
                <Suspense fallback={<DeskLoading message={UI_COPY.load.surfaceModule} />}>
                  <SurfaceMatrixView />
                </Suspense>
              </SectionErrorBoundary>
            )}
            {focusSub === 'smile' && (
              <SectionErrorBoundary name="Smile">
                <SmileView />
              </SectionErrorBoundary>
            )}
            {focusSub === 'term' && (
              <SectionErrorBoundary name="Term">
                <TermView />
              </SectionErrorBoundary>
            )}
            {focusSub === 'greeks' && (
              <SectionErrorBoundary name="Greeks">
                <Suspense fallback={<DeskLoading message={UI_COPY.load.greeks} />}>
                  <GreeksView />
                </Suspense>
              </SectionErrorBoundary>
            )}
            {focusSub === 'quality' && (
              <SectionErrorBoundary name="Quality">
                <div className="flex h-full flex-col" data-testid="vol-surface-quality">
                  <p className="shrink-0 border-b border-border px-3 py-1.5 font-mono text-type-2xs text-muted-foreground">
                    Surface Fit / Model Convergence — validates SVI fit, not raw feed
                  </p>
                  <div className="border-b border-border px-3 py-1.5 font-mono text-type-xs text-muted-foreground">
                    Calendar: total variance w=σ²T non-decreasing in T · Butterfly: discrete convexity of w in log-moneyness.
                    Red cells = model inconsistency / noisy grid — not a free lunch without bid/ask and transaction costs.
                  </div>
                  <div className="min-h-0 flex-1">
                    <ArbitrageView />
                  </div>
                </div>
              </SectionErrorBoundary>
            )}
          </div>
        )}
      </div>
      <SectionErrorBoundary name="ForwardVol"><ForwardVolMatrixSection /></SectionErrorBoundary>
      <SectionErrorBoundary name="SkewDiagnostics"><VolSkewDiagnostics /></SectionErrorBoundary>
    </div>
  );
}
const STALE_AFTER_MS = 96 * 3600_000;
function VolSkewDiagnostics() {
  const snapshot = useTerminalStore((s) => s.snapshot);
  const loading = useTerminalStore((s) => s.loading);
  const chainUsed = useTerminalStore((s) => s.chainUsed);
  const symbol = useTerminalStore((s) => s.symbol);
  const fmpHistory = useTerminalStore((s) => s.fmpHistory);
  const [histParam, setHistParam] = useUrlSearchParam('hist', SKEW_HISTORY_WINDOWS.map(String), '90');
  const histWindow = SKEW_HISTORY_WINDOWS.includes(Number(histParam) as typeof SKEW_HISTORY_WINDOWS[number]) ? Number(histParam) : 90;
  const setHistWindow = (w: number) => setHistParam(String(w));
  const provenance = useMemo(() => {
    if (!snapshot) return null;
    const ageMs = Date.now() - snapshot.timestamp;
    const stale = snapshot.timestamp > 0 && ageMs > STALE_AFTER_MS;
    const asOf = Number.isFinite(snapshot.timestamp) && snapshot.timestamp > 0 ? new Date(snapshot.timestamp).toISOString() : 'unknown';
    return { asOf, stale };
  }, [snapshot]);
  const model = useMemo(() => {
    if (!snapshot) return null;
    const wm = wingMatrix(snapshot);
    const rr = riskReversalRows(snapshot);
    const term = atmTermRows(snapshot);
    const rv = fmpHistory?.length ? realizedVolCloseToClose(fmpHistory.slice(-histWindow).map((b) => b.close)) : null;
    const totalAvail = wm.totalAvailable;
    const displayed = wm.displayed;
    const withIv = wm.rows.filter((r) => Object.values(r.cells).some((v) => v != null)).length;
    const partial = withIv > 0 && withIv < displayed;
    const empty = withIv === 0;
    return { wm, rr, term, rv, withIv, displayed, totalAvail, partial, empty };
  }, [snapshot, fmpHistory, histWindow]);
  if (!snapshot && loading) return <div data-testid="vol-skew-section" className="shrink-0 border-t border-border p-3"><EmptyState kind="loading" title="Loading skew" body="Requires the active options chain snapshot." /></div>;
  if (!snapshot || !model) return <div data-testid="vol-skew-section" className="shrink-0 border-t border-border p-3"><EmptyState kind="no-data" title="No skew — chain unavailable" body={`${symbol ?? 'Selected'} options chain unavailable — ${chainUsed ?? 'yfinance/FMP'} chain returned no snapshot (no values fabricated).`} /></div>;
  if (model.empty) return <div data-testid="vol-skew-section" className="shrink-0 border-t border-border p-3"><EmptyState kind="no-data" title="No skew — insufficient delta-qualified quotes" body="No expiry has a valid 10Δ/25Δ/ATM derived IV (finite, 0<IV≤3)." /></div>;
  const providerLabel = chainUsed === 'deribit' ? 'Deribit' : chainUsed === 'fmp' ? 'FMP' : 'yfinance/FMP';
  return (
    <div data-testid="vol-skew-section" className="shrink-0 border-t border-border bg-card/20">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <h3 className="font-mono text-xs font-semibold">Skew Diagnostics</h3>
        <span className="font-mono text-[10px] text-muted-foreground" title="Derived: IV locally solved from mid-price (bid+ask)/2 via Black-Scholes; delta locally computed BS delta; unknown r/q assumptions from chain builder; RR/realized/forward derived">Derived · IV = solved mid-price IV · delta = BS-computed · IV ×100 → % · RR vol pts ×100 · DTE days</span>
        {provenance?.stale && <span data-testid="vol-skew-stale" className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-600">Stale</span>}
        {model.partial && <span data-testid="vol-skew-partial" title={`${model.withIv}/${model.displayed} displayed expiries have at least one delta-qualified derived IV`} className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-600">Partial {model.withIv}/{model.displayed}</span>}
        {model.wm.capped && <span data-testid="vol-skew-cap" title={`Display cap: showing ${model.displayed} of ${model.totalAvail} eligible expiries (oldest truncated)`} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">Showing {model.displayed} of {model.totalAvail} expiries</span>}
        <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-muted-foreground"><span className="hidden sm:inline">History window</span>{SKEW_HISTORY_WINDOWS.map((w) => <button key={w} type="button" data-testid={`vol-skew-hist-${w}`} onClick={() => setHistWindow(w)} className={w === histWindow ? 'rounded border border-primary bg-secondary px-1.5 py-0.5 text-foreground' : 'rounded border border-border px-1.5 py-0.5 hover:text-foreground'}>{w}d</button>)}</span>
      </div>
      <div className="px-3 pb-1 font-mono text-[10px] text-muted-foreground">Source: {providerLabel} chain (derived) · asOf {provenance?.asOf ?? '—'} · {symbol ?? '—'} · {model.rv != null ? `realized (derived close-to-close) ${(model.rv*100).toFixed(2)}%` : 'realized vol needs price history (derived)'} · <span title="Yahoo/FMP: mid-price BS invert + BS delta; r/q per tenor from chain builder; selection = nearest within tolerance (10Δ 0.08, 25Δ 0.14, ATM 0.15)">provenance: derived, not observed</span>{model.wm.capped ? ` · display cap ${model.displayed}/${model.totalAvail}` : ` · coverage ${model.totalAvail} eligible`}</div>
      <div className="grid gap-3 p-3 lg:grid-cols-2">
        <div className="overflow-x-auto rounded border border-border focus:outline-none focus-visible:ring-1 focus-visible:ring-primary" tabIndex={0} role="region" aria-label="ATM term structure — scrollable table"><div className="bg-muted/30 px-2 py-1 font-mono text-[11px] font-semibold">ATM Term — <span data-testid="vol-skew-atm-label">ATM 50Δ proxy (avg ~50Δ call & put, different strikes)</span> · derived · Fwd derived (null when DTE invalid/variance negative) {model.wm.wingMin != null && model.wm.wingMax != null ? `· wings ${(model.wm.wingMin*100).toFixed(1)}–${(model.wm.wingMax*100).toFixed(1)}%` : ''}</div><table role="table" aria-label="ATM term structure derived 50Delta proxy" className="w-full min-w-[380px] border-collapse font-mono text-[11px]"><thead><tr className="bg-muted/20 text-muted-foreground"><th scope="col" className="px-2 py-1 text-left">DTE</th><th scope="col" className="px-2 py-1 text-right">ATM IV % (derived proxy)</th><th scope="col" className="px-2 py-1 text-right">Fwd IV % (derived)</th></tr></thead><tbody>{model.term.map((r) => <tr key={r.expiry} className="border-t border-border"><td className="px-2 py-1" title={r.fwdUnavailableReason ? `Forward unavailable: ${r.fwdUnavailableReason}` : undefined}>{r.dte}d{r.fwdUnavailableReason ? ' *' : ''}</td><td className="px-2 py-1 text-right" title={r.atmIv != null ? `Derived avg: call strike ${r.atmCallStrike ?? '—'} Δ ${r.atmCallDelta != null ? r.atmCallDelta.toFixed(2) : '—'} / put strike ${r.atmPutStrike ?? '—'} Δ ${r.atmPutDelta != null ? r.atmPutDelta.toFixed(2) : '—'}${r.atmCallStrike != null && r.atmPutStrike != null && r.atmCallStrike !== r.atmPutStrike ? ' (different strikes)' : ''}` : 'ATM proxy unavailable — one leg missing/out of tolerance'}>{fmtIvPct(r.atmIv)}</td><td className="px-2 py-1 text-right" title={r.fwdUnavailableReason ?? (r.fwdIv != null ? 'Derived forward vol from consecutive DTEs' : undefined)}>{fmtIvPct(r.fwdIv)}{r.fwdUnavailableReason ? ` (${r.fwdUnavailableReason})` : ''}</td></tr>)}</tbody></table></div>
        <div className="rounded border border-border"><div className="bg-muted/30 px-2 py-1 font-mono text-[11px] font-semibold">25Δ Risk Reversal (derived) — RR = IV(25ΔC) − IV(25ΔP) vol pts ×100</div><div data-testid="vol-skew-rr-bar" role="img" aria-label="25 delta risk reversal bar chart derived" className="h-[140px] w-full px-2 pt-2"><ResponsiveContainer width="100%" height="100%"><BarChart data={model.rr.map((r) => ({ dte: `${r.dte}d`, rr: r.rr != null ? r.rr*100 : null, raw: r.rr }))} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} /><XAxis dataKey="dte" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v.toFixed(1)}`} width={36} /><Tooltip formatter={(value: any) => value == null ? '—' : `${Number(value).toFixed(2)}`} labelFormatter={(l: string) => `DTE ${l}`} /><ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" /><Bar dataKey="rr" fill="hsl(var(--primary))" radius={[2,2,0,0]} isAnimationActive={false} /></BarChart></ResponsiveContainer></div><div className="overflow-x-auto focus:outline-none focus-visible:ring-1 focus-visible:ring-primary" tabIndex={0} role="region" aria-label="25 delta risk reversal — scrollable table"><table role="table" aria-label="25 delta risk reversal derived" className="w-full min-w-[380px] border-collapse font-mono text-[11px]"><thead><tr className="bg-muted/20 text-muted-foreground"><th scope="col" className="px-2 py-1 text-left">DTE</th><th scope="col" className="px-2 py-1 text-right">RR (derived)</th><th scope="col" className="px-2 py-1 text-right">C25 strike/Δ</th><th scope="col" className="px-2 py-1 text-right">P25 strike/Δ</th></tr></thead><tbody>{model.rr.map((r) => <tr key={r.expiry} className="border-t border-border"><td className="px-2 py-1">{r.dte}d</td><td className="px-2 py-1 text-right">{fmtRR(r.rr)}</td><td className="px-2 py-1 text-right">{r.c25Strike != null ? `${r.c25Strike} @ ${r.c25Delta != null ? r.c25Delta.toFixed(2) : '—'}` : '—'}</td><td className="px-2 py-1 text-right">{r.p25Strike != null ? `${r.p25Strike} @ ${r.p25Delta != null ? r.p25Delta.toFixed(2) : '—'}` : '—'}</td></tr>)}</tbody></table></div></div>
      </div>
      <WingsMatrixTable rows={model.wm.rows} totalAvailable={model.totalAvail} displayed={model.displayed} maxRows={model.wm.maxRows} />
    </div>
  );
}

function WingsMatrixTable({ rows, totalAvailable, displayed, maxRows }: { rows: import('../../lib/options/volSkew').WingRow[]; totalAvailable: number; displayed: number; maxRows: number }) {
  const [focused, setFocused] = useState(0);
  const tableRef = useRef<HTMLDivElement>(null);
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setFocused((f) => Math.min(rows.length - 1, f + 1)); }
    else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setFocused((f) => Math.max(0, f - 1)); }
  }, [rows.length]);
  useEffect(() => { if (focused >= rows.length) setFocused(Math.max(0, rows.length - 1)); }, [rows.length, focused]);
  return (
    <div
      className="px-3 pb-3"
    >
      <div
        ref={tableRef}
        tabIndex={0}
        role="region"
        aria-label="Wings matrix — scrollable table, use j/k or arrow keys"
        onKeyDown={onKeyDown}
        data-testid="vol-skew-wings-wrap"
        className="overflow-x-auto rounded border border-border focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        <div className="bg-muted/30 px-2 py-1 font-mono text-[11px] font-semibold">Wings — delta-bucketed derived IV (%) · nearest within tolerance (10Δ 0.08, 25Δ 0.14) <span className="font-normal text-muted-foreground">· j/k to navigate · hover for strike/Δ</span>{totalAvailable > maxRows ? <span data-testid="vol-skew-wings-cap" className="ml-2 font-normal text-muted-foreground">Showing {displayed} of {totalAvailable}</span> : null}</div>
        <table role="table" aria-label="Wings matrix delta-bucketed derived nearest approximation" data-testid="vol-skew-wings-table" className="w-full min-w-[560px] border-collapse font-mono text-[11px]">
          <thead><tr className="bg-muted/20 text-muted-foreground"><th scope="col" className="px-2 py-1 text-left">Expiry</th>{SKEW_DELTA_BUCKETS.map((b) => <th key={b} scope="col" className="px-2 py-1 text-right">{b}</th>)}</tr></thead>
          <tbody>{rows.map((row, idx) => <tr key={row.expiry} data-testid={`vol-skew-wings-row-${idx}`} aria-selected={focused === idx} className={focused === idx ? 'border-t border-border bg-secondary/40' : 'border-t border-border'}><td className="px-2 py-1">{row.dte}d{row.reused ? <span title={`Nearest-approx reuse: ${row.reuseGroups.join(', ')} — same quote fills multiple buckets`} className="ml-1 text-amber-600">↔</span> : null}</td>{SKEW_DELTA_BUCKETS.map((b) => {
            const leg = row.legs[b];
            let title: string;
            let extra: string | null = null;
            if (b === 'ATM') {
              if (leg.iv != null) {
                title = `Derived ATM 50Δ proxy avg call strike ${row.atmCallStrike ?? '—'} Δ ${row.atmCallDelta != null ? row.atmCallDelta.toFixed(2) : '—'} / put strike ${row.atmPutStrike ?? '—'} Δ ${row.atmPutDelta != null ? row.atmPutDelta.toFixed(2) : '—'}${row.atmCallStrike != null && row.atmPutStrike != null && row.atmCallStrike !== row.atmPutStrike ? ' (different strikes)' : ''}; nearest within 0.15`;
                extra = `${row.atmCallStrike ?? '—'}@${row.atmCallDelta != null ? row.atmCallDelta.toFixed(2) : '—'}/${row.atmPutStrike ?? '—'}@${row.atmPutDelta != null ? row.atmPutDelta.toFixed(2) : '—'}`;
              } else title = 'ATM 50Δ proxy — null when either leg missing (derived avg of ~50Δ call & put, different strikes)';
            } else {
              title = leg.iv != null ? `Derived IV from strike ${leg.strike ?? '—'} Δ ${leg.delta != null ? leg.delta.toFixed(3) : '—'} (target ${leg.targetDelta != null ? leg.targetDelta.toFixed(2) : '—'}; nearest within tolerance)` : `No qualifying derived quote within tolerance for ${b}`;
            }
            return <td key={b} className="px-2 py-1 text-right" title={title} data-testid={`vol-skew-cell-${idx}-${b}`}>{leg.iv != null ? `${(leg.iv*100).toFixed(2)}%` : '—'}{leg.iv != null ? <span className="ml-1 text-[10px] text-muted-foreground">{b === 'ATM' ? extra : `${leg.strike}@${leg.delta != null ? leg.delta.toFixed(2) : '—'}`}</span> : null}</td>;
          })}</tr>)}</tbody>
        </table>
        {rows.some((r) => r.reused) ? <div data-testid="vol-skew-reuse-note" className="px-2 py-1 font-mono text-[10px] text-amber-600">↔ Same quote reused across buckets where nearest Δ overlaps (tolerance-limited selection).</div> : null}
      </div>
    </div>
  );
}
