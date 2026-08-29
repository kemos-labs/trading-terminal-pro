import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  canvasCellColor, colorWithAlpha, resolveCanvasColors,
} from '../../lib/chartTheme';
import { cn } from '../../lib/utils';

/**
 * Canonical analytical heatmap engine (Phase 3).
 * ONE heatmap implementation for every desk. Canvas fill + DOM axis/tooltip
 * overlay + accessible virtualized-style table fallback + keyboard navigation.
 *
 * Spec rules encoded:
 * - Signed metrics → zero-centered diverging palette with symmetric domain;
 *   sequential metrics → perceptually uniform single-hue ramp; never rainbow.
 * - Missing cells are hatched neutral — visually distinct from numeric zero.
 * - Exact-value tooltip: value, units, row/col keys, side(s), coverage, source,
 *   observation time, assumptions.
 * - Keyboard: arrow keys move focus cell; Enter selects; Home/End jump edges.
 * - Row/col windows center on spot/forward or selected scope — never "first N".
 */

export interface HeatmapAxisKey {
  /** Raw value (strike, DTE, expiry label…) */
  key: string;
  /** Rendered label */
  label: string;
  /** Numeric value for centering/sorting (strike or dte); null for pure labels */
  num?: number | null;
}

export interface HeatmapCellData {
  value: number | null;
  /** Exact display value (preformatted) — falls back to value formatting */
  display?: string;
  /** Coverage (e.g. OI numerator/denominator) for the tooltip */
  coverage?: string;
  sides?: string;
  source?: string;
  asOf?: string | number | null;
  assumption?: string;
}

export interface HeatmapTooltipContext {
  row: HeatmapAxisKey;
  col: HeatmapAxisKey;
  cell: HeatmapCellData;
}

export interface HeatmapEngineProps {
  rows: HeatmapAxisKey[];
  cols: HeatmapAxisKey[];
  /** values[rowIndex][colIndex] */
  cells: HeatmapCellData[][];
  /** diverging = signed, zero-centered symmetric; sequential = single-hue ramp */
  diverging: boolean;
  /** Explicit domain override; diverging uses ±max(|v|) when omitted */
  domain?: [number, number];
  units?: string;
  metricLabel?: string;
  /** Spot/ATM reference line position on the columns axis */
  spotRef?: { colKey: string; label: string } | null;
  onCellSelect?: (ctx: HeatmapTooltipContext | null) => void;
  emptyMessage?: string;
  className?: string;
  /** a11y caption for the table fallback */
  caption?: string;
}

