/**
 * Bloomberg-style 3M SOFR futures yield strip:
 * white = live implied yield, blue = prior settlement yield.
 * X = delivery quarter, Y = yield %.
 */
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  CHART, chartAxisTick, chartTooltipStyle, tightDomain,
} from '../../../lib/chartTheme';
import { DeskChartFrame, deskAxisLabel, deskDefaultMargin } from '../../desk/DeskChart';
import { DESK_SERIES } from '../../desk/seriesGrammar';

export type SofrCurvePoint = {
  x: string;
  rate: number | null;
  prior?: number | null;
  vsSofr?: number | null;
  source?: string;
  contract?: string;
};

export function SofrFuturesCurve({
  data,
  height = 280,
  asOf,
}: {
  data: SofrCurvePoint[];
  height?: number;
  asOf?: string | null;
}) {
  const rows = data.filter((d) => d.rate != null || d.prior != null);
  const liveLabel = '3M SOFR Future · Yield · Live Data';
  const priorLabel = asOf
    ? `3M SOFR Future · Yield · ${asOf}`
    : '3M SOFR Future · Yield · prior settle';
  const yDomain = tightDomain(
    rows.flatMap((d) => [d.rate, d.prior ?? null]),
    0.12,
    { minPadAbs: 0.05 },
  );

  if (rows.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded border border-border bg-black/90 font-mono text-type-xs text-muted-foreground"
        style={{ height }}
      >
        Awaiting live 3M SOFR futures strip…
      </div>
    );
  }

  return (
    <div className="rounded border border-border bg-black p-1.5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1 px-1">
        <span className="font-mono text-type-xs font-semibold tracking-wide text-zinc-100">
          3 MONTH SOFR FUTURE · YIELD
        </span>
        <span className="font-mono text-type-2xs text-zinc-400">
          Sep24→Dec30 · white = live · blue = prior · settled = FRED SOFR · USD %
        </span>
      </div>
      <DeskChartFrame
        xTitle="Delivery"
        yTitle="Yield (USD %)"
        height={height}
        className="border-0 bg-transparent"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ ...deskDefaultMargin, bottom: 36, left: 10 }}>
            <CartesianGrid stroke={CHART.grid} strokeDasharray="0" vertical horizontal />
            <XAxis
              dataKey="x"
              tick={{ ...chartAxisTick, fontSize: 9 }}
              interval={0}
              angle={-40}
              textAnchor="end"
              height={48}
              minTickGap={4}
              axisLine={{ stroke: CHART.axisLine }}
              tickLine={{ stroke: CHART.axisLine }}
              label={deskAxisLabel('Delivery')}
            />
            <YAxis
              tick={chartAxisTick}
              width={48}
              domain={yDomain}
              tickFormatter={(v) => Number(v).toFixed(2)}
              axisLine={{ stroke: CHART.axisLine }}
              tickLine={{ stroke: CHART.axisLine }}
              label={deskAxisLabel('Yield (USD %)', 'insideLeft')}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(v: number, name: string) => [
                `${Number(v).toFixed(3)}%`,
                name === 'rate' ? liveLabel : priorLabel,
              ]}
              labelFormatter={(l) => String(l)}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono', color: CHART.legend, paddingTop: 4 }}
              formatter={(value) => (value === 'rate' ? liveLabel : priorLabel)}
              iconType="circle"
            />
            <Line
              type="monotone"
              dataKey="prior"
              name="prior"
              stroke={DESK_SERIES.historyCompare}
              strokeWidth={2.25}
              dot={{ r: 3.5, fill: DESK_SERIES.historyCompare, stroke: DESK_SERIES.historyCompare }}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="rate"
              name="rate"
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
    </div>
  );
}
