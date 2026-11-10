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

/** SERFF badge: only when the row note explicitly marks a synthetic leg — never from a bare ZQ mention. */
function serffSynthNote(kind: StirSpread['kind'], rows: SpreadRow[]): string | null {
  if (kind !== 'serff') return null;
  const note =
    rows.find((r) => r.note)?.note
    || rows.find((r) => r.imply?.text)?.imply?.text
    || '';
  if (/synth/i.test(note)) return 'ZQ offline';
  return null;
}

const KIND_ORDER = ['cash', 'serff', 'calendar', 'fly', 'pack', 'inter'] as const;

function titleFor(kind: (typeof KIND_ORDER)[number]): string {
  switch (kind) {
    case 'cash':
      return 'CASH CORRIDOR (SOFR / EFFR / IORB)';
    case 'serff':
      return 'SERFF · SR1 − ZQ (same delivery month, 1:1)';
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

/**
 * Shared column header so the SERFF table keeps the exact same
 * `Spread` / `Rate bps` / `Price spr` / `Implies` / `Note` labels and units as
 * every other spread table.
 */
function SpreadTableHeader({
  testId,
  impliesClass = '',
}: {
  testId?: string;
  /** Extra class on the `Implies` label; SERFF indents it so it never crowds `Price spr`. */
  impliesClass?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="serff-grid grid grid-cols-[1.2fr_72px_72px_100px_1.4fr] gap-0 border-b border-border/60 px-1.5 py-1 text-type-2xs text-muted-foreground"
    >
      <span>Spread</span>
      <span className="text-right">Rate bps</span>
      <span className="text-right">Price spr</span>
      <span className={impliesClass}>Implies</span>
      <span>Note</span>
    </div>
  );
}

/** Stable identity key: prefer the row name, then its exact legs, never the array index alone. */
function serffRowKey(s: SpreadRow, index: number): string {
  const name = s.name?.trim();
  if (name) return name;
  const legs = s.legs?.filter((leg) => Boolean(leg && leg.trim())).join('|');
  if (legs) return legs;
  return `serff-${index}`;
}

/**
 * Responsive SERFF table: renders every returned SERFF row into the DOM (no
 * virtualization) inside a keyboard-focusable, named scroll region with list
 * semantics, so all rows and their full identifier/`Unavailable` note text are
 * reachable at mobile width. Rows size to their content (min 28px) so wrapped
 * multi-line cells cannot overlap adjacent rows.
 */
function SerffRows({
  rows,
  onOpenImply,
}: {
  rows: SpreadRow[];
  onOpenImply: (i: ImplyRead) => void;
}) {
  return (
    <div
      className="serff-table-scroll"
      role="region"
      aria-label="SERFF spread rows"
      tabIndex={0}
    >
      <SpreadTableHeader testId="serff-column-header" impliesClass="pl-2" />
      <div role="list" aria-label="SERFF spreads">
        {rows.map((s, index) => {
          const bps = s.rate_bps;
          return (
            <div
              key={serffRowKey(s, index)}
              role="listitem"
              className={`serff-grid grid min-h-7 grid-cols-[1.2fr_72px_72px_100px_1.4fr] items-center gap-0 border-t border-border/40 px-1.5 py-0.5 text-type-xs ${
                bps != null && bps < 0
                  ? 'bg-down/15'
                  : bps != null && bps > 0
                    ? 'bg-info/10'
                    : ''
              }`}
            >
              <span className="font-mono font-bold text-foreground serff-cell-name serff-name-nowrap">{s.name}</span>
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
              <span className="pl-2">
                <ImplyChip imply={s.imply} compact onOpen={onOpenImply} />
              </span>
              <span className="text-type-2xs text-muted-foreground serff-cell-note serff-note-wrap">
                {s.imply?.text || s.note || s.legs?.join(' / ')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
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
      <SpreadTableHeader />
      <div role="list" aria-label="Spread rows">
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
      </div>
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
      <style>{`
        .serff-table-scroll {
          max-height: 280px;
          overflow-x: hidden;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
        }
        @media (max-width: 560px) {
          .serff-table-scroll {
            overflow-x: auto;
            touch-action: pan-x pan-y;
          }
          .serff-grid {
            grid-template-columns: 68px 52px 56px 65px 96px;
            min-width: 337px;
          }
          .serff-name-nowrap {
            white-space: nowrap;
            max-width: none;
          }
          .serff-note-wrap {
            white-space: normal;
            overflow-wrap: break-word;
            word-break: normal;
          }
        }
      `}</style>

      <div>
        <h4 className="text-type-sm font-semibold text-foreground">STIR SPREADS DESK</h4>
        <p className="text-type-2xs text-muted-foreground">
          Calendars · flies · packs · SERFF (SR1−ZQ) · cash corridor · {stir.spreads.note}
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
            {kind === 'serff' ? (
              <SerffRows rows={rows} onOpenImply={onOpenImply} />
            ) : (
              <PackTable
                rows={rows}
                onOpenImply={onOpenImply}
                focusable={kind === 'calendar'}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
