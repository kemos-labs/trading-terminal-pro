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

export type HedgePathVolBasis = 'atm-iv' | 'user-scenario';

export interface HedgePanelRunConfig {
  symbol: string;
  mode: HedgeMode;
  threshold: number;
  tolerance: number;
  period: number;
  strike: number;
  T: number;
  vol: number;
  pathVol: number;
  pathVolBasis: HedgePathVolBasis;
  spot: number;
  r: number;
  q: number;
  qty: number;
  days: number;
  steps: number;
  seed: number;
  instrument: 'spot' | 'future';
}

export function hedgeDraftProblems(d: {
  strike: number | null | undefined; T: number | null | undefined; vol: number | null | undefined;
  pathVol: number | null | undefined; spot: number | null | undefined;
  r: number | null | undefined; q: number | null | undefined; qty: number | null | undefined;
  threshold: number | null | undefined; tolerance: number | null | undefined; period: number | null | undefined;
  days: number | null | undefined; steps: number | null | undefined; mode: HedgeMode;
}): string[] {
  const p: string[] = [];
  if (!(Number.isFinite(d.strike) && (d.strike as number) > 0)) p.push('strike unavailable');
  if (!(Number.isFinite(d.T) && (d.T as number) > 0)) p.push('expiry unavailable');
  if (!(Number.isFinite(d.vol) && (d.vol as number) > 0)) p.push('mark IV unavailable');
  if (!Number.isFinite(d.pathVol) || (d.pathVol as number) < 0) p.push('path vol unavailable');
  if (!(Number.isFinite(d.spot) && (d.spot as number) > 0)) p.push('spot unavailable');
  if (!Number.isFinite(d.r)) p.push('rate unavailable');
  if (!Number.isFinite(d.q)) p.push('carry unavailable');
  if (!Number.isFinite(d.qty) || (d.qty as number) === 0) p.push('qty invalid');
  if (!(Number.isFinite(d.days) && (d.days as number) > 0)) p.push('horizon invalid');
  if (!(Number.isFinite(d.steps) && (d.steps as number) >= 1)) p.push('steps invalid');
  if (d.mode === 'threshold' && !(Number.isFinite(d.threshold) && (d.threshold as number) > 0)) p.push('threshold invalid');
  if (d.mode === 'tolerance' && !(Number.isFinite(d.tolerance) && (d.tolerance as number) >= 0)) p.push('band invalid');
  if (d.mode === 'period' && !(Number.isFinite(d.period) && Number.isInteger(d.period) && (d.period as number) >= 1)) p.push('period invalid');
  return p;
}

export function followerDraftProblems(d: {
  strike: number | null | undefined; T: number | null | undefined; vol: number | null | undefined;
  pathVol: number | null | undefined; spot: number | null | undefined;
  r: number | null | undefined; q: number | null | undefined; qty: number | null | undefined;
  band: number | null | undefined; days: number | null | undefined;
}): string[] {
  const p: string[] = [];
  if (!(Number.isFinite(d.strike) && (d.strike as number) > 0)) p.push('strike unavailable');
  if (!(Number.isFinite(d.T) && (d.T as number) > 0)) p.push('expiry unavailable');
  if (!(Number.isFinite(d.vol) && (d.vol as number) > 0)) p.push('mark IV unavailable');
  if (!Number.isFinite(d.pathVol) || (d.pathVol as number) < 0) p.push('path vol unavailable');
  if (!(Number.isFinite(d.spot) && (d.spot as number) > 0)) p.push('spot unavailable');
  if (!Number.isFinite(d.r)) p.push('rate unavailable');
  if (!Number.isFinite(d.q)) p.push('carry unavailable');
  if (!Number.isFinite(d.qty) || (d.qty as number) === 0) p.push('qty invalid');
  if (!(Number.isFinite(d.band) && (d.band as number) >= 0)) p.push('band invalid');
  if (!(Number.isFinite(d.days) && (d.days as number) > 0)) p.push('horizon invalid');
  return p;
}

