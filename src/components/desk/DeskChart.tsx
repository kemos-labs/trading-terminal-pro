import type { ReactNode, CSSProperties } from 'react';
import { cn } from '../../lib/utils';
import {
  CHART,
  chartAxisTick,
  chartGridProps,
  chartTooltipStyle,
  chartAxisLabelStyle,
} from '../../lib/chartTheme';

/** Recharts axis label prop object. */
export function deskAxisLabel(
  value: string,
  position: 'insideBottom' | 'insideLeft' | 'insideTop' | 'insideRight' = 'insideBottom',
): { value: string; position: typeof position; style: CSSProperties; offset?: number } {
  return {
    value,
    position,
    offset: position === 'insideBottom' ? -2 : 8,
    style: { ...chartAxisLabelStyle },
  };
}

export const deskDefaultMargin = { top: 12, right: 14, bottom: 22, left: 8 };

export function deskChartChrome() {
  return {
    grid: chartGridProps,
    tick: chartAxisTick,
    tooltipStyle: chartTooltipStyle,
    axisLine: CHART.axisLine,
    margin: deskDefaultMargin,
  };
}

/**
 * Black chart field + optional axis title strip (outside Recharts when needed).
 * Prefer Recharts label={{...deskAxisLabel()}} on axes; captions here for a11y/tests.
 */
export function DeskChartFrame({
  children,
  xTitle,
  yTitle,
  height,
  className,
  header,
}: {
  children: ReactNode;
  xTitle?: string;
  yTitle?: string;
  height?: number | string;
  className?: string;
  header?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col rounded border border-border bg-black',
        className,
      )}
      style={height != null ? { height, minHeight: height } : undefined}
    >
      {(header || yTitle) && (
        <div className="flex shrink-0 items-center justify-between gap-2 px-2 pt-1 font-mono text-type-2xs text-zinc-400">
          <span>{yTitle}</span>
          {header}
        </div>
      )}
      <div className="min-h-0 flex-1 px-0.5 pb-0.5">{children}</div>
      {xTitle && (
        <div className="shrink-0 pb-1 text-center font-mono text-type-2xs text-zinc-400">{xTitle}</div>
      )}
    </div>
  );
}
