import { lazy, Suspense, useMemo, useState } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import { Panel } from '../terminal/Panel';
import { selectStrikeWindow, spotStatus } from '../../lib/quant/strikeWindow';
import { HeatmapEngine, type HeatmapCellData, type HeatmapAxisKey } from '../charts/HeatmapEngine';
import { DeskModeBar } from '../terminal/DeskModeBar';
import { EmptyState } from '../common/EmptyState';

const Surface3DTool = lazy(() => import('./surface/Surface3DTool').then(m => ({ default: m.Surface3DTool })));

type QuoteSide = 'mid' | 'bid' | 'ask';

export function SurfaceMatrixView() {
  const snapshot = useTerminalStore((s) => s.snapshot);
  const [side, setSide] = useState<QuoteSide>('mid');
  const [show3d, setShow3d] = useState(false);

  const availability = useMemo(() => {
    if (!snapshot) return { hasBidIv: false, hasAskIv: false };
    const expiries = snapshot.expiries.slice(0, 8);
    return {
      hasBidIv: expiries.some((e) => [...e.calls, ...e.puts].some((q) => q.bidIv != null)),
      hasAskIv: expiries.some((e) => [...e.calls, ...e.puts].some((q) => q.askIv != null)),
    };
  }, [snapshot]);

  // OTM/ATM convention: K < F → OTM put, K ≥ F → OTM call; missing side → unavailable (null), never substitute.
  const grid = useMemo(() => {
    if (!snapshot) return null;
    const expiries = snapshot.expiries.slice(0, 8);
    const strikeSet = new Set<number>();
    for (const e of expiries) for (const q of [...e.calls, ...e.puts]) strikeSet.add(q.strike);
    const allStrikes = [...strikeSet].sort((a, b) => a - b);
    const strikes = selectStrikeWindow(allStrikes, snapshot.spot, 40, 0.18);
    const values: HeatmapCellData[][] = expiries.map((e) => {
      const T = Math.max(1e-9, e.dte / 365);
      const F = (e as unknown as { forward?: number }).forward ?? snapshot.spot * Math.exp((snapshot.riskFreeRate - snapshot.dividendYield) * T);
      return strikes.map((k) => {
        const wantPut = k < F;
        const q = wantPut ? e.puts.find((x) => x.strike === k) : e.calls.find((x) => x.strike === k);
        const pick = (x: number | null | undefined) => (x != null ? x * 100 : null);
        const value = !q
          ? null
          : side === 'mid'
            ? (pick(q.midIv) ?? pick(q.iv))
            : side === 'bid'
              ? pick(q.bidIv)
              : pick(q.askIv);
        return {
          value,
          sides: q ? `K${k.toFixed(0)} ${wantPut ? 'OTM put' : 'OTM call'}` : undefined,
          coverage: q ? `${side} IV · ${q.openInterest != null ? `OI ${q.openInterest}` : 'OI missing'}` : undefined,
          source: 'chain quotes (observed)',
          asOf: snapshot.timestamp ?? null,
          assumption: side === 'mid' ? 'mid of observed bid/ask IV — not a traded print' : undefined,
        } satisfies HeatmapCellData;
      });
    });
    let min = Infinity, max = -Infinity;
    for (const row of values) for (const c of row) {
      const v = c.value;
      if (v != null && Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
    }
    if (!Number.isFinite(min)) { min = 0; max = 40; }
    const rows: HeatmapAxisKey[] = expiries.map((e) => ({ key: e.expiry, label: `${e.dte}d`, num: e.dte }));
    const cols: HeatmapAxisKey[] = strikes.map((k) => ({ key: String(k), label: k >= 1000 ? String(Math.round(k)) : k.toFixed(0), num: k }));
    const { offscreen } = spotStatus(snapshot.spot, strikes);
    const spot = snapshot.spot;
    const hasSpot = spot != null && Number.isFinite(spot) && spot > 0;
    // When in range, use true numeric interpolation; when offscreen/unavailable, omit line and show separate status
    const spotRef: { colKey: string; label: string } | null = null; // legacy fallback not used; kept for compat
    const drawSpotValue = hasSpot && !offscreen ? spot : null;
    const drawSpotLabel = hasSpot && !offscreen ? `SPOT ${spot.toFixed(0)}` : null;
    const spotBanner = !hasSpot ? `SPOT unavailable` : offscreen ? `SPOT ${spot.toFixed(0)} — offscreen` : null;
    return {
      rows, cols, cells: values,
      spotRef,
      spotOffscreen: offscreen,
      spotValue: hasSpot ? spot : null,
      drawSpotValue,
      drawSpotLabel,
      spotBanner,
      min, max,
    };
  }, [snapshot, side]);

  if (!snapshot || !grid) {
    return (
      <Panel title="IV Surface — strike × expiry" data-testid="vol-surface-matrix">
        <EmptyState kind="no-data" title="No surface" body="Load a live option chain — no synthetic surface is drawn." />
      </Panel>
    );
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
    <Panel title="IV Surface — strike × expiry matrix" data-testid="vol-surface-matrix">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 px-2 py-1 border-b border-border">
          <DeskModeBar
            items={modeItems as unknown as { id: string; label: string }[]}
            activeId={effectiveSide}
            onSelect={(id) => setSide(id as QuoteSide)}
          />
          <span className="text-type-2xs text-muted-foreground" title="Bid/ask IV derived by independent inversion of observed bid/ask prices via canonical solver; null when not invertible; feed IV when present is observed; SVI is model; never proxy">
            {availability.hasBidIv || availability.hasAskIv ? 'Bid/Ask IV derived (inverted) — no proxy · Feed IV observed · SVI model' : 'Bid/Ask IV unavailable for this chain — derived when invertible'}
          </span>
          <span className="ml-auto font-mono text-type-2xs text-muted-foreground">{snapshot.symbol} · {snapshot.spot.toFixed(2)} · {grid.rows.length}×{grid.cols.length}</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
          <div className="text-type-2xs text-muted-foreground">IV % — {effectiveSide === 'mid' ? 'derived two-sided midpoint IV (mid-price inversion, not executable)' : effectiveSide === 'bid' ? 'derived bid IV (inverted from observed bid, not observed IV)' : 'derived ask IV (inverted from observed ask, not observed IV)'} · feed IV: observed when supplied · SVI: model · unavailable sides remain — (null) · OTM: K&lt;F→put, K≥F→call</div>
          <div className="h-64">
            <HeatmapEngine
              rows={grid.rows}
              cols={grid.cols}
              cells={grid.cells}
              diverging={false}
              units="%"
              metricLabel="IV"
              spotRef={grid.spotRef}
              spotValue={grid.drawSpotValue}
              spotLabel={grid.drawSpotLabel}
              caption="IV surface matrix (IV % by strike and expiry)"
              emptyMessage="No IV observations in window — cells stay unavailable."
            />
            {grid.spotBanner && (
              <div className="font-mono text-type-2xs text-amber" data-testid="spot-offscreen-banner">{grid.spotBanner}</div>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-border pt-2">
            <div>
              <div className="font-mono text-type-xs font-semibold text-foreground">3D observed/model surface</div>
              <div className="text-type-2xs text-muted-foreground">Optional analytical view; the WebGL engine is not loaded until opened.</div>
            </div>
            <button
              type="button"
              className="rounded border border-border px-2 py-1 font-mono text-type-2xs text-foreground hover:bg-muted/30 focus-ring-term"
              aria-expanded={show3d}
              onClick={() => setShow3d((open) => !open)}
              data-testid="open-3d-surface"
            >
              {show3d ? 'Close 3D' : 'Open 3D'}
            </button>
          </div>
          {show3d && (
            <Suspense fallback={<div className="flex h-40 items-center justify-center font-mono text-type-2xs text-muted-foreground">3D engine loads on open…</div>}>
              <Surface3DTool />
            </Suspense>
          )}
        </div>
      </div>
    </Panel>
  );
}
