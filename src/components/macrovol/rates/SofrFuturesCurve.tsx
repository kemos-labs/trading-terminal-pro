/**
 * 3M SOFR Futures — Implied Rate (Phase 3 exemplar rebuild).
 *
 * Spec rules implemented:
 * - Title "3M SOFR Futures — Implied Rate"; default Y = 100 − price (% p.a.),
 *   explicit Price mode toggle (index points, not %).
 * - X = actual contract/reference quarter from data — never a hardcoded range.
 * - Points + straight segments (discrete contracts; no monotone interpolation).
 * - Live + prior settlement, compact header legend (not a chart-bottom sentence).
 * - One X title, one Y title (frame captions only for a11y, visually hidden).
 * - Adaptive tick density: all front contracts, thinned back contracts.
 * - Tooltip: contract, ref-quarter start/end, price, implied rate, Δ bp,
 *   settlement state, source, observation + fetch times.
 * - Curve-change panel is separate (bps), keeping the outright chart uncluttered.
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

const REFRESH_NOTE = 'Discrete quarterly contracts · points + straight segments · no interpolation';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toISOString().slice(0, 10);
}

function SettlementBadge({ source }: { source?: string }) {
  if (!source) return null;
  const label = source === 'settled'
    ? 'settled'
    : source === 'fallback'
      ? 'model settle'
      : 'live';
  return (
    <span
      className={cn(
        'rounded px-1 py-px font-mono text-[10px]',
        source === 'live' && 'bg-up/15 text-up',
        source === 'settled' && 'bg-info/15 text-info',
        source === 'fallback' && 'bg-amber/15 text-amber',
      )}
    >
      {label}
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
}

function SofrTooltip({ active, payload, fetchedAt, mode }: SofrTooltipRow) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const chgBps = p.rate != null && p.prior != null ? (p.rate - p.prior) * 100 : null;
  return (
    <div
      className="rounded border border-border bg-black/95 px-2.5 py-2 font-mono text-type-2xs leading-relaxed shadow-xl"
      data-testid="sofr-curve-tooltip"
    >
      <div className="flex items-center gap-2 font-bold">
        <span>{p.contract ?? p.x}</span>
        <SettlementBadge source={p.source} />
      </div>
      <div className="mt-1 text-muted-foreground">
        Ref quarter {fmtDate(p.ref_start)} → {fmtDate(p.ref_end)}
      </div>
      <div className="mt-1 grid grid-cols-[auto_auto] gap-x-3">
        <span className="text-muted-foreground">Futures px</span>
        <span className="text-right tabular-nums">{p.futures_price != null ? p.futures_price.toFixed(3) : '—'}</span>
        <span className="text-muted-foreground">Implied rate</span>
        <span className="text-right tabular-nums">{p.rate != null ? `${p.rate.toFixed(3)}%` : '—'}</span>
        {mode === 'price' && (
          <>
            <span className="text-muted-foreground">Index pts</span>
            <span className="text-right tabular-nums">{p.rate != null ? (100 - p.rate).toFixed(3) : '—'}</span>
          </>
        )}
        <span className="text-muted-foreground">Δ vs prior</span>
        <span className="text-right tabular-nums">{chgBps != null ? `${chgBps >= 0 ? '+' : ''}${chgBps.toFixed(1)}bp` : '—'}</span>
        <span className="text-muted-foreground">Observed</span>
        <span className="text-right tabular-nums">{fetchedAt ? new Date(fetchedAt).toISOString().slice(11, 19) + 'Z' : '—'}</span>
      </div>
      <div className="mt-1 text-muted-foreground/80">
        src: CME SR3 via yfinance{p.source === 'settled' ? ' · settled = FRED SOFR compound' : ''} · fetched {fetchedAt ? new Date(fetchedAt).toISOString().slice(11, 19) + 'Z' : '—'}
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

export function SofrFuturesCurve({
  data,
  height = 280,
  asOf,
}: {
  data: SofrCurvePoint[];
  height?: number;
  asOf?: string | null;
}) {
  const [mode, setMode] = useState<YMode>('implied');
  const rows = useMemo(
    () => data.filter((d) => d.rate != null || d.prior != null),
    [data],
  );
  const tickIdx = useMemo(() => xTickIndices(rows.length), [rows.length]);

  // Implied-rate domain (tight); price mode mirrors via 100 − rate.
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

  if (rows.length < 2) {
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

  const yTitle = mode === 'implied' ? 'Implied rate (% p.a.)' : 'Futures price (index pts)';
  const toY = (r: number | null | undefined) =>
    r == null ? null : mode === 'implied' ? r : 100 - r;

  return (
    <div className="rounded border border-border bg-black p-1.5" data-testid="sofr-futures-curve">
      {/* Compact header: title + legend + mode toggle (spec: title "3M SOFR Futures — Implied Rate") */}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1">
        <span className="font-mono text-type-xs font-semibold tracking-wide text-zinc-100" data-testid="sofr-curve-title">
          3M SOFR Futures — {mode === 'implied' ? 'Implied Rate' : 'Price'}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-type-2xs text-zinc-400">
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: DESK_SERIES.historyLive }} aria-hidden />
            live
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: DESK_SERIES.historyCompare }} aria-hidden />
            prior settle
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

      {/* Rotated Y title as DOM (guarantees exactly one Y title; SVG label skipped at 0-width). */}
      <div className="relative" style={{ height }}>
        <span
          className="pointer-events-none absolute left-0 top-1/2 origin-center -translate-y-1/2 -rotate-90 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
          data-testid="sofr-curve-y-title"
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
              content={<SofrTooltip mode={mode} fetchedAt={fetchedAt} />}
              cursor={{ stroke: CHART.axisLine, strokeDasharray: '3 3' }}
            />
            {/* Discrete contracts: points + straight segments (type="linear", never monotone). */}
            <Line
              type="linear"
              dataKey={(row: SofrCurvePoint) => toY(row.prior)}
              name="prior settle"
              stroke={DESK_SERIES.historyCompare}
              strokeWidth={2}
              dot={{ r: 3, fill: DESK_SERIES.historyCompare, stroke: DESK_SERIES.historyCompare }}
              activeDot={{ r: 4.5 }}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey={(row: SofrCurvePoint) => toY(row.rate)}
              name="live"
              stroke={DESK_SERIES.historyLive}
              strokeWidth={2.25}
              dot={{ r: 3.5, fill: DESK_SERIES.historyLive, stroke: DESK_SERIES.historyLive }}
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
