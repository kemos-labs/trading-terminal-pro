/**
 * Hero curves board — dual UST (today vs last year), SOFR futures path, every spread history.
 * Dense grid to fill rates desk content area (not chrome).
 */
import {
  Area, AreaChart, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { CollapsibleSection } from '../../terminal/CollapsibleSection';
import { DataBadge } from '../DataBadge';
import { CHART, CHART_SPREAD, chartGridProps, chartTooltipStyle } from '../../../lib/chartTheme';
import type { CurveShapeData, ImplyRead, RatesCurveHistory } from '../../../lib/macrovol/api';
import { ImplyChip } from '../../common/ImplyDrawer';
import { Spark } from './Spark';
import { SofrFuturesCurve } from './SofrFuturesCurve';
import {
  YieldCurveCompare,
  type CurveComparePoint,
  type CurveCompareWindowId,
} from './YieldCurveCompare';

export type CurvePoint = { label: string; yield: number | null };
export type StirPathPoint = {
  x: string;
  rate: number | null;
  prior?: number | null;
  vsSofr: number | null;
  source?: string;
  contract?: string;
};
export type SpreadHist = { date: string; bps: number }[];

const SPREAD_META: {
  key: keyof typeof CHART_SPREAD;
  label: string;
  color: string;
  histKey: keyof SpreadHistoryPack;
  sparkKey?: string;
}[] = [
  { key: '2s10s', label: '2s10s', color: CHART_SPREAD['2s10s'], histKey: 's2s10', sparkKey: 'spark_2s10s' },
  { key: '5s30s', label: '5s30s', color: CHART_SPREAD['5s30s'], histKey: 's5s30', sparkKey: 'spark_5s30s' },
  { key: '2s5s', label: '2s5s', color: CHART_SPREAD['2s5s'], histKey: 's2s5', sparkKey: 'spark_2s5s' },
  { key: '5s10s', label: '5s10s', color: CHART_SPREAD['5s10s'], histKey: 's5s10', sparkKey: 'spark_5s10s' },
  { key: '10s30s', label: '10s30s', color: CHART_SPREAD['10s30s'], histKey: 's10s30', sparkKey: 'spark_10s30s' },
  { key: '3m10y', label: '3m10y', color: CHART_SPREAD['3m10y'], histKey: 's3m10y', sparkKey: 'spark_3m10y' },
  { key: 'fly_2s5s10s', label: '2s5s10s fly', color: CHART_SPREAD.fly_2s5s10s, histKey: 'fly', sparkKey: 'spark_fly' },
];

export type SpreadHistoryPack = {
  s2s10: SpreadHist;
  s5s30: SpreadHist;
  s2s5: SpreadHist;
  s5s10: SpreadHist;
  s10s30: SpreadHist;
  s3m10y: SpreadHist;
  fly: SpreadHist;
};

function MiniCurve({
  title,
  subtitle,
  liveBps,
  formula,
  data,
  color,
  imply,
  spark,
  onOpenImply,
}: {
  title: string;
  subtitle?: string;
  liveBps?: number | null;
  formula?: string;
  data: SpreadHist;
  color: string;
  imply?: ImplyRead | null;
  spark?: number[];
  onOpenImply?: (i: ImplyRead) => void;
}) {
  const neg = liveBps != null && liveBps < 0;
  return (
    <div className="flex min-h-0 flex-col rounded border border-border bg-background/40 p-1.5">
      <div className="mb-0.5 flex items-baseline justify-between gap-1">
        <div className="min-w-0">
          <div className="truncate font-mono text-type-2xs font-semibold text-foreground">{title}</div>
          {formula && (
            <div className="truncate font-mono text-type-2xs text-muted-foreground/80">{formula}</div>
          )}
        </div>
        <div className={`shrink-0 font-mono text-sm font-bold tabular-nums ${neg ? 'text-down' : 'text-foreground'}`}>
          {liveBps != null ? `${liveBps >= 0 ? '+' : ''}${liveBps.toFixed(0)}` : '—'}
          <span className="ml-0.5 text-type-2xs font-normal text-muted-foreground">bp</span>
        </div>
      </div>
      {imply && onOpenImply && (
        <div className="mb-0.5">
          <ImplyChip imply={imply} compact onOpen={onOpenImply} />
        </div>
      )}
      {data.length > 0 ? (
        <div className="min-h-0 flex-1" style={{ height: 88 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
              <CartesianGrid {...chartGridProps} />
              <XAxis dataKey="date" hide />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(v: number) => [`${Number(v).toFixed(1)} bp`, title]}
                labelFormatter={(l) => String(l)}
              />
              <ReferenceLine y={0} stroke={CHART.refLine} strokeWidth={1} />
              <Area
                type="monotone"
                dataKey="bps"
                stroke={color}
                fill={color}
                fillOpacity={0.18}
                strokeWidth={1.4}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : spark && spark.length > 0 ? (
        <div className="flex h-[88px] items-center px-1">
          <Spark values={spark} color={color} />
        </div>
      ) : (
        <div className="flex h-[88px] items-center justify-center font-mono text-type-2xs text-muted-foreground">
          {subtitle || 'No history'}
        </div>
      )}
    </div>
  );
}

export function CurvesBoard({
  curve,
  curveMeta,
  curveComparePoints,
  curveCompare,
  stirChart,
  sofr,
  shape,
  spreadHistory,
  onOpenImply,
  compareWindow,
  onCompareWindow,
  customDays,
  onCustomDays,
  compareLoading,
}: {
  curve: CurvePoint[];
  curveMeta: { as_of?: string; source?: string; note?: string };
  curveComparePoints: CurveComparePoint[];
  curveCompare?: RatesCurveHistory | null;
  stirChart: StirPathPoint[];
  sofr: number | null | undefined;
  shape: CurveShapeData | null;
  spreadHistory: SpreadHistoryPack;
  onOpenImply?: (i: ImplyRead) => void;
  compareWindow?: CurveCompareWindowId | string;
  onCompareWindow?: (id: CurveCompareWindowId) => void;
  customDays?: number;
  onCustomDays?: (days: number) => void;
  compareLoading?: boolean;
}) {
  const compareLive = curveComparePoints.filter((p) => p.today != null || p.historical != null);
  const sofrPath = stirChart.filter((p) => p.rate != null || p.prior != null);
  const compareDate = curveCompare?.compare_as_of;

  return (
    <CollapsibleSection
      id="sec-curves"
      className="order-2"
      title="CURVES & SPREADS · CHARTS"
      apis={['FRED', 'yfinance', 'FiscalData']}
      defaultOpen
      storageKey="rates.sec.curves"
      subtitle="Visual layer for UST data strip above · same tenors / same SOFR path · auction calendar"
      badge={
        <span className="font-mono text-type-2xs text-muted-foreground">
          {compareLive.length} UST dual · {sofrPath.length} SOFR futs · {SPREAD_META.length} spreads
          {sofr != null ? ` · SOFR ${sofr.toFixed(2)}%` : ''}
        </span>
      }
    >
      {/* Bloomberg-style dual UST: white = today, blue = compare window */}
      <YieldCurveCompare
        points={curveComparePoints.length ? curveComparePoints : curve.map((c) => ({
          label: c.label,
          today: c.yield,
          historical: null,
          delta_bps: null,
        }))}
        todayAsOf={curveCompare?.today_as_of || curveMeta.as_of}
        compareAsOf={compareDate}
        source={curveCompare?.source || curveMeta.source}
        height={280}
        compareWindow={compareWindow}
        onCompareWindow={onCompareWindow}
        customDays={customDays}
        onCustomDays={onCustomDays}
        compareLoading={compareLoading}
      />

      {/* Bloomberg-style dual SOFR futures yield path */}
      <div className="mt-2">
        <SofrFuturesCurve
          data={sofrPath.map((p) => ({
            x: p.x,
            rate: p.rate,
            prior: p.prior ?? null,
            vsSofr: p.vsSofr,
            source: p.source,
            contract: p.contract,
          }))}
          height={240}
        />
      </div>

      {/* Every spread — live print + history curve */}
      <div className="mt-2 grid grid-cols-2 gap-1.5 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
        {SPREAD_META.map((m) => {
          const sp = shape?.spreads?.[m.key];
          const hist = spreadHistory[m.histKey] || [];
          const spark = m.sparkKey
            ? (shape?.history as Record<string, number[]> | undefined)?.[m.sparkKey]
            : undefined;
          return (
            <MiniCurve
              key={m.key}
              title={m.label}
              formula={sp?.formula}
              liveBps={sp?.bps}
              data={hist}
              color={m.color}
              imply={sp?.imply}
              spark={spark}
              onOpenImply={onOpenImply}
            />
          );
        })}
      </div>

      <DataBadge
        asOf={shape?.as_of || curveCompare?.as_of || curveMeta.as_of}
        source={shape?.source || curveCompare?.source || curveMeta.source || 'FRED'}
        note={
          compareDate
            ? `UST dual: live vs ${compareDate} · Spreads bps · SOFR path % · FRED + yfinance only`
            : 'Spreads in bps · UST / SOFR path in % · aligned FRED history only'
        }
        className="mt-1.5"
      />
    </CollapsibleSection>
  );
}
