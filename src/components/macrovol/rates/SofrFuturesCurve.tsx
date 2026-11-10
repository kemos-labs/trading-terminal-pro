/**
 * STIR futures leg curves — SR3 / SR1 / ZQ over the existing strip envelope.
 *
 * Spec rules implemented:
 * - Default SR3 view preserves the Phase 3 exemplar: title
 *   "3M SOFR Futures — Implied Rate"; default Y = 100 − price (% p.a.),
 *   explicit Price mode toggle (index points, not %).
 * - X = actual contract/month label from data — never a hardcoded range.
 * - Points + straight segments (discrete contracts; no monotone interpolation).
 * - Live + prior settlement, compact header legend (not a chart-bottom sentence).
 * - One X title, one Y title per panel (frame captions only for a11y, visually hidden).
 * - Adaptive tick density: all front contracts, thinned back contracts.
 * - Tooltip per row: leg, contract, ref-quarter start/end, futures price,
 *   implied rate, Δ bp, settlement state, source, observation + fetch times.
 * - REF07/N3a-small: independent SR3 (3M SOFR), SR1 (1M SOFR) and ZQ
 *   (30-Day Fed Funds) leg selection plus a simultaneous "All" comparison of
 *   parallel per-leg panels. Legs are never merged into one curve; a leg with
 *   fewer than two finite observed/settled points renders an explicit
 *   Unavailable state — never zero-fill, SR3 copies, interpolation or proxy
 *   relabelling. Leg/mode controls are local-only (no fetch, no request
 *   change, no frame-identity change).
 */
import { useMemo, useState } from 'react';
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  CHART, chartAxisTick, tightDomain,
} from '../../../lib/chartTheme';
import { DESK_SERIES } from '../../desk/seriesGrammar';
import { cn } from '../../../lib/utils';

export type SofrCurvePoint = {
  x: string;
  rate: number | null;
  prior?: number | null;
  vsSofr?: number | null;
  source?: string;
  contract?: string;
  ref_start?: string | null;
  ref_end?: string | null;
  futures_price?: number | null;
};

type YMode = 'implied' | 'price';

export type StirLegId = 'sr3' | 'sr1' | 'zq';
export type StirLegView = StirLegId | 'all';

const REFRESH_NOTE = 'Discrete quarterly contracts · points + straight segments · no interpolation';

const LEG_META: Record<StirLegId, {
  short: string;
  label: string;
  fullName: string;
  venueNote: string;
  liveColor: string;
  priorColor: string;
  priorDashed: boolean;
}> = {
  sr3: {
    short: 'SR3',
    label: 'SR3 · 3M SOFR',
    fullName: '3M SOFR Futures',
    venueNote: 'CME SR3 via yfinance',
    liveColor: DESK_SERIES.historyLive,
    priorColor: DESK_SERIES.historyCompare,
    priorDashed: false,
  },
  sr1: {
    short: 'SR1',
    label: 'SR1 · 1M SOFR',
    fullName: '1M SOFR Futures (SR1)',
    venueNote: 'CME SR1 via yfinance',
    liveColor: CHART.series.up,
    priorColor: CHART.series.up,
    priorDashed: true,
  },
  zq: {
    short: 'ZQ',
    label: 'ZQ · 30-Day Fed Funds',
    fullName: '30-Day Fed Funds Futures (ZQ)',
    venueNote: 'CME ZQ via yfinance',
    liveColor: CHART.series.warn,
    priorColor: CHART.series.warn,
    priorDashed: true,
  },
};

const LEG_ORDER: StirLegId[] = ['sr3', 'sr1', 'zq'];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toISOString().slice(0, 10);
}

function fmtNum(v: number | null | undefined, digits: number): string {
  return v != null && Number.isFinite(v) ? v.toFixed(digits) : '—';
}

function SettlementBadge({ source }: { source?: string | null }) {
  // Fail-closed: the source field is an observed provider token. Only the
  // three exact tokens below may claim a live/settled/model state. Any
  // missing, empty, unknown, cased or padded value renders an explicit
  // neutral Unavailable badge — never the green live claim. No trim or
  // case-fold is applied to the untrusted token. Raw source disclosure is
  // preserved separately in the tooltip provenance line and table Source
  // column.
  if (source === 'settled') {
    return (
      <span
        data-testid="settlement-badge"
        className={cn('rounded px-1 py-px font-mono text-[10px]', 'bg-info/15 text-info')}
      >
        settled
      </span>
    );
  }
  if (source === 'fallback') {
    return (
      <span
        data-testid="settlement-badge"
        className={cn('rounded px-1 py-px font-mono text-[10px]', 'bg-amber/15 text-amber')}
      >
        model settle
      </span>
    );
  }
  if (source === 'live') {
    return (
      <span
        data-testid="settlement-badge"
        className={cn('rounded px-1 py-px font-mono text-[10px]', 'bg-up/15 text-up')}
      >
        live
      </span>
    );
  }
  return (
    <span
      data-testid="settlement-badge"
      className={cn('rounded px-1 py-px font-mono text-[10px]', 'bg-muted/40 text-muted-foreground')}
    >
      Unavailable
    </span>
  );
}

