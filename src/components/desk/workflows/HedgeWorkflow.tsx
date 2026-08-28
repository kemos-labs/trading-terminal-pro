/**
 * Trade · Hedge / Risk workflow — canonical consolidated workspace.
 * Subsumes legacy HedgeTool + DFollowTool + BasisTool + RollTool presentation
 * shells; all engines from src/lib/options (hedging, basis).
 */
import { useMemo, useState } from 'react';
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useTerminalStore } from '../../../store/terminalStore';
import {
  defaultHedgeFromSnapshot, simulateDeltaHedge, type HedgeMode,
} from '../../../lib/options/hedging';
import { buildBasisCurve, isCryptoSymbol, rollPnlHeatmap } from '../../../lib/options/basis';
import { fmtPct, fmtPrice, fmtSigned } from '../../../lib/format';
import { cn } from '../../../lib/utils';
import { DeskToolShell } from '../DeskToolShell';
import { DeskField, DeskSelect } from '../DeskField';
import { PrintStrip } from '../PrintStrip';
import { DeskChartFrame, deskChartChrome, deskAxisLabel } from '../DeskChart';
import { DESK_LEGEND, DESK_SERIES } from '../seriesGrammar';
import { CHART_GREEK, chartDayTick, chartPctTick, chartSignedTick, tightDomain } from '../../../lib/chartTheme';

