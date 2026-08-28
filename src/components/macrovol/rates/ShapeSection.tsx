import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type { CurveShapeData, ImplyRead } from '../../../lib/macrovol/api';
import { DataBadge } from '../DataBadge';
import { CollapsibleSection } from '../../terminal/CollapsibleSection';
import { CHART, CHART_SPREAD, chartGridProps, chartTooltipStyle } from '../../../lib/chartTheme';
import { ImplyChip } from '../../common/ImplyDrawer';
import { Spark } from './Spark';

export function ShapeSection({
  shape,
  shapeHistoryCharts,
  onOpenImply,
}: {
  shape: CurveShapeData;
  shapeHistoryCharts: {
    s2s10: { date: string; bps: number }[];
    s5s30: { date: string; bps: number }[];
    s3m10y: { date: string; bps: number }[];
    fly: { date: string; bps: number }[];
  };
  onOpenImply: (i: ImplyRead) => void;
}) {
  // Compact regime strip — full spread curves live on CurvesBoard (sec-curves).
  // Colors from shared CHART_SPREAD so Shape + Curves always match.
  const shapeCards = [
    { key: '2s10s', label: '2s10s', spark: shape.history?.spark_2s10s, color: CHART_SPREAD['2s10s'] },
    { key: '5s30s', label: '5s30s', spark: shape.history?.spark_5s30s, color: CHART_SPREAD['5s30s'] },
    { key: 'fly_2s5s10s', label: 'fly', spark: shape.history?.spark_fly, color: CHART_SPREAD.fly_2s5s10s },
    { key: '2s5s', label: '2s5s', spark: shape.history?.spark_2s5s, color: CHART_SPREAD['2s5s'] },
    { key: '5s10s', label: '5s10s', spark: shape.history?.spark_5s10s, color: CHART_SPREAD['5s10s'] },
    { key: '10s30s', label: '10s30s', spark: shape.history?.spark_10s30s, color: CHART_SPREAD['10s30s'] },
    { key: '3m10y', label: '3m10y', spark: shape.history?.spark_3m10y, color: CHART_SPREAD['3m10y'] },
  ];

  return (
    <CollapsibleSection
      id="sec-shape"
      className="order-3"
      title="SHAPE REGIME"
      apis={['FRED']}
      defaultOpen={false}
      storageKey="rates.sec.shape"
      subtitle="Prints + regime — full curve charts under CURVES & SPREADS"
      badge={
        <>
          <span
            className={`rounded px-1.5 py-0.5 text-type-2xs font-bold ${
              shape.regime === 'steep'
                ? 'bg-up/15 text-up'
                : shape.regime === 'inverted'
                  ? 'bg-down/15 text-down'
                  : 'bg-warn/15 text-warn'
            }`}
          >
            {(shape.regime ?? 'unknown').toUpperCase()}
          </span>
          {shape.imply && <ImplyChip imply={shape.imply} onOpen={onOpenImply} />}
          <span className="hidden text-type-xs text-muted-foreground xl:inline">{shape.regime_note}</span>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-1.5 md:grid-cols-4 lg:grid-cols-7">
        {shapeCards.map((sc) => {
          const sp = shape.spreads[sc.key];
          const bps = sp?.bps;
          return (
            <div key={sc.key} className="rounded border border-border bg-background/50 p-1.5">
              <div className="text-type-2xs text-muted-foreground">{sc.label}</div>
              <div className={`text-sm font-bold tabular-nums ${bps != null && bps < 0 ? 'text-down' : 'text-foreground'}`}>
                {bps != null ? `${bps >= 0 ? '+' : ''}${bps.toFixed(0)}` : '—'}
                <span className="ml-0.5 text-type-2xs font-normal text-muted-foreground">bp</span>
              </div>
              {sc.spark && sc.spark.length > 0 && (
                <div className="mt-0.5">
                  <Spark values={sc.spark} color={sc.color} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* Larger multi-spread history strip */}
      <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { title: '2s10s', data: shapeHistoryCharts.s2s10, color: CHART_SPREAD['2s10s'] },
          { title: '5s30s', data: shapeHistoryCharts.s5s30, color: CHART_SPREAD['5s30s'] },
          { title: '3m10y', data: shapeHistoryCharts.s3m10y, color: CHART_SPREAD['3m10y'] },
          { title: 'fly 2s5s10s', data: shapeHistoryCharts.fly, color: CHART_SPREAD.fly_2s5s10s },
        ].map((ch) => (
          <div key={ch.title} className="rounded border border-border/60 p-1">
            <div className="mb-0.5 text-type-2xs text-muted-foreground">{ch.title} (bps)</div>
            {ch.data.length > 0 ? (
              <ResponsiveContainer width="100%" height={96}>
                <AreaChart data={ch.data} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
                  <CartesianGrid {...chartGridProps} />
                  <XAxis dataKey="date" hide />
                  <YAxis hide domain={['auto', 'auto']} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <ReferenceLine y={0} stroke={CHART.refLine} />
                  <Area type="monotone" dataKey="bps" stroke={ch.color} fill={ch.color} fillOpacity={0.15} strokeWidth={1.4} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="py-4 text-center text-type-2xs text-muted-foreground">No history</div>
            )}
          </div>
        ))}
      </div>
      <DataBadge asOf={shape.as_of} source={shape.source || 'FRED'} note={shape.unit_note} className="mt-1" />
    </CollapsibleSection>
  );
}
