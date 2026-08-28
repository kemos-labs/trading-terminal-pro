import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import { DiagnosticsStrip } from './DiagnosticsStrip';
import { fmtPrice, fmtPct } from '../../lib/format';
import { colorWithAlpha, resolveCanvasColors } from '../../lib/chartTheme';
import type { NoArbResult } from '../../lib/options/noarb';
import { Explain } from '../common/Explain';
import { DeskChartFrame } from '../desk/DeskChart';
import { PrintStrip } from '../desk/PrintStrip';
import { DeskModeBar } from '../terminal/DeskModeBar';

type ArbMode = 'combined' | 'calendar' | 'butterfly';

const MODE_ITEMS = [
  { id: 'combined', label: 'Combined', title: 'Calendar ∪ butterfly flags' },
  { id: 'calendar', label: 'Calendar', title: 'Calendar arbitrage only' },
  { id: 'butterfly', label: 'Butterfly', title: 'Butterfly arbitrage only' },
] as const;

function buildViolationMatrix(
  surface: NonNullable<ReturnType<typeof useTerminalStore.getState>['surface']>,
  arbResult: NoArbResult,
  mode: ArbMode,
): { rows: number; cols: number; viol: boolean[][] } {
  const rows = surface.iv.length;
  const cols = surface.strikes.length;
  const viol: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < cols; c++) {
      const cal = arbResult.calendar.flags[r]?.[c] ?? false;
      const fly = arbResult.butterfly.flags[r]?.[c] ?? false;
      row.push(mode === 'combined' ? cal || fly : mode === 'calendar' ? cal : fly);
    }
    viol.push(row);
  }
  return { rows, cols, viol };
}