interface SofrTooltipRow {
  active?: boolean;
  payload?: {
    payload: SofrCurvePoint;
  }[];
  fetchedAt?: string | null;
  mode: YMode;
  leg?: StirLegId;
  venueNote?: string;
}

export function SofrTooltip({ active, payload, fetchedAt, mode, leg, venueNote }: SofrTooltipRow) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const finiteRate = p.rate != null && Number.isFinite(p.rate) ? p.rate : null;
  const finitePrior = p.prior != null && Number.isFinite(p.prior) ? p.prior : null;
  const finitePx = p.futures_price != null && Number.isFinite(p.futures_price) ? p.futures_price : null;
  const chgBps = finiteRate != null && finitePrior != null ? (finiteRate - finitePrior) * 100 : null;
  return (
    <div
      className="rounded border border-border bg-black/95 px-2.5 py-2 font-mono text-type-2xs leading-relaxed shadow-xl"
      data-testid="sofr-curve-tooltip"
    >
      <div className="flex items-center gap-2 font-bold">
        <span>{p.contract ?? p.x}</span>
        <SettlementBadge source={p.source} />
      </div>
      {leg && (
        <div className="mt-0.5 text-muted-foreground" data-testid="sofr-tooltip-leg">
          Leg {LEG_META[leg].label}
        </div>
      )}
      <div className="mt-1 text-muted-foreground">
        Ref quarter {fmtDate(p.ref_start)} → {fmtDate(p.ref_end)}
      </div>
      <div className="mt-1 grid grid-cols-[auto_auto] gap-x-3">
        <span className="text-muted-foreground">Futures px</span>
        <span className="text-right tabular-nums">{finitePx != null ? finitePx.toFixed(3) : '—'}</span>
        <span className="text-muted-foreground">Implied rate</span>
        <span className="text-right tabular-nums">{finiteRate != null ? `${finiteRate.toFixed(3)}%` : '—'}</span>
        {mode === 'price' && (
          <>
            <span className="text-muted-foreground">Index pts</span>
            <span className="text-right tabular-nums">{finiteRate != null ? (100 - finiteRate).toFixed(3) : '—'}</span>
          </>
        )}
        <span className="text-muted-foreground">Δ vs prior</span>
        <span className="text-right tabular-nums">{chgBps != null ? `${chgBps >= 0 ? '+' : ''}${chgBps.toFixed(1)}bp` : '—'}</span>
        <span className="text-muted-foreground">Observed</span>
        <span className="text-right tabular-nums">{fetchedAt ? new Date(fetchedAt).toISOString().slice(11, 19) + 'Z' : '—'}</span>
      </div>
      <div className="mt-1 text-muted-foreground/80">
        src: {venueNote ?? 'CME SR3 via yfinance'}{p.source === 'settled' && (!leg || leg === 'sr3') ? ' · settled = FRED SOFR compound' : ''} · fetched {fetchedAt ? new Date(fetchedAt).toISOString().slice(11, 19) + 'Z' : '—'}
      </div>
    </div>
  );
}

/** Adaptive X ticks: every contract ≤ N, then progressively thin the back. */
function xTickIndices(n: number): number[] {
  if (n <= 12) return Array.from({ length: n }, (_, i) => i);
  const front = 12;
  const backEvery = n > 20 ? 4 : 2;
  const idx: number[] = Array.from({ length: front }, (_, i) => i);
  for (let i = front; i < n; i += backEvery) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  return idx;
}

/** Rows that can draw: at least one of rate/prior present (nulls preserved downstream). */
function drawableRows(data: SofrCurvePoint[]): SofrCurvePoint[] {
  return data.filter((d) => d.rate != null || d.prior != null);
}

/** Finite observed/settled points — the availability denominator (never zero-filled). */
function finiteCount(rows: SofrCurvePoint[]): number {
  return rows.filter(
    (d) => (d.rate != null && Number.isFinite(d.rate)) || (d.prior != null && Number.isFinite(d.prior)),
  ).length;
}

