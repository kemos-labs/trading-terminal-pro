import { useMemo, useRef } from 'react';
import type { ImplyRead, StirStripData, StirSpread } from '../../../lib/macrovol/api';
import { VirtualRows } from '../../common/VirtualRows';
import { ImplyChip } from '../../common/ImplyDrawer';
import { PERF_BUDGET } from '../../../config/perfBudget';
import {
  useBoardFocus,
  useRegisterBoard,
  type FocusableBoardApi,
} from '../../../hooks/useBoardFocus';
import { StirSpreadCurve, toCurvePoints } from './StirSpreadCurve';

type SpreadRow = NonNullable<NonNullable<StirStripData['spreads']>['spreads']>[number];

/** SERFF pack: only badge when API says synth/ZQ offline — never invent "partial" as synth. */
function serffSynthNote(kind: StirSpread['kind'], rows: SpreadRow[]): string | null {
  if (kind !== 'serff') return null;
  const note =
    rows.find((r) => r.note)?.note
    || rows.find((r) => r.imply?.text)?.imply?.text
    || '';
  if (/synth|ZQ|offline/i.test(note)) return 'ZQ offline';
  return null;
}

const KIND_ORDER = ['cash', 'serff', 'calendar', 'fly', 'pack', 'inter'] as const;

function titleFor(kind: (typeof KIND_ORDER)[number]): string {
  switch (kind) {
    case 'cash':
      return 'CASH CORRIDOR (SOFR / EFFR / IORB)';
    case 'serff':
      return 'SERFF · SOFR FUT − EFFR (synth when ZQ offline)';
    case 'calendar':
      return 'CALENDARS (reds / greens)';
    case 'fly':
      return 'BUTTERFLIES';
    case 'pack':
      return 'PACKS';
    case 'inter':
      return 'INTER (SR1−SR3 / SR−ZQ)';
  }
}

function capFor(kind: (typeof KIND_ORDER)[number]): number {
  if (kind === 'serff') return 14;
  if (kind === 'calendar') return 16;
  return 10;
}

function PackTable({
  rows,
  onOpenImply,
  focusable,
}: {
  rows: SpreadRow[];
  onOpenImply: (i: ImplyRead) => void;
  /** Calendar pack registers board keyboard focus (PR-05 follow-up). */
  focusable?: boolean;
}) {
  const height = Math.min(280, Math.max(84, rows.length * 28));
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const { focused, rowIndex, focusRow } = useBoardFocus('calendar');
  const focusApi = useMemo<FocusableBoardApi>(
    () => ({
      scrollToRow: () => {},
      getCellText: (row, colKey) => {
        const r = rowsRef.current[row];
        if (!r) return '';
        if (colKey === 'rate_bps') return r.rate_bps != null ? String(r.rate_bps) : '';
        return r.name;
      },
      rowCount: () => rowsRef.current.length,
      colKeys: () => ['name', 'rate_bps'],
    }),
    [],
  );
  useRegisterBoard('calendar', focusable && rows.length ? focusApi : null);

  return (
    <>
      <div className="grid grid-cols-[1.2fr_72px_72px_100px_1.4fr] gap-0 border-b border-border/60 px-1.5 py-1 text-type-2xs text-muted-foreground">
        <span>Spread</span>
        <span className="text-right">Rate bps</span>
        <span className="text-right">Price spr</span>
        <span>Implies</span>
        <span>Note</span>
      </div>
      <VirtualRows
        items={rows}
        rowHeight={28}
        overscanCount={PERF_BUDGET.virtualOverscan}
        height={height}
        renderRow={({ index, style, item: s }) => {
          const bps = s.rate_bps;
          const isFocused = Boolean(focusable && focused && index === rowIndex);
          return (
            <div
              style={style}
              role={focusable ? 'row' : undefined}
              aria-selected={focusable ? isFocused : undefined}
              onClick={focusable ? () => focusRow(index, 'name') : undefined}
              className={`grid grid-cols-[1.2fr_72px_72px_100px_1.4fr] items-center gap-0 border-t border-border/40 px-1.5 text-type-xs ${
                focusable ? 'cursor-default hover:bg-muted/20' : ''
              } ${isFocused ? 'focus-ring-term-inset bg-primary/10' : ''} ${
                !isFocused && bps != null && bps < 0
                  ? 'bg-down/15'
                  : !isFocused && bps != null && bps > 0
                    ? 'bg-info/10'
                    : ''
              }`}
            >
              <span className="truncate font-mono font-bold text-foreground">{s.name}</span>
              <span
                className={`text-right font-mono font-semibold tabular-nums ${
                  bps == null
                    ? 'text-muted-foreground'
                    : bps < 0
                      ? 'text-down'
                      : bps > 0
                        ? 'text-up'
                        : ''
                }`}
                title={bps == null && s.implied_rate != null ? `Level ${s.implied_rate.toFixed(3)}% — not a spread` : undefined}
              >
                {bps != null
                  ? `${bps >= 0 ? '+' : ''}${bps.toFixed(1)}`
                  : '—'}
              </span>
              <span className="text-right font-mono tabular-nums text-muted-foreground">
                {s.price_spread != null
                  ? s.price_spread >= 0
                    ? `+${s.price_spread.toFixed(3)}`
                    : s.price_spread.toFixed(3)
                  : '—'}
              </span>
              <span>
                <ImplyChip imply={s.imply} compact onOpen={onOpenImply} />
              </span>
              <span
                className="truncate text-type-2xs text-muted-foreground"
                title={s.imply?.text || s.note}
              >
                {s.imply?.text || s.note || s.legs?.join(' / ')}
              </span>
            </div>
          );
        }}
      />
    </>
  );
}

export function CalendarPacksBoard({
  stir,
  onOpenImply,
}: {
  stir: StirStripData;
  onOpenImply: (i: ImplyRead) => void;
}) {
  if (!stir.spreads?.spreads?.length) return null;

  return (
    <div className="mt-4 space-y-3">
      <div>
        <h4 className="text-type-sm font-semibold text-foreground">STIR SPREADS DESK</h4>
        <p className="text-type-2xs text-muted-foreground">
          Calendars · flies · packs · SERFF (SOFR−EFFR) · cash corridor · {stir.spreads.note}
        </p>
      </div>

      {KIND_ORDER.map((kind) => {
        const rows = (
          stir.spreads?.by_kind?.[kind] ||
          stir.spreads?.spreads.filter((s) => s.kind === kind) ||
          []
        ).slice(0, capFor(kind));
        if (!rows.length) return null;
        // P0 Fix: level (implied_rate) never substitutes for spread (rate_bps). Null stays null — no unit mixing.
        const curvePoints = toCurvePoints(rows, {
          x: (r) => r.name,
          bps: (r) => r.rate_bps ?? null,
          full: (r) => r.legs?.join(' / '),
        });
        return (
          <div key={kind} className="overflow-hidden rounded border border-border">
            <div className="border-b border-border bg-background/40 px-2 py-1 text-type-xs font-semibold tracking-wide text-foreground">
              {titleFor(kind)}
              <span className="ml-2 font-normal text-muted-foreground">
                {rows.length} legs · hover chip for full read
              </span>
            </div>
            <StirSpreadCurve
              title="TERM STRUCTURE (bps)"
              points={curvePoints}
              synthNote={serffSynthNote(kind, rows)}
              height={140}
            />
            <PackTable
              rows={rows}
              onOpenImply={onOpenImply}
              focusable={kind === 'calendar'}
            />
          </div>
        );
      })}
    </div>
  );
}
