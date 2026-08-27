import { useCallback, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTerminalStore } from '../../store/terminalStore';
import {
  dealerCalendarGrid,
  dealerExposure,
  dealerExposureByExpiry,
  type DealerCalendarMetric,
  type ExposureWeight,
} from '../../lib/options/analytics';
import type { HeatmapCell } from './greeksTypes';
import { CanvasHeatmap } from './CanvasHeatmap';
import { useUrlSearchParam } from '../../hooks/useUrlSearchParam';
import { Panel } from '../terminal/Panel';
import { EmptyState } from '../common/EmptyState';
import { fmtCompact, fmtPct, fmtPrice } from '../../lib/format';
import { chartGridProps, chartTooltipStyle } from '../../lib/chartTheme';
import { cn } from '../../lib/utils';
import { CryptoPageHeader } from './crypto/CryptoPageHeader';

const METRICS: { id: DealerCalendarMetric; label: string; symbol: string; note: string }[] = [
  { id: 'gex', label: 'Gamma Exposure', symbol: 'Γ', note: '$ gamma for a 1% spot move' },
  { id: 'dex', label: 'Delta Exposure', symbol: 'Δ', note: 'Directional dollar delta' },
  { id: 'vex', label: 'Vanna Exposure', symbol: 'νΔ', note: 'Delta response to volatility' },
  { id: 'charm', label: 'Charm Exposure', symbol: 'Δt', note: 'Dollar delta decay per day' },
];

const PROFILE_FIELD: Record<DealerCalendarMetric, 'netGEX' | 'netDEX' | 'netVEX' | 'netCharm'> = {
  gex: 'netGEX', dex: 'netDEX', vex: 'netVEX', charm: 'netCharm',
};

function signedTone(value: number) {
  return value >= 0 ? 'text-up' : 'text-down';
}

function Stat({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: string }) {
  return (
    <div className="min-w-0 border-l-2 border-border px-2 py-1.5">
      <div className="font-mono text-type-2xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('truncate font-mono text-type-sm font-bold tabular-nums text-foreground', tone)}>{value}</div>
      {detail && <div className="truncate font-mono text-type-2xs text-muted-foreground">{detail}</div>}
    </div>
  );
}

