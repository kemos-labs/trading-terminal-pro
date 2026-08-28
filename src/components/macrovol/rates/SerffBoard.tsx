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

export function SerffBoard({
  rows,
  onOpenImply,
}: {
  rows: SerffRow[];
  onOpenImply: (i: ImplyRead) => void;
}) {
  const data = rows.slice(0, 48);
  const dataRef = useRef(data);
  dataRef.current = data;

  const { focused, rowIndex, focusRow } = useBoardFocus('serff');
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
  useRegisterBoard('serff', data.length ? focusApi : null);

  if (!data.length) return null;

  const curvePoints = toCurvePoints(data, {
    x: (r) => r.cc && r.name ? `${r.cc} ${r.name}` : (r.name || r.cc),
    bps: (r) => r.last_bps,
    full: (r) => r.description,
  });
  const synthNote = data.some((r) =>
    /synth|ZQ|offline/i.test(`${r.description || ''} ${r.name || ''} ${r.cc || ''}`),
  )
    ? 'ZQ offline'
    : null;

  return (
    <div className="mt-3 overflow-hidden rounded border border-border">
      <StirSpreadCurve
        title="SERFF TERM STRUCTURE (bps)"
        points={curvePoints}
        synthNote={synthNote}
        height={140}
      />
      <div className="flex items-center justify-between border-b border-border bg-background/50 px-2 py-1 text-type-xs font-semibold text-foreground">
        <span>
          SERFF / SOFR−EFFR INTERMARKET · CME ICS style
          <span className="ml-2 font-normal text-muted-foreground">
            CC · Description · Last (bps) — synth when ZQ offline · j/k focus
          </span>
        </span>
        <ExportCsvButton
          filename="serff-board.csv"
          headers={['cc', 'name', 'description', 'last_bps', 'price_spread']}
          rows={data.map((s) => [s.cc, s.name, s.description, s.last_bps, s.price_spread])}
        />
      </div>
      <div className="grid grid-cols-[48px_1fr_2fr_72px_72px_100px] gap-0 border-b border-border/60 px-1.5 py-1 text-type-2xs text-muted-foreground">
        <span>CC</span>
        <span>Spread</span>
        <span>Description</span>
        <span className="text-right">Last bps</span>
        <span className="text-right">Price spr</span>
        <span>Implies</span>
      </div>
      <VirtualRows
        items={data}
        rowHeight={28}
        overscanCount={PERF_BUDGET.virtualOverscan}
        height={Math.min(320, Math.max(120, data.length * 28))}
        renderRow={({ index, style, item: s }) => {
          const bps = s.last_bps;
          const isFocused = focused && index === rowIndex;
          return (
            <div
              style={style}
              onClick={() => focusRow(index, 'name')}
              className={`grid grid-cols-[48px_1fr_2fr_72px_72px_100px] items-center gap-0 border-t border-border/40 px-1.5 text-type-xs cursor-default hover:bg-muted/20 ${
                isFocused ? 'focus-ring-term-inset bg-primary/10' : ''
              } ${
                !isFocused && bps != null && bps < 0
                  ? 'bg-down/15'
                  : !isFocused && bps != null && bps > 0
                    ? 'bg-info/10'
                    : ''
              }`}
            >
              <span className="font-mono text-muted-foreground">{s.cc}</span>
              <span className="truncate font-mono font-bold text-foreground">{s.name}</span>
              <span className="truncate text-type-2xs text-muted-foreground" title={s.description}>
                {s.description}
              </span>
              <span
                className={`text-right font-mono font-semibold tabular-nums ${
                  bps == null ? 'text-muted-foreground' : bps < 0 ? 'text-down' : 'text-up'
                }`}
              >
                {bps != null ? `${bps >= 0 ? '+' : ''}${bps.toFixed(1)}` : '—'}
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
            </div>
          );
        }}
      />
    </div>
  );
}