function LegPanel({
  leg,
  points,
  mode,
  asOf,
  height,
  titleTestId,
  yTitleTestId,
}: {
  leg: StirLegId;
  points: SofrCurvePoint[];
  mode: YMode;
  asOf?: string | null;
  height: number;
  titleTestId: string;
  yTitleTestId: string;
}) {
  const meta = LEG_META[leg];
  const rows = useMemo(() => drawableRows(points), [points]);
  const tickIdx = useMemo(() => xTickIndices(rows.length), [rows.length]);
  const finite = useMemo(() => finiteCount(rows), [rows]);

  const yDomain = useMemo(
    () => tightDomain(
      rows.flatMap((d) => [d.rate, d.prior ?? null]),
      0.12,
      { minPadAbs: 0.05 },
    ),
    [rows],
  );
  const priceDomain = useMemo(
    () => tightDomain(
      rows.flatMap((d) => [
        d.rate != null ? 100 - d.rate : null,
        d.prior != null ? 100 - d.prior : null,
      ]),
      0.12,
      { minPadAbs: 0.05 },
    ),
    [rows],
  );

  const fetchedAt = asOf ?? null;

  // Fail-closed per leg: fewer than two finite observed/settled points.
  // SR3 keeps the legacy empty copy; other legs name themselves explicitly.
  if (rows.length < 2 || finite < 2) {
    if (leg === 'sr3') {
      return (
        <div
          className="flex items-center justify-center rounded border border-border bg-black/90 font-mono text-type-xs text-muted-foreground"
          style={{ height }}
          data-testid="sofr-curve-empty"
        >
          Awaiting live 3M SOFR futures strip — no synthetic curve is drawn.
        </div>
      );
    }
    return (
      <div
        className="flex items-center justify-center rounded border border-border bg-black/90 px-2 py-4 font-mono text-type-xs text-muted-foreground"
        style={{ height }}
        data-testid={`sofr-leg-unavailable-${leg}`}
      >
        {meta.fullName} Unavailable — fewer than two observed points; no synthetic values drawn.
      </div>
    );
  }

  const yTitle = mode === 'implied' ? 'Implied rate (% p.a.)' : 'Futures price (index pts)';
  const toY = (r: number | null | undefined) =>
    r == null || !Number.isFinite(r) ? null : mode === 'implied' ? r : 100 - r;

  return (
    <div className="rounded border border-border bg-black p-1.5" data-testid={leg === 'sr3' ? 'sofr-leg-panel-sr3' : `sofr-leg-panel-${leg}`}>
      {/* Compact header: leg-scoped title + legend + live/prior dots */}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1">
        <span className="font-mono text-type-xs font-semibold tracking-wide text-zinc-100" data-testid={titleTestId}>
          {meta.fullName} — {mode === 'implied' ? 'Implied Rate' : 'Price'}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-type-2xs text-zinc-400">
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: meta.liveColor }} aria-hidden />
            live
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: meta.priorColor }} aria-hidden />
            prior settle
          </span>
        </span>
      </div>

      {/* Rotated Y title as DOM (guarantees exactly one Y title; SVG label skipped at 0-width). */}
      <div className="relative" style={{ height }}>
        <span
          className="pointer-events-none absolute left-0 top-1/2 origin-center -translate-y-1/2 -rotate-90 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
          data-testid={yTitleTestId}
          aria-hidden
        >
          {yTitle}
        </span>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={rows}
            // Measured margins: left for Y ticks/title, bottom for X labels (title lives in header).
            margin={{ top: 10, right: 16, bottom: 30, left: 4 }}
          >
            <CartesianGrid stroke={CHART.grid} strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="x"
              ticks={tickIdx.map((i) => rows[i]!.x).filter((v, i, a) => a.indexOf(v) === i)}
              tick={{ ...chartAxisTick, fontSize: 9 }}
              interval={0}
              height={26}
              axisLine={{ stroke: CHART.axisLine }}
              tickLine={{ stroke: CHART.axisLine }}
              tickMargin={6}
            />
            <YAxis
              tick={chartAxisTick}
              width={52}
              domain={mode === 'implied' ? (yDomain as [number, number]) : (priceDomain as [number, number])}
              tickFormatter={(v) => Number(v).toFixed(2)}
              axisLine={{ stroke: CHART.axisLine }}
              tickLine={{ stroke: CHART.axisLine }}
              tickMargin={4}
            />
            <Tooltip
              content={<SofrTooltip mode={mode} fetchedAt={fetchedAt} leg={leg} venueNote={meta.venueNote} />}
              cursor={{ stroke: CHART.axisLine, strokeDasharray: '3 3' }}
            />
            {/* Discrete contracts: points + straight segments (type="linear", never monotone). */}
            <Line
              type="linear"
              dataKey={(row: SofrCurvePoint) => toY(row.prior)}
              name="prior settle"
              stroke={meta.priorColor}
              strokeDasharray={meta.priorDashed ? '4 3' : undefined}
              strokeWidth={2}
              dot={{ r: 3, fill: meta.priorColor, stroke: meta.priorColor }}
              activeDot={{ r: 4.5 }}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey={(row: SofrCurvePoint) => toY(row.rate)}
              name="live"
              stroke={meta.liveColor}
              strokeWidth={2.25}
              dot={{ r: 3.5, fill: meta.liveColor, stroke: meta.liveColor }}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Single X title below the plot (Recharts axis label reserved for Y to avoid double-supply). */}
      <div className="mt-0.5 flex items-center justify-between px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Contract / reference quarter</span>
        <span className="normal-case">{REFRESH_NOTE}</span>
      </div>
    </div>
  );
}