export function HedgeWorkflow() {
  const snapshot = useTerminalStore((s) => s.snapshot);
  const fundingAnn = useTerminalStore((s) => s.fundingAnn);
  const chrome = deskChartChrome();
  const defaults = useMemo(() => (snapshot ? defaultHedgeFromSnapshot(snapshot) : {}), [snapshot]);
  const basisDefaults = { strike: defaults.strike, T: defaults.T, vol: defaults.vol };
  // Path-vol scenario: initialized from ATM IV when available; no numeric fallback.
  // NaN = unavailable until the user enters an explicit scenario vol.
  const atmIv = defaults.realizedVol;
  const atmIvAvailable = Number.isFinite(atmIv) && (atmIv as number) >= 0;

  // ── A: Δ-hedge simulator (explicit-run snapshot semantics) ─────────
  const [mode, setMode] = useState<HedgeMode>('threshold');
  const [threshold, setThreshold] = useState(0.1);
  const [tolerance, setTolerance] = useState(0.05);
  const [period, setPeriod] = useState(5);
  const [rvOverride, setRvOverride] = useState<number | null>(null);
  const hedgeRvLabel = rvOverride != null
    ? 'Path vol scenario — user-entered scenario vol'
    : atmIvAvailable
      ? 'Path vol scenario — initialized from ATM IV'
      : 'Path vol scenario — ATM IV unavailable, enter scenario vol';
  const rv = rvOverride ?? (atmIvAvailable ? (atmIv as number) : NaN);
  const hedgePathVolBasis: HedgePathVolBasis = rvOverride != null ? 'user-scenario' : 'atm-iv';
  const [qty, setQty] = useState(-1);
  const [hedgeRun, setHedgeRun] = useState<HedgePanelRunConfig | null>(null);
  const hedgeDraft = {
    strike: basisDefaults.strike, T: basisDefaults.T, vol: basisDefaults.vol,
    pathVol: rv, pathVolBasis: hedgePathVolBasis, spot: snapshot?.spot, r: snapshot?.riskFreeRate, q: snapshot?.dividendYield,
    qty, threshold, tolerance, period, days: defaults.days ?? 21, steps: defaults.steps ?? 60, mode,
  };
  const hedgeProblems = hedgeDraftProblems(hedgeDraft);
  const hedgeDraftSig = JSON.stringify({ ...hedgeDraft, symbol: snapshot?.symbol });
  const hedgeRunSig = hedgeRun ? JSON.stringify({
    strike: hedgeRun.strike, T: hedgeRun.T, vol: hedgeRun.vol, pathVol: hedgeRun.pathVol,
    pathVolBasis: hedgeRun.pathVolBasis,
    spot: hedgeRun.spot, r: hedgeRun.r, q: hedgeRun.q, qty: hedgeRun.qty,
    threshold: hedgeRun.threshold, tolerance: hedgeRun.tolerance, period: hedgeRun.period,
    days: hedgeRun.days, steps: hedgeRun.steps, mode: hedgeRun.mode, symbol: hedgeRun.symbol,
  }) : null;
  const hedgeStale = hedgeRun != null && hedgeRunSig !== hedgeDraftSig;
  const hedgeResult = useMemo(() => {
    if (!hedgeRun) return null;
    return simulateDeltaHedge({
      mode: hedgeRun.mode, threshold: hedgeRun.threshold, tolerance: hedgeRun.tolerance,
      periodSteps: hedgeRun.period, type: defaults.type ?? 'call',
      strike: hedgeRun.strike, T: hedgeRun.T, vol: hedgeRun.vol,
      realizedVol: hedgeRun.pathVol, drift: 0, days: hedgeRun.days, steps: hedgeRun.steps,
      optionQty: hedgeRun.qty, hedgeInstrument: hedgeRun.instrument,
      r: hedgeRun.r, q: hedgeRun.q, seed: hedgeRun.seed,
    }, hedgeRun.spot);
  }, [hedgeRun, defaults.type]);
  const hedgeChart = hedgeResult?.steps.map((s) => ({ t: s.tDay, pnl: s.totalPnl, netDelta: s.netDelta })) ?? [];
  const hedgePnlDomain = tightDomain(hedgeChart.map((r) => r.pnl), 0.08, { includeZero: true });
  const hedgeDeltaDomain = tightDomain(hedgeChart.map((r) => r.netDelta), 0.08, { includeZero: true });

  // ── B: Δ-follower (explicit-run snapshot semantics) ───────────────
  const [band, setBand] = useState(0.05);
  const [fQty, setFQty] = useState(1);
  const [fRvOverride, setFRvOverride] = useState<number | null>(null);
  const fRv = fRvOverride ?? (atmIvAvailable ? (atmIv as number) : NaN);
  const followPathVolBasis: HedgePathVolBasis = fRvOverride != null ? 'user-scenario' : 'atm-iv';
  const followRvLabel = fRvOverride != null
    ? 'Path vol scenario — user-entered scenario vol'
    : atmIvAvailable
      ? 'Path vol scenario — initialized from ATM IV'
      : 'Path vol scenario — ATM IV unavailable, enter scenario vol';
  const [followRun, setFollowRun] = useState<HedgePanelRunConfig | null>(null);
  const followDraft = {
    strike: basisDefaults.strike, T: basisDefaults.T, vol: basisDefaults.vol,
    pathVol: fRv, pathVolBasis: followPathVolBasis, spot: snapshot?.spot, r: snapshot?.riskFreeRate, q: snapshot?.dividendYield,
    qty: fQty, band, days: defaults.days ?? 21,
  };
  const followProblems = followerDraftProblems(followDraft);
  const followDraftSig = JSON.stringify({ ...followDraft, symbol: snapshot?.symbol });
  const followRunSig = followRun ? JSON.stringify({
    strike: followRun.strike, T: followRun.T, vol: followRun.vol, pathVol: followRun.pathVol,
    pathVolBasis: followRun.pathVolBasis,
    spot: followRun.spot, r: followRun.r, q: followRun.q, qty: followRun.qty,
    threshold: followRun.threshold, tolerance: followRun.tolerance, period: followRun.period,
    days: followRun.days, steps: followRun.steps, mode: followRun.mode, symbol: followRun.symbol,
  }) : null;
  // Follower draft signature uses band for both threshold/tolerance slots.
  const followStale = followRun != null && JSON.stringify({
    strike: followRun.strike, T: followRun.T, vol: followRun.vol, pathVol: followRun.pathVol,
    pathVolBasis: followRun.pathVolBasis,
    spot: followRun.spot, r: followRun.r, q: followRun.q, qty: followRun.qty,
    band: followRun.tolerance, days: followRun.days, symbol: followRun.symbol,
  }) !== JSON.stringify({ ...followDraft, symbol: snapshot?.symbol });
  const followResult = useMemo(() => {
    if (!followRun) return null;
    return simulateDeltaHedge({
      mode: 'tolerance', threshold: followRun.threshold, tolerance: followRun.tolerance,
      periodSteps: 1, type: 'call', strike: followRun.strike, T: followRun.T, vol: followRun.vol,
      realizedVol: followRun.pathVol, drift: 0, days: followRun.days, steps: followRun.steps,
      optionQty: followRun.qty, hedgeInstrument: followRun.instrument,
      r: followRun.r, q: followRun.q, seed: followRun.seed,
    }, followRun.spot);
  }, [followRun]);
  void followDraftSig; void followRunSig;
  const followChart = followResult?.steps.map((s) => ({ t: s.tDay, pnl: s.totalPnl, netDelta: s.netDelta })) ?? [];
  const followPnlDomain = tightDomain(followChart.map((r) => r.pnl), 0.08, { includeZero: true });
  const followDeltaDomain = tightDomain(followChart.map((r) => r.netDelta), 0.08, { includeZero: true });

  // ── C: forward basis & carry ───────────────────────────────────────
  const liveFunding = fundingAnn ?? snapshot?.fundingAnn ?? null;
  const basisCurve = useMemo(() => (snapshot ? buildBasisCurve(snapshot, { fundingAnn: liveFunding }) : null), [snapshot, liveFunding]);
  const basisChart = useMemo(() => (basisCurve?.points.map((p) => ({
    dte: p.dte, basisPct: (p.basis / basisCurve.spot) * 100, carry: p.annCarry * 100, forward: p.forward, source: p.source,
  })) ?? []), [basisCurve]);
  const mktN = basisCurve?.points.filter((p) => p.source === 'market').length ?? 0;
  const frontBasis = basisChart[0]?.basisPct;
  if (!snapshot || !basisCurve) {
    return (
      <div data-testid="trade-hedge-workflow" className="flex flex-col gap-2 p-1">
        <span className="text-type-xs text-muted-foreground">Unavailable — no market snapshot; mount pending data.</span>
      </div>
    );
  }

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
          <DeskField label={hedgeRvLabel} value={Number.isFinite(rv) ? rv : '' as unknown as number} onChange={setRvOverride} step={0.01} />
          <DeskField label="Opt qty (− short)" value={qty} onChange={setQty} step={1} />
          <button type="button" data-testid="hedge-run" className="rounded border border-border px-2 py-1 text-type-xs" disabled={hedgeProblems.length > 0} onClick={() => {
            if (hedgeProblems.length > 0 || !snapshot) return;
            setHedgeRun({
              symbol: snapshot.symbol, mode, threshold, tolerance, period,
              strike: basisDefaults.strike as number, T: basisDefaults.T as number, vol: basisDefaults.vol as number,
              pathVol: rv, pathVolBasis: hedgePathVolBasis, spot: snapshot.spot, r: snapshot.riskFreeRate, q: snapshot.dividendYield,
              qty, days: defaults.days ?? 21, steps: defaults.steps ?? 60, seed: 19, instrument: 'spot',
            });
          }}>{hedgeRun ? 'Re-run scenario' : 'Run scenario'}</button>
          {hedgeRun == null && <span data-testid="hedge-pending" className="text-type-xs text-muted-foreground">Not run — set inputs, Run scenario</span>}
          {hedgeStale && <span data-testid="hedge-stale" className="text-type-xs text-muted-foreground">Stale — inputs changed, re-run scenario</span>}
          {hedgeProblems.length > 0 && <span data-testid="hedge-unavailable" className="text-type-xs text-muted-foreground">Unavailable — {hedgeProblems.join('; ')}</span>}
        </>}
        print={<PrintStrip items={hedgeRun && hedgeResult ? [
          { label: 'Terminal PnL', value: fmtSigned(hedgeResult.terminalPnl), tone: hedgeResult.terminalPnl >= 0 ? 'up' : 'down', title: 'hedgePnl' },
          { label: 'Trades', value: String(hedgeResult.tradeCount) },
          { label: 'Max DD', value: fmtSigned(hedgeResult.maxDrawdown), tone: 'down' },
          { label: 'Avg |Δ|', value: hedgeResult.avgAbsNetDelta.toFixed(3) },
          { label: 'Strike', value: hedgeRun.strike != null ? fmtPrice(hedgeRun.strike) : '—' },
          { label: 'Scenario', value: `${hedgeRun.symbol} K=${hedgeRun.strike} T=${hedgeRun.T.toFixed(3)}y pathVol=${(hedgeRun.pathVol * 100).toFixed(1)}%`, tone: 'muted' as const },
          { label: 'Path vol scenario', value: hedgeRun.pathVolBasis === 'atm-iv' ? `${(hedgeRun.pathVol * 100).toFixed(1)}% · initialized from ATM IV` : `${(hedgeRun.pathVol * 100).toFixed(1)}% · user-entered scenario vol`, tone: 'muted' as const },
        ] : [{ label: 'Terminal PnL', value: '—', tone: 'muted' as const }]} />}
      >
        <DeskChartFrame xTitle="Day" yTitle="PnL ($) · Net Δ" className="min-h-[220px]" testId="hedge-chart-a" chartPoints={hedgeChart.length} header={<span className="text-muted-foreground">Δ-hedge — spot hedge instrument · implied-vol scenario (seed 19) — not realized vol</span>}>
          {/* Definite pixel height: ResponsiveContainer height:100% resolves to 0 inside the flex body. */}
          <div className="w-full min-h-0" style={{ height: 240 }} data-testid="hedge-chart-a-body">
          <ResponsiveContainer width="100%" height={240}>
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
          </div>
        </DeskChartFrame>
      </DeskToolShell>

      {/* B — Δ-follower */}
      <DeskToolShell
        controls={<>
          <DeskField label="Band" value={band} onChange={setBand} step={0.01} />
          <DeskField label="Option qty" value={fQty} onChange={setFQty} step={1} />
          <DeskField label={followRvLabel} value={Number.isFinite(fRv) ? fRv : '' as unknown as number} onChange={setFRvOverride} step={0.01} />
          <button type="button" data-testid="follower-run" className="rounded border border-border px-2 py-1 text-type-xs" disabled={followProblems.length > 0} onClick={() => {
            if (followProblems.length > 0 || !snapshot) return;
            setFollowRun({
              symbol: snapshot.symbol, mode: 'tolerance', threshold: band, tolerance: band, period: 1,
              strike: basisDefaults.strike as number, T: basisDefaults.T as number, vol: basisDefaults.vol as number,
              pathVol: fRv, pathVolBasis: followPathVolBasis, spot: snapshot.spot, r: snapshot.riskFreeRate, q: snapshot.dividendYield,
              qty: fQty, days: defaults.days ?? 21, steps: 80, seed: 33, instrument: 'future',
            });
          }}>{followRun ? 'Re-run scenario' : 'Run scenario'}</button>
          {followRun == null && <span data-testid="follower-pending" className="text-type-xs text-muted-foreground">Not run — set inputs, Run scenario</span>}
          {followStale && <span data-testid="follower-stale" className="text-type-xs text-muted-foreground">Stale — inputs changed, re-run scenario</span>}
          {followProblems.length > 0 && <span data-testid="follower-unavailable" className="text-type-xs text-muted-foreground">Unavailable — {followProblems.join('; ')}</span>}
        </>}
        print={<PrintStrip items={followRun && followResult ? [
          { label: 'Terminal PnL', value: fmtSigned(followResult.terminalPnl), tone: followResult.terminalPnl >= 0 ? 'up' : 'down' },
          { label: 'Trades', value: String(followResult.tradeCount) },
          { label: 'Max DD', value: fmtSigned(followResult.maxDrawdown), tone: 'down' },
          { label: 'Avg |Δ|', value: followResult.avgAbsNetDelta.toFixed(3) },
          { label: 'Scenario', value: `${followRun.symbol} K=${followRun.strike} pathVol=${(followRun.pathVol * 100).toFixed(1)}%`, tone: 'muted' as const },
          { label: 'Path vol scenario', value: followRun.pathVolBasis === 'atm-iv' ? `${(followRun.pathVol * 100).toFixed(1)}% · initialized from ATM IV` : `${(followRun.pathVol * 100).toFixed(1)}% · user-entered scenario vol`, tone: 'muted' as const },
        ] : [{ label: 'Terminal PnL', value: '—', tone: 'muted' as const }]} />}
      >
        <DeskChartFrame xTitle="Day" yTitle="PnL ($) · Net Δ" className="min-h-[220px]" testId="hedge-chart-b" chartPoints={followChart.length} header={<span className="text-muted-foreground">Δ-follower — futures hedge · tolerance band (seed 33) · implied-vol scenario</span>}>
          {/* Definite pixel height: ResponsiveContainer height:100% resolves to 0 inside the flex body. */}
          <div className="w-full min-h-0" style={{ height: 240 }} data-testid="hedge-chart-b-body">
          <ResponsiveContainer width="100%" height={240}>
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
          </div>
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
          xTitle="Time (DTE)" yTitle="Basis % · Ann. carry %" className="min-h-[220px]" testId="hedge-chart-c" chartPoints={basisChart.length}
          header={<span className="text-zinc-400">{basisCurve.hasMarketMarks ? 'Market F − S' : '(F−S)/S theo'} · (F/S−1)/T</span>}
        >
          {/* Definite pixel height: ResponsiveContainer height:100% resolves to 0 inside the flex body. */}
          <div className="w-full min-h-0" style={{ height: 240 }} data-testid="hedge-chart-c-body">
          <ResponsiveContainer width="100%" height={240}>
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
          </div>
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
          <div className="min-h-0 flex-1 overflow-auto" tabIndex={0} aria-label="Roll and funding risk matrix">
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