/** Live Deribit strike × expiry exposure workstation. */
export function CryptoHeatmapView() {
  const snapshot = useTerminalStore((s) => s.snapshot);
  const symbol = useTerminalStore((s) => s.symbol);
  // Active greek is deep-linked (?page=heatmaps&greek=dex)
  const [metricParam, setMetricParam] = useUrlSearchParam(
    'greek',
    METRICS.map((m) => m.id),
    'gex',
  );
  const metric = metricParam as DealerCalendarMetric;
  const setMetric = (next: DealerCalendarMetric) => setMetricParam(next);
  const [weight, setWeight] = useState<ExposureWeight>('oi');
  const [spotBand, setSpotBand] = useState(0.2);
  const [hovered, setHovered] = useState<HeatmapCell | null>(null);
  const [selected, setSelected] = useState<HeatmapCell | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null);

  const grid = useMemo(() => snapshot ? dealerCalendarGrid(snapshot, metric, {
    weight,
    spotBand,
    maxStrikes: 44,
    maxExpiries: 14,
  }) : null, [metric, snapshot, spotBand, weight]);

  const matrix = useMemo(() => {
    if (!grid) return [];
    return grid.rows.map((row, ri) => grid.strikes.map((strike, ci) => ({
      strike,
      dte: row.dte,
      expiry: row.expiry,
      value: grid.values[ri]?.[ci] ?? null,
    })));
  }, [grid]);

  const exposure = useMemo(() => snapshot ? dealerExposure(snapshot, {
    weight,
    ...(selectedExpiry ? { expiry: selectedExpiry } : {}),
  }) : null, [selectedExpiry, snapshot, weight]);

  const profile = useMemo(() => {
    if (!exposure) return [];
    const field = PROFILE_FIELD[metric];
    return exposure.points
      .filter((point) => Math.abs(point.strike - (snapshot?.spot ?? 0)) / (snapshot?.spot ?? 1) <= spotBand)
      .map((point) => ({
        strike: point.strike,
        label: fmtPrice(point.strike, point.strike > 1000 ? 0 : 2),
        value: point[field],
      }));
  }, [exposure, metric, snapshot?.spot, spotBand]);

  const expiryRows = useMemo(() => snapshot ? dealerExposureByExpiry(snapshot, { weight }) : [], [snapshot, weight]);

  const oiByStrike = useMemo(() => {
    if (!snapshot) return [];
    const byK = new Map<number, { callOi: number; putOi: number }>();
    for (const slice of snapshot.expiries) {
      if (selectedExpiry && slice.expiry !== selectedExpiry) continue;
      for (const q of slice.calls) {
        const row = byK.get(q.strike) ?? { callOi: 0, putOi: 0 };
        row.callOi += q.openInterest; byK.set(q.strike, row);
      }
      for (const q of slice.puts) {
        const row = byK.get(q.strike) ?? { callOi: 0, putOi: 0 };
        row.putOi += q.openInterest; byK.set(q.strike, row);
      }
    }
    const field = PROFILE_FIELD[metric];
    const valueByK = new Map<number, number>((exposure?.points ?? []).map((p) => [p.strike, p[field]]));
    return [...byK.entries()]
      .filter(([strike]) => Math.abs(strike - snapshot.spot) / snapshot.spot <= (spotBand || 1))
      .map(([strike, row]) => ({ strike, callOi: row.callOi, putOi: row.putOi, netOi: row.callOi - row.putOi, exposure: valueByK.get(strike) ?? 0 }))
      .sort((a, b) => Math.abs(a.strike - snapshot.spot) - Math.abs(b.strike - snapshot.spot))
      .slice(0, 26)
      .sort((a, b) => b.strike - a.strike);
  }, [exposure, metric, selectedExpiry, snapshot, spotBand]);

  const selectedMetric = METRICS.find((item) => item.id === metric)!;
  const focusCell = hovered ?? selected;

  // Per-strike dominant expiry = the matrix cell with the largest |exposure|.
  const dominantCellByStrike = useMemo(() => {
    const map = new Map<number, HeatmapCell>();
    for (const cell of matrix.flat()) {
      const current = map.get(cell.strike);
      if (!current || Math.abs(cell.value ?? 0) > Math.abs(current.value ?? 0)) map.set(cell.strike, cell);
    }
    return map;
  }, [matrix]);
  const total = exposure ? exposure.points.reduce((sum, point) => sum + point[PROFILE_FIELD[metric]], 0) : 0;
  const strongest = profile.reduce<(typeof profile)[number] | null>((best, row) => !best || Math.abs(row.value) > Math.abs(best.value) ? row : best, null);

  const pickCell = useCallback((cell: HeatmapCell | null) => {
    setSelected(cell);
    setSelectedExpiry(cell?.expiry ?? null);
  }, []);

  if (!snapshot) {
    return (
      <Panel title="Crypto Greek Heatmap" apis={['Deribit']} className="h-full">
        <EmptyState kind="loading" title="Loading Greek exposure grid…" body="The heatmap requires the active BTC or ETH options chain." />
      </Panel>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#030506]">
      <CryptoPageHeader
        title="Greek Exposure"
        highlight="Heatmap"
        description={`Strike × expiry dealer exposure where pressure concentrates · ${symbol === 'ETH' ? 'ETH' : 'BTC'} · ` + (grid?.unitNote ?? 'OI-weighted')}
        actions={
          <div className="flex items-center gap-1">
            {METRICS.map((item) => (
              <button key={item.id} type="button" onClick={() => { setMetric(item.id); setSelected(null); }} aria-pressed={metric === item.id} title={item.note} className={cn('min-h-7 border px-2 font-mono text-[10px]', metric === item.id ? 'border-[#25d7c5] bg-[#25d7c5]/10 text-[#7ee9db]' : 'border-[#2c3337] text-[#8b999f]')}>{item.symbol} {item.id.toUpperCase()}</button>
            ))}
          </div>
        }
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#20282b] bg-[#0a0d0e] px-3 py-1.5">
        <span className="font-mono text-type-2xs uppercase text-muted-foreground">Weight</span>
        {(['oi', 'volume', 'unit'] as ExposureWeight[]).map((item) => (
          <button key={item} type="button" onClick={() => setWeight(item)} aria-pressed={weight === item} className={cn('min-h-6 border px-2 font-mono text-[10px] uppercase', weight === item ? 'border-[#25d7c5] text-[#7ee9db]' : 'border-[#2c3337] text-[#8b999f] hover:text-white')}>{item}</button>
        ))}
        <span className="ml-2 font-mono text-type-2xs uppercase text-muted-foreground">Strike Range</span>
        {([0.1, 0.2, 0.35] as const).map((band) => (
          <button key={band} type="button" onClick={() => setSpotBand(band)} aria-pressed={spotBand === band} className={cn('min-h-6 border px-2 font-mono text-[10px]', spotBand === band ? 'border-[#25d7c5] text-[#25d7c5]' : 'border-[#2c3337] text-[#8b999f] hover:text-white')}>±{Math.round(band * 100)}%</button>
        ))}
        {selectedExpiry && <button type="button" onClick={() => { setSelectedExpiry(null); setSelected(null); }} className="ml-auto min-h-6 border border-warn/50 px-2 font-mono text-type-2xs text-warn">CLEAR {selected?.dte}D FILTER ×</button>}
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-px border-b border-[#20282b] bg-[#20282b] sm:grid-cols-3 xl:grid-cols-6">
        <div className="bg-card p-1"><Stat label={selectedMetric.label} value={fmtCompact(total)} detail={selectedExpiry ? `${selected?.dte}d isolated` : 'All expiries'} tone={signedTone(total)} /></div>
        <div className="bg-card p-1"><Stat label="Strongest Node" value={strongest ? `K ${strongest.label}` : '—'} detail={strongest ? fmtCompact(strongest.value) : undefined} tone={strongest ? signedTone(strongest.value) : undefined} /></div>
        <div className="bg-card p-1"><Stat label="Gamma Flip" value={exposure?.gammaFlip != null ? fmtPrice(exposure.gammaFlip, 0) : '—'} detail="Cumulative zero-cross" /></div>
        <div className="bg-card p-1"><Stat label="Call Wall" value={exposure?.callWall != null ? fmtPrice(exposure.callWall, 0) : '—'} detail="Largest +Γ node" tone="text-up" /></div>
        <div className="bg-card p-1"><Stat label="Put Wall" value={exposure?.putWall != null ? fmtPrice(exposure.putWall, 0) : '—'} detail="Largest −Γ node" tone="text-down" /></div>
        <div className="bg-card p-1"><Stat label="Selected Cell" value={focusCell?.value != null ? fmtCompact(focusCell.value) : 'Hover grid'} detail={focusCell ? `${focusCell.dte}d · K ${fmtPrice(focusCell.strike, 0)}` : selectedMetric.note} tone={focusCell?.value != null ? signedTone(focusCell.value) : undefined} /></div>
      </div>

      <div className="grid min-h-0 flex-1 gap-1 p-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.8fr)]">
        <Panel title={`${selectedMetric.symbol} ${selectedMetric.label} Heatmap`} subtitle={`${grid?.rows.length ?? 0} expiries × ${grid?.strikes.length ?? 0} strikes`} className="min-h-[360px]">
          {grid && grid.rows.length && grid.strikes.length ? (
            <div className="h-full min-h-[340px] p-1">
              <CanvasHeatmap
                rows={grid.rows}
                cols={grid.strikes}
                cellMatrix={matrix}
                min={grid.min}
                max={grid.max}
                diverging
                onCellHover={setHovered}
                onCellClick={pickCell}
                selectedCell={selected}
              />
            </div>
          ) : <EmptyState kind="no-data" title="No exposure grid" body="Try OI, volume, or a wider strike range." />}
        </Panel>

        <div className="grid min-h-0 grid-rows-[minmax(260px,1fr)_minmax(180px,0.65fr)] gap-1">
          <Panel title={`${selectedMetric.symbol} Strike Profile`} subtitle={selectedExpiry ? `${selected?.dte}d expiry` : 'All expiries'}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={profile} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="label" interval={Math.max(1, Math.floor(profile.length / 8))} tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
                <YAxis width={46} tickFormatter={(v: number) => fmtCompact(v)} tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [fmtCompact(v), selectedMetric.label]} />
                <ReferenceLine y={0} stroke="var(--muted-foreground)" />
                <ReferenceLine x={fmtPrice(snapshot.spot, snapshot.spot > 1000 ? 0 : 2)} stroke="var(--primary)" strokeDasharray="3 3" />
                <Bar dataKey="value" isAnimationActive={false}>{profile.map((row) => <Cell key={row.strike} fill={row.value >= 0 ? 'var(--up)' : 'var(--down)'} opacity={0.85} />)}</Bar>
                <Line dataKey="value" stroke="var(--foreground)" dot={false} opacity={0.25} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Expiry Concentration" subtitle="Click a row to isolate the profile">
            <div className="h-full overflow-auto">
              <table className="w-full border-collapse font-mono text-type-2xs">
                <thead className="sticky top-0 bg-card text-muted-foreground"><tr><th className="px-2 py-1 text-left">DTE</th><th className="px-2 py-1 text-right">GEX</th><th className="px-2 py-1 text-right">DEX</th><th className="px-2 py-1 text-right">Move</th></tr></thead>
                <tbody>{expiryRows.map((row) => (
                  <tr key={row.expiry} onClick={() => setSelectedExpiry(row.expiry)} className={cn('cursor-pointer border-t border-border/50 hover:bg-secondary/40', selectedExpiry === row.expiry && 'bg-primary/10')}>
                    <td className="px-2 py-1 text-foreground">{row.dte}d</td>
                    <td className={cn('px-2 py-1 text-right tabular-nums', signedTone(row.totalGEX))}>{fmtCompact(row.totalGEX)}</td>
                    <td className={cn('px-2 py-1 text-right tabular-nums', signedTone(row.totalDEX))}>{fmtCompact(row.totalDEX)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{row.expMove != null ? fmtPct(row.expMove / snapshot.spot) : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="Per-Strike Exposure" subtitle="Open interest and selected exposure by strike · click a row to focus its dominant expiry" className="mt-1">
        <div className="h-full max-h-[260px] overflow-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead className="sticky top-0 z-10 bg-[#0a0d0e] text-[#8b999f]"><tr>
              <th className="px-2 py-1.5 text-left">Strike</th>
              <th className="px-2 py-1.5 text-right">VS Spot</th>
              <th className="px-2 py-1.5 text-right">Call OI</th>
              <th className="px-2 py-1.5 text-right">Put OI</th>
              <th className="px-2 py-1.5 text-right">Net OI</th>
              <th className="px-2 py-1.5 text-right">{selectedMetric.label}</th>
            </tr></thead>
            <tbody>{oiByStrike.map((row) => {
              const vsSpot = row.strike / snapshot.spot - 1;
              return (
                <tr key={row.strike} onClick={() => { const cell = dominantCellByStrike.get(row.strike) ?? { strike: row.strike, dte: 0, expiry: '', value: row.exposure }; pickCell(cell); }} className={cn('border-t border-[#1a1f22]', Math.abs(row.strike - snapshot.spot) / snapshot.spot < 0.02 && 'bg-[#0c1012]')}>
                  <td className="px-2 py-1 text-foreground font-bold">${fmtPrice(row.strike, row.strike > 1000 ? 0 : 1)}</td>
                  <td className={cn('px-2 py-1 text-right tabular-nums', vsSpot >= 0 ? 'text-[#37c990]' : 'text-[#e25c5c]')}>{vsSpot >= 0 ? '+' : ''}{(vsSpot * 100).toFixed(1)}%</td>
                  <td className="px-2 py-1 text-right tabular-nums">{row.callOi.toLocaleString()}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{row.putOi.toLocaleString()}</td>
                  <td className={cn('px-2 py-1 text-right tabular-nums', row.netOi >= 0 ? 'text-[#37c990]' : 'text-[#e25c5c]')}>{row.netOi >= 0 ? '+' : ''}{row.netOi.toLocaleString()}</td>
                  <td className={cn('px-2 py-1 text-right tabular-nums', signedTone(row.exposure))}>{fmtCompact(row.exposure)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </Panel>

      <footer className="shrink-0 border-t border-[#20282b] px-3 py-1.5 font-mono text-[10px] text-[#76848a]">
        {grid?.unitNote ?? 'Exposure unavailable'} · OI-inferred dealer convention, not proprietary inventory or executed flow.
      </footer>
    </div>
  );
}
