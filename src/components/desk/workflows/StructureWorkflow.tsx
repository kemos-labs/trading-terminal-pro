/**
 * Trade · Structure workflow — canonical consolidated workspace.
 * Subsumes legacy ComboGreeksTool + GridTool + SimTool presentation shells.
 * Engines come from src/lib/options (portfolio, optionGrid, pathSim) — the
 * view adds shared controls and provenance labels only.
 */
import { useMemo, useState } from 'react';
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useTerminalStore } from '../../../store/terminalStore';
import {
  comboGreeksProfile, evaluateCombo, spotGrid, templateLegs, type PortfolioLeg,
} from '../../../lib/options/portfolio';
import { analyzeComboBreakEven } from '../../../lib/options/breakEven';
import { buildOptionGrid } from '../../../lib/options/optionGrid';
import { simulatePaths } from '../../../lib/options/pathSim';
import { fmtCompact, fmtPct, fmtPrice, fmtSigned } from '../../../lib/format';
import { cn } from '../../../lib/utils';
import { DeskToolShell } from '../DeskToolShell';
import { DeskField, DeskSelect } from '../DeskField';
import { PrintStrip } from '../PrintStrip';
import { DeskChartFrame, deskChartChrome, deskAxisLabel } from '../DeskChart';
import { DESK_SERIES } from '../seriesGrammar';
import { CHART_GREEK, chartDayTick, chartPriceTick, chartSignedTick, tightDomain } from '../../../lib/chartTheme';

type ComboTemplate = 'long_straddle' | 'short_straddle' | 'risk_reversal' | 'call_spread' | 'long_call';
type GridMetric = 'omega' | 'invNd2' | 'nd2';