function LegTable({
  visible,
  series,
  mode,
  testId,
}: {
  visible: StirLegId[];
  series: Record<StirLegId, SofrCurvePoint[]>;
  mode: YMode;
  testId: string;
}) {
  const rows = visible.flatMap((leg) =>
    drawableRows(series[leg]).map((d) => ({ leg, d })),
  );
  if (rows.length === 0) return null;
  return (
    <details className="mt-1 rounded border border-border bg-black/60 px-2 py-1" data-testid={`${testId}-wrap`}>
      <summary className="cursor-pointer font-mono text-type-2xs text-muted-foreground">
        Curve data table ({rows.length} rows · {mode === 'implied' ? '% p.a.' : 'index pts'})
      </summary>
      <div className="mt-1 max-h-56 overflow-auto" role="region" aria-label="Scrollable curve data" tabIndex={0}>
        <table className="w-full border-collapse font-mono text-type-2xs tabular-nums" data-testid={testId}>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pr-2 font-normal">Leg</th>
              <th className="pr-2 font-normal">Contract</th>
              <th className="pr-2 font-normal">Ref quarter</th>
              <th className="pr-2 text-right font-normal">Futures px</th>
              <th className="pr-2 text-right font-normal">Implied %</th>
              <th className="pr-2 text-right font-normal">Δ bp</th>
              <th className="pr-2 text-right font-normal">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ leg, d }, i) => {
              const finiteRate = d.rate != null && Number.isFinite(d.rate) ? d.rate : null;
              const finitePrior = d.prior != null && Number.isFinite(d.prior) ? d.prior : null;
              const finitePx = d.futures_price != null && Number.isFinite(d.futures_price) ? d.futures_price : null;
              const chg = finiteRate != null && finitePrior != null ? (finiteRate - finitePrior) * 100 : null;
              return (
                <tr key={`${leg}-${d.contract ?? d.x}-${i}`} className="border-t border-border/40">
                  <td className="pr-2 text-muted-foreground">{LEG_META[leg].short}</td>
                  <td className="pr-2 font-bold text-foreground">{d.contract ?? d.x}</td>
                  <td className="pr-2 text-muted-foreground">{fmtDate(d.ref_start)} → {fmtDate(d.ref_end)}</td>
                  <td className="pr-2 text-right">{fmtNum(finitePx, 3)}</td>
                  <td className="pr-2 text-right">{finiteRate != null ? `${finiteRate.toFixed(3)}%` : '—'}</td>
                  <td className="pr-2 text-right">{chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}` : '—'}</td>
                  <td className="pr-2 text-right text-muted-foreground">{d.source ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function SofrFuturesCurve({
  data,
  sr1Data,
  zqData,
  height = 280,
  asOf,
}: {
  /** SR3 (3M SOFR) strip — the default leg; existing callers pass stirChart here. */
  data: SofrCurvePoint[];
  /** SR1 (1M SOFR) rows from the existing stir envelope; absent = Unavailable. */
  sr1Data?: SofrCurvePoint[];
  /** ZQ (30-Day Fed Funds) rows from the existing stir envelope; absent = Unavailable. */
  zqData?: SofrCurvePoint[];
  height?: number;
  asOf?: string | null;
}) {
  const [mode, setMode] = useState<YMode>('implied');
  // Local-only view state: never fetches, never mutates selected time or frame identity.
  const [legView, setLegView] = useState<StirLegView>('sr3');

  const series: Record<StirLegId, SofrCurvePoint[]> = useMemo(() => ({
    sr3: data,
    sr1: sr1Data ?? [],
    zq: zqData ?? [],
  }), [data, sr1Data, zqData]);

  const counts = useMemo(() => ({
    sr3: finiteCount(drawableRows(series.sr3)),
    sr1: finiteCount(drawableRows(series.sr1)),
    zq: finiteCount(drawableRows(series.zq)),
  }), [series]);

  const visibleLegs: StirLegId[] = legView === 'all' ? [...LEG_ORDER] : [legView];
  const singleLeg = legView !== 'all';

  const allTitle = `STIR Futures Legs — ${mode === 'implied' ? 'Implied Rate' : 'Price'} (SR3 · SR1 · ZQ)`;

  return (
    <div className="max-w-full overflow-hidden" data-testid="sofr-futures-curve">
      {/* Compact header: title + legend + leg/mode controls (local-only, keyboard labelled). */}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1">
        {singleLeg ? null : (
          <span className="font-mono text-type-xs font-semibold tracking-wide text-zinc-100" data-testid="sofr-curve-title-all">
            {allTitle}
          </span>
        )}
        {singleLeg ? (
          <span className="sr-only" data-testid="sofr-curve-view-note">
            Single-leg view: {LEG_META[legView].label}
          </span>
        ) : null}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-type-2xs text-zinc-400">
          <span
            role="group"
            aria-label="STIR futures leg"
            className="flex flex-wrap overflow-hidden rounded border border-border"
          >
            {(LEG_ORDER as StirLegId[]).map((leg) => (
              <button
                key={leg}
                type="button"
                onClick={() => setLegView(leg)}
                aria-pressed={legView === leg}
                aria-label={`Show ${LEG_META[leg].label} curve`}
                data-testid={`sofr-leg-${leg}`}
                className={cn(
                  'px-1.5 py-px font-mono text-[10px] uppercase transition-colors',
                  legView === leg ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60',
                )}
              >
                {LEG_META[leg].short}
              </button>
            ))}
            <button
              key="all"
              type="button"
              onClick={() => setLegView('all')}
              aria-pressed={legView === 'all'}
              aria-label="Show all STIR legs SR3 SR1 ZQ side by side"
              data-testid="sofr-leg-all"
              className={cn(
                'px-1.5 py-px font-mono text-[10px] uppercase transition-colors',
                legView === 'all' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60',
              )}
            >
              All
            </button>
          </span>
          <span
            role="group"
            aria-label="Y-axis mode"
            className="flex overflow-hidden rounded border border-border"
          >
            {(['implied', 'price'] as YMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                aria-label={m === 'implied' ? 'Y-axis implied rate percent per annum' : 'Y-axis futures price index points'}
                data-testid={`sofr-mode-${m}`}
                className={cn(
                  'px-1.5 py-px font-mono text-[10px] uppercase transition-colors',
                  mode === m ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60',
                )}
              >
                {m}
              </button>
            ))}
          </span>
        </span>
      </div>

      {singleLeg ? (
        <LegPanel
          leg={legView}
          points={series[legView]}
          mode={mode}
          asOf={asOf}
          height={height}
          titleTestId="sofr-curve-title"
          yTitleTestId="sofr-curve-y-title"
        />
      ) : (
        <div className="space-y-1.5">
          {LEG_ORDER.map((leg) => (
            <LegPanel
              key={leg}
              leg={leg}
              points={series[leg]}
              mode={mode}
              asOf={asOf}
              height={200}
              titleTestId={`sofr-curve-title-${leg}`}
              yTitleTestId={`sofr-curve-y-title-${leg}`}
            />
          ))}
        </div>
      )}

      {/* Provenance: per-leg finite counts + as-of; missing legs stay Unavailable, never zero. */}
      <div
        className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-1 font-mono text-[10px] text-muted-foreground"
        data-testid="sofr-curve-provenance"
      >
        <span>
          SR3 n={counts.sr3} · SR1 {counts.sr1 >= 2 ? `n=${counts.sr1}` : 'Unavailable'} · ZQ {counts.zq >= 2 ? `n=${counts.zq}` : 'Unavailable'}
        </span>
        <span>as of {asOf ? fmtDate(asOf) : '—'}</span>
      </div>

      <LegTable
        visible={visibleLegs}
        series={series}
        mode={mode}
        testId="sofr-curve-table"
      />
    </div>
  );
}