export function HedgeWorkflow() {
  const snapshot = useTerminalStore((s) => s.snapshot)!;
  const fundingAnn = useTerminalStore((s) => s.fundingAnn);
  const chrome = deskChartChrome();
  const defaults = useMemo(() => defaultHedgeFromSnapshot(snapshot), [snapshot]);

  // ── A: Δ-hedge simulator ───────────────────────────────────────────
  const [mode, setMode] = useState<HedgeMode>('threshold');
  const [threshold, setThreshold] = useState(0.1);
  const [tolerance, setTolerance] = useState(0.05);
  const [period, setPeriod] = useState(5);
  const [rv, setRv] = useState(defaults.realizedVol ?? 0.25);
  const [qty, setQty] = useState(-1);
  const hedgeResult = useMemo(() => {
    if (!defaults.strike || !defaults.T || !defaults.vol) return null;
    return simulateDeltaHedge({
      mode, threshold, tolerance, periodSteps: period,
      type: defaults.type ?? 'call', strike: defaults.strike, T: defaults.T, vol: defaults.vol,
      realizedVol: rv, drift: 0, days: defaults.days ?? 21, steps: defaults.steps ?? 60,
      optionQty: qty, hedgeInstrument: 'spot', r: snapshot.riskFreeRate, q: snapshot.dividendYield, seed: 19,
    }, snapshot.spot);
  }, [snapshot, defaults, mode, threshold, tolerance, period, rv, qty]);
  const hedgeChart = hedgeResult?.steps.map((s) => ({ t: s.tDay, pnl: s.totalPnl, netDelta: s.netDelta })) ?? [];
  const hedgePnlDomain = tightDomain(hedgeChart.map((r) => r.pnl), 0.08, { includeZero: true });
  const hedgeDeltaDomain = tightDomain(hedgeChart.map((r) => r.netDelta), 0.08, { includeZero: true });

  // ── B: Δ-follower (tolerance-band hedging on futures) ──────────────
  const [band, setBand] = useState(0.05);
  const [fQty, setFQty] = useState(1);
  const [fRv, setFRv] = useState(defaults.realizedVol ?? 0.25);
  const followResult = useMemo(() => {
    if (!defaults.strike || !defaults.T || !defaults.vol) return null;
    return simulateDeltaHedge({
      mode: 'tolerance', threshold: band, tolerance: band, periodSteps: 1,
      type: 'call', strike: defaults.strike, T: defaults.T, vol: defaults.vol,
      realizedVol: fRv, drift: 0, days: defaults.days ?? 21, steps: 80,
      optionQty: fQty, hedgeInstrument: 'future', r: snapshot.riskFreeRate, q: snapshot.dividendYield, seed: 33,
    }, snapshot.spot);
  }, [snapshot, defaults, band, fQty, fRv]);
  const followChart = followResult?.steps.map((s) => ({ t: s.tDay, pnl: s.totalPnl, netDelta: s.netDelta })) ?? [];
  const followPnlDomain = tightDomain(followChart.map((r) => r.pnl), 0.08, { includeZero: true });
  const followDeltaDomain = tightDomain(followChart.map((r) => r.netDelta), 0.08, { includeZero: true });

  // ── C: forward basis & carry ───────────────────────────────────────
  const liveFunding = fundingAnn ?? snapshot.fundingAnn ?? null;
  const basisCurve = useMemo(() => buildBasisCurve(snapshot, { fundingAnn: liveFunding }), [snapshot, liveFunding]);
  const basisChart = useMemo(() => basisCurve.points.map((p) => ({
    dte: p.dte, basisPct: (p.basis / basisCurve.spot) * 100, carry: p.annCarry * 100, forward: p.forward, source: p.source,
  })), [basisCurve]);
  const mktN = basisCurve.points.filter((p) => p.source === 'market').length;
  const frontBasis = basisChart[0]?.basisPct;

  // ── D: roll / funding PnL heatmap ──────────────────────────────────
  const equityCarry = snapshot.riskFreeRate - snapshot.dividendYield;
  const carryAnn = liveFunding ?? equityCarry;
  const roll = useMemo(() => rollPnlHeatmap(snapshot, { fundingAnn: carryAnn }), [snapshot, carryAnn]);
  const rollMaxAbs = useMemo(() => {
    let m = 1e-9;
    for (const row of roll.pnl) for (const v of row) m = Math.max(m, Math.abs(v));
    return m;
  }, [roll.pnl]);

  return (
    <div data-testid="trade-hedge-workflow" className="flex flex-col gap-2 p-1">
      {/* A — Δ-hedge */}
      <DeskToolShell
        controls={<>
          <DeskSelect label="Mode" value={mode} onChange={setMode} options={[
            { value: 'threshold', label: 'Threshold' }, { value: 'tolerance', label: 'Tolerance band' }, { value: 'period', label: 'Period' },
          ]} />
          {mode === 'threshold' && <DeskField label="|Δ| trigger" value={threshold} onChange={setThreshold} step={0.01} />}
          {mode === 'tolerance' && <DeskField label="Band" value={tolerance} onChange={setTolerance} step={0.01} />}
          {mode === 'period' && <DeskField label="Every N steps" value={period} onChange={setPeriod} step={1} min={1} />}
          <DeskField label="Path vol scenario — initialized from ATM IV" value={rv} onChange={setRv} step={0.01} />
          <DeskField label="Opt qty (− short)" value={qty} onChange={setQty} step={1} />
        </>}
        print={<PrintStrip items={hedgeResult ? [
          { label: 'Terminal PnL', value: fmtSigned(hedgeResult.terminalPnl), tone: hedgeResult.terminalPnl >= 0 ? 'up' : 'down', title: 'hedgePnl' },
          { label: 'Trades', value: String(hedgeResult.tradeCount) },
          { label: 'Max DD', value: fmtSigned(hedgeResult.maxDrawdown), tone: 'down' },
          { label: 'Avg |Δ|', value: hedgeResult.avgAbsNetDelta.toFixed(3) },
          { label: 'Strike', value: defaults.strike != null ? fmtPrice(defaults.strike) : '—' },
          { label: 'Path vol scenario', value: `${(rv*100).toFixed(1)}% · initialized from ATM IV`, tone: 'muted' as const },
        ] : [{ label: 'Terminal PnL', value: '—', tone: 'muted' as const }]} />}
      >
        <DeskChartFrame xTitle="Day" yTitle="PnL ($) · Net Δ" className="min-h-[220px]" header={<span className="text-muted-foreground">Δ-hedge — spot hedge instrument · implied-vol scenario (seed 19) — not realized vol</span>}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={hedgeChart} margin={{ ...chrome.margin, right: 28 }}>
              <CartesianGrid {...chrome.grid} />
              <XAxis dataKey="t" tick={chrome.tick} stroke={chrome.axisLine} tickFormatter={(v: number) => chartDayTick(v)} label={deskAxisLabel('Day')} />
              <YAxis yAxisId="pnl" tick={chrome.tick} stroke={chrome.axisLine} width={52} domain={hedgePnlDomain} tickFormatter={(v: number) => chartSignedTick(v, 0)} label={deskAxisLabel('PnL ($)', 'insideLeft')} />
              <YAxis yAxisId="d" orientation="right" tick={chrome.tick} stroke={chrome.axisLine} width={44} domain={hedgeDeltaDomain} tickFormatter={(v: number) => chartSignedTick(v, 2)} label={deskAxisLabel('Net Δ', 'insideRight')} />
              <Tooltip contentStyle={chrome.tooltipStyle} />
              <ReferenceLine yAxisId="pnl" y={0} stroke={DESK_SERIES.zero} />
              <Area yAxisId="pnl" type="monotone" dataKey="pnl" stroke={DESK_SERIES.median} fill={DESK_SERIES.median} fillOpacity={0.15} name={DESK_LEGEND.pnl} />
              <Line yAxisId="d" type="monotone" dataKey="netDelta" stroke={CHART_GREEK.delta} strokeWidth={1.5} dot={false} name={DESK_LEGEND.netDelta} />
            </ComposedChart>
          </ResponsiveContainer>
        </DeskChartFrame>
      </DeskToolShell>

      {/* B — Δ-follower */}
      <DeskToolShell
        controls={<>
          <DeskField label="Band" value={band} onChange={setBand} step={0.01} />
          <DeskField label="Option qty" value={fQty} onChange={setFQty} step={1} />
          <DeskField label="Path vol scenario — initialized from ATM IV" value={fRv} onChange={setFRv} step={0.01} />
        </>}
        print={<PrintStrip items={followResult ? [
          { label: 'Terminal PnL', value: fmtSigned(followResult.terminalPnl), tone: followResult.terminalPnl >= 0 ? 'up' : 'down' },
          { label: 'Trades', value: String(followResult.tradeCount) },
          { label: 'Max DD', value: fmtSigned(followResult.maxDrawdown), tone: 'down' },
          { label: 'Avg |Δ|', value: followResult.avgAbsNetDelta.toFixed(3) },
          { label: 'Path vol scenario', value: `${(fRv*100).toFixed(1)}% · initialized from ATM IV`, tone: 'muted' as const },
        ] : [{ label: 'Terminal PnL', value: '—', tone: 'muted' as const }]} />}
      >
        <DeskChartFrame xTitle="Day" yTitle="PnL ($) · Net Δ" className="min-h-[220px]" header={<span className="text-muted-foreground">Δ-follower — futures hedge · tolerance band (seed 33) · implied-vol scenario</span>}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={followChart} margin={{ ...chrome.margin, right: 28 }}>
              <CartesianGrid {...chrome.grid} />
              <XAxis dataKey="t" tick={chrome.tick} stroke={chrome.axisLine} tickFormatter={(v: number) => chartDayTick(v)} label={deskAxisLabel('Day')} />
              <YAxis yAxisId="pnl" tick={chrome.tick} stroke={chrome.axisLine} width={52} domain={followPnlDomain} tickFormatter={(v: number) => chartSignedTick(v, 0)} label={deskAxisLabel('PnL ($)', 'insideLeft')} />
              <YAxis yAxisId="d" orientation="right" tick={chrome.tick} stroke={chrome.axisLine} width={44} domain={followDeltaDomain} tickFormatter={(v: number) => chartSignedTick(v, 2)} label={deskAxisLabel('Net Δ', 'insideRight')} />
              <Tooltip contentStyle={chrome.tooltipStyle} />
              <ReferenceLine yAxisId="pnl" y={0} stroke={DESK_SERIES.zero} />
              <Area yAxisId="pnl" type="monotone" dataKey="pnl" stroke={DESK_SERIES.median} fill={DESK_SERIES.median} fillOpacity={0.15} name={DESK_LEGEND.pnl} />
              <Line yAxisId="d" type="monotone" dataKey="netDelta" stroke={CHART_GREEK.delta} strokeWidth={1.5} dot={false} name={DESK_LEGEND.netDelta} />
            </ComposedChart>
          </ResponsiveContainer>
        </DeskChartFrame>
      </DeskToolShell>

      {/* C — forward basis */}
      <DeskToolShell
        print={<PrintStrip items={[
          { label: 'Spot', value: fmtPrice(snapshot.spot, snapshot.spot > 1000 ? 1 : 2) },
          { label: 'r', value: fmtPct(basisCurve.r) },
          { label: 'q_eff', value: fmtPct(basisCurve.q) },
          ...(liveFunding != null ? [{ label: 'Funding ann', value: fmtPct(liveFunding), tone: (liveFunding >= 0 ? ('up' as const) : ('down' as const)) }] : []),
          ...(basisCurve.perp ? [{ label: 'Perp mark', value: `${fmtPrice(basisCurve.perp.mark, basisCurve.perp.mark > 1000 ? 0 : 2)} (${fmtSigned(basisCurve.perp.basis)})` }] : []),
          { label: 'Front basis', value: frontBasis != null ? `${frontBasis.toFixed(3)}%` : '—', tone: frontBasis == null ? ('muted' as const) : frontBasis >= 0 ? ('up' as const) : ('down' as const) },
          { label: 'Marks', value: basisCurve.hasMarketMarks ? `mkt ${mktN}` : 'theo' },
          { label: 'Model', value: basisCurve.hasMarketMarks ? 'Live F − S' : isCryptoSymbol(snapshot.symbol) ? 'F=S·e^(r+f)T' : 'F=S·e^(r−q)T', tone: 'muted' as const },
        ]} />}
      >
        <DeskChartFrame
          xTitle="Time (DTE)" yTitle="Basis % · Ann. carry %" className="min-h-[220px]"
          header={<span className="text-zinc-400">{basisCurve.hasMarketMarks ? 'Market F − S' : '(F−S)/S theo'} · (F/S−1)/T</span>}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={basisChart} margin={{ ...chrome.margin, right: 36 }}>
              <CartesianGrid {...chrome.grid} />
              <XAxis dataKey="dte" tick={chrome.tick} stroke={chrome.axisLine} tickFormatter={(v: number) => chartDayTick(v)} label={deskAxisLabel('Time (DTE)')} />
              <YAxis yAxisId="basis" tick={chrome.tick} stroke={chrome.axisLine} width={48} tickFormatter={(v: number) => chartPctTick(v, false)} label={deskAxisLabel('Basis %', 'insideLeft')} />
              <YAxis yAxisId="carry" orientation="right" tick={chrome.tick} stroke={chrome.axisLine} width={48} tickFormatter={(v: number) => chartPctTick(v, false)} label={deskAxisLabel('Ann. carry %', 'insideRight')} />
              <Tooltip contentStyle={chrome.tooltipStyle} formatter={(value: number, name: string) => [`${Number(value).toFixed(3)}%`, name]} labelFormatter={(dte: number) => `DTE ${dte}d`} />
              <ReferenceLine yAxisId="basis" y={0} stroke={DESK_SERIES.zero} />
              <Bar yAxisId="basis" dataKey="basisPct" fill={DESK_SERIES.historyLive} opacity={0.85} name="Basis %" />
              <Line yAxisId="carry" type="monotone" dataKey="carry" stroke={DESK_SERIES.median} strokeWidth={2} dot={{ r: 2 }} name="Ann. carry %" />
            </ComposedChart>
          </ResponsiveContainer>
        </DeskChartFrame>
      </DeskToolShell>

      {/* D — roll PnL heatmap */}
      <DeskToolShell
        print={<PrintStrip items={[
          { label: 'Carry ann', value: fmtPct(carryAnn), tone: carryAnn >= 0 ? 'up' : 'down', title: 'rollPnl' },
          { label: 'Notional', value: fmtPrice(snapshot.spot, snapshot.spot > 1000 ? 0 : 2) },
          { label: 'Source', value: liveFunding != null ? 'Deribit funding' : 'r−q equity', tone: 'muted' },
          { label: 'Formula', value: 'S·(1+shock)·carry·d/365', tone: 'muted' },
        ]} />}
        bodyClassName="min-h-0 overflow-auto rounded border border-border bg-card"
      >
        <div className="flex h-full min-h-0 flex-col bg-black/40">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1 font-mono text-type-2xs text-muted-foreground">
            <span>Rows: <span className="text-foreground">spot shock %</span></span>
            <span className="text-zinc-400">Roll / funding PnL</span>
            <span>Cols: <span className="text-foreground">hold horizon (days)</span></span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse font-mono text-type-xs">
              <thead className="sticky top-0 z-10 bg-card">
                <tr>
                  <th className="px-2 py-1 text-left font-normal text-muted-foreground">Shock % \ Days</th>
                  {roll.horizons.map((h) => <th key={h} className="px-2 py-1 text-right font-normal text-muted-foreground">{h}d</th>)}
                </tr>
              </thead>
              <tbody>
                {roll.shocks.map((sh, si) => (
                  <tr key={sh}>
                    <td className="px-2 py-0.5 text-muted-foreground">{(sh * 100).toFixed(0)}%</td>
                    {roll.horizons.map((h, hi) => {
                      const v = roll.pnl[si]![hi]!;
                      const intensity = Math.min(1, Math.abs(v) / rollMaxAbs);
                      const nearZero = intensity < 0.06;
                      const bg = nearZero ? undefined
                        : v >= 0 ? `color-mix(in oklch, var(--up) ${Math.round(intensity * 55)}%, transparent)`
                          : `color-mix(in oklch, var(--down) ${Math.round(intensity * 55)}%, transparent)`;
                      return (
                        <td key={h} className={cn('px-2 py-0.5 text-right tabular-nums', nearZero ? 'text-muted-foreground' : v >= 0 ? 'text-up' : 'text-down')} style={bg ? { background: bg } : undefined}>
                          {fmtSigned(v, Math.abs(v) > 100 ? 0 : 2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </DeskToolShell>
    </div>
  );
}