export function ArbitrageView() {
  const surface = useTerminalStore((s) => s.surface);
  const arbResult = useTerminalStore((s) => s.arbResult);
  const sviReadout = useTerminalStore((s) => s.sviReadout);
  const [mode, setMode] = useState<ArbMode>('combined');
  const [selectedCell, setSelectedCell] = useState<{ strike: number; dte: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverCell, setHoverCell] = useState<{ strike: number; dte: number } | null>(null);
  const [dim, setDim] = useState({ w: 600, h: 400 });

  const violationMatrix = useMemo(() => {
    if (!surface || !arbResult) return null;
    return buildViolationMatrix(surface, arbResult, mode);
  }, [surface, arbResult, mode]);

  const violCount = useMemo(() => {
    if (!violationMatrix) return { calendar: 0, butterfly: 0 };
    return {
      calendar: arbResult?.calendar.violations ?? 0,
      butterfly: arbResult?.butterfly.violations ?? 0,
    };
  }, [violationMatrix, arbResult]);

  useEffect(() => {
    if (!selectedCell) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-arb-canvas]') || t.closest('[data-arb-inspector]')) return;
      setSelectedCell(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selectedCell]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !surface || !violationMatrix) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = dim.w;
    const h = dim.h;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    const colors = resolveCanvasColors();
    const rows = violationMatrix.rows;
    const cols = violationMatrix.cols;
    const labelW = 60;
    const headerH = 16;
    const cellW = Math.max(12, (w - labelW) / cols);
    const cellH = Math.max(8, (h - headerH) / rows);
    const x0 = labelW;
    const y0 = headerH;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = violationMatrix.viol[r]![c]!;
        const x = x0 + c * cellW;
        const y = y0 + r * cellH;

        ctx.fillStyle = v
          ? colorWithAlpha(colors.down, 0.7)
          : colorWithAlpha(colors.up, 0.12);
        ctx.fillRect(x, y, cellW - 1, cellH - 1);

        if (
          selectedCell &&
          surface.strikes[c] === selectedCell.strike &&
          surface.dtes[r] === selectedCell.dte
        ) {
          ctx.strokeStyle = colors.brand;
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, cellW - 1, cellH - 1);
        }
      }
    }

    // X labels = strike (columns)
    ctx.fillStyle = colorWithAlpha(colors.label, 0.9);
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * cellW + cellW / 2;
      ctx.fillText(String(surface.strikes[c]!), x, y0 + rows * cellH + 2);
    }

    // Y labels = DTE (rows)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colorWithAlpha(colors.label, 0.7);
    ctx.font = '9px "JetBrains Mono", monospace';
    for (let r = 0; r < rows; r++) {
      const y = y0 + r * cellH + cellH / 2;
      ctx.fillText(`${surface.dtes[r]}d`, x0 - 4, y);
    }
  }, [surface, violationMatrix, dim, selectedCell]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDim({ w: Math.max(200, width), h: Math.max(100, height) });
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const posToCell = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !surface || !violationMatrix) return null;
      const rect = canvas.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      const rows = violationMatrix.rows;
      const cols = violationMatrix.cols;
      const labelW = 60;
      const headerH = 16;
      const cellW = Math.max(12, (dim.w - labelW) / cols);
      const cellH = Math.max(8, (dim.h - headerH) / rows);
      const x0 = labelW;
      const y0 = headerH;
      const c = Math.floor((mx - x0) / cellW);
      const r = Math.floor((my - y0) / cellH);
      if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
      return { strike: surface.strikes[c]!, dte: surface.dtes[r]!, r, c };
    },
    [surface, violationMatrix, dim],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const cell = posToCell(e.clientX, e.clientY);
      if (cell && (hoverCell?.strike !== cell.strike || hoverCell?.dte !== cell.dte)) {
        setHoverCell(cell);
      } else if (!cell) {
        setHoverCell(null);
      }
    },
    [posToCell, hoverCell],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const cell = posToCell(e.clientX, e.clientY);
      if (!cell) return;
      if (selectedCell?.strike === cell.strike && selectedCell?.dte === cell.dte) {
        setSelectedCell(null);
      } else {
        setSelectedCell(cell);
      }
    },
    [posToCell, selectedCell],
  );

  if (!surface || !arbResult) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
        No arbitrage data
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-1 pt-1">
        <DeskModeBar
          items={[...MODE_ITEMS]}
          activeId={mode}
          onSelect={(id) => {
            setMode(id as ArbMode);
            setSelectedCell(null);
          }}
        />
      </div>

      <PrintStrip
        className="mx-1"
        items={[
          {
            label: 'SVI RMSE',
            value: sviReadout ? fmtPct(sviReadout.rmse) : '—',
            title: 'Surface SVI fit RMSE',
          },
          {
            label: 'Calendar',
            value: String(violCount.calendar),
            tone: violCount.calendar > 0 ? 'down' : 'up',
            title: 'Calendar arb violations',
          },
          {
            label: 'Butterfly',
            value: String(violCount.butterfly),
            tone: violCount.butterfly > 0 ? 'down' : 'up',
            title: 'Butterfly arb violations',
          },
          {
            label: 'Status',
            value: arbResult.clean ? 'Clean' : 'Arb',
            tone: arbResult.clean ? 'up' : 'down',
          },
          ...(sviReadout
            ? [
                {
                  label: 'ρ',
                  value: sviReadout.params.rho.toFixed(3),
                  title: 'SVI correlation',
                },
                {
                  label: 'n',
                  value: String(sviReadout.samples),
                  title: 'Fit sample count',
                },
              ]
            : []),
        ]}
      />

      <DiagnosticsStrip sviReadout={sviReadout} arbResult={arbResult} />

      <DeskChartFrame
        xTitle="Strike"
        yTitle="DTE"
        className="relative min-h-0 flex-1"
        header={
          <span className="text-type-2xs text-zinc-400">
            Arb · {mode}
          </span>
        }
      >
        <div className="relative h-full min-h-0 w-full" ref={containerRef}>
          <canvas
            ref={canvasRef}
            data-arb-canvas=""
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverCell(null)}
            onMouseDown={handleClick}
            className="absolute inset-0 cursor-crosshair"
            style={{ width: dim.w, height: dim.h }}
          />
        </div>

        {hoverCell && (
          <div className="pointer-events-none absolute bottom-6 left-2 z-10 rounded border border-border bg-card/90 px-2 py-1 font-mono text-type-xs text-muted-foreground">
            K {fmtPrice(hoverCell.strike, 0)} · {hoverCell.dte}d
          </div>
        )}

        {selectedCell && (
          <div
            data-arb-inspector=""
            className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-x-4 gap-y-1 rounded border border-border bg-card/95 px-3 py-2 font-mono text-type-sm shadow-sm backdrop-blur-sm"
          >
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">K</span>
              <span className="font-semibold tabular-nums text-foreground">
                {fmtPrice(selectedCell.strike, 0)}
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="tabular-nums text-foreground">{selectedCell.dte}d</span>
            </span>
            {(() => {
              const ci = surface.strikes.indexOf(selectedCell.strike);
              const ri = surface.dtes.indexOf(selectedCell.dte);
              if (ci < 0 || ri < 0) return null;
              const cal = arbResult.calendar.flags[ri]?.[ci] ?? false;
              const fly = arbResult.butterfly.flags[ri]?.[ci] ?? false;
              return (
                <>
                  <span className={`flex items-center gap-1.5 ${cal ? 'text-down' : 'text-up'}`}>
                    <span className="text-muted-foreground">
                      <Explain term="calendarArb">Calendar</Explain>
                    </span>
                    {cal ? '✗' : '✓'}
                  </span>
                  <span className={`flex items-center gap-1.5 ${fly ? 'text-down' : 'text-up'}`}>
                    <span className="text-muted-foreground">
                      <Explain term="butterflyArb">Butterfly</Explain>
                    </span>
                    {fly ? '✗' : '✓'}
                  </span>
                </>
              );
            })()}
          </div>
        )}
      </DeskChartFrame>
    </div>
  );
}
