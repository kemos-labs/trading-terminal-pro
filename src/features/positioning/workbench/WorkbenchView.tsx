/**
 * Linked positioning workbench (REF-01–04 core slice).
 *
 * Tall signed strike profile (left) + stacked gamma / charm price×time
 * scenario grids (right), all from ONE workbench snapshot frame
 * (POST /api/v1/analytics/positioning/workbench). The frame identity,
 * frozen-OI as-of, and explicit scenario inputs are displayed; missing live
 * data stays Unavailable and hypothetical axes are labelled scenario.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { CHART, canvasCellColor, resolveCanvasColors, colorWithAlpha } from '../../../lib/chartTheme';
import { deskChartChrome } from '../../../components/desk/DeskChart';
import { fmtCompact } from '../../../lib/format';
import { cn } from '../../../lib/utils';

type WorkbenchProfileRow = {
  strike: number; value: number | null; unit: string; basis: string;
  contracts?: number | null; contractsCall?: number | null; contractsPut?: number | null;
  callGex?: number | null; putGex?: number | null;
};
type ProfileUnits = 'gex' | 'contracts';
type WorkbenchCell = { value: number | null; included: number; excludedExpired: number; missing: number; reasons: string[] };
type WorkbenchGrid = {
  units: string; prices: number[]; timesMs: number[];
  cells: WorkbenchCell[][];
  methodology?: Record<string, unknown>;
};
type WorkbenchLinkGroup = { id?: string; symbol?: boolean; expiry?: boolean; time?: boolean; priceRange?: boolean } | null;
type WorkbenchData = {
  symbol: string; frameId: string; referenceTimeMs: number; spotRef: number | null;
  gex: WorkbenchGrid; dex?: WorkbenchGrid | null; charm: WorkbenchGrid;
  profile: WorkbenchProfileRow[]; profileBasis: string;
  calendar?: {
    dates: string[]; instantsMs: number[]; instants: string[]; clock: string;
    prices: number[]; cells: WorkbenchCell[][];
    current: { spot: number | null; instantMs: number; instant: string; value: number | null; unit: string; reasons: string[] };
    peak: { value: number; price: number; date: string; instantMs: number; instant: string } | null;
    domain: { min: number | null; max: number | null; symmetricAuto: boolean };
    colorSemantics: string; snapshotIdentity: string;
    budget: Record<string, number>;
  } | null;
  scenario: Record<string, unknown>;
  rowSelection: { totalContracts: number; eligibleContracts: number; usedContracts: number; omittedContracts: number; truncated: boolean; truncationReason: string | null };
  gridCells: { computed: number; total: number };
  positionBasisAt: string | null; snapshotSource: string[];
  linkGroup?: WorkbenchLinkGroup;
};
type WorkbenchEnvelope = {
  asOf: string | number | null; fetchedAt?: number; freshness?: string;
  coverage?: { state: string; missing: string[] };
  warnings?: string[]; source?: string[];
  data: WorkbenchData;
};

type Phase = 'idle' | 'loading-snapshot' | 'ready-to-run' | 'running' | 'done' | 'error' | 'unavailable';

export type WorkbenchSnapshotMeta = { spot: number | null; expirations: string[] };

function utcLabel(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/** T1 link-group id truth (mirrors server B7): broken links isolate, never coerce. */
const LINK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Safe UTC-instant parse matching the server strictInstantMs contract (Z-suffixed ISO or safe epoch ms). */
const STRICT_UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/;
function strictParseUtc(value: string): number | null {
  const v = value.trim();
  if (/^\d{1,16}$/.test(v)) {
    if (/^\d{8}$/.test(v)) return null;
    const n = Number(v);
    if (!Number.isSafeInteger(n) || !(n > 0) || n > 8_640_000_000_000_000) return null;
    return n;
  }
  if (!STRICT_UTC_RE.test(v)) return null;
  const ms = Date.parse(v);
  if (!Number.isSafeInteger(ms) || !(ms > 0)) return null;
  // Calendar round-trip: reject rollovers such as Feb 30.
  const d = new Date(ms).toISOString();
  if (d.slice(0, 19) !== v.slice(0, 19)) return null;
  return ms;
}

