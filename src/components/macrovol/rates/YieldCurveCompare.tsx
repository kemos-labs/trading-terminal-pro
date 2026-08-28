/**
 * Bloomberg-style dual UST yield curve:
 * white = today, blue = compare window (1M · 3M · 6M · 1Y · custom days).
 * Black field, maturity X · yield % Y, compare chips when controlled.
 */
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  CHART, chartAxisTick, chartTooltipStyle, tightDomain,
} from '../../../lib/chartTheme';
import { DeskChartFrame, deskAxisLabel, deskDefaultMargin } from '../../desk/DeskChart';
import { DeskModeBar } from '../../terminal/DeskModeBar';
import { DeskField } from '../../desk/DeskField';
import { DESK_SERIES } from '../../desk/seriesGrammar';

export type CurveComparePoint = {
  label: string;
  today: number | null;
  historical: number | null;
  delta_bps?: number | null;
};

/** Preset + custom compare windows (W4). */
export const CURVE_COMPARE_WINDOWS = [
  { id: '1M', label: '1M', title: 'Compare ~1 month ago' },
  { id: '3M', label: '3M', title: 'Compare ~3 months ago' },
  { id: '6M', label: '6M', title: 'Compare ~6 months ago' },
  { id: '1Y', label: '1Y', title: 'Compare ~1 year ago' },
  { id: 'custom', label: 'Custom', title: 'Custom day lookback' },
] as const;

export type CurveCompareWindowId = (typeof CURVE_COMPARE_WINDOWS)[number]['id'];

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}

function windowTitle(windowId?: string | null, customDays?: number): string {
  if (!windowId || windowId === '1Y') return 'UST YIELD CURVE · TODAY VS LAST YEAR';
  if (windowId === 'custom') {
    return `UST YIELD CURVE · TODAY VS ${customDays ?? '—'}D AGO`;
  }
  return `UST YIELD CURVE · TODAY VS ${windowId}`;
}

