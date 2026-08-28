import { useMemo, useState } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import { Panel } from '../terminal/Panel';
import { MatrixHeatmap } from '../charts/MatrixHeatmap';
import { DeskModeBar } from '../terminal/DeskModeBar';

type QuoteSide = 'mid' | 'bid' | 'ask';

export function SurfaceMatrixView() {
  const snapshot = useTerminalStore((s) => s.snapshot);
  const [side, setSide] = useState<QuoteSide>('mid');

  const availability = useMemo(() => {
    if (!snapshot) return { hasBidIv: false, hasAskIv: false };
    const expiries = snapshot.expiries.slice(0, 8);
    return {
      hasBidIv: expiries.some((e) => [...e.calls, ...e.puts].some((q) => q.bidIv != null)),
      hasAskIv: expiries.some((e) => [...e.calls, ...e.puts].some((q) => q.askIv != null)),
    };
  }, [snapshot]);

  const grid = useMemo(() => {
    if (!snapshot) return null;
    const expiries = snapshot.expiries.slice(0, 8);
    const strikeSet = new Set<number>();
    for (const e of expiries) {
      for (const q of [...e.calls, ...e.puts]) strikeSet.add(q.strike);
    }
    const strikes = [...strikeSet].sort((a, b) => a - b).filter((k) => Math.abs(k - snapshot.spot) / snapshot.spot < 0.18).slice(0, 40);
    const values: (number | null)[][] = expiries.map((e) =>
      strikes.map((k) => {
        const q = [...e.calls, ...e.puts].find((x) => x.strike === k);
        if (!q) return null;
        if (side === 'mid') return q.midIv != null ? q.midIv * 100 : (q.iv != null ? q.iv * 100 : null);
        if (side === 'bid') return q.bidIv != null ? q.bidIv * 100 : null;
        if (side === 'ask') return q.askIv != null ? q.askIv * 100 : null;
        return null;
      })
    );
    let min = Infinity, max = -Infinity;
    for (const row of values) for (const v of row) if (v != null) { if (v < min) min = v; if (v > max) max = v; }
    if (!isFinite(min)) { min = 0; max = 40; }
    return { expiries: expiries.map((e) => `${e.dte}d`), strikes: strikes.map(String), values, min, max };
  }, [snapshot, side]);

  if (!snapshot || !grid) {
    return <Panel title="IV Surface — strike × expiry"><div className="p-4 text-xs text-muted-foreground">No surface</div></Panel>;
  }

  // Ensure side stays valid when availability changes
  if (side === 'bid' && !availability.hasBidIv) {
    // keep showing mid when bid unavailable — control hidden
  }
  if (side === 'ask' && !availability.hasAskIv) {
    // keep showing mid when ask unavailable
  }
  const modeItems = [
    { id: 'mid', label: 'Mid' },
    ...(availability.hasBidIv ? [{ id: 'bid', label: 'Bid' }] : []),
    ...(availability.hasAskIv ? [{ id: 'ask', label: 'Ask' }] : []),
  ] as const;
  const effectiveSide = (side === 'bid' && !availability.hasBidIv) || (side === 'ask' && !availability.hasAskIv) ? 'mid' as const : side;

  return (
    <Panel title="IV Surface — strike × expiry matrix">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 px-2 py-1 border-b border-border">
          <DeskModeBar
            items={modeItems as unknown as { id: string; label: string }[]}
            activeId={effectiveSide}
            onSelect={(id) => setSide(id as QuoteSide)}
          />
          <span className="text-type-2xs text-muted-foreground" title="Bid/Ask IV independently inverted from observed bid/ask prices via canonical solver; null when not invertible; never proxy">
            {availability.hasBidIv || availability.hasAskIv ? 'Bid/Ask IV independently inverted — no proxy' : 'Bid/Ask IV unavailable for this chain'}
          </span>
          <span className="ml-auto font-mono text-type-2xs text-muted-foreground">{snapshot.symbol} · {snapshot.spot.toFixed(2)} · {grid.expiries.length}×{grid.strikes.length}</span>
        </div>
        <div className="p-2">
          <div className="text-type-2xs text-muted-foreground mb-1">IV % — {effectiveSide === 'mid' ? 'solved mid IV (executable mid)' : effectiveSide === 'bid' ? 'solved bid IV (observed bid price)' : 'solved ask IV (observed ask price)'} · separate feed/mid/bid/ask/model layers</div>
          <MatrixHeatmap
            data={grid.values}
            xLabels={grid.strikes}
            yLabels={grid.expiries}
            title={`IV Surface ${side} — ${grid.min.toFixed(1)} to ${grid.max.toFixed(1)}%`}
          />
          <div className="mt-2 max-h-[160px] overflow-auto border border-border rounded">
            <table className="w-full font-mono text-type-2xs">
              <caption className="sr-only">IV surface matrix — accessible table fallback for Canvas heatmap</caption>
              <thead className="sticky top-0 bg-card"><tr><th className="px-1 py-1 text-left">Strike \ DTE</th>{grid.expiries.map((e) => <th key={e} className="px-1 py-1 text-right">{e}</th>)}</tr></thead>
              <tbody>{grid.strikes.slice(0, 12).map((k, ki) => <tr key={k} className="border-t border-border/40"><td className="px-1 py-0.5">{k}</td>{grid.values.map((row, ri) => <td key={ri} className="px-1 py-0.5 text-right tabular-nums">{row[ki]?.toFixed(1) ?? '—'}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>
    </Panel>
  );
}