function fmtTick(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v/1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v/1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v/1e3).toFixed(1)}k`;
  return v.toFixed(2);
}

/** Exact strike label: always one decimal (4400.0, never 4400) so hover
    and table name the identical strike string. */
function strikeLabel(strike: number): string {
  return strike.toFixed(1);
}

/** Signed compact: +1.2M / -42. ASCII sign keeps tooltip + table + live region testable. */
function fmtSignedCompact(n: number): string {
  return `${n < 0 ? '-' : '+'}${fmtCompact(Math.abs(n))}`;
}
function fmtSignedInt(n: number): string {
  return `${n < 0 ? '-' : '+'}${Math.abs(n)}`;
}

export type ProfilePoint = {
  strike: number; label: string;
  value: number | null; raw: number | null;
  contracts: number | null; contractsCall: number | null; contractsPut: number | null;
  callGex: number | null; putGex: number | null;
};

/**
 * REF-02 T2 real profile hover renderer (Recharts Tooltip `content`).
 * Shows the exact strike, call/put/combined in the selected unit, the other
 * unit as secondary, plus spot / selected expiry / as-of / source context
 * and the proxy warning — without scrolling to the assumptions panel.
 * Tested by rendering this component directly with a Recharts-shaped
 * payload (no Recharts internals are faked).
 */
export function ProfileTooltipContent(props: {
  active?: boolean;
  payload?: Array<{ payload?: ProfilePoint }>;
  units?: ProfileUnits;
  spotRef?: number | null;
  expiryLabel?: string;
  asOf?: string | number | null;
  source?: string[];
}) {
  const row = props.payload?.[0]?.payload;
  if (!props.active || row == null) return null;
  const units = props.units ?? 'gex';
  const gexMissing = row.raw == null || row.callGex == null || row.putGex == null;
  const cMissing = row.contracts == null || row.contractsCall == null || row.contractsPut == null;
  const primary = units === 'gex'
    ? (gexMissing ? 'GEX net unavailable (never zero-filled)'
      : `GEX net ${fmtSignedCompact(row.raw!)} $/1% · call ${fmtSignedCompact(row.callGex!)} · put ${fmtSignedCompact(row.putGex!)}`)
    : (cMissing ? 'contracts net unavailable (never zero-filled)'
      : `contracts net ${fmtSignedInt(row.contracts!)} · call ${fmtSignedInt(row.contractsCall!)} · put ${fmtSignedInt(row.contractsPut!)}`);
  const secondary = units === 'gex'
    ? (cMissing ? 'contracts: unavailable' : `contracts net ${fmtSignedInt(row.contracts!)} · call ${fmtSignedInt(row.contractsCall!)} · put ${fmtSignedInt(row.contractsPut!)}`)
    : (gexMissing ? 'GEX: unavailable' : `GEX net ${fmtSignedCompact(row.raw!)} $/1% · call ${fmtSignedCompact(row.callGex!)} · put ${fmtSignedCompact(row.putGex!)}`);
  return (
    <div data-testid="wb-profile-tooltip" className="max-w-64 break-words rounded border border-border bg-black/95 px-2 py-1 font-mono text-type-2xs leading-snug shadow-xl">
      <div className="font-bold text-foreground">strike {strikeLabel(row.strike)}</div>
      <div className="tabular-nums text-foreground">{primary}</div>
      <div className="tabular-nums text-muted-foreground">{secondary}</div>
      <div className="text-muted-foreground">
        spot {props.spotRef != null ? props.spotRef.toFixed(2) : 'Unavailable'} · expiry {props.expiryLabel ?? 'all'} · as-of {String(props.asOf ?? 'Unavailable')}
      </div>
      <div className="text-muted-foreground/70">source {(props.source ?? []).join(', ') || 'unknown'} · OI-weighted exposure proxy — not observed dealer inventory</div>
    </div>
  );
}

/** REF-03 T3 additive candle path: observed OHLC only where a verified
    yfinance history bar matches an exact calendar date. Never carried
    forward, interpolated, or drawn for unobserved/future columns. */
type YfHistoryBar = { date: string; open: number; high: number; low: number; close: number };

const CAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function usableHistoryBar(b: unknown): YfHistoryBar | null {
  if (b == null || typeof b !== 'object' || Array.isArray(b)) return null;
  const r = b as Record<string, unknown>;
  const date = typeof r.date === 'string' ? r.date.trim() : '';
  if (!CAL_DATE_RE.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) return null;
  const nums = [r.open, r.high, r.low, r.close].map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  return { date, open: nums[0]!, high: nums[1]!, low: nums[2]!, close: nums[3]! };
}

/** Small responsive DOM overlay sharing the calendar time columns and price
    scale. One column per calendar date; wick/body render ONLY from the
    matched bar's own OHLC values. Price orientation stays upward (higher
    price = smaller top %). Horizontal geometry mirrors HeatGrid plot gutters
    padL=54 padR=8 so column centers align with the canvas at
    padL + (index+0.5)*((width-padL-padR)/n). Clamped via overflow-hidden;
    the exposure domain is never altered. */
const CANDLE_PAD_L = 54;
const CANDLE_PAD_R = 8;
function CandleOverlay({ dates, prices, barsByDate }: {
  dates: string[]; prices: number[]; barsByDate: Map<string, YfHistoryBar>;
}) {
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const span = hi - lo > 0 ? hi - lo : 1;
  const yPct = (p: number) => ((hi - p) / span) * 100;
  return (
    <div
      data-testid="wb-candle-overlay"
      data-pad-l={String(CANDLE_PAD_L)}
      data-pad-r={String(CANDLE_PAD_R)}
      data-columns={String(dates.length)}
      role="img"
      aria-label="Observed OHLC candles only where a verified history bar matches an exact calendar date; modeled columns remain scenarios, not observed prices"
      className="mt-1 w-full overflow-hidden rounded border border-border/40 py-1"
      style={{ paddingLeft: CANDLE_PAD_L, paddingRight: CANDLE_PAD_R }}
    >
      <div
        className="grid w-full items-stretch"
        style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))`, gap: 0 }}
        aria-hidden={false}
      >
        {dates.map((d, idx) => {
          const bar = barsByDate.get(d);
          if (!bar) {
            return (
              <div key={d} data-testid={`wb-candle-${d}`} data-observed="false" data-col-index={String(idx)} title={`${d}: no verified bar — modeled scenario, not a price observation`} className="flex h-16 min-w-0 flex-col items-center justify-end gap-0.5 border-b border-border/30 px-0.5 pb-1">
                <span className="font-mono text-type-2xs text-muted-foreground/60">—</span>
                <span className="font-mono text-type-2xs text-muted-foreground/60">{d.slice(5)}</span>
              </div>
            );
          }
          const top = yPct(bar.high);
          const bottom = yPct(bar.low);
          const wickTop = Math.max(0, Math.min(100, top));
          const wickH = Math.max(1, Math.min(100 - wickTop, bottom - top));
          const bodyTopRaw = yPct(Math.max(bar.open, bar.close));
          const bodyBotRaw = yPct(Math.min(bar.open, bar.close));
          const bodyTop = Math.max(0, Math.min(100, bodyTopRaw));
          const bodyH = Math.max(1.5, Math.min(100 - bodyTop, bodyBotRaw - bodyTopRaw));
          const up = bar.close >= bar.open;
          return (
            <div
              key={d}
              data-testid={`wb-candle-${d}`}
              data-observed="true"
              data-col-index={String(idx)}
              data-open={bar.open}
              data-high={bar.high}
              data-low={bar.low}
              data-close={bar.close}
              title={`${d} observed OHLC ${bar.open}/${bar.high}/${bar.low}/${bar.close}`}
              className="relative h-16 min-w-0 overflow-hidden border-b border-border/30 px-0.5"
            >
              <div data-testid={`wb-candle-${d}-wick`} data-high={bar.high} data-low={bar.low} style={{ top: `${wickTop}%`, height: `${wickH}%` }} className="absolute left-1/2 w-px -translate-x-1/2 bg-foreground/70" />
              <div data-testid={`wb-candle-${d}-body`} data-open={bar.open} data-close={bar.close} style={{ top: `${bodyTop}%`, height: `${bodyH}%` }} className={up ? 'absolute left-1/4 right-1/4 bg-emerald-500/80' : 'absolute left-1/4 right-1/4 bg-rose-500/80'} />
              <span className="absolute bottom-0 left-0 right-0 text-center font-mono text-type-2xs text-muted-foreground/60">{d.slice(5)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** REF-04 T4b shared hover anchor (workbench-local, presentation only).
    Identifies its source (`profile` or a named grid title), one existing
    `timeIndex`, and the existing `price` (grid scenario price) or `strike`
    (listed strike) when available. Sibling readouts always use each
    sibling's own cell value/units; exact-equality matches only — never
    nearest, interpolated, or carried values. Never refetches, never alters
    selected-time state, frameId, as-of, axes, or provenance. */
type HoverAnchor = { source: string; timeIndex: number; price: number | null; strike: number | null };

/** Sibling-cell readout: the sibling's own value/units, or Unavailable with
    its reasons. Null is never zero-filled. */
function fmtSyncCell(grid: WorkbenchGrid, pi: number, ti: number): string {
  const cell = grid.cells[pi]?.[ti];
  const v = cell?.value;
  if (v == null || !Number.isFinite(v)) {
    return `Unavailable (${(cell?.reasons ?? []).join(', ') || 'no quotes'})`;
  }
  return `${fmtCompact(v)} ${grid.units}`;
}

/** Genuine price(S)xtime canvas heatmap: price up, time right, evaluated cells only, zero contour from finite neighbors. */
function HeatGrid({ grid, title, units, selectedTime, onSelectTime, zoom, expanded, spotRef, anchorId, hoverAnchor, onHoverAnchor }: {
  grid: WorkbenchGrid; title: string; units: string;
  selectedTime: number; onSelectTime: (i: number) => void;
  zoom: { lo: number; hi: number }; expanded: boolean; spotRef?: number | null;
  anchorId: string; hoverAnchor: HoverAnchor | null; onHoverAnchor: (a: HoverAnchor | null) => void;
}) {
  const maxAbs = useMemo(() => {
    let m = 0;
    for (const col of grid.cells) for (const c of col) if (c.value != null && Number.isFinite(c.value)) m = Math.max(m, Math.abs(c.value));
    return m;
  }, [grid]);
  const lo = Math.max(0, zoom.lo);
  const hi = Math.min(grid.prices.length - 1, zoom.hi);
  const priceIdx: number[] = [];
  for (let i = lo; i <= hi; i++) priceIdx.push(i);
  // Display rows: higher price at top -> reverse priceIdx for canvas rows
  const displayPriceIdx = [...priceIdx].reverse();
  const selectedMs = grid.timesMs[selectedTime];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 420, h: 220 });
  const [hover, setHover] = useState<{ pi: number; ti: number } | null>(null);
  const colors = useMemo(() => resolveCanvasColors(), []);
  // resolution coverage
  const totalCells = grid.prices.length * grid.timesMs.length;
  const nullCells = useMemo(() => grid.cells.flat().filter(c=>c.value==null).length, [grid]);
  const layout = useMemo(() => {
    const padL=54, padT=14, padR=8, padB=22;
    const w=Math.max(0, dim.w-padL-padR), h=Math.max(0, dim.h-padT-padB);
    return { padL, padT, padR, padB, w, h, cellW: grid.timesMs.length ? w/grid.timesMs.length : 0, cellH: displayPriceIdx.length ? h/displayPriceIdx.length : 0 };
  }, [dim, grid.timesMs.length, displayPriceIdx.length]);
  // T4b cross-panel marker: this grid's own cell at the shared anchor, matched
  // by exact price equality only. No nearest/interpolated/carried values.
  const syncMark = useMemo(() => {
    if (!hoverAnchor || hoverAnchor.source === anchorId) return null;
    if (hoverAnchor.timeIndex < 0 || hoverAnchor.timeIndex >= grid.timesMs.length) return null;
    const key = hoverAnchor.source === 'profile' ? hoverAnchor.strike : hoverAnchor.price;
    if (key == null) return null;
    const pi = grid.prices.findIndex((p) => p === key);
    if (pi < 0) return null;
    return { pi, ti: hoverAnchor.timeIndex };
  }, [hoverAnchor, anchorId, grid, displayPriceIdx.length]);
  const draw = useCallback(() => {
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const dpr=window.devicePixelRatio||1;
    canvas.width=Math.max(1, Math.floor(dim.w*dpr)); canvas.height=Math.max(1, Math.floor(dim.h*dpr));
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,dim.w,dim.h);
    const { padL, padT, cellW, cellH }=layout;
    if(!cellW||!cellH) return;
    // cells: grid.cells[priceIdx][timeIdx] where priceIdx 0=lowest. Map display row r -> priceIdx displayPriceIdx[r]
    for(let r=0;r<displayPriceIdx.length;r++){
      const pi=displayPriceIdx[r]!;
      for(let ti=0;ti<grid.timesMs.length;ti++){
        const cell=grid.cells[pi]?.[ti];
        const v=cell?.value;
        const x=padL+ti*cellW, y=padT+r*cellH;
        if(v==null||!Number.isFinite(v)){
          ctx.save(); ctx.beginPath(); ctx.rect(x,y,cellW-1,cellH-1); ctx.clip();
          ctx.fillStyle=colors.empty; ctx.fillRect(x,y,cellW-1,cellH-1);
          ctx.strokeStyle=colorWithAlpha(colors.label,0.35); ctx.lineWidth=1;
          for(let s=-cellH;s<cellW;s+=5){ ctx.beginPath(); ctx.moveTo(x+s,y+cellH); ctx.lineTo(x+s+cellH,y); ctx.stroke(); }
          ctx.restore();
        } else {
          ctx.fillStyle=canvasCellColor(v, -maxAbs, maxAbs, true, colors);
          ctx.fillRect(x,y,cellW-1,cellH-1);
        }
        if(hover && hover.pi===pi && hover.ti===ti){ ctx.strokeStyle=colorWithAlpha(colors.brand,0.7); ctx.lineWidth=1.5; ctx.strokeRect(x-0.5,y-0.5,cellW,cellH); }
        if(syncMark && syncMark.pi===pi && syncMark.ti===ti){ ctx.strokeStyle='#f8fafc'; ctx.lineWidth=2; ctx.strokeRect(x+0.5,y+0.5,cellW-1,cellH-1); }
      }
    }
    // zero contour: between adjacent finite cells of opposite sign, same row or col
    ctx.strokeStyle=colorWithAlpha(colors.foreground,0.9); ctx.lineWidth=1; ctx.setLineDash([3,3]);
    for(let r=0;r<displayPriceIdx.length;r++){
      const pi=displayPriceIdx[r]!;
      for(let ti=0;ti<grid.timesMs.length;ti++){
        const v=grid.cells[pi]?.[ti]?.value;
        if(v==null||!Number.isFinite(v)) continue;
        // right neighbor
        if(ti+1<grid.timesMs.length){
          const vr=grid.cells[pi]?.[ti+1]?.value;
          if(vr!=null&&Number.isFinite(vr)&& Math.sign(v)!==Math.sign(vr) && v!==0 && vr!==0){
            const x=padL+(ti+1)*cellW; ctx.beginPath(); ctx.moveTo(x, padT+r*cellH+1); ctx.lineTo(x, padT+(r+1)*cellH-1); ctx.stroke();
          }
        }
        // down neighbor (next display row = lower price; physics neighbor in price direction)
        if(r+1<displayPriceIdx.length){
          const pi2=displayPriceIdx[r+1]!;
          const vd=grid.cells[pi2]?.[ti]?.value;
          if(vd!=null&&Number.isFinite(vd)&& Math.sign(v)!==Math.sign(vd) && v!==0 && vd!==0){
            const y=padT+(r+1)*cellH; ctx.beginPath(); ctx.moveTo(padL+ti*cellW+1, y); ctx.lineTo(padL+(ti+1)*cellW-1, y); ctx.stroke();
          }
        }
      }
    }
    ctx.setLineDash([]);
    // selected time vertical line
    if(selectedTime>=0 && selectedTime<grid.timesMs.length){
      const x=padL+(selectedTime+0.5)*cellW;
      ctx.strokeStyle=colorWithAlpha(colors.brand,0.95); ctx.setLineDash([4,3]); ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(x, padT-2); ctx.lineTo(x, padT+layout.h); ctx.stroke(); ctx.setLineDash([]);
    }
    // spot ref horizontal line
    if(spotRef!=null && Number.isFinite(spotRef)){
      // find spot between price ticks
      // precise interpolation: y between cell centers: y = padT + (1 - (spot - min)/(max-min?) but uneven steps -> find segment
      let y: number|null=null;
      // Prices ascending original: grid.prices sorted asc. View is reversed.
      // Linear interpolation between nearest prices
      const asc=grid.prices.slice(lo, hi+1);
      if(spotRef>=asc[0]! && spotRef<=asc[asc.length-1]!){
        // find interval where spot lies
        for(let i=0;i<asc.length-1;i++) if(spotRef>=asc[i]! && spotRef<=asc[i+1]!){
          const frac=(spotRef-asc[i]!)/(asc[i+1]!-asc[i]!);
          // display row mapping: hi is top? display reversed: top = hi, bottom=lo
          const idxFromTop=(asc.length-1 - i) - frac; // fractional row from top
          y=padT+idxFromTop*cellH + (1-frac)*0; // center of cell interpolation tricky; use exact
          // more exact: interpolate between cell centers
          const yHi=padT + (asc.length-1 - (i+1))*cellH + cellH/2;
          const yLo=padT + (asc.length-1 - i)*cellH + cellH/2;
          y=yHi + frac*(yLo - yHi);
          break;
        }
        if(y==null && asc.length===1) y=padT+cellH/2;
      }
      if(y!=null){
        ctx.strokeStyle=colorWithAlpha(CHART.series.amber,0.95); ctx.setLineDash([5,3]); ctx.lineWidth=1.2;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL+layout.w, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle=CHART.series.amber; ctx.font='9px "JetBrains Mono",monospace'; ctx.textAlign='left'; ctx.fillText(`SPOT ${spotRef.toFixed(0)}`, padL+2, y-3);
      }
    }
    // axes labels
    ctx.fillStyle=colors.label; ctx.font='9px "JetBrains Mono",monospace'; ctx.textAlign='center'; ctx.textBaseline='top';
    const step=Math.max(1, Math.ceil(grid.timesMs.length/Math.max(2, Math.floor(layout.w/55))));
    for(let ti=0;ti<grid.timesMs.length;ti++) if(ti%step===0||ti===grid.timesMs.length-1){
      const lab=new Date(grid.timesMs[ti]!).toISOString().slice(5,16).replace('T',' ');
      ctx.fillText(lab, padL+ti*cellW+cellW/2, dim.h-layout.padB+4);
    }
    ctx.textAlign='right'; ctx.textBaseline='middle';
    for(let r=0;r<displayPriceIdx.length;r++){
      const pi=displayPriceIdx[r]!; const show=r%Math.max(1,Math.ceil(displayPriceIdx.length/6))===0 || r===displayPriceIdx.length-1;
      if(!show) continue;
      ctx.fillText(String(grid.prices[pi]!.toFixed(0)), padL-6, padT+r*cellH+cellH/2);
    }
    // axis titles
    ctx.fillStyle=colors.label; ctx.font='9px "JetBrains Mono",monospace'; ctx.textAlign='left'; ctx.fillText('Price ↑', 2, padT-2);
    ctx.textAlign='center'; ctx.fillText('valuation time →', padL+layout.w/2, dim.h-2);
  }, [grid, maxAbs, dim, layout, hover, syncMark, selectedTime, spotRef, lo, hi, displayPriceIdx, colors]);
  useEffect(()=>{ draw(); }, [draw]);
  useEffect(()=>{
    const el=wrapRef.current; if(!el) return; const RO=(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver as unknown as (new (cb: ResizeObserverCallback)=>ResizeObserver)|undefined; if(typeof RO!=='function'){ setDim({w:420,h:220}); return; } try{ const obs=new RO(ents=>{ for(const e of ents) setDim({w:Math.max(260,(e as ResizeObserverEntry).contentRect.width), h:Math.max(160,(e as ResizeObserverEntry).contentRect.height)}); }); obs.observe(el); return()=>obs.disconnect(); }catch{ setDim({w:420,h:220}); return; }
  }, []);
  const posToCell=useCallback((cx:number, cy:number)=>{
    const c=canvasRef.current; if(!c) return null; const rect=c.getBoundingClientRect();
    const ti=Math.floor((cx-rect.left-layout.padL)/layout.cellW); const r=Math.floor((cy-rect.top-layout.padT)/layout.cellH);
    if(ti<0||ti>=grid.timesMs.length||r<0||r>=displayPriceIdx.length) return null;
    return { pi: displayPriceIdx[r]!, ti, r };
  }, [layout, grid.timesMs.length, displayPriceIdx]);
  const hoverCell = hover ? grid.cells[hover.pi]?.[hover.ti] : null;
  const hoverVal = hoverCell?.value;
  return (
    <div data-testid={`wb-grid-${title}`} className="min-w-0">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1 font-mono text-type-2xs">
        <span className="font-semibold text-foreground">{title} · {units}</span>
        <span className="tabular-nums text-muted-foreground">{maxAbs>0?`±${fmtTick(maxAbs)} ${units}`:'—'} · {grid.prices.length}×{grid.timesMs.length} · {totalCells-nullCells}/{totalCells} computed</span>
      </div>
      <div className="mb-1 font-mono text-type-2xs leading-snug text-muted-foreground">{title==='GAMMA'? 'Higher price at top · time left→right · zero contour (dashed) where finite neighbors change sign — interpolated display, not computed nodes. Missing = hatched, never zero.' : title==='DEX-Δ' ? 'Delta pressure: signed kernel delta × S × OI × mult ($Δ notional) — call δ ≥ 0, put δ ≤ 0, no side negation. Independent scale from gamma · same axes/orientation · missing = hatched.' : 'Charm per-day −dΔ/dT · independent scale from gamma · same axes/orientation · missing = hatched.'}</div>
      <div ref={wrapRef} className={cn('relative min-h-[190px] w-full', expanded ? 'h-[340px]' : 'h-[190px]')} data-testid={`wb-canvas-wrap-${title}`}>
        <canvas ref={canvasRef} tabIndex={0} className="absolute inset-0 h-full w-full cursor-crosshair" onMouseMove={e=>{const p=posToCell(e.clientX,e.clientY); setHover(p?{pi:p.pi,ti:p.ti}:null); if(p) onHoverAnchor({source:anchorId,timeIndex:p.ti,price:grid.prices[p.pi]??null,strike:null});}} onMouseLeave={()=>{setHover(null); onHoverAnchor(null);}} onKeyDown={e=>{if(e.key==='Escape'){setHover(null); onHoverAnchor(null);}}} onClick={e=>{const p=posToCell(e.clientX,e.clientY); if(p) onSelectTime(p.ti);}} aria-label={`${title} scenario heatmap price by time`} />
        {hover && (
          <div data-testid={`wb-tooltip-${title}`} className="pointer-events-none absolute z-10 rounded border border-border bg-black/95 px-2 py-1 font-mono text-type-2xs leading-snug shadow-xl" style={{left: Math.min(Math.max(0, layout.padL+(hover.ti+0.5)*layout.cellW-90), Math.max(0, dim.w-200)), top: (layout.padT+ (displayPriceIdx.indexOf(hover.pi)+1)*layout.cellH +6 > dim.h/2 ? layout.padT+ displayPriceIdx.indexOf(hover.pi)*layout.cellH -58 : layout.padT+(displayPriceIdx.indexOf(hover.pi)+1)*layout.cellH+6)}}>
            <div className="font-bold text-foreground">{grid.prices[hover.pi]!.toFixed(2)} · {utcLabel(grid.timesMs[hover.ti]!)}</div>
            <div className="tabular-nums text-foreground">{title}: {hoverVal!=null&&Number.isFinite(hoverVal)? `${fmtCompact(hoverVal)} ${units}` : `unavailable — ${(hoverCell?.reasons??[]).join(', ')||'no quotes'}`}</div>
            <div className="text-muted-foreground">{hoverCell?.included??0} included · {hoverCell?.excludedExpired??0} expired · {hoverCell?.missing??0} missing</div>
          </div>
        )}
        {syncMark && (
          <div data-testid={`wb-sync-mark-${title}`} tabIndex={0} role="status" aria-label={`Synchronized hover marker in ${title} at scenario price ${grid.prices[syncMark.pi]!.toFixed(2)}`} className="pointer-events-none absolute z-10 rounded border border-white/70 bg-black/85 px-1.5 py-0.5 font-mono text-type-2xs text-foreground shadow-xl" style={{left: Math.min(Math.max(0, layout.padL+syncMark.ti*layout.cellW), Math.max(0, dim.w-150)), top: Math.max(0, layout.padT+displayPriceIdx.indexOf(syncMark.pi)*layout.cellH-4)}}>
            synced {grid.prices[syncMark.pi]!.toFixed(2)} · {utcLabel(grid.timesMs[syncMark.ti]!)}
          </div>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1.5 font-mono text-type-2xs text-muted-foreground" aria-hidden>
        <span className="tabular-nums">{maxAbs>0?`-${fmtTick(maxAbs)}`:''}</span>
        <div className="h-2 min-w-24 flex-1 rounded-sm" style={{background: `linear-gradient(90deg, ${colorWithAlpha(colors.down,0.9)} 0%, ${colorWithAlpha(colors.down,0.51)} 25%, ${colorWithAlpha(colors.up,0.12)} 50%, ${colorWithAlpha(colors.up,0.51)} 75%, ${colorWithAlpha(colors.up,0.9)} 100%)`}} />
        <span className="tabular-nums">{maxAbs>0?`+${fmtTick(maxAbs)}`:''}</span>
        <span className="ml-1">{units}</span>
        {nullCells>0 && <span className="ml-2 flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 border border-border" style={{backgroundImage:`repeating-linear-gradient(45deg, transparent, transparent 2px, ${colorWithAlpha(colors.label,0.4)} 2px, ${colorWithAlpha(colors.label,0.4)} 3px)`}}/> {nullCells}/{totalCells} missing</span>}
      </div>
      <details className="mt-1">
        <summary className="cursor-pointer font-mono text-type-2xs text-muted-foreground">Table fallback · {title} at {selectedMs!=null?utcLabel(selectedMs):'—'} ({displayPriceIdx.length} scenario prices, accessible)</summary>
        <div className="max-h-40 overflow-auto">
          <table className="w-full border-collapse font-mono text-type-2xs" aria-label={`${title} values at linked time`}>
            <thead><tr className="text-muted-foreground"><th scope="col" className="px-1 py-0.5 text-right font-normal">Scenario price</th><th scope="col" className="px-1 py-0.5 text-right font-normal">{title} ({units})</th></tr></thead>
            <tbody>
              {displayPriceIdx.map(pi=>{const cell=grid.cells[pi]?.[selectedTime]; const v=cell?.value??null; const price=grid.prices[pi]!; const lift=()=>onHoverAnchor({source:anchorId,timeIndex:selectedTime,price,strike:null}); return (<tr key={pi} tabIndex={0} data-testid={`wb-grid-row-${title}-${price.toFixed(2)}`} onMouseEnter={lift} onFocus={lift} onMouseLeave={()=>onHoverAnchor(null)} onBlur={()=>onHoverAnchor(null)} onKeyDown={(e)=>{if(e.key==='Escape') onHoverAnchor(null);}} className="border-t border-border/40"><th scope="row" className="px-1 py-0.5 text-right font-normal tabular-nums">{price.toFixed(2)}</th><td className="px-1 py-0.5 text-right tabular-nums">{v==null?'—':fmtCompact(v)}</td></tr>);})}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function WorkbenchView({ initialSymbol, onExit }: { initialSymbol: string; onExit?: () => void }) {
  const [symbol, setSymbol] = useState(initialSymbol.toUpperCase());
  const [meta, setMeta] = useState<WorkbenchSnapshotMeta | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<WorkbenchEnvelope | null>(null);
  const [staleEdits, setStaleEdits] = useState(false);
  // Explicit scenario inputs — empty means Unavailable, never prefilled as observed.
  const [riskFreeRate, setRiskFreeRate] = useState('');
  const [carryRate, setCarryRate] = useState('');
  const [multiplier, setMultiplier] = useState('');
  const [expiryFilter, setExpiryFilter] = useState('');
  const [expiryInstant, setExpiryInstant] = useState('');
  const [zeroDteOnly, setZeroDteOnly] = useState(false);
  const [rangePct, setRangePct] = useState('10');
  const [horizonDays, setHorizonDays] = useState('7');
  const [calendarDates, setCalendarDates] = useState('');
  const [steps, setSteps] = useState('6');
  const [timeStepsStr, setTimeStepsStr] = useState('6');
  const [selectedTime, setSelectedTime] = useState(0);
  // T1 link groups (REF-01, gates B4/B7): explicit per-panel vs linked
  // symbol/expiry/time/priceRange. Absent group = unlinked. Defaults mirror
  // the prior always-linked time slider (time:true) with priceRange:false so
  // hypothetical-price linkage never forces strike-profile zoom (B4 guard).
  const [linkId, setLinkId] = useState('wb-a');
  const [linkSymbol, setLinkSymbol] = useState(true);
  const [linkExpiry, setLinkExpiry] = useState(true);
  const [linkTime, setLinkTime] = useState(true);
  const [linkPriceRange, setLinkPriceRange] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  // Solo states used only while the corresponding link is off: the peer grid
  // keeps its own instant/zoom and never mutates the linked panel (A1/A4).
  const [charmTime, setCharmTime] = useState(0);
  const [zoomCharm, setZoomCharm] = useState<{ lo: number; hi: number }>({ lo: 0, hi: 0 });
  const [expanded, setExpanded] = useState<'none' | 'profile' | 'gex' | 'charm'>('none');
  // REF-04 T4a (gate B5): local pressure-metric presentation switch over the
  // SAME frame. Default gex preserves current behavior. Toggling never
  // refetches and never alters frameId, positionBasisAt, snapshot source,
  // scenario, linkGroup, or charm — it only swaps the displayed grid.
  const [pressureMetric, setPressureMetric] = useState<'gex' | 'dex'>('gex');
  // SAME frame. Default gex preserves current behavior. Toggling never
  // refetches and never alters frameId, positionBasisAt, snapshot source,
  // scenario, linkGroup, or heatmaps — it only re-derives display values.
  const [profileUnits, setProfileUnits] = useState<ProfileUnits>('gex');
  // Hovered strike for the aria-live mirror (mouse hover on bars; keyboard
  // users get the same call/put/combined facts from the table fallback).
  const [hoveredStrike, setHoveredStrike] = useState<number | null>(null);
  // REF-04 T4b: workbench-local shared hover anchor (presentation only — no
  // refetch, no selected-time/frame mutation) and workbench-local profile
  // strike zoom over the derived category list (independent of heatmap
  // hypothetical-price zoom even when linkPriceRange is on).
  const [hoverAnchor, setHoverAnchor] = useState<HoverAnchor | null>(null);
  const [profileZoom, setProfileZoom] = useState<{ lo: number; hi: number }>({ lo: 0, hi: 0 });
  // REF-03 T3 candle overlay state: separate delayed yfinance history fetch,
  // independent from snapshotIdentity/frameId. Never blocks exposure rendering.
  // Stale cache responses (body.cache.stale) are treated as unavailable and masked.
  const [candleBars, setCandleBars] = useState<Map<string, YfHistoryBar>>(new Map());
  const [candleState, setCandleState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const [candleStaleMeta, setCandleStaleMeta] = useState<{ stale: boolean; ageMs: number | null; providerError: string | null; coverage: unknown; warnings: unknown } | null>(null);
  const candleSeq = useRef(0);
  const [zoom, setZoom] = useState<{ lo: number; hi: number }>({ lo: 0, hi: 0 });
  const [assumptionsOpen, setAssumptionsOpen] = useState(true);
  const [executed, setExecuted] = useState<string | null>(null);
  const seq = useRef(0);

  const markEdited = useCallback(() => {
    if (result) setStaleEdits(true);
  }, [result]);

  const loadSnapshot = useCallback(async (sym: string) => {
    const my = ++seq.current;
    setPhase('loading-snapshot');
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/market/options/${encodeURIComponent(sym)}`);
      if (my !== seq.current) return;
      if (res.status !== 200) {
        setPhase('unavailable');
        setNotice(`Snapshot unavailable for ${sym} (HTTP ${res.status}). No values fabricated — workbench stays Unavailable.`);
        return;
      }
      const body = await res.json();
      const spot = typeof body?.data?.spot === 'number' ? body.data.spot : null;
      const expirations = Array.isArray(body?.data?.expirations) ? body.data.expirations : [];
      setMeta({ spot, expirations });
      setExpiryFilter((prev) => prev || expirations[0] || '');
      setPhase('ready-to-run');
      if (spot == null) setNotice('Snapshot has no live spot reference: the strike profile will be Unavailable; grids remain runnable as scenarios.');
    } catch (e) {
      if (my !== seq.current) return;
      setPhase('error');
      setNotice(`Snapshot fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    seq.current += 1;
    setResult(null);
    setMeta(null);
    setStaleEdits(false);
    setExecuted(null);
    setAssumptionsOpen(true);
    setPhase('idle');
  }, [symbol]);

  const runDisabled = phase === 'loading-snapshot' || phase === 'running'
    || riskFreeRate === '' || carryRate === '' || multiplier === '' || expiryInstant === '';

  const run = useCallback(async () => {
    if (meta?.spot == null) {
      setNotice('No live spot reference — cannot build hypothetical price axes from nothing. Snapshot stays Unavailable for axes.');
      return;
    }
    const my = ++seq.current;
    setPhase('running');
    setNotice(null);
    try {
      // Strict scenario-input validation — invalid input errors out; nothing is silently clamped or defaulted.
      const rp = Number(rangePct);
      if (!Number.isFinite(rp) || rp <= 0 || rp > 100) {
        setPhase('error');
        setNotice(`Price range percent must be a finite number in (0, 100] — got "${rangePct}". No clamp or default is applied.`);
        return;
      }
      const priceSteps = Number(steps);
      if (!Number.isInteger(priceSteps) || priceSteps < 2 || priceSteps > 150) {
        setPhase('error');
        setNotice(`Price steps must be an integer in 2..150 (server MAX_AXIS) — got "${steps}". No silent clamp.`);
        return;
      }
      const timeSteps = Number(timeStepsStr);
      if (!Number.isInteger(timeSteps) || timeSteps < 1 || timeSteps > 150) {
        setPhase('error');
        setNotice(`Time steps must be an integer in 1..150 (server MAX_AXIS) — got "${timeStepsStr}". No silent clamp.`);
        return;
      }
      const horizon = Number(horizonDays);
      if (!Number.isFinite(horizon) || horizon <= 0 || horizon > 3650) {
        setPhase('error');
        setNotice(`Horizon days must be a finite number in (0, 3650] — got "${horizonDays}". No silent default.`);
        return;
      }
      if (priceSteps * timeSteps > 10_000) {
        setPhase('error');
        setNotice(`Requested ${priceSteps}×${timeSteps} = ${priceSteps * timeSteps} cells exceeds the 10000-cell response bound. Reduce resolution explicitly — coverage is never invented to fit a budget.`);
        return;
      }
      const rpFrac = rp / 100;
      const prices: number[] = [];
      for (let i = 0; i < priceSteps; i++) {
        prices.push(+(meta.spot * (1 - rpFrac + (2 * rpFrac * i) / (priceSteps - 1))).toFixed(2));
      }
      if (new Set(prices).size !== priceSteps) {
        setPhase('error');
        setNotice(`Rounded price axis has duplicate levels at ${priceSteps} steps over ±${rangePct}% of spot ${meta.spot.toFixed(2)} — narrow the range or use fewer price steps. No duplicate axes are sent.`);
        return;
      }
      const hMs = horizon * 86400000;
      const t0 = Date.now();
      const times = Array.from({ length: timeSteps }, (_, i) => new Date(t0 + (hMs * i) / timeSteps).toISOString());
      const expiryDate = expiryFilter || meta.expirations[0];
      if (!expiryDate) {
        setPhase('error');
        setNotice('No expiry in snapshot metadata — select requires actual expiry metadata.');
        return;
      }
      const instantMs = strictParseUtc(expiryInstant);
      if (instantMs == null) {
        setPhase('error');
        setNotice('Expiry instant must be a strict UTC instant like 2026-09-18T20:00:00.000Z (label matches the parsed instant; no 20:00 UTC fallback).');
        return;
      }
      const parsedDates = calendarDates.split(',').map((s) => s.trim()).filter(Boolean);
      // T1 broken-link isolation (A3): an invalid group id never leaves the
      // client and never clears the survivor frame — the prior result stays
      // rendered and interactive; the typed 400 path is server-side (tested
      // in v1Workbench.test.js) for callers that bypass this guard.
      if (linkId.trim() !== '' && !LINK_ID_RE.test(linkId.trim())) {
        setPhase(result ? 'done' : 'error');
        setLinkError(`Link group id must match ^[A-Za-z0-9_-]{1,64}$ — got "${linkId}". Broken link isolated: no request sent, prior frame kept.`);
        return;
      }
      setLinkError(null);
      if (parsedDates.length > 0) {
        for (const d of parsedDates) {
          if (!/^(\d{4})-(\d{2})-(\d{2})$/.test(d)) {
            setPhase('error');
            setNotice(`Calendar date '${d}' must be YYYY-MM-DD. No index-to-days mapping is assumed.`);
            return;
          }
        }
      }
      const res = await fetch('/api/v1/analytics/positioning/workbench', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          symbol,
          prices,
          times,
          referenceTime: times[0],
          expiryFilter: expiryFilter || undefined,
          zeroDteOnly,
          ...(parsedDates.length > 0 ? { calendar: { dates: parsedDates } } : {}),
          // T1 linkGroup hint (B7): explicit UI linkage state, echoed verbatim.
          // Absent = unlinked. Invalid id isolates here: no fetch, survivor frame kept.
          ...(() => {
            const id = linkId.trim();
            if (id === '' && !linkSymbol && !linkExpiry && !linkTime && !linkPriceRange) return {};
            if (id !== '' && !LINK_ID_RE.test(id)) return {};
            const hint: Record<string, unknown> = {};
            if (id !== '') hint.id = id;
            hint.symbol = linkSymbol;
            hint.expiry = linkExpiry;
            hint.time = linkTime;
            hint.priceRange = linkPriceRange;
            return { linkGroup: hint };
          })(),
          scenario: {
            riskFreeRate: Number(riskFreeRate),
            carryRate: Number(carryRate),
            model: 'spot-european',
            multiplier: Number(multiplier),
            expiryOverrides: { [expiryDate]: new Date(instantMs).toISOString() },
          },
        }),
      });
      if (my !== seq.current) return; // old response must not overwrite newer request
      const body = await res.json();
      if (res.status !== 200) {
        setPhase(body?.error?.code === 'PROVIDER_UNAVAILABLE' || body?.error?.code === 'INSUFFICIENT_COVERAGE' ? 'unavailable' : 'error');
        setNotice(body?.error?.message ?? `Workbench request failed (HTTP ${res.status}).`);
        return;
      }
      setResult(body as WorkbenchEnvelope);
      setSelectedTime(0);
      setCharmTime(0);
      setHoverAnchor(null);
      setHoveredStrike(null);
      setProfileZoom({ lo: 0, hi: Math.max(0, ((body as WorkbenchEnvelope)?.data?.profile?.length ?? 1) - 1) });
      setZoom({ lo: 0, hi: prices.length - 1 });
      setZoomCharm({ lo: 0, hi: prices.length - 1 });
      setStaleEdits(false);
      setExecuted(`r=${riskFreeRate} q=${carryRate} ×${multiplier} · ${expiryDate} @ ${new Date(instantMs).toISOString()} · ±${rangePct}% ${horizonDays}d ${priceSteps}p×${timeSteps}t${zeroDteOnly ? ' · 0DTE' : ''}`);
      setAssumptionsOpen(false);
      setPhase('done');
    } catch (e) {
      if (my !== seq.current) return;
      setPhase('error');
      setNotice(`Workbench request failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [meta, symbol, rangePct, steps, timeStepsStr, horizonDays, expiryFilter, expiryInstant, zeroDteOnly, riskFreeRate, carryRate, multiplier, calendarDates, linkId, linkSymbol, linkExpiry, linkTime, linkPriceRange, result]);

  const data = result?.data ?? null;
  // Display order: HIGHEST strike at top (prices increase upward); feed descending strikes.
  // (Pixel-verified 2026-09-13, 1440x900 fresh build: 840 top / 700 bottom.)
  // The table keeps the same order. `value` stays combined signed GEX for
  // old clients; display units re-derive from the enriched row without refetch.
  const profileChart: ProfilePoint[] = useMemo(() => (data?.profile ?? [])
    .slice()
    .sort((a, b) => b.strike - a.strike)
    .map((p) => ({
    strike: p.strike,
    label: strikeLabel(p.strike),
    value: profileUnits === 'gex'
      ? (p.value == null ? null : p.value / 1e6)
      : (p.contracts ?? null),
    raw: p.value,
    contracts: p.contracts ?? null,
    contractsCall: p.contractsCall ?? null,
    contractsPut: p.contractsPut ?? null,
    callGex: p.callGex ?? null,
    putGex: p.putGex ?? null,
  })), [data, profileUnits]);
  // T4b workbench-local profile strike zoom: an actual-strike/category-axis
  // view filter over the derived, sorted list. Same frame, no refetch, no
  // frame/link mutation; independent from heatmap zoomCharm/zoom.
  const profileVisible: ProfilePoint[] = useMemo(() => {
    if (profileChart.length === 0) return profileChart;
    const n = profileChart.length;
    const lo = Math.max(0, Math.min(profileZoom.lo, profileZoom.hi, n - 1));
    const hi = Math.max(0, Math.min(Math.max(profileZoom.lo, profileZoom.hi), n - 1));
    return profileChart.slice(lo, hi + 1);
  }, [profileChart, profileZoom]);
  const profileZoomEcho = profileChart.length === 0
    ? 'no strikes'
    : `${profileVisible.length} of ${profileChart.length} strikes · ${strikeLabel(profileVisible[0]!.strike)}–${strikeLabel(profileVisible[profileVisible.length - 1]!.strike)}`;
  // T4b grid→profile exact match: the anchor price names a listed strike only
  // on strict equality; hypothetical-only prices match nothing.
  const profileSyncStrike: number | null = (() => {
    if (!data || !hoverAnchor || hoverAnchor.source === 'profile' || hoverAnchor.price == null) return null;
    return profileChart.some((r) => r.strike === hoverAnchor.price) ? hoverAnchor.price : null;
  })();
  // T4b shared status body: every readout uses the sibling's own cell and
  // units; null/expired cells say Unavailable with reasons, never zero.
  function hoverSyncBody(): React.ReactNode {
    if (!data) return null;
    const gTitle = pressureMetric === 'dex' ? 'DEX-Δ' : 'GAMMA';
    const gGrid: WorkbenchGrid = pressureMetric === 'dex' && data.dex != null ? data.dex : data.gex;
    if (!hoverAnchor) {
      return (<span>No shared hover — hover a grid cell or profile strike for a synchronized readout. Tables below list exact values.</span>);
    }
    if (hoverAnchor.source === 'profile') {
      const s = hoverAnchor.strike;
      if (s == null) return (<span>profile hover has no strike — no marker drawn.</span>);
      const t = data.gex.timesMs[hoverAnchor.timeIndex];
      const grids: Array<[string, WorkbenchGrid]> = [[gTitle, gGrid], ['CHARM', data.charm]];
      let matched = 0;
      const parts = grids.map(([gt, g]) => {
        const pi = g.prices.findIndex((p) => p === s);
        if (pi < 0 || hoverAnchor.timeIndex < 0 || hoverAnchor.timeIndex >= g.timesMs.length) return `${gt}: no matching hypothetical price node`;
        matched += 1;
        return `${gt} ${s.toFixed(2)}: ${fmtSyncCell(g, pi, hoverAnchor.timeIndex)}`;
      });
      const head = `profile strike ${strikeLabel(s)}${t != null ? ` · ${utcLabel(t)}` : ''}`;
      return (<span>{matched === 0 ? `${head} · no matching hypothetical price node — no marker drawn, no value carried` : `${head} · ${parts.join(' · ')}`}</span>);
    }
    const p = hoverAnchor.price;
    if (p == null) return (<span>{hoverAnchor.source} hover has no price — no marker drawn.</span>);
    const srcGrid: WorkbenchGrid | null = hoverAnchor.source === 'CHARM' ? data.charm : hoverAnchor.source === gTitle ? gGrid : null;
    const t = srcGrid?.timesMs[hoverAnchor.timeIndex];
    const head = `${hoverAnchor.source} ${p.toFixed(2)}${t != null ? ` · ${utcLabel(t)}` : ''}`;
    const out: string[] = [];
    if (srcGrid) {
      const pi = srcGrid.prices.findIndex((x) => x === p);
      out.push(pi < 0 ? `${hoverAnchor.source}: no node` : `${hoverAnchor.source}: ${fmtSyncCell(srcGrid, pi, hoverAnchor.timeIndex)}`);
    }
    for (const [gt, g] of [[gTitle, gGrid], ['CHARM', data.charm]] as Array<[string, WorkbenchGrid]>) {
      if (gt === hoverAnchor.source) continue;
      const pi = g.prices.findIndex((x) => x === p);
      out.push(pi < 0 || hoverAnchor.timeIndex >= g.timesMs.length ? `${gt}: no matching node` : `${gt} ${p.toFixed(2)}: ${fmtSyncCell(g, pi, hoverAnchor.timeIndex)}`);
    }
    const row = profileChart.find((r) => r.strike === p);
    if (!row) {
      out.push('profile: no matching listed strike — no profile bar fabricated');
    } else if (profileUnits === 'gex') {
      out.push(row.raw == null ? 'profile: Unavailable (never zero-filled)' : `profile strike ${strikeLabel(row.strike)}: GEX net ${fmtSignedCompact(row.raw)} $/1%`);
    } else {
      out.push(row.contracts == null ? 'profile: Unavailable (never zero-filled)' : `profile strike ${strikeLabel(row.strike)}: contracts net ${fmtSignedInt(row.contracts)}`);
    }
    return (<span>{`${head} · ${out.join(' · ')}`}</span>);
  }
  const hoveredRow = hoveredStrike == null ? null : profileChart.find((r) => r.strike === hoveredStrike) ?? null;
  const profileUnitShort = profileUnits === 'gex' ? 'GEX $/1%' : 'contracts';
  const calendarDatesKey = data?.calendar?.dates?.join(',') ?? '';
  const calendarSymbol = data?.symbol ?? null;
  // Optional observed-history path for the existing calendar panel. Fires
  // only after a successful workbench response with calendar.dates, using
  // the exact symbol against the already-existing GET /api/yf/history/:symbol
  // endpoint. The workbench result renders first and is preserved whatever
  // history does (slow/malformed/unavailable/stale). Stale cache responses
  // (body.cache.stale) must not render candles. No FMP call here.
  useEffect(() => {
    if (!data?.calendar || data.calendar.dates.length === 0 || !calendarSymbol) {
      setCandleState('idle');
      setCandleBars(new Map());
      setCandleStaleMeta(null);
      return;
    }
    const dates = data.calendar.dates;
    const my = ++candleSeq.current;
    setCandleState('loading');
    setCandleStaleMeta(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/yf/history/${encodeURIComponent(calendarSymbol)}`);
        if (cancelled || my !== candleSeq.current) return;
        if (!res.ok) { setCandleBars(new Map()); setCandleState('unavailable'); setCandleStaleMeta(null); return; }
        const body = await res.json().catch(() => null) as Record<string, unknown> | null;
        const cache = (body as unknown as { cache?: Record<string, unknown> })?.cache;
        const isStale = cache != null && cache.stale === true;
        if (isStale) {
          const ageMs = Number.isFinite(cache.ageMs as number) ? Number(cache.ageMs) : null;
          setCandleBars(new Map());
          setCandleState('unavailable');
          setCandleStaleMeta({ stale: true, ageMs, providerError: (cache.providerError as string) ?? null, coverage: (body as unknown as { coverage?: unknown })?.coverage ?? cache.coverage ?? null, warnings: (body as unknown as { warnings?: unknown })?.warnings ?? null });
          return;
        }
        const raw = body != null && Array.isArray((body as { bars?: unknown }).bars)
          ? (body as { bars: unknown[] }).bars
          : null;
        if (!raw) { setCandleBars(new Map()); setCandleState('unavailable'); setCandleStaleMeta(null); return; }
        const byDate = new Map<string, YfHistoryBar>();
        for (const b of raw) {
          const u = usableHistoryBar(b);
          if (u && !byDate.has(u.date)) byDate.set(u.date, u);
        }
        const matched = new Map<string, YfHistoryBar>();
        for (const d of dates) {
          const hit = byDate.get(d);
          if (hit) matched.set(d, hit);
        }
        setCandleBars(matched);
        setCandleState(matched.size > 0 ? 'ready' : 'unavailable');
        setCandleStaleMeta(null);
      } catch {
        if (!cancelled && my === candleSeq.current) { setCandleBars(new Map()); setCandleState('unavailable'); setCandleStaleMeta(null); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarDatesKey, calendarSymbol]);

  return (
    <div data-testid="positioning-workbench" className="flex min-w-0 flex-col gap-1.5 overflow-x-hidden p-2" onKeyDown={(e) => { if (e.key === 'Escape') { setHoverAnchor(null); setHoveredStrike(null); } }}> 
      {/* Compact toolbar: exit, title, executed-input summary, state badges */}
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Workbench">
        {onExit && (
          <button
            type="button" onClick={onExit} aria-label="Back to chain views"
            title="Close the workbench and return to the option chain and dealer profiles"
            className="rounded border border-border px-1.5 py-0.5 font-mono text-type-2xs text-muted-foreground hover:bg-muted/30"
          >
            ← Chain
          </button>
        )}
        <h3 className="font-mono text-type-xs font-semibold text-foreground">WORKBENCH · gamma + DEX pressure + charm</h3>
        {executed && (
          <span data-testid="wb-executed-summary" title="Exactly the inputs the displayed frame was computed with; editing any assumption marks the result stale until Run" className="font-mono text-type-2xs text-muted-foreground">
            {executed}
          </span>
        )}
        {result && staleEdits && (
          <span role="status" className="rounded border border-warn/50 bg-warn/10 px-1.5 py-0.5 font-mono text-type-2xs text-warn">
            Edited — result stale until Run
          </span>
        )}
        {result && (result.freshness === 'stale' || result.coverage?.state === 'partial') && (
          <span role="status" className="rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 font-mono text-type-2xs text-warn">
            {result.freshness === 'stale' ? 'Stale snapshot frame' : 'Partial coverage'}
          </span>
        )}
      </div>
      <details className="rounded border border-border/40 px-1.5 py-0.5">
        <summary className="cursor-pointer font-mono text-type-2xs text-muted-foreground">About this workspace &amp; limitations</summary>
        <p className="py-1 font-mono text-type-2xs leading-snug text-muted-foreground">
          One snapshot frame drives the strike profile and all scenario grids. Gamma is in $ per 1% move;
          DEX delta pressure is in $Δ notional (signed kernel delta, no side negation);
          charm is in $Δ per day — distinct quantities, zero-centered. The profile is an OI-weighted exposure
          proxy, not observed dealer inventory. Hypothetical axes are scenarios, never future prices.
        </p>
        <p className="pb-1 font-mono text-type-2xs leading-snug text-muted-foreground/70">
          Implementation notes (workspace status, not market data): participant/inversion,
          stability %, and RTH/session controls remain unimplemented in this slice. The calendar date ×
          hypothetical-price scenario grid exists below when dates are requested; observed price
          history/candles are optional and shown only where a verified bar matches an exact calendar date;
          future/modeled columns are never price observations.
        </p>
      </details>

      {/* Assumptions (collapsible; the toolbar above carries the executed-input summary once run) */}
      <details data-testid="wb-assumptions" open={assumptionsOpen} onToggle={(e) => setAssumptionsOpen(e.currentTarget.open)} className="rounded border border-border/60 px-1.5 py-1">
        <summary className="cursor-pointer font-mono text-type-2xs text-muted-foreground" aria-label="Workbench assumptions">
          {result
            ? `Assumptions${staleEdits ? ' — edited, re-run for a fresh frame' : ' — collapsed; executed inputs in the toolbar'}`
            : 'Assumptions — fill r, q, multiplier, and the expiry instant, then Run'}
        </summary>
      <div className="mt-1 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" role="group" aria-label="Workbench controls">
        <label className="flex min-w-0 flex-col gap-0.5 font-mono text-type-2xs text-muted-foreground">
          Symbol (actual chain symbol)
          <input
            value={symbol} aria-label="Symbol"
            onChange={(e) => { setSymbol(e.target.value.toUpperCase()); markEdited(); }}
            className="rounded border border-border bg-card px-1.5 py-1 text-foreground"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 font-mono text-type-2xs text-muted-foreground">
          Expiry (actual snapshot metadata)
          <select
            value={expiryFilter} aria-label="Expiry"
            onChange={(e) => { setExpiryFilter(e.target.value); markEdited(); }}
            className="rounded border border-border bg-card px-1.5 py-1 text-foreground"
          >
            <option value="">All (rows without overrides unavailable)</option>
            {(meta?.expirations ?? []).map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 font-mono text-type-2xs text-muted-foreground">
          Expiry instant (UTC Z, your assumption)
          <input
            type="text" value={expiryInstant} aria-label="Expiry instant UTC" placeholder="2026-09-18T20:00:00.000Z"
            spellCheck={false}
            onChange={(e) => { setExpiryInstant(e.target.value); markEdited(); }}
            className="rounded border border-border bg-card px-1.5 py-1 tabular-nums text-foreground"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 font-mono text-type-2xs text-muted-foreground">
          Risk-free rate r (decimal, your assumption)
          <input
            value={riskFreeRate} inputMode="decimal" aria-label="Risk-free rate" placeholder="e.g. 0.043"
            onChange={(e) => { setRiskFreeRate(e.target.value); markEdited(); }}
            className="rounded border border-border bg-card px-1.5 py-1 text-foreground"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 font-mono text-type-2xs text-muted-foreground">
          Carry/dividend q (decimal, your assumption)
          <input
            value={carryRate} inputMode="decimal" aria-label="Carry rate" placeholder="e.g. 0.015"
            onChange={(e) => { setCarryRate(e.target.value); markEdited(); }}
            className="rounded border border-border bg-card px-1.5 py-1 text-foreground"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 font-mono text-type-2xs text-muted-foreground">
          Contract multiplier (your assumption)
          <input
            value={multiplier} inputMode="numeric" aria-label="Contract multiplier" placeholder="e.g. 100"
            onChange={(e) => { setMultiplier(e.target.value); markEdited(); }}
            className="rounded border border-border bg-card px-1.5 py-1 text-foreground"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 font-mono text-type-2xs text-muted-foreground">
          Price range ±% (scenario)
          <input
            value={rangePct} inputMode="decimal" aria-label="Price range percent"
            onChange={(e) => { setRangePct(e.target.value); markEdited(); }}
            className="rounded border border-border bg-card px-1.5 py-1 text-foreground"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 font-mono text-type-2xs text-muted-foreground">
          Horizon days (scenario)
          <input
            value={horizonDays} inputMode="decimal" aria-label="Horizon days"
            onChange={(e) => { setHorizonDays(e.target.value); markEdited(); }}
            className="rounded border border-border bg-card px-1.5 py-1 text-foreground"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 font-mono text-type-2xs text-muted-foreground">
          Price steps (scenario)
          <input
            value={steps} inputMode="numeric" aria-label="Price steps"
            onChange={(e) => { setSteps(e.target.value); markEdited(); }}
            className="rounded border border-border bg-card px-1.5 py-1 text-foreground"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 font-mono text-type-2xs text-muted-foreground">
          Time steps (scenario)
          <input
            value={timeStepsStr} inputMode="numeric" aria-label="Time steps"
            onChange={(e) => { setTimeStepsStr(e.target.value); markEdited(); }}
            className="rounded border border-border bg-card px-1.5 py-1 text-foreground"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 font-mono text-type-2xs text-muted-foreground">
          Calendar dates, comma-separated YYYY-MM-DD (optional; first = reference UTC date)
          <input
            value={calendarDates} aria-label="Calendar dates" placeholder="2026-01-05, 2026-01-06" spellCheck={false}
            onChange={(e) => { setCalendarDates(e.target.value); markEdited(); }}
            className="rounded border border-border bg-card px-1.5 py-1 tabular-nums text-foreground"
          />
        </label>
        <label className="flex items-center gap-1.5 font-mono text-type-2xs text-muted-foreground">
          <input
            type="checkbox" checked={zeroDteOnly} aria-label="0DTE only"
            disabled={!meta?.expirations?.length}
            title={meta?.expirations?.length ? 'Filter to the front expiry in actual snapshot metadata' : 'Unavailable: no expiry metadata loaded'}
            onChange={(e) => { setZeroDteOnly(e.target.checked); markEdited(); }}
          />
          0DTE only (front expiry)
        </label>
        <div className="flex items-end gap-2">
          <button
            type="button" onClick={() => loadSnapshot(symbol)} aria-label="Load snapshot"
            className="rounded border border-border px-2 py-1 font-mono text-type-2xs text-foreground hover:bg-muted/30"
          >
            {phase === 'loading-snapshot' ? 'Loading…' : 'Load snapshot'}
          </button>
          <button
            type="button" onClick={run} disabled={runDisabled} aria-label="Run workbench"
            title={runDisabled ? 'Fill r, q, multiplier, and the expiry instant first — nothing is prefilled as observed' : 'Freeze executed inputs and compute one frame'}
            className="rounded border border-primary bg-primary/10 px-2 py-1 font-mono text-type-2xs text-foreground hover:bg-primary/20 disabled:opacity-40"
          >
            {phase === 'running' ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>
      </details>
      <div className="font-mono text-type-2xs text-muted-foreground" role="status">
        Pricing model: European on spot (explicitly selected). Futures-style exercise is unsupported, never substituted.
        {meta && <> Snapshot spot: {meta.spot ?? 'Unavailable'} · expiries: {meta.expirations.length || 'none'}</>}
      </div>
      {notice && (
        <div role={phase === 'unavailable' ? 'status' : 'alert'} className="rounded border border-warn/40 bg-warn/10 px-2 py-1 font-mono text-type-2xs text-warn">
          {notice}
        </div>
      )}
      {phase === 'unavailable' && !result && (
        <div className="rounded border border-border/60 p-3 font-mono text-type-2xs text-muted-foreground" data-testid="wb-unavailable">
          Workbench Unavailable for this symbol — live chain could not be loaded. No chain or dealer positions were invented to fill these charts.
        </div>
      )}

      {data && (
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-type-2xs text-muted-foreground">
            <span>Frame <span className="text-foreground">{data.frameId}</span></span>
            <span>as-of <span className="text-foreground">{String(data.positionBasisAt ?? 'Unavailable')}</span></span>
            <span>spot ref <span className="text-foreground">{data.spotRef ?? 'Unavailable (profile unavailable)'}</span></span>
            <span>contracts {data.rowSelection.usedContracts}/{data.rowSelection.eligibleContracts}{data.rowSelection.truncated ? ` (truncated: ${data.rowSelection.truncationReason})` : ''}</span>
            <span>cells {data.gridCells.computed}/{data.gridCells.total}</span>
            <span>coverage {result?.coverage?.state}</span>
          </div>
          <div className="mb-1 flex flex-wrap items-center gap-2 font-mono text-type-2xs" data-testid="wb-link-group" role="group" aria-label="Link group across panels">
            <label className="flex items-center gap-1 text-muted-foreground">
              Link group
              <input
                value={linkId} aria-label="Link group id" placeholder="wb-a (empty = unlinked)" spellCheck={false}
                onChange={(e) => { setLinkId(e.target.value); markEdited(); }}
                className="w-24 rounded border border-border bg-card px-1 py-0.5 text-foreground"
              />
            </label>
            {([['symbol', linkSymbol, setLinkSymbol, 'Symbol'], ['expiry', linkExpiry, setLinkExpiry, 'Expiry'], ['time', linkTime, setLinkTime, 'Time'], ['priceRange', linkPriceRange, setLinkPriceRange, 'Price range']] as const).map(([key, val, set, label]) => (
              <label key={key} className="flex items-center gap-1 text-muted-foreground">
                <input
                  type="checkbox" checked={val} aria-label={`Link ${label.toLowerCase()}`}
                  onChange={(e) => { set(e.target.checked); markEdited(); }}
                />
                Link {label}
              </label>
            ))}
            <span data-testid="wb-link-echo" className="text-muted-foreground" title="Server echo of the request linkGroup hint; absent = unlinked; the server never mutates panel state">
              echo: {data.linkGroup == null ? 'unlinked (absent)' : JSON.stringify(data.linkGroup)}
            </span>
          </div>
          {linkError && (
            <div role="alert" data-testid="wb-link-error" className="mb-1 rounded border border-warn/40 bg-warn/10 px-2 py-1 font-mono text-type-2xs text-warn">
              {linkError}
            </div>
          )}
          <div className="mb-1 flex flex-wrap items-center gap-2 font-mono text-type-2xs">
            {linkTime ? (
              <label className="flex items-center gap-1 text-muted-foreground">
                Linked time
                <input
                  type="range" min={0} max={Math.max(0, data.gex.timesMs.length - 1)} value={selectedTime}
                  aria-label="Linked valuation time across panels"
                  onChange={(e) => setSelectedTime(Number(e.target.value))}
                  className="w-32"
                />
                <span className="text-foreground">{data.gex.timesMs[selectedTime] ? utcLabel(data.gex.timesMs[selectedTime]!) : '—'}</span>
              </label>
            ) : (
              <>
                <label className="flex items-center gap-1 text-muted-foreground">
                  Gamma time (unlinked)
                  <input
                    type="range" min={0} max={Math.max(0, data.gex.timesMs.length - 1)} value={selectedTime}
                    aria-label="Gamma valuation time (unlinked)"
                    data-testid="wb-time-gamma"
                    onChange={(e) => setSelectedTime(Number(e.target.value))}
                    className="w-28"
                  />
                  <span className="text-foreground">{data.gex.timesMs[selectedTime] ? utcLabel(data.gex.timesMs[selectedTime]!) : '—'}</span>
                </label>
                <label className="flex items-center gap-1 text-muted-foreground">
                  Charm time (unlinked)
                  <input
                    type="range" min={0} max={Math.max(0, data.charm.timesMs.length - 1)} value={charmTime}
                    aria-label="Charm valuation time (unlinked)"
                    data-testid="wb-time-charm"
                    onChange={(e) => setCharmTime(Number(e.target.value))}
                    className="w-28"
                  />
                  <span className="text-foreground">{data.charm.timesMs[charmTime] ? utcLabel(data.charm.timesMs[charmTime]!) : '—'}</span>
                </label>
              </>
            )}
            {(['profile', 'gex', 'charm'] as const).map((p) => (
              <button
                key={p} type="button"
                onClick={() => setExpanded((e) => (e === p ? 'none' : p))}
                aria-pressed={expanded === p}
                className={cn('rounded border px-1.5 py-0.5', expanded === p ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground')}
              >
                {expanded === p ? `Collapse ${p}` : `Expand ${p}`}
              </button>
            ))}
            <button
              type="button" onClick={() => { setExpanded('none'); setSelectedTime(0); setCharmTime(0); setZoom({ lo: 0, hi: data.gex.prices.length - 1 }); setZoomCharm({ lo: 0, hi: data.gex.prices.length - 1 }); setProfileZoom({ lo: 0, hi: Math.max(0, profileChart.length - 1) }); setHoverAnchor(null); setHoveredStrike(null); }}
              aria-label="Reset views"
              className="rounded border border-border px-1.5 py-0.5 text-muted-foreground"
            >
              Reset views
            </button>
          </div>
          <div data-testid="wb-hover-sync" role="status" tabIndex={0} aria-label="Synchronized hover readout across profile and grids" onKeyDown={(e) => { if (e.key === 'Escape') { setHoverAnchor(null); setHoveredStrike(null); } }} className="rounded border border-border/60 px-1.5 py-1 font-mono text-type-2xs leading-snug text-muted-foreground">
            <span className="font-semibold text-foreground">Shared hover</span>
            <span> · {hoverSyncBody()}</span>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            {/* Left: tall strike profile */}
            <div className={cn('min-w-0 rounded border border-border/60 p-1', expanded === 'gex' || expanded === 'charm' ? 'hidden lg:block' : '')}>
              <div className="mb-1 font-mono text-type-2xs font-semibold text-foreground">
                {profileUnits === 'gex' ? 'STRIKE PROFILE · signed GEX $M per 1% move' : 'STRIKE PROFILE · net contracts (signed OI)'} <span className="font-normal text-muted-foreground">(OI-weighted proxy — not dealer inventory)</span>
                {data.spotRef != null && (() => {
                  const s = profileChart.map((r) => r.strike);
                  const loS = s.length ? Math.min(...s) : null;
                  const hiS = s.length ? Math.max(...s) : null;
                  const within = loS != null && hiS != null && data.spotRef! >= loS && data.spotRef! <= hiS;
                  return (
                    <span data-testid="wb-profile-spot" className="ml-2 font-normal text-warn">
                      SPOT {data.spotRef.toFixed(2)} — {within ? `between listed strikes ${loS?.toFixed(0) ?? '?'}–${hiS?.toFixed(0) ?? '?'}; no interpolated line on a category strike axis` : 'outside strike range — out-of-range reference, no false line drawn'}
                    </span>
                  );
                })()}
              </div>
              <div className="mb-1 flex flex-wrap items-center gap-1.5" role="group" aria-label="Profile units">
                <span className="font-mono text-type-2xs text-muted-foreground">Units</span>
                <button
                  type="button" data-testid="wb-profile-units-gex"
                  aria-pressed={profileUnits === 'gex'}
                  aria-label="Show profile in GEX dollars per 1 percent move"
                  onClick={() => setProfileUnits('gex')}
                  className={cn('rounded border px-1.5 py-0.5 font-mono text-type-2xs', profileUnits === 'gex' ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground')}
                >
                  GEX $/1%
                </button>
                <button
                  type="button" data-testid="wb-profile-units-contracts"
                  aria-pressed={profileUnits === 'contracts'}
                  aria-label="Show profile in net contracts"
                  onClick={() => setProfileUnits('contracts')}
                  className={cn('rounded border px-1.5 py-0.5 font-mono text-type-2xs', profileUnits === 'contracts' ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground')}
                >
                  Contracts
                </button>
                <span data-testid="wb-profile-units-echo" className="font-mono text-type-2xs text-muted-foreground">
                  unit: {profileUnits === 'gex' ? 'gex ($M/1%)' : 'contracts (signed OI sum)'} · same frame, no refetch
                </span>
              </div>
              <div className={cn(expanded === 'profile' ? 'h-[520px]' : 'h-[300px]')} data-testid="wb-profile">
                {profileChart.length === 0 ? (
                  <div className="p-2 font-mono text-type-2xs text-muted-foreground">Profile unavailable for this frame.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={profileVisible} layout="vertical" margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                      <CartesianGrid {...deskChartChrome().grid} />
                      <XAxis type="number" tick={deskChartChrome().tick} tickLine={false} stroke={deskChartChrome().axisLine} tickFormatter={(v: number) => (profileUnits === 'gex' ? `${v.toFixed(0)}M` : (Number.isInteger(v) ? String(v) : fmtTick(v)))} />
                      <YAxis type="category" dataKey="label" tick={{ ...deskChartChrome().tick, fontSize: 9 }} tickLine={false} stroke={deskChartChrome().axisLine} width={52} />
                      <Tooltip
                        content={<ProfileTooltipContent units={profileUnits} spotRef={data.spotRef} expiryLabel={`${expiryFilter || 'all'}${zeroDteOnly ? ' · 0DTE' : ''}`} asOf={data.positionBasisAt} source={data.snapshotSource} />}
                        contentStyle={deskChartChrome().tooltipStyle}
                        wrapperStyle={{ maxWidth: 'min(80vw, 21rem)' }}
                        allowEscapeViewBox={{ x: true, y: false }}
                        // Narrow viewports: pin the tooltip top-left inside the
                        // chart so a mouse-following placement can never push
                        // it past the container edge and clip mid-glyph.
                        position={typeof window !== 'undefined' && window.innerWidth < 768 ? { x: 8, y: 8 } : undefined}
                      />
                      <ReferenceLine x={0} stroke={CHART.series.up} label={{ value: '0', position: 'bottom', fill: deskChartChrome().axisLine, fontSize: 9 }} />
                      {/* SPOT is a price, not an exposure value: it is NEVER drawn as a vertical line at x=0.
                          A category strike axis cannot interpolate, so spot is declared in the header
                          with its position relative to the listed strikes — no fake nearest-strike line. */}
                      <Bar
                        dataKey="value"
                        name={profileUnits === 'gex' ? 'Strike GEX $M' : 'Strike net contracts'}
                        isAnimationActive={false}
                        onMouseEnter={(_row: unknown, index: number) => { const s = profileVisible[index]?.strike ?? null; setHoveredStrike(s); setHoverAnchor(s == null ? null : { source: 'profile', timeIndex: selectedTime, price: null, strike: s }); }}
                        onMouseLeave={() => { setHoveredStrike(null); setHoverAnchor(null); }}
                      >
                        {profileVisible.map((row) => (
                          <Cell key={row.strike} fill={row.value == null ? '#64748b' : row.value >= 0 ? CHART.series.up : CHART.series.down} fillOpacity={row.value == null ? 0.35 : 0.88} stroke={hoverAnchor?.source !== 'profile' && hoverAnchor?.price === row.strike ? '#f8fafc' : undefined} strokeWidth={hoverAnchor?.source !== 'profile' && hoverAnchor?.price === row.strike ? 2 : undefined} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              {profileSyncStrike != null && (
                <div data-testid="wb-sync-mark-profile" tabIndex={0} role="status" aria-label={`Synchronized hover marker on profile strike ${strikeLabel(profileSyncStrike)}`} className="mt-1 inline-block rounded border border-white/70 px-1.5 py-0.5 font-mono text-type-2xs text-foreground">
                  synced strike {strikeLabel(profileSyncStrike)} — exact listed strike, values in the row below
                </div>
             )}
              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-type-2xs text-muted-foreground" role="group" aria-label="Profile strike zoom, actual strikes only, view filter">
                <span>Strike zoom</span>
                <label>Low
                  <input type="range" min={0} max={Math.max(0, profileChart.length - 1)} value={Math.max(0, Math.min(profileZoom.lo, profileZoom.hi, Math.max(0, profileChart.length - 1)))} aria-label="Profile zoom low" data-testid="wb-profile-zoom-lo" disabled={profileChart.length === 0}
                    onChange={(e) => setProfileZoom((z) => ({ ...z, lo: Math.min(Number(e.target.value), z.hi) }))} className="w-20" />
                </label>
                <label>High
                  <input type="range" min={0} max={Math.max(0, profileChart.length - 1)} value={Math.max(0, Math.min(Math.max(profileZoom.lo, profileZoom.hi), Math.max(0, profileChart.length - 1)))} aria-label="Profile zoom high" data-testid="wb-profile-zoom-hi" disabled={profileChart.length === 0}
                    onChange={(e) => setProfileZoom((z) => ({ ...z, hi: Math.max(Number(e.target.value), z.lo) }))} className="w-20" />
                </label>
                <span data-testid="wb-profile-zoom-echo" className="tabular-nums">{profileZoomEcho} · same frame, no refetch</span>
              </div>
              <div aria-live="polite" data-testid="wb-profile-live" className="mt-1 font-mono text-type-2xs text-muted-foreground">
                {hoveredRow == null
                  ? 'Hover a profile bar for exact strike call/put/combined — the table fallback below lists every strike.'
                  : `Strike ${strikeLabel(hoveredRow.strike)} · ${profileUnits === 'gex'
                    ? (hoveredRow.raw == null ? 'GEX unavailable (never zero-filled)' : `GEX net ${fmtSignedCompact(hoveredRow.raw)} $/1% · call ${hoveredRow.callGex == null ? '—' : fmtSignedCompact(hoveredRow.callGex)} · put ${hoveredRow.putGex == null ? '—' : fmtSignedCompact(hoveredRow.putGex)}`)
                    : (hoveredRow.contracts == null ? 'contracts unavailable (never zero-filled)' : `contracts net ${fmtSignedInt(hoveredRow.contracts)} · call ${hoveredRow.contractsCall == null ? '—' : fmtSignedInt(hoveredRow.contractsCall)} · put ${hoveredRow.contractsPut == null ? '—' : fmtSignedInt(hoveredRow.contractsPut)}`)}`}
              </div>
              {/* REF-02 T2 (gate B9): BALANCE/TEST stays Unavailable with its
                  rule gap stated. Non-interactive disclosure adjacent to the
                  profile — never a drawn or simulated overlay, no invented
                  thresholds/zones/colors. Keyboard-reachable via tabIndex. */}
              <div data-testid="wb-balance-test" tabIndex={0} role="status" aria-label="BALANCE TEST unavailable disclosure" className="mt-1 rounded border border-border/60 px-1.5 py-1 font-mono text-type-2xs leading-snug text-muted-foreground">
                <span className="font-semibold text-foreground">BALANCE/TEST — Unavailable</span>
                <span> · No documented rule or user placement is present; overlay cannot be drawn. This is not observed dealer positioning — it requires explicit rules or user-placed annotations.</span>
              </div>
              <div data-testid="wb-key-levels" tabIndex={0} role="status" aria-label="Key levels unavailable disclosure" className="mt-1 rounded border border-border/60 px-1.5 py-1 font-mono text-type-2xs leading-snug text-muted-foreground">
                <span className="font-semibold text-foreground">Key levels — Unavailable</span>
                <span> · No sourced participant/inversion rule, Stability %, key-level or institutional-pressure data, and no user placement exists; no overlay is drawn and no level is derived from profile peaks, DEX, zero contours, or thresholds. RTH/session and venue settlement are explicitly out of scope for this slice.</span>
              </div>
              <details className="mt-1">
                <summary className="cursor-pointer font-mono text-type-2xs text-muted-foreground">Table fallback ({profileVisible.length} of {profileChart.length} strikes · {profileUnitShort})</summary>
                <div className="max-h-48 overflow-auto">
                  <table className="w-full border-collapse font-mono text-type-2xs" aria-label="Strike profile values">
                    <thead><tr className="text-muted-foreground"><th scope="col" className="px-1 py-0.5 text-left">Strike</th><th scope="col" className="px-1 py-0.5 text-right">Call ({profileUnitShort})</th><th scope="col" className="px-1 py-0.5 text-right">Put ({profileUnitShort})</th><th scope="col" className="px-1 py-0.5 text-right">Net ({profileUnitShort})</th></tr></thead>
                    <tbody>
                      {profileVisible.map((r) => {
                        const call = profileUnits === 'gex' ? r.callGex : r.contractsCall;
                        const put = profileUnits === 'gex' ? r.putGex : r.contractsPut;
                        const net = profileUnits === 'gex' ? r.raw : r.contracts;
                        const fmt = (n: number | null) => (n == null ? '—' : (profileUnits === 'gex' ? fmtCompact(n) : String(n)));
                        const lift = () => { setHoveredStrike(r.strike); setHoverAnchor({ source: 'profile', timeIndex: selectedTime, price: null, strike: r.strike }); };
                        const drop = () => { setHoveredStrike(null); setHoverAnchor(null); };
                        return (
                          <tr key={r.strike} tabIndex={0} data-testid={`wb-profile-row-${r.label}`} onMouseEnter={lift} onFocus={lift} onMouseLeave={drop} onBlur={drop} onKeyDown={(e) => { if (e.key === 'Escape') drop(); }} className="border-t border-border/40">
                            <th scope="row" className="px-1 py-0.5 text-left tabular-nums">{r.label}</th>
                            <td className="px-1 py-0.5 text-right tabular-nums">{fmt(call)}</td>
                            <td className="px-1 py-0.5 text-right tabular-nums">{fmt(put)}</td>
                            <td className="px-1 py-0.5 text-right tabular-nums">{fmt(net)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
              <p className="mt-1 font-mono text-type-2xs text-muted-foreground">profile.units: $/1% move (gex) vs contracts (signed OI sum) — presentation switch over the same frame; no refetch, frameId unchanged.</p>
              <p className="mt-1 font-mono text-type-2xs text-muted-foreground">{data.profileBasis}</p>
            </div>

            {/* Right: stacked pressure (gamma/DEX selector, same frame) + charm */}
            <div className={cn('flex min-w-0 flex-col gap-2', expanded === 'profile' ? 'hidden lg:flex' : '')}>
              {(expanded === 'none' || expanded === 'gex') && (
                <div className="min-w-0 rounded border border-border/60 p-1">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Pressure grid metric (same frame, no refetch)">
                    <span className="font-mono text-type-2xs text-muted-foreground">Pressure</span>
                    <button
                      type="button" data-testid="wb-pressure-gex"
                      role="radio" aria-checked={pressureMetric === 'gex'}
                      aria-label="Show gamma pressure grid, dollars per 1 percent move"
                      onClick={() => { setPressureMetric('gex'); setHoverAnchor(null); }}
                      onKeyDown={(e) => { if (e.key === 'ArrowRight') setPressureMetric('dex'); }}
                      className={cn('rounded border px-1.5 py-0.5 font-mono text-type-2xs', pressureMetric === 'gex' ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground')}
                    >
                      GAMMA $/1%
                    </button>
                    <button
                      type="button" data-testid="wb-pressure-dex"
                      role="radio" aria-checked={pressureMetric === 'dex'}
                      aria-label="Show DEX delta-notional pressure grid, delta dollars notional"
                      onClick={() => { setPressureMetric('dex'); setHoverAnchor(null); }}
                      onKeyDown={(e) => { if (e.key === 'ArrowLeft') setPressureMetric('gex'); }}
                      className={cn('rounded border px-1.5 py-0.5 font-mono text-type-2xs', pressureMetric === 'dex' ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground')}
                    >
                      DEX $Δ notional
                    </button>
                    <span data-testid="wb-pressure-echo" className="font-mono text-type-2xs text-muted-foreground">
                      metric: {pressureMetric === 'gex' ? 'gex ($/1% move)' : 'dex ($Δ notional)'} · same frame, no refetch
                    </span>
                  </div>
                  {pressureMetric === 'dex' && data.dex == null ? (
                    <div data-testid="wb-dex-unavailable" role="status" className="rounded border border-border/60 p-2 font-mono text-type-2xs text-muted-foreground">
                      DEX unavailable for this frame — no fallback grid is fabricated. Gamma and charm above remain the same frame.
                    </div>
                  ) : (
                    <HeatGrid grid={pressureMetric === 'dex' && data.dex != null ? data.dex : data.gex} title={pressureMetric === 'dex' ? 'DEX-Δ' : 'GAMMA'} units={pressureMetric === 'dex' ? '$Δ notional' : '$/1% move'} selectedTime={selectedTime} onSelectTime={setSelectedTime} zoom={zoom} expanded={expanded === 'gex'} spotRef={data.spotRef} anchorId={pressureMetric === 'dex' ? 'DEX-Δ' : 'GAMMA'} hoverAnchor={hoverAnchor} onHoverAnchor={setHoverAnchor} />
                  )}
                  <p className="mt-1 font-mono text-type-2xs text-muted-foreground">{pressureMetric === 'dex' ? 'DEX methodology: signed kernel δ·S·OI·mult per cell (sticky frozen IV, explicit r/q, no side negation); OI-weighted proxy — not observed dealer inventory.' : 'Gamma methodology: signed γ·S²·0.01·OI·mult per cell (sticky frozen IV, explicit r/q); OI-weighted proxy — not observed dealer inventory.'}</p>
                  <div className="mt-1 flex items-center gap-2 font-mono text-type-2xs text-muted-foreground">
                    <label>{linkPriceRange ? 'Price zoom (linked hypothetical axes)' : 'Gamma price zoom (hypothetical axis only)'}
                      <input type="range" min={0} max={data.gex.prices.length - 1} value={zoom.lo} aria-label="Gamma zoom low"
                        onChange={(e) => setZoom((z) => ({ ...z, lo: Math.min(Number(e.target.value), z.hi) }))} className="w-20" />
                      <input type="range" min={0} max={data.gex.prices.length - 1} value={zoom.hi} aria-label="Gamma zoom high"
                        onChange={(e) => setZoom((z) => ({ ...z, hi: Math.max(Number(e.target.value), z.lo) }))} className="w-20" />
                    </label>
                  </div>
                </div>
              )}
              {(expanded === 'none' || expanded === 'charm') && (
                <div className="min-w-0 rounded border border-border/60 p-1">
                  <HeatGrid grid={data.charm} title="CHARM" units="$Δ/day" selectedTime={linkTime ? selectedTime : charmTime} onSelectTime={linkTime ? setSelectedTime : setCharmTime} zoom={linkPriceRange ? zoom : zoomCharm} expanded={expanded === 'charm'} spotRef={data.spotRef} anchorId="CHARM" hoverAnchor={hoverAnchor} onHoverAnchor={setHoverAnchor} />
                  {!linkPriceRange && (
                    <div className="mt-1 flex items-center gap-2 font-mono text-type-2xs text-muted-foreground">
                      <label>Charm price zoom (unlinked hypothetical axis; strike profile independent)
                        <input type="range" min={0} max={data.charm.prices.length - 1} value={zoomCharm.lo} aria-label="Charm zoom low"
                          onChange={(e) => setZoomCharm((z) => ({ ...z, lo: Math.min(Number(e.target.value), z.hi) }))} className="w-20" />
                        <input type="range" min={0} max={data.charm.prices.length - 1} value={zoomCharm.hi} aria-label="Charm zoom high"
                          onChange={(e) => setZoomCharm((z) => ({ ...z, hi: Math.max(Number(e.target.value), z.lo) }))} className="w-20" />
                      </label>
                    </div>
                  )}
                  <p className="mt-1 font-mono text-type-2xs text-muted-foreground">
                    Charm uses elapsed-time decay (per-day −dΔ/dT); its color scale is independent of gamma — do not reuse gamma meanings.
                  </p>
                </div>
              )}
            </div>
          </div>
          {/* REF-05 calendarized dollar-gamma surface: calendar date × hypothetical price, same snapshot frame.
              The grid section is taller than the 390px nested scrollport, so centering scrolls
              (element capture, scrollIntoViewIfNeeded) park the section top above the clip edge
              underneath the persistent GEX/print strips. The title sticks to the scrollport top
              with an opaque page background so the full UTC-clock disclaimer stays painted and
              readable at any scroll offset; scroll-mt keeps programmatic scrolls clear of the strips. */}
          <div data-testid="wb-calendar" className="mt-2 min-w-0 scroll-mt-2 rounded border border-border/60 p-1">
            <div data-testid="wb-calendar-title" className="sticky top-0 z-10 mb-1 min-w-0 whitespace-normal break-words bg-background py-0.5 font-mono text-type-2xs font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
              CALENDAR GAMMA · signed $/1% move by calendar date × hypothetical price{' '}
              <span className="font-normal text-muted-foreground">scenario valuation at the reference UTC clock — not exchange settlement</span>
            </div>
            {data.calendar == null ? (
              <p className="font-mono text-type-2xs text-muted-foreground">
                No calendar requested — enter comma-separated YYYY-MM-DD dates (first = reference UTC date) and Run. Calendar columns reuse the explicit ±% price range above.
              </p>
            ) : (
              <>
                <div className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-type-2xs text-muted-foreground">
                  <span data-testid="wb-calendar-current">
                    Current {data.calendar.current.spot ?? 'Unavailable'} @ {data.calendar.current.instant}:{' '}
                    <span className="text-foreground">{data.calendar.current.value == null ? `unavailable (${data.calendar.current.reasons.join(', ') || 'no quotes'})` : `${fmtCompact(data.calendar.current.value)} ${data.calendar.current.unit}`}</span>
                  </span>
                  <span data-testid="wb-calendar-peak">
                    Peak {data.calendar.peak == null ? 'unavailable (no finite nodes)' : `${fmtCompact(data.calendar.peak.value)} $/1% @ ${data.calendar.peak.price.toFixed(2)} on ${data.calendar.peak.date}`}
                    <span className="text-muted-foreground/70"> (resolution-dependent grid node)</span>
                  </span>
                  <span data-testid="wb-calendar-domain">
                    Domain [{data.calendar.domain.min == null ? '—' : fmtCompact(data.calendar.domain.min)}, {data.calendar.domain.max == null ? '—' : fmtCompact(data.calendar.domain.max)}] · clock {data.calendar.clock} · snapshot {data.calendar.snapshotIdentity === data.frameId ? 'same frame ✓' : 'MISMATCH'}
                  </span>
                </div>
                <HeatGrid
                  grid={{ units: '$/1% move', prices: data.calendar.prices, timesMs: data.calendar.instantsMs, cells: data.calendar.cells }}
                  title="CAL-GAMMA" units="$/1% move" selectedTime={0} onSelectTime={() => {}} zoom={{ lo: 0, hi: data.calendar.prices.length - 1 }} expanded={false} spotRef={data.spotRef} anchorId="CAL-GAMMA" hoverAnchor={null} onHoverAnchor={() => {}}
                />
                <p className="mt-1 font-mono text-type-2xs text-muted-foreground">{data.calendar.colorSemantics}</p>
                {candleStaleMeta?.stale ? (
                  <>
                    <CandleOverlay dates={data.calendar.dates} prices={data.calendar.prices} barsByDate={new Map()} />
                    <div data-testid="wb-candle-disclosure" data-candle-state="unavailable" data-stale="true" tabIndex={0} role="status" aria-label="Observed OHLC candle coverage disclosure — stale history" className="mt-1 rounded border border-warn/40 bg-warn/10 px-1.5 py-1 font-mono text-type-2xs leading-snug text-warn">
                      Stale — price history is stale and no candle is shown{candleStaleMeta.ageMs != null ? ` (age ${Math.round(candleStaleMeta.ageMs / 1000)}s)` : ''}{candleStaleMeta.providerError ? ` · ${candleStaleMeta.providerError}` : ''}; modeled columns remain scenarios, not observed prices. The exposure grid remains the canonical snapshot frame {data.frameId}; history is separate delayed yfinance data.
                    </div>
                  </>
                ) : candleState === 'ready' && candleBars.size > 0 ? (
                  <>
                    <CandleOverlay dates={data.calendar.dates} prices={data.calendar.prices} barsByDate={candleBars} />
                    <div data-testid="wb-candle-disclosure" data-candle-state={candleState} tabIndex={0} role="status" aria-label="Observed OHLC candle coverage disclosure" className="mt-1 rounded border border-border/60 px-1.5 py-1 font-mono text-type-2xs leading-snug text-muted-foreground">
                      Observed OHLC candles shown only where a verified history bar matches an exact calendar date ({candleBars.size} of {data.calendar.dates.length} dates); other columns are modeled scenarios, not observed prices. Candles come from the separate delayed yfinance history endpoint; the exposure grid remains the canonical snapshot frame {data.frameId}.
                    </div>
                  </>
                ) : (
                  <>
                    {candleState === 'ready' ? null : <CandleOverlay dates={data.calendar.dates} prices={data.calendar.prices} barsByDate={candleBars} />}
                    <div data-testid="wb-candle-disclosure" data-candle-state={candleState} tabIndex={0} role="status" aria-label="Observed OHLC candle coverage disclosure" className="mt-1 rounded border border-border/60 px-1.5 py-1 font-mono text-type-2xs leading-snug text-muted-foreground">
                      Actual price history unavailable — candle overlay not shown; modeled columns remain scenarios, not observed prices. Candles come from the separate delayed yfinance history endpoint when present; the exposure grid remains the canonical snapshot frame {data.frameId}.
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