export function StructureWorkflow() {
  const snapshot = useTerminalStore((s) => s.snapshot)!;
  // Shared structure controls (one combo spec drives PnL profile, BEs, scenario sim).
  const [template, setTemplate] = useState<ComboTemplate>('short_straddle');
  const [expiryIdx, setExpiryIdx] = useState(0);

  const legs: PortfolioLeg[] = useMemo(
    () => templateLegs(template, snapshot, expiryIdx),
    [template, snapshot, expiryIdx],
  );
  const mark = useMemo(() => evaluateCombo(legs, snapshot), [legs, snapshot]);
  const profile = useMemo(() => {
    const spots = spotGrid(snapshot.spot, 0.15, 61);
    return comboGreeksProfile(legs, snapshot, spots);
  }, [legs, snapshot]);
  const be = useMemo(() => analyzeComboBreakEven(legs, snapshot.spot), [legs, snapshot]);

  // Leverage grid (independent selector).
  const [gridType, setGridType] = useState<'call' | 'put'>('call');
  const [metric, setMetric] = useState<GridMetric>('omega');
  const grid = useMemo(() => buildOptionGrid(snapshot, gridType, 6), [snapshot, gridType]);

  // Scenario simulator (shared template/expiry; independent drift/vol/horizon).
  const [drift, setDrift] = useState(0);
  const [vol, setVol] = useState(snapshot.expiries[expiryIdx]?.atmIV ?? 0.25);
  const [days, setDays] = useState(21);
  const sim = useMemo(
    () => simulatePaths(legs, snapshot, { drift, vol, days, steps: 40, paths: 200, seed: 99 }),
    [legs, snapshot, drift, vol, days],
  );
  const simChart = sim.available ? sim.t.map((t, i) => ({
    t, p5: sim.pnlBands.p5[i], p25: sim.pnlBands.p25[i], p50: sim.pnlBands.p50[i],
    p75: sim.pnlBands.p75[i], p95: sim.pnlBands.p95[i],
  })) : [];
  const simLast = simChart.length - 1;

  const gridValues = grid.cells.flatMap((row) =>
    row.map((c) => c[metric]).filter((v): v is number => v != null && isFinite(v)),
  );
  const gridMaxAbs = Math.max(...gridValues.map(Math.abs), 1e-9);
  const nearestKi = useMemo(() => {
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < grid.strikes.length; i++) {
      const d = Math.abs(grid.strikes[i]! - snapshot.spot);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }, [grid.strikes, snapshot.spot]);

  const chrome = deskChartChrome();
  const pnlDomain = tightDomain(profile.map((r) => r.pnl), 0.08, { includeZero: true });
  const greekDomain = tightDomain(profile.flatMap((r) => [r.delta, r.vega, r.gamma]), 0.08, { includeZero: true });
  const simDomain = tightDomain(simChart.flatMap((r) => [r.p5, r.p95]), 0.08, { includeZero: true });

  return (
    <div data-testid="trade-structure-workflow" className="flex flex-col gap-2 p-1">
      {/* SECTION A — combo structure profile */}
      <DeskToolShell
        controls={
          <>
            <DeskSelect label="Template" value={template} onChange={setTemplate} options={[
              { value: 'short_straddle', label: 'Short straddle (MM)' },
              { value: 'long_straddle', label: 'Long straddle' },
              { value: 'risk_reversal', label: 'Risk reversal' },
              { value: 'call_spread', label: 'Call spread' },
              { value: 'long_call', label: 'Long call' },
            ]} />
            <DeskSelect label="Expiry" value={String(expiryIdx)} onChange={(v) => setExpiryIdx(+v)} options={snapshot.expiries.map((e, i) => ({ value: String(i), label: `${e.expiry} (${e.dte}d)` }))} />
          </>
        }
        print={
          <PrintStrip items={[
            { label: 'Mark', value: mark.mark != null ? fmtSigned(mark.mark) : '—' },
            { label: 'PnL', value: mark.pnl != null ? fmtSigned(mark.pnl) : '—', tone: mark.pnl != null && mark.pnl >= 0 ? 'up' : 'down' },
            { label: 'Δ', value: fmtSigned(mark.greeks.delta, 3), title: 'delta' },
            { label: 'Γ', value: fmtCompact(mark.greeks.gamma), title: 'gamma' },
            { label: 'ν', value: fmtSigned(mark.greeks.vega, 2), title: 'vega' },
            { label: 'Θ', value: fmtSigned(mark.greeks.theta, 2), title: 'theta' },
            { label: 'BEs', value: be.breakEvens.map((x) => fmtPrice(x, 0)).join(' · ') || '—' },
          ]} />
        }
        bodyClassName="grid grid-cols-1 md:grid-cols-2 gap-1 min-h-0"
      >
        <DeskChartFrame xTitle="Spot" yTitle="PnL ($)" className="min-h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={profile} margin={chrome.margin}>
              <CartesianGrid {...chrome.grid} />
              <XAxis dataKey="spot" tick={chrome.tick} stroke={chrome.axisLine} tickFormatter={(v: number) => chartPriceTick(v)} label={deskAxisLabel('Spot')} />
              <YAxis tick={chrome.tick} stroke={chrome.axisLine} width={52} domain={pnlDomain} tickFormatter={(v: number) => chartSignedTick(v, 0)} label={deskAxisLabel('PnL ($)', 'insideLeft')} />
              <Tooltip contentStyle={chrome.tooltipStyle} />
              <ReferenceLine y={0} stroke={DESK_SERIES.zero} />
              <ReferenceLine x={snapshot.spot} stroke={DESK_SERIES.spot} strokeDasharray="3 3" />
              <Area type="monotone" dataKey="pnl" stroke={DESK_SERIES.combo} fill={DESK_SERIES.combo} fillOpacity={0.2} name="PnL" />
            </ComposedChart>
          </ResponsiveContainer>
        </DeskChartFrame>
        <DeskChartFrame xTitle="Spot" yTitle="Greeks" className="min-h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={profile} margin={chrome.margin}>
              <CartesianGrid {...chrome.grid} />
              <XAxis dataKey="spot" tick={chrome.tick} stroke={chrome.axisLine} tickFormatter={(v: number) => chartPriceTick(v)} label={deskAxisLabel('Spot')} />
              <YAxis tick={chrome.tick} stroke={chrome.axisLine} width={52} domain={greekDomain} tickFormatter={(v: number) => chartSignedTick(v, 2)} label={deskAxisLabel('Greeks', 'insideLeft')} />
              <Tooltip contentStyle={chrome.tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'var(--font-mono), monospace' }} />
              <ReferenceLine x={snapshot.spot} stroke={DESK_SERIES.spot} strokeDasharray="3 3" />
              <Line type="monotone" dataKey="delta" stroke={CHART_GREEK.delta} strokeWidth={1.5} dot={false} name="Delta" />
              <Line type="monotone" dataKey="vega" stroke={CHART_GREEK.vega} strokeWidth={1.5} dot={false} name="Vega" />
              <Line type="monotone" dataKey="gamma" stroke={CHART_GREEK.gamma} strokeWidth={1} dot={false} name="Gamma" />
            </LineChart>
          </ResponsiveContainer>
        </DeskChartFrame>
      </DeskToolShell>

      {/* SECTION B — leverage grid */}
      <DeskToolShell
        controls={
          <>
            <DeskSelect label="Type" value={gridType} onChange={setGridType} options={[{ value: 'call', label: 'Calls' }, { value: 'put', label: 'Puts' }]} />
            <DeskSelect label="Metric" value={metric} onChange={setMetric} options={[
              { value: 'omega', label: 'Ω leverage' },
              { value: 'nd2', label: 'N(d2)' },
              { value: 'invNd2', label: '1/N(d2)' },
            ]} />
          </>
        }
        print={<PrintStrip items={[
          { label: 'Strikes', value: String(grid.strikes.length) },
          { label: 'Expiries', value: String(grid.expiries.length) },
          { label: 'Spot', value: fmtPrice(snapshot.spot, snapshot.spot > 1000 ? 0 : 2) },
        ]} />}
        bodyClassName="min-h-0 overflow-auto rounded border border-border bg-card"
      >
        <div className="h-full overflow-auto bg-black/40">
          <table className="border-collapse font-mono text-type-xs">
            <thead className="sticky top-0 z-10 bg-card">
              <tr>
                <th className="sticky left-0 z-20 bg-card px-1 py-1 text-left text-muted-foreground">K \ T</th>
                {grid.dtes.map((d, i) => (
                  <th key={grid.expiries[i]} className="px-1 py-1 font-normal text-muted-foreground">{d}d</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.strikes.map((K, ki) => {
                const nearSpot = ki === nearestKi;
                return (
                  <tr key={K} className={cn(nearSpot && 'border-l-2 border-l-amber-500 bg-amber-500/10')}>
                    <td className={cn('sticky left-0 z-[1] px-1 py-0.5 text-muted-foreground', nearSpot ? 'bg-amber-500/10' : 'bg-card')}>
                      {fmtPrice(K, K > 1000 ? 0 : 1)}
                    </td>
                    {grid.cells.map((row, ei) => {
                      const cell = row[ki];
                      const v = cell?.[metric] ?? null;
                      const intensity = v != null ? Math.min(1, Math.abs(v) / gridMaxAbs) : 0;
                      const nearZero = v == null || intensity < 0.08;
                      const tone = nearZero ? 'text-muted-foreground' : v! > 0 ? 'text-up' : 'text-down';
                      return (
                        <td key={ei} className={cn('px-1 py-0.5 text-right tabular-nums', tone)}>
                          {v == null ? '·' : metric === 'nd2' ? (v * 100).toFixed(0) : v.toFixed(1)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DeskToolShell>

      {/* SECTION C — scenario simulator */}
      <DeskToolShell
        controls={
          <>
            <DeskSelect label="Structure" value={template} onChange={setTemplate} options={[
              { value: 'short_straddle', label: 'Short straddle' },
              { value: 'long_straddle', label: 'Long straddle' },
              { value: 'long_call', label: 'Long call' },
            ]} />
            <DeskField label="Drift μ" value={drift} onChange={setDrift} step={0.01} />
            <DeskField label="Realized σ" value={vol} onChange={setVol} step={0.01} />
            <DeskField label="Horizon d" value={days} onChange={setDays} step={1} min={1} />
          </>
        }
        print={<PrintStrip items={[
          { label: 'E[PnL]', value: sim.meanTerminalPnl != null ? fmtSigned(sim.meanTerminalPnl) : '—', tone: sim.meanTerminalPnl != null && sim.meanTerminalPnl >= 0 ? 'up' : 'down' },
          { label: 'Win', value: sim.winRate != null ? fmtPct(sim.winRate) : '—' },
          { label: 'p5 term', value: sim.pnlBands.p5[simLast] != null ? fmtSigned(sim.pnlBands.p5[simLast]!) : '—', tone: 'down' },
          { label: 'p95 term', value: sim.pnlBands.p95[simLast] != null ? fmtSigned(sim.pnlBands.p95[simLast]!) : '—', tone: 'up' },
        ]} />}
      >
        <DeskChartFrame
          xTitle="Horizon (days)" yTitle="PnL ($)" className="min-h-[220px]"
          header={<span className="text-muted-foreground">Scenario GBM — μ,σ user-set · not historical backtest</span>}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={simChart} margin={chrome.margin}>
              <CartesianGrid {...chrome.grid} />
              <XAxis dataKey="t" tick={chrome.tick} stroke={chrome.axisLine} tickFormatter={(v: number) => chartDayTick(v)} label={deskAxisLabel('Days')} />
              <YAxis tick={chrome.tick} stroke={chrome.axisLine} width={52} domain={simDomain} tickFormatter={(v: number) => chartSignedTick(v, 0)} label={deskAxisLabel('PnL ($)', 'insideLeft')} />
              <Tooltip contentStyle={chrome.tooltipStyle} />
              <ReferenceLine y={0} stroke={DESK_SERIES.zero} />
              <Area type="monotone" dataKey="p95" stroke="none" fill={DESK_SERIES.bandOuter} fillOpacity={0.12} />
              <Area type="monotone" dataKey="p5" stroke="none" fill="#000" fillOpacity={1} />
              <Area type="monotone" dataKey="p75" stroke="none" fill={DESK_SERIES.bandInner} fillOpacity={0.18} />
              <Area type="monotone" dataKey="p25" stroke="none" fill="#000" fillOpacity={1} />
              <Line type="monotone" dataKey="p50" stroke={DESK_SERIES.median} strokeWidth={2} dot={false} name="p50" />
            </ComposedChart>
          </ResponsiveContainer>
        </DeskChartFrame>
      </DeskToolShell>
    </div>
  );
}