export function YieldCurveCompare({
  points,
  todayAsOf,
  compareAsOf,
  height = 280,
  source,
  title,
  currencyLabel = 'USD',
  emptyMessage = 'Awaiting FRED UST curve (today vs compare window)…',
  legendLivePrefix = 'UST CMT · Live',
  legendHistPrefix = 'UST CMT · Yield',
  sourceHint,
  /** Controlled compare window (1M/3M/6M/1Y/custom). Omit chips when unset. */
  compareWindow,
  onCompareWindow,
  customDays = 45,
  onCustomDays,
  compareLoading = false,
}: {
  points: CurveComparePoint[];
  todayAsOf?: string | null;
  compareAsOf?: string | null;
  height?: number;
  source?: string | null;
  title?: string;
  currencyLabel?: string;
  emptyMessage?: string;
  legendLivePrefix?: string;
  legendHistPrefix?: string;
  sourceHint?: string;
  compareWindow?: CurveCompareWindowId | string;
  onCompareWindow?: (id: CurveCompareWindowId) => void;
  customDays?: number;
  onCustomDays?: (days: number) => void;
  compareLoading?: boolean;
}) {
  const rows = points.filter((p) => p.today != null || p.historical != null);
  const liveLabel = `${legendLivePrefix} · ${fmtDate(todayAsOf)}`;
  const histLabel = `${legendHistPrefix} · ${fmtDate(compareAsOf)}`;
  const yDomain = tightDomain(
    rows.flatMap((p) => [p.today, p.historical]),
    0.12,
    { minPadAbs: 0.05 },
  );
  const chartTitle = title ?? windowTitle(compareWindow, customDays);
  const showChips = typeof onCompareWindow === 'function';

  if (rows.length < 2) {
    return (
      <div
        className="flex flex-col gap-1 rounded border border-border bg-black/90 font-mono text-type-xs text-muted-foreground"
        style={{ minHeight: height }}
      >
        {showChips && (
          <div className="flex flex-wrap items-end gap-2 border-b border-zinc-800 px-2 py-1">
            <DeskModeBar
              items={[...CURVE_COMPARE_WINDOWS]}
              activeId={compareWindow ?? '1Y'}
              onSelect={(id) => onCompareWindow(id as CurveCompareWindowId)}
            />
            {compareWindow === 'custom' && onCustomDays && (
              <DeskField
                label="Days"
                value={customDays}
                onChange={(v) => onCustomDays(Math.max(7, Math.min(800, Math.round(v) || 7)))}
                min={7}
                max={800}
                step={1}
                className="w-16"
              />
            )}
          </div>
        )}
        <div className="flex flex-1 items-center justify-center p-3">{emptyMessage}</div>
      </div>
    );
  }

  return (
    <div className="rounded border border-border bg-black p-1.5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1 px-1">
        <span className="font-mono text-type-xs font-semibold tracking-wide text-zinc-100">
          {chartTitle}
          {compareLoading ? (
            <span className="ml-2 font-normal text-zinc-400">· loading…</span>
          ) : null}
        </span>
        <span className="font-mono text-type-2xs text-zinc-400">
          {sourceHint
            || `${source || 'FRED'} · white = live · blue = compare · ${currencyLabel} %`}
        </span>
      </div>

      {showChips && (
        <div className="mb-1 flex flex-wrap items-end gap-2 px-1">
          <DeskModeBar
            items={[...CURVE_COMPARE_WINDOWS]}
            activeId={compareWindow ?? '1Y'}
            onSelect={(id) => onCompareWindow(id as CurveCompareWindowId)}
          />
          {compareWindow === 'custom' && onCustomDays && (
            <DeskField
              label="Days"
              value={customDays}
              onChange={(v) => onCustomDays(Math.max(7, Math.min(800, Math.round(v) || 7)))}
              min={7}
              max={800}
              step={1}
              className="w-16"
            />
          )}
        </div>
      )}

      <DeskChartFrame
        xTitle="Maturity"
        yTitle={`Yield (${currencyLabel} %)`}
        height={height}
        className="border-0 bg-transparent"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ ...deskDefaultMargin, bottom: 28, left: 10 }}>
            <CartesianGrid stroke={CHART.grid} strokeDasharray="0" vertical horizontal />
            <XAxis
              dataKey="label"
              tick={chartAxisTick}
              axisLine={{ stroke: CHART.axisLine }}
              tickLine={{ stroke: CHART.axisLine }}
              interval={0}
              label={deskAxisLabel('Maturity')}
            />
            <YAxis
              tick={chartAxisTick}
              width={48}
              domain={yDomain}
              tickFormatter={(v) => Number(v).toFixed(2)}
              axisLine={{ stroke: CHART.axisLine }}
              tickLine={{ stroke: CHART.axisLine }}
              label={deskAxisLabel(`Yield (${currencyLabel} %)`, 'insideLeft')}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(v: number, name: string) => {
                const n = Number(v);
                if (!Number.isFinite(n)) return ['—', name];
                return [
                  `${n.toFixed(3)}%`,
                  name === 'today' ? liveLabel : histLabel,
                ];
              }}
              labelFormatter={(l) => `Tenor ${l}`}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono', color: CHART.legend, paddingTop: 4 }}
              formatter={(value) => (value === 'today' ? liveLabel : histLabel)}
              iconType="circle"
            />
            <Line
              type="monotone"
              dataKey="historical"
              name="historical"
              stroke={DESK_SERIES.historyCompare}
              strokeWidth={2.25}
              dot={{ r: 3.5, fill: DESK_SERIES.historyCompare, stroke: DESK_SERIES.historyCompare }}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="today"
              name="today"
              stroke={DESK_SERIES.historyLive}
              strokeWidth={2.25}
              dot={{ r: 3.5, fill: DESK_SERIES.historyLive, stroke: DESK_SERIES.historyLive }}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </DeskChartFrame>

      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 border-t border-zinc-800 px-1 pt-1 font-mono text-type-2xs text-zinc-400">
        {rows.map((p) => {
          const d =
            p.delta_bps != null
              ? p.delta_bps
              : p.today != null && p.historical != null
                ? Math.round((p.today - p.historical) * 1000) / 10
                : null;
          if (d == null) return null;
          return (
            <span key={p.label}>
              <span className="text-zinc-400">{p.label}</span>{' '}
              <span className={d > 0 ? 'text-warn' : d < 0 ? 'text-up' : 'text-foreground'}>
                {d > 0 ? '+' : ''}
                {d.toFixed(0)}bp
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
