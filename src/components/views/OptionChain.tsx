import { useMemo, useCallback, useRef } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import { fmtPrice, fmtPct, fmtInt } from '../../lib/format';
import { cn } from '../../lib/utils';
import { VISUAL_CONFIG } from '../../config/constants';
import { PERF_BUDGET } from '../../config/perfBudget';
import { DiagnosticsStrip } from './DiagnosticsStrip';
import { Explain } from '../common/Explain';
import { ExportCsvButton } from '../common/ExportCsvButton';
import { VirtualRows } from '../common/VirtualRows';
import {
  useBoardFocus,
  useRegisterBoard,
  type FocusableBoardApi,
} from '../../hooks/useBoardFocus';

interface RowData {
  strike: number;
  callIV: string;
  callDelta: string;
  callBid: string;
  callAsk: string;
  callOI: string;
  callVol: string;
  putIV: string;
  putDelta: string;
  putBid: string;
  putAsk: string;
  putOI: string;
  putVol: string;
  atm: boolean;
}

const COL_WIDTHS = { sm: 'flex-[1.5]', md: 'flex-[1]', lg: 'flex-[1.2]' };
const { ROW_HEIGHT, ATM_THRESHOLD } = VISUAL_CONFIG.optionChain;

function HeaderRow() {
  return (
    <div className="flex text-type-xs font-mono text-muted-foreground border-b border-border bg-card sticky top-0 z-10 h-6 items-center">
      <div className="flex-[4] flex">
        <Explain term="impliedVol" className={`${COL_WIDTHS.sm} text-right px-1`}>IV%</Explain>
        <Explain term="delta" className={`${COL_WIDTHS.sm} text-right px-1`}>Δ</Explain>
        <Explain term="bid" className={`${COL_WIDTHS.md} text-right px-1`}>Bid</Explain>
        <Explain term="ask" className={`${COL_WIDTHS.md} text-right px-1`}>Ask</Explain>
        <Explain term="openInterest" className={`${COL_WIDTHS.sm} text-right px-1`}>OI</Explain>
        <Explain term="volume" className={`${COL_WIDTHS.sm} text-right px-1`}>Vol</Explain>
      </div>
      <span className="flex-[1] text-center font-semibold text-muted-foreground"><Explain term="strike">Strike</Explain></span>
      <div className="flex-[4] flex">
        <Explain term="volume" className={`${COL_WIDTHS.sm} text-right px-1`}>Vol</Explain>
        <Explain term="openInterest" className={`${COL_WIDTHS.sm} text-right px-1`}>OI</Explain>
        <Explain term="bid" className={`${COL_WIDTHS.md} text-right px-1`}>Bid</Explain>
        <Explain term="ask" className={`${COL_WIDTHS.md} text-right px-1`}>Ask</Explain>
        <Explain term="delta" className={`${COL_WIDTHS.sm} text-right px-1`}>Δ</Explain>
        <Explain term="impliedVol" className={`${COL_WIDTHS.sm} text-right px-1`}>IV%</Explain>
      </div>
    </div>
  );
}

