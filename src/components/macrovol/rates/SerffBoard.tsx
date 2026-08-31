import { useMemo, useRef } from 'react';
import type { ImplyRead, StirStripData } from '../../../lib/macrovol/api';
import { VirtualRows } from '../../common/VirtualRows';
import { ImplyChip } from '../../common/ImplyDrawer';
import { ExportCsvButton } from '../../common/ExportCsvButton';
import { PERF_BUDGET } from '../../../config/perfBudget';
import {
  useBoardFocus,
  useRegisterBoard,
  type FocusableBoardApi,
} from '../../../hooks/useBoardFocus';
import { StirSpreadCurve, toCurvePoints } from './StirSpreadCurve';

type SerffRow = NonNullable<StirStripData['serff_board']>[number];

function isProxy(r: SerffRow): boolean {
  return r.kind === 'derived-proxy';
}

function BoardRows({
  rows,
  onOpenImply,
  boardId,
}: {
  rows: SerffRow[];
  onOpenImply: (i: ImplyRead) => void;
  boardId: string;
}) {
  const dataRef = useRef(rows);
  dataRef.current = rows;

  const { focused, rowIndex, focusRow } = useBoardFocus(boardId);
  const focusApi = useMemo<FocusableBoardApi>(
    () => ({
      scrollToRow: () => {},
      getCellText: (row, colKey) => {
        const r = dataRef.current[row];
        if (!r) return '';
        if (colKey === 'last_bps') return r.last_bps != null ? String(r.last_bps) : '';
        if (colKey === 'name') return r.name;
        return `${r.cc} ${r.name} ${r.last_bps ?? ''}`;
      },
      rowCount: () => dataRef.current.length,
      colKeys: () => ['cc', 'name', 'last_bps'],
    }),
    [],
  );
  useRegisterBoard(boardId, rows.length ? focusApi : null);

  return (
    <VirtualRows
      items={rows}
      rowHeight={28}
      overscanCount={PERF_BUDGET.virtualOverscan}
      height={Math.min(320, Math.max(56, rows.length * 28))}
      renderRow={({ index, style, item: s }) => {
        const bps = s.last_bps;
        const unavailable = bps == null;
        const isFocused = focused && index === rowIndex;
        return (
          <div
            style={style}
            onClick={() => focusRow(index, 'name')}
            className={`grid grid-cols-[48px_1fr_2fr_64px_64px_64px_84px] items-center gap-0 border-t border-border/40 px-1.5 text-type-xs cursor-default hover:bg-muted/20 ${
              isFocused ? 'focus-ring-term-inset bg-primary/10' : ''
            } ${
              !isFocused && !unavailable && bps < 0
                ? 'bg-down/15'
                : !isFocused && !unavailable && bps > 0
                  ? 'bg-info/10'
                  : ''
            } ${unavailable ? 'opacity-70' : ''}`}
          >
            <span className="font-mono text-muted-foreground">{s.cc}</span>
            <span className="truncate font-mono font-bold text-foreground">{s.name}</span>
            <span className="truncate text-type-2xs text-muted-foreground" title={s.description}>
              {s.description}
            </span>
            <span
              data-testid={boardId === 'serff' ? 'serff-bps' : undefined}
              className={`text-right font-mono font-semibold tabular-nums ${
                unavailable ? 'text-muted-foreground' : bps < 0 ? 'text-down' : 'text-up'
              }`}
            >
              {unavailable ? 'Unavailable' : `${bps >= 0 ? '+' : ''}${bps.toFixed(1)}`}
            </span>
            <span className="text-right font-mono tabular-nums text-muted-foreground">
              {s.price_spread != null
                ? s.price_spread >= 0
                  ? `+${s.price_spread.toFixed(3)}`
                  : s.price_spread.toFixed(3)
                : '—'}
            </span>
            <span className="text-center font-mono text-type-2xs text-muted-foreground" title={s.ratio ?? ''}>
              {s.ratio ?? '—'}
            </span>
            <span>
              <ImplyChip imply={s.imply} compact onOpen={onOpenImply} />
            </span>
          </div>
        );
      }}
    />
  );
}