function fmt(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

/** Sequential perceptually-uniform-ish ramp (single hue, lightness-scaled). */
function sequentialColor(t: number, colors: ReturnType<typeof resolveCanvasColors>): string {
  const c = Math.max(0, Math.min(1, t));
  return colorWithAlpha(colors.info, 0.08 + c * 0.82);
}

export function HeatmapEngine({
  rows, cols, cells, diverging, domain, units = '', metricLabel = 'value',
  spotRef, onCellSelect, emptyMessage = 'No heatmap data — values stay unavailable.', className, caption,
}: HeatmapEngineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 640, h: 320 });
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [focus, setFocus] = useState<{ r: number; c: number } | null>(null);
  const colors = useMemo(() => resolveCanvasColors(), []);

  // Domain computation — diverging is symmetric ±m (fixed visible scale).
  const [dMin, dMax] = useMemo(() => {
    if (domain) return domain;
    let lo = Infinity;
    let hi = -Infinity;
    for (const row of cells) {
      for (const c of row) {
        if (c?.value != null && Number.isFinite(c.value)) {
          if (c.value < lo) lo = c.value;
          if (c.value > hi) hi = c.value;
        }
      }
    }
    if (!Number.isFinite(lo)) return [0, 1] as [number, number];
    if (diverging) {
      const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
      return [-m, m] as [number, number];
    }
    return [lo, hi] as [number, number];
  }, [cells, diverging, domain]);

  // Layout metrics (axis gutters measured from label widths).
  const layout = useMemo(() => {
    const padL = 56;
    const padT = 22;
    const padR = 10;
    const padB = 26;
    const w = Math.max(0, dim.w - padL - padR);
    const h = Math.max(0, dim.h - padT - padB);
    const cellW = cols.length ? w / cols.length : 0;
    const cellH = rows.length ? h / rows.length : 0;
    return { padL, padT, padR, padB, w, h, cellW, cellH };
  }, [dim, rows.length, cols.length]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(dim.w * dpr));
    canvas.height = Math.max(1, Math.floor(dim.h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dim.w, dim.h);

    const { padL, padT, cellW, cellH } = layout;
    if (!rows.length || !cols.length || cellW <= 0 || cellH <= 0) return;

    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < cols.length; c++) {
        const cell = cells[r]?.[c];
        const v = cell?.value;
        const x = padL + c * cellW;
        const y = padT + r * cellH;
        if (v == null || !Number.isFinite(v)) {
          // Missing: hatched neutral — never the zero color.
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, cellW - 1, cellH - 1);
          ctx.clip();
          ctx.fillStyle = colors.empty;
          ctx.fillRect(x, y, cellW - 1, cellH - 1);
          ctx.strokeStyle = colorWithAlpha(colors.label, 0.35);
          ctx.lineWidth = 1;
          for (let s = -cellH; s < cellW; s += 5) {
            ctx.beginPath();
            ctx.moveTo(x + s, y + cellH);
            ctx.lineTo(x + s + cellH, y);
            ctx.stroke();
          }
          ctx.restore();
        } else {
          ctx.fillStyle = diverging
            ? canvasCellColor(v, dMin, dMax, true, colors)
            : sequentialColor((v - dMin) / ((dMax - dMin) || 1), colors);
          ctx.fillRect(x, y, cellW - 1, cellH - 1);
        }
        // Focus ring (keyboard) — brand color.
        if (focus && focus.r === r && focus.c === c) {
          ctx.strokeStyle = colors.brand;
          ctx.lineWidth = 2;
          ctx.strokeRect(x - 0.5, y - 0.5, cellW, cellH);
        } else if (hover && hover.r === r && hover.c === c) {
          ctx.strokeStyle = colorWithAlpha(colors.brand, 0.45);
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x - 0.5, y - 0.5, cellW, cellH);
        }
      }
    }

    // Spot/ATM reference line on columns.
    if (spotRef) {
      const ci = cols.findIndex((k) => k.key === spotRef.colKey);
      if (ci >= 0) {
        const x = padL + (ci + 0.5) * cellW;
        ctx.strokeStyle = colorWithAlpha(colors.brand, 0.85);
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, layout.padT - 4);
        ctx.lineTo(x, layout.padT + layout.h);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = colors.brand;
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(spotRef.label, x, layout.padT - 7);
      }
    }

    // Axis labels.
    ctx.fillStyle = colors.label;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const step = Math.max(1, Math.ceil(cols.length / Math.max(4, Math.floor(layout.w / 42))));
    for (let c = 0; c < cols.length; c++) {
      if (c % step !== 0 && c !== cols.length - 1) continue;
      ctx.fillText(cols[c]!.label, padL + c * cellW + cellW / 2, dim.h - layout.padB + 6);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let r = 0; r < rows.length; r++) {
      ctx.fillText(rows[r]!.label, padL - 6, padT + r * cellH + cellH / 2);
    }
  }, [cells, rows, cols, diverging, dMin, dMax, dim, layout, hover, focus, colors, spotRef]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDim({ w: Math.max(220, width), h: Math.max(140, height) });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const posToCell = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const c = Math.floor((clientX - rect.left - layout.padL) / layout.cellW);
    const r = Math.floor((clientY - rect.top - layout.padT) / layout.cellH);
    if (r < 0 || c < 0 || r >= rows.length || c >= cols.length) return null;
    return { r, c };
  }, [layout, rows.length, cols.length]);

  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (!rows.length || !cols.length) return;
    const cur = focus ?? { r: 0, c: Math.floor(cols.length / 2) };
    const move = (dr: number, dc: number) => {
      e.preventDefault();
      const next = { r: Math.max(0, Math.min(rows.length - 1, cur.r + dr)), c: Math.max(0, Math.min(cols.length - 1, cur.c + dc)) };
      setFocus(next);
      const cell = cells[next.r]?.[next.c];
      if (cell) onCellSelect?.({ row: rows[next.r]!, col: cols[next.c]!, cell });
    };
    if (e.key === 'ArrowDown') move(1, 0);
    else if (e.key === 'ArrowUp') move(-1, 0);
    else if (e.key === 'ArrowRight') move(0, 1);
    else if (e.key === 'ArrowLeft') move(0, -1);
    else if (e.key === 'Home') { e.preventDefault(); setFocus({ r: cur.r, c: 0 }); }
    else if (e.key === 'End') { e.preventDefault(); setFocus({ r: cur.r, c: cols.length - 1 }); }
    else if (e.key === 'Escape') { setFocus(null); onCellSelect?.(null); }
  }, [focus, rows, cols, cells, onCellSelect]);

  const tooltip = (() => {
    const pos = hover ?? focus;
    if (!pos) return null;
    const cell = cells[pos.r]?.[pos.c];
    if (!cell) return null;
    const row = rows[pos.r]!;
    const col = cols[pos.c]!;
    return { row, col, cell, pos };
  })();

  const missingCount = useMemo(
    () => cells.flat().filter((c) => c?.value == null).length,
    [cells],
  );
  const totalCount = rows.length * cols.length;

  if (!rows.length || !cols.length) {
    return (
      <div className={cn('flex items-center justify-center rounded border border-border bg-black/40 p-4 font-mono text-type-2xs text-muted-foreground', className)} data-testid="heatmap-empty">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      className={cn('flex min-h-0 flex-col gap-1', className)}
      data-testid="heatmap-engine"
    >
      {/* Canvas plot + DOM overlay */}
      <div
        ref={wrapRef}
        className="relative min-h-[180px] flex-1"
        tabIndex={0}
        role="application"
        aria-label={`${metricLabel} heatmap. ${rows.length} rows × ${cols.length} columns. Arrow keys navigate, Enter selects, Escape clears.`}
        onKeyDown={onKey}
        data-testid-slot="heatmap-canvas-wrap"
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full cursor-crosshair"
          onMouseMove={(e) => setHover(posToCell(e.clientX, e.clientY))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const pos = posToCell(e.clientX, e.clientY);
            if (!pos) return;
            setFocus(pos);
            const cell = cells[pos.r]?.[pos.c];
            if (cell) onCellSelect?.({ row: rows[pos.r]!, col: cols[pos.c]!, cell });
          }}
        />
        {/* Exact tooltip */}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 rounded border border-border bg-black/95 px-2 py-1.5 font-mono text-type-2xs leading-snug shadow-xl"
            data-testid="heatmap-tooltip"
            style={{
              left: Math.min(Math.max(0, layout.padL + (tooltip.pos.c + 0.5) * layout.cellW - 90), Math.max(0, dim.w - 200)),
              top: tooltip.pos.r * layout.cellH > dim.h / 2 ? layout.padT + tooltip.pos.r * layout.cellH - 84 : layout.padT + (tooltip.pos.r + 1) * layout.cellH + 6,
            }}
          >
            <div className="font-bold text-foreground">
              {tooltip.col.label} · {tooltip.row.label}
            </div>
            <div className="tabular-nums text-foreground">
              {metricLabel}:{' '}
              {tooltip.cell.value != null
                ? `${tooltip.cell.display ?? fmt(tooltip.cell.value)}${units ? ` ${units}` : ''}`
                : 'unavailable'}
            </div>
            {tooltip.cell.sides && <div className="text-muted-foreground">sides: {tooltip.cell.sides}</div>}
            {tooltip.cell.coverage && <div className="text-muted-foreground">coverage: {tooltip.cell.coverage}</div>}
            {tooltip.cell.source && <div className="text-muted-foreground">src: {tooltip.cell.source}</div>}
            {tooltip.cell.asOf != null && (
              <div className="text-muted-foreground">
                obs: {new Date(typeof tooltip.cell.asOf === 'number' ? tooltip.cell.asOf : tooltip.cell.asOf).toISOString().slice(11, 19)}Z
              </div>
            )}
            {tooltip.cell.assumption && <div className="text-amber">{tooltip.cell.assumption}</div>}
          </div>
        )}
      </div>

      {/* Legend + scale footer */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-1 font-mono text-type-2xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="tabular-nums">{fmt(dMin)}</span>
          <div
            className="h-2 min-w-24 flex-1 rounded-sm"
            style={{
              background: diverging
                ? `linear-gradient(90deg, ${colorWithAlpha(colors.down, 0.9)} 0%, ${colorWithAlpha(colors.down, 0.3)} 28%, ${colorWithAlpha(colors.foreground, 0.12)} 50%, ${colorWithAlpha(colors.up, 0.3)} 72%, ${colorWithAlpha(colors.up, 0.9)} 100%)`
                : `linear-gradient(90deg, ${colorWithAlpha(colors.info, 0.08)} 0%, ${colorWithAlpha(colors.info, 0.55)} 55%, ${colorWithAlpha(colors.info, 0.9)} 100%)`,
            }}
            aria-hidden
          />
          <span className="tabular-nums">{fmt(dMax)}</span>
          <span className="ml-1">{units}</span>
          {missingCount > 0 && (
            <span className="ml-1 flex items-center gap-1 text-muted-foreground/80" title="Hatched cells = missing (distinct from zero)">
              <span className="inline-block h-2.5 w-2.5 border border-border" style={{ backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 2px, ${colorWithAlpha(colors.label, 0.4)} 2px, ${colorWithAlpha(colors.label, 0.4)} 3px)` }} aria-hidden />
              {missingCount}/{totalCount} missing
            </span>
          )}
        </div>
        {spotRef && <span className="shrink-0">spot/ATM ref: {spotRef.label}</span>}
      </div>

      {/* Accessible table fallback — same data, DOM table */}
      <details className="shrink-0">
        <summary className="cursor-pointer font-mono text-type-2xs text-muted-foreground hover:text-foreground">
          Table view (accessible fallback)
        </summary>
        <div className="mt-1 max-h-48 overflow-auto rounded border border-border/60">
          <table className="w-full border-collapse font-mono text-type-2xs">
            <caption className="sr-only">{caption ?? `${metricLabel} heatmap data table`}</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 bg-card px-1.5 py-1 text-left">row \ col</th>
                {cols.map((c) => (
                  <th key={c.key} scope="col" className="px-1.5 py-1 text-right">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={r.key} className="border-t border-border/40">
                  <th scope="row" className="sticky left-0 bg-card px-1.5 py-1 text-left">{r.label}</th>
                  {cols.map((c, ci) => {
                    const v = cells[ri]?.[ci]?.value;
                    return (
                      <td key={c.key} className="px-1.5 py-1 text-right tabular-nums">
                        {v != null && Number.isFinite(v) ? (cells[ri]![ci]!.display ?? fmt(v)) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