export function OptionChain() {
  const snapshot = useTerminalStore(s => s.snapshot);
  const selectedExpiry = useTerminalStore(s => s.selectedExpiry);
  const sviReadout = useTerminalStore(s => s.sviReadout);
  const arbResult = useTerminalStore(s => s.arbResult);
  const spot = snapshot?.spot ?? 0;
  const { focused, rowIndex, focusRow } = useBoardFocus('chain');
  const rowsRef = useRef<RowData[]>([]);

  const rows: RowData[] = useMemo(() => {
    if (!snapshot) return [];
    const slice = snapshot.expiries.find(e => e.expiry === selectedExpiry) ?? snapshot.expiries[0];
    if (!slice) return [];

    const callsMap = new Map(slice.calls.map(c => [c.strike, c]));
    const putsMap = new Map(slice.puts.map(p => [p.strike, p]));
    const allStrikes = [...new Set([...callsMap.keys(), ...putsMap.keys()])].sort((a, b) => b - a);

    return allStrikes.map(strike => {
      const call = callsMap.get(strike);
      const put = putsMap.get(strike);
      const isATM = Math.abs(strike - spot) / spot < ATM_THRESHOLD;
      return {
        strike,
        callIV: call?.iv != null ? fmtPct(call.iv, 1) : '—',
        callDelta: call?.delta != null ? fmtPrice(call.delta, 3) : '—',
        callBid: call?.bid != null ? fmtPrice(call.bid) : '—',
        callAsk: call?.ask != null ? fmtPrice(call.ask) : '—',
        callOI: call?.openInterest != null ? fmtInt(call.openInterest) : '—',
        callVol: call?.volume != null ? fmtInt(call.volume) : '—',
        putIV: put?.iv != null ? fmtPct(put.iv, 1) : '—',
        putDelta: put?.delta != null ? fmtPrice(put.delta, 3) : '—',
        putBid: put?.bid != null ? fmtPrice(put.bid) : '—',
        putAsk: put?.ask != null ? fmtPrice(put.ask) : '—',
        putOI: put?.openInterest != null ? fmtInt(put.openInterest) : '—',
        putVol: put?.volume != null ? fmtInt(put.volume) : '—',
        atm: isATM,
      };
    });
  }, [snapshot, selectedExpiry, spot]);

  rowsRef.current = rows;

  const api = useMemo<FocusableBoardApi>(() => ({
    scrollToRow: () => { /* VirtualRows remounts on focus ring; overscan handles visibility */ },
    getCellText: (row, colKey) => {
      const r = rowsRef.current[row];
      if (!r) return '';
      if (colKey === 'callBid') return r.callBid;
      if (colKey === 'putBid') return r.putBid;
      return String(r.strike);
    },
    rowCount: () => rowsRef.current.length,
    colKeys: () => ['strike', 'callBid', 'putBid'],
  }), []);

  useRegisterBoard('chain', api);

  const onRowClick = useCallback((index: number) => {
    focusRow(index, 'strike');
  }, [focusRow]);

  const chainUsed = useTerminalStore((s) => s.chainUsed);
  const chainAvailable = useTerminalStore((s) => s.chainAvailable);
  const loading = useTerminalStore((s) => s.loading);
  /**
   * Existing chain cache truth only: store `provenance.chain` (server
   * `freshness` via `sourceFreshness` + snapshot age). Separate from numeric
   * snapshot fields; never the Session-GEX 96h wall-clock rule, never a frozen
   * fixture timestamp, never dealer-exposure inference. `expired` is stale-or-
   * worse with rows present, so it shows the same Stale pill; down/unknown/
   * delayed/absent show no pill (fail-closed, not stale).
   */
  const chainProv = useTerminalStore((s) => s.provenance.chain);
  const chainStale = chainProv?.kind === 'stale' || chainProv?.kind === 'expired';
  const chainStaleTitle = (() => {
    const parts = [`chain data ${chainProv?.kind ?? 'stale'}`];
    if (chainProv?.asOfMs != null && Number.isFinite(chainProv.asOfMs)) {
      parts.push(`age ${Math.max(0, Math.round((Date.now() - chainProv.asOfMs) / 1000))}s`);
    }
    return parts.join(' \u00b7 ');
  })();

  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center font-mono text-xs text-muted-foreground">
        <div className="font-semibold text-foreground">
          {loading ? 'Loading option chain…' : 'No live option chain'}
        </div>
        <div className="max-w-md text-type-2xs leading-relaxed">
          {chainAvailable
            ? 'Selected expiry has no rows. Pick another expiry.'
            : 'Equities: yfinance delayed chain (bid/ask/OI/volume via /api/options) or FMP if keyed. BTC/ETH: Deribit. Fail-closed — no synthetic strikes shown as market data.'}
        </div>
        {!loading && (
          <div className="text-type-2xs text-muted-foreground/80">
            source: {chainUsed || 'none'}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-end border-b border-border/50 px-2 py-0.5">
        {chainStale && (
          <span className="mr-auto flex items-center gap-1.5">
            <span
              data-testid="chain-stale"
              role="status"
              title={chainStaleTitle}
              className="rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 font-mono text-type-2xs text-warn"
            >
              Stale
            </span>
            <span
              data-testid="chain-stale-scope"
              className="font-mono text-type-2xs text-muted-foreground"
            >
              chain only · spot keeps own badge
            </span>
          </span>
        )}
        <ExportCsvButton
          filename={`chain-${selectedExpiry ?? 'front'}`}
          headers={['strike', 'callIV', 'callDelta', 'callBid', 'callAsk', 'callOI', 'callVol', 'putVol', 'putOI', 'putBid', 'putAsk', 'putDelta', 'putIV']}
          rows={rows.map((r) => [
            r.strike, r.callIV, r.callDelta, r.callBid, r.callAsk, r.callOI, r.callVol,
            r.putVol, r.putOI, r.putBid, r.putAsk, r.putDelta, r.putIV,
          ])}
        />
      </div>
      <HeaderRow />
      <DiagnosticsStrip sviReadout={sviReadout} arbResult={arbResult} data-testid="chain-diagnostics" />
      <div className="flex-1 min-h-0">
        <VirtualRows
          items={rows}
          rowHeight={ROW_HEIGHT}
          height="100%"
          overscanCount={PERF_BUDGET.virtualOverscan}
          className="h-full"
          renderRow={({ index, style, item: r }) => (
            <div
              style={style}
              onClick={() => onRowClick(index)}
              className={cn(
                'flex text-type-xs font-mono items-center border-b border-border/30 hover:bg-muted/20 cursor-default',
                r.atm && 'bg-primary/5',
                focused && index === rowIndex && 'focus-ring-term-inset bg-primary/10',
              )}
            >
              <div className="flex-[4] flex text-up">
                <span className={`${COL_WIDTHS.sm} text-right px-1 tabular-nums`}>{r.callIV}</span>
                <span className={`${COL_WIDTHS.sm} text-right px-1 tabular-nums`}>{r.callDelta}</span>
                <span className={`${COL_WIDTHS.md} text-right px-1 tabular-nums`}>{r.callBid}</span>
                <span className={`${COL_WIDTHS.md} text-right px-1 tabular-nums`}>{r.callAsk}</span>
                <span className={`${COL_WIDTHS.sm} text-right px-1 tabular-nums`}>{r.callOI}</span>
                <span className={`${COL_WIDTHS.sm} text-right px-1 tabular-nums`}>{r.callVol}</span>
              </div>
              <span className="flex-[1] text-center text-foreground font-semibold tabular-nums">{fmtPrice(r.strike, 0)}</span>
              <div className="flex-[4] flex text-down">
                <span className={`${COL_WIDTHS.sm} text-right px-1 tabular-nums`}>{r.putVol}</span>
                <span className={`${COL_WIDTHS.sm} text-right px-1 tabular-nums`}>{r.putOI}</span>
                <span className={`${COL_WIDTHS.md} text-right px-1 tabular-nums`}>{r.putBid}</span>
                <span className={`${COL_WIDTHS.md} text-right px-1 tabular-nums`}>{r.putAsk}</span>
                <span className={`${COL_WIDTHS.sm} text-right px-1 tabular-nums`}>{r.putDelta}</span>
                <span className={`${COL_WIDTHS.sm} text-right px-1 tabular-nums`}>{r.putIV}</span>
              </div>
            </div>
          )}
        />
      </div>
    </div>
  );
}