export function SerffBoard({
  rows,
  onOpenImply,
}: {
  rows: SerffRow[];
  onOpenImply: (i: ImplyRead) => void;
}) {
  const data = rows.slice(0, 48);
  if (!data.length) return null;

  // Exact legs + ratio resolved from the data contract (never guessed from the name).
  // Listed SERFF = same-month SR1 − ZQ (ratio 1:1) only. Cash-EFFR rows are a
  // separate Derived Proxy group — non-listed, non-executable. Any other kind
  // (e.g. SR3 calendar-of-calendars, SR3−ZQ inter) must never render here.
  const listed = data.filter((r) => r.kind === 'serff');
  const proxies = data.filter(isProxy);
  const legs = Array.from(new Set(listed.flatMap((r) => r.legs ?? []))).filter(Boolean);
  const ratios = Array.from(new Set(listed.map((r) => r.ratio).filter(Boolean) as string[]));
  const ratioLabel = ratios.length === 1 ? ratios[0] : ratios.length ? ratios.join(' | ') : null;
  const legLabel = legs.length ? legs.join(' − ') : 'SR1 − ZQ';
  const titleRatio = ratioLabel ? ` [${ratioLabel}]` : '';
  const curvePoints = toCurvePoints(listed.filter((r) => r.last_bps != null), {
    x: (r) => (r.name || r.cc),
    bps: (r) => r.last_bps,
    full: (r) => r.description,
  });

  return (
    <div className="mt-3 overflow-hidden rounded border border-border">
      <StirSpreadCurve
        title={`SERFF · ${legLabel}${titleRatio} — same delivery month (bp per contract)`}
        points={curvePoints}
        height={140}
      />
      <p className="border-b border-border bg-background/30 px-2 py-1 font-mono text-type-2xs leading-snug text-muted-foreground" data-testid="serff-sign-note">
        Sign convention: rate_bps = SR1 implied − ZQ implied (leg order as listed), 1:1 ratio.
        Positive = One-Month SOFR futures above 30-Day Fed Funds futures (secured funding priced
        firmer than unsecured). Negative = SOFR leg below FF leg. Missing exact leg → Unavailable —
        never an SR3 or cash-EFFR substitution. X = common delivery month; Y = spread in basis
        points, never mixed with outright rates.
      </p>
      <div className="flex items-center justify-between border-b border-border bg-background/50 px-2 py-1 text-type-xs font-semibold text-foreground">
        <span>
          SERFF · CME ICS · SR1 − ZQ (same delivery month, 1:1)
          <span className="ml-2 font-normal text-muted-foreground">
            CC · Description · Last (bps) · j/k focus
          </span>
        </span>
        <ExportCsvButton
          filename="serff-board.csv"
          headers={['cc', 'name', 'description', 'last_bps', 'price_spread', 'legs', 'ratio', 'kind']}
          rows={data.map((s) => [s.cc, s.name, s.description, s.last_bps, s.price_spread, (s.legs ?? []).join(' '), s.ratio, s.kind])}
        />
      </div>
      <div className="grid grid-cols-[48px_1fr_2fr_64px_64px_64px_84px] gap-0 border-b border-border/60 px-1.5 py-1 text-type-2xs text-muted-foreground">
        <span>CC</span>
        <span>Spread</span>
        <span>Description</span>
        <span className="text-right">Last bps</span>
        <span className="text-right">Price spr</span>
        <span className="text-center">Ratio</span>
        <span>Implies</span>
      </div>
      <BoardRows rows={listed} onOpenImply={onOpenImply} boardId="serff" />
      {proxies.length > 0 && (
        <>
          <div className="border-t border-border bg-muted/30 px-1.5 py-1 text-type-2xs font-semibold uppercase tracking-wide text-muted-foreground" data-testid="serff-proxy-heading">
            Derived Proxy — SR1/SR3 implied − cash EFFR · non-listed · non-executable · not SERFF
          </div>
          <BoardRows rows={proxies} onOpenImply={onOpenImply} boardId="serff-proxy" />
        </>
      )}
    </div>
  );
}
