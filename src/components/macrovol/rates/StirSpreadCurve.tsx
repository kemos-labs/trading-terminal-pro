import { useMemo } from 'react';
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  CHART, chartAxisTick, chartGridProps, chartTooltipStyle, tightDomain,
} from '../../../lib/chartTheme';

export interface StirSpreadPoint {
  x: string;
  bps: number | null;
  /** Full label for tooltip / truncation source. Defaults to `x`. */
  full?: string;
}

export interface StirSpreadCurveProps {
  title?: string;
  points: StirSpreadPoint[];
  height?: number;
  synthNote?: string | null;
  /** Color token for the line; defaults to rate series. */
  color?: string;
  asOf?: string | null;
}

/** Pure helper: map raw rows to chart points with short x labels. */
export function toCurvePoints<T>(rows: T[], opts: {
  x: (r: T) => string;
  bps: (r: T) => number | null | undefined;
  /** Optional field for tooltip full name. */
  full?: (r: T) => string | undefined;
}): StirSpreadPoint[] {
  return rows.map((r) => ({
    x: opts.x(r),
    bps: opts.bps(r) ?? null,
    full: opts.full?.(r),
  }));
}

/** Shorten a tenor / spread label for the X axis (e.g. "SR1Z5-SR3Z5" → "Z5/Z5"). */
function shortLabel(x: string): string {
  if (!x) return x;
  // Strip leading prefix hints (SR1/SR3/ZQ/SOFR) and common separators.
  const cleaned = x
    .replace(/^(SR1|SR3|ZQ|SR|Z)\b/i, '')
    .replace(/[-/]/g, '/')
    .trim();
  if (cleaned.length <= 6) return cleaned || x;
  return cleaned.slice(0, 6);
}

export function StirSpreadCurve({
  title,
  points,
  height = 150,
  synthNote,
  color = CHART.series.rate,
  asOf,
}: StirSpreadCurveProps) {
  const rows = useMemo(() => points.filter((p) => p.bps != null), [points]);
  const yDomain = useMemo(() => {
    const d = tightDomain(rows.map((r) => r.bps), 0.15, { minPadAbs: 1 }) as [number, number];
    // Signed spreads: keep zero inside the domain so the reference line + 0 tick render.
    if (rows.some((r) => (r.bps ?? 0) > 0) && d[0] > 0) d[0] = 0;
    if (rows.some((r) => (r.bps ?? 0) < 0) && d[1] < 0) d[1] = 0;
    return d;
  }, [rows]);

  // Fail-closed: no empty axes when nothing resolved.
  if (rows.length < 2) {
    return (
      <div className="rounded border border-border bg-background/30 p-2 font-mono text-type-2xs text-muted-foreground">
        {title ? `${title}: ` : ''}Awaiting live bps for curve…
      </div>
    );
  }

  return (
    <div className="rounded border border-border bg-background/30 p-1.5">
      {(title || synthNote) && (
        <div className="mb-1 flex flex-wrap items-center justify-between gap-1 px-1">
          {title && (
            <span className="font-mono text-type-2xs font-semibold tracking-wide text-foreground">
              {title}
              {asOf && <span className="ml-1.5 font-normal text-muted-foreground">{asOf}</span>}
            </span>
          )}
          {synthNote && (
            <span className="rounded border border-warn/40 px-1 py-0.5 font-mono text-type-2xs text-warn">
              SYNTH · {synthNote}
            </span>
          )}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={rows}
          margin={{ top: 6, right: 12, left: 2, bottom: 4 }}
        >
          <CartesianGrid {...chartGridProps} />
          <XAxis
            dataKey="x"
            tick={{ ...chartAxisTick, fontSize: 8 }}
            interval={0}
            angle={-35}
            textAnchor="end"
            height={36}
            minTickGap={2}
            tickFormatter={(v: string) => shortLabel(v)}
          />
          <YAxis
            tick={{ ...chartAxisTick, fontSize: 8 }}
            width={44}
            domain={yDomain}
            tickFormatter={(v) => Number(v).toFixed(0)}
            label={{
              value: 'bp',
              angle: -90,
              position: 'insideLeft',
              style: { ...chartAxisTick, textAnchor: 'middle', fontSize: 9 },
            }}
          />
          {/* Visible zero — sign convention reference (SOFR−FF: + = secured firmer than unsecured). */}
          <ReferenceLine y={0} stroke={CHART.axisLine} strokeDasharray="4 3" />
          <Tooltip
            contentStyle={chartTooltipStyle}
            formatter={(v: number, _n, item) => [
              `${Number(v).toFixed(1)} bps`,
              (item?.payload?.full as string) || (item?.payload?.x as string),
            ]}
            labelFormatter={(l) => String(l)}
          />
          <Line
            type="linear"
            dataKey="bps"
            name="bps"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 2.5, fill: color, stroke: color }}
            activeDot={{ r: 4 }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
