/**
 * Trade · PnL / Scenario workflow — canonical consolidated workspace.
 * Subsumes legacy OptionPnlTool + ComboPnlTool + StraddleTool + BreakEvenTool +
 * SubjectiveTool + BacktestTool presentation shells; all engines from src/lib/options.
 * Observed history (live FMP/Yahoo path) is labelled Historical; synthetic GBM is
 * labelled Scenario — never mixed.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useTerminalStore } from '../../../store/terminalStore';
import {
  breakEvenTable, analyzeComboBreakEven,
} from '../../../lib/options/breakEven';
import { comboGreeksPnl, optionGreeksPnl, straddleBreakEvens } from '../../../lib/options/greeksPnl';
import { evaluateCombo, templateLegs } from '../../../lib/options/portfolio';
import { simulatePaths } from '../../../lib/options/pathSim';
import { defaultHedgeFromSnapshot, simulateDeltaHedge } from '../../../lib/options/hedging';
import { evaluateSubjective, subjectiveSummary } from '../../../lib/options/subjective';
import { fmtPct, fmtPrice, fmtSigned } from '../../../lib/format';
import { cn } from '../../../lib/utils';
import { useSpotPath } from '../useSpotPath';
import { DeskToolShell } from '../DeskToolShell';
import { DeskField, DeskSelect } from '../DeskField';
import { PrintStrip } from '../PrintStrip';
import { DeskChartFrame, deskChartChrome } from '../DeskChart';
import { DESK_LEGEND, DESK_SERIES } from '../seriesGrammar';
import { CHART, CHART_GREEK, chartDayTick, chartPriceTick, chartSignedTick, tightDomain } from '../../../lib/chartTheme';
import { Explain } from '../../common/Explain';

type ComboTemplate = 'long_straddle' | 'short_straddle' | 'risk_reversal' | 'call_spread' | 'long_call';
type OptType = 'call' | 'put' | 'both';

export function PnlWorkflow() {
  const snapshot = useTerminalStore((s) => s.snapshot)!;
  const { path, source: pathSrc } = useSpotPath(45);
  const chrome = deskChartChrome();

  // ── A: single-option historical PnL ────────────────────────────────
  const [oExpiryIdx, setOExpiryIdx] = useState(0);
  const [oType, setOType] = useState<'call' | 'put'>('call');
  const [oSide, setOSide] = useState<'long' | 'short'>('long');
  const oSlice = snapshot.expiries[oExpiryIdx] ?? snapshot.expiries[0];
  const oStrikes = useMemo(() => {
    if (!oSlice) return [] as number[];
    const list = oType === 'call' ? oSlice.calls : oSlice.puts;
    return list.filter((q) => q.iv != null).map((q) => q.strike).sort((a, b) => a - b);
  }, [oSlice, oType]);
  const oDefaultStrike = useMemo(() => {
    if (!oStrikes.length) return snapshot.spot;
    return oStrikes.reduce((b, k) => (Math.abs(k - snapshot.spot) < Math.abs(b - snapshot.spot) ? k : b), oStrikes[0]!);
  }, [oStrikes, snapshot.spot]);
  const [oStrike, setOStrike] = useState(oDefaultStrike);
  useEffect(() => { setOStrike(oDefaultStrike); }, [oDefaultStrike]);
  const oSeries = useMemo(() => {
    if (!oSlice) return null;
    const list = oType === 'call' ? oSlice.calls : oSlice.puts;
    const q = list.find(x => x.strike === oStrike);
    const exec = q ? (oSide === 'long' ? q.ask : q.bid) : null;
    const basis = oSide === 'long' ? 'ask' as const : 'bid' as const;
    // Require explicit executable price; null → unavailable (never 0)
    return optionGreeksPnl(snapshot, { type: oType, strike: oStrike, expiry: oSlice.expiry, side: oSide, path, entryPrice: exec ?? null, entryBasis: exec != null ? basis : null });
  }, [snapshot, oType, oStrike, oSlice, oSide, path]);
  const oChart = oSeries?.bars.map((b) => ({ t: b.dateLabel, pnl: b.pnl, mark: b.mark, delta: b.cumDelta, gamma: b.cumGamma, theta: b.cumTheta })) ?? [];
  const oDomain = tightDomain(oChart.flatMap((r) => [r.pnl, r.delta, r.theta]), 0.08, { includeZero: true });

  // ── B: combo historical PnL ────────────────────────────────────────
  const [cTemplate, setCTemplate] = useState<ComboTemplate>('short_straddle');
  const [cExpiryIdx, setCExpiryIdx] = useState(0);
  const cLegs = useMemo(() => templateLegs(cTemplate, snapshot, cExpiryIdx), [cTemplate, snapshot, cExpiryIdx]);
  const cSeries = useMemo(() => comboGreeksPnl(cLegs, snapshot, path), [cLegs, snapshot, path]);
  const cChart = cSeries.bars.map((b) => ({ t: b.dateLabel, pnl: b.pnl, delta: b.cumDelta, gamma: b.cumGamma, theta: b.cumTheta, residual: b.cumResidual }));
  const cDomain = tightDomain(cChart.flatMap((r) => [r.pnl, r.delta, r.gamma, r.theta, r.residual]), 0.08, { includeZero: true });

  // ── C: straddle (break-even + historical PnL) ──────────────────────
  const [sMode, setSMode] = useState<'breakeven' | 'pnl'>('breakeven');
  const [sSide, setSSide] = useState<'long' | 'short'>('long');
  const [sExpiryIdx, setSExpiryIdx] = useState(0);
  const sLegs = useMemo(() => templateLegs(sSide === 'long' ? 'long_straddle' : 'short_straddle', snapshot, sExpiryIdx), [sSide, snapshot, sExpiryIdx]);
  const sMark = useMemo(() => evaluateCombo(sLegs, snapshot), [sLegs, snapshot]);
  const sBe = useMemo(() => analyzeComboBreakEven(sLegs, snapshot.spot), [sLegs, snapshot]);
  const sStrike = sLegs[0]?.strike ?? snapshot.spot;
  const sCallExec = sLegs.find((l) => l.kind === 'call')?.entryPrice;
  const sPutExec = sLegs.find((l) => l.kind === 'put')?.entryPrice;
  const hasExec = sCallExec != null && sPutExec != null && Number.isFinite(sCallExec) && Number.isFinite(sPutExec);
  const sStrBe = hasExec ? straddleBreakEvens(sStrike, sCallExec as number, sPutExec as number, sSide) : null;
  const sSeries = useMemo(() => comboGreeksPnl(sLegs, snapshot, path), [sLegs, snapshot, path]);
  const sPnlChart = sSeries.bars.map((b) => ({ t: b.dateLabel, pnl: b.pnl, delta: b.cumDelta, theta: b.cumTheta }));
  const sPayoffChart = sBe.available ? sBe.payoffCurve.filter(p => p.pnl != null).map((p) => ({ spot: p.spot, pnl: p.pnl as number })) : [];
  const sBeDomain = sPayoffChart.length ? tightDomain(sPayoffChart.map((r) => r.pnl), 0.08, { includeZero: true }) : ([-1, 1] as [number, number]);
  const sPnlDomain = tightDomain(sPnlChart.flatMap((r) => [r.pnl, r.delta, r.theta]), 0.08, { includeZero: true });

  // ── D: break-even matrix ───────────────────────────────────────────
  const [bExpiryIdx, setBExpiryIdx] = useState(0);
  const [bType, setBType] = useState<OptType>('call');
  const bRows = useMemo(() => breakEvenTable(snapshot, bExpiryIdx, bType), [snapshot, bExpiryIdx, bType]);
  const bNear = useMemo(() => bRows.filter((r) => Math.abs(r.strike - snapshot.spot) / snapshot.spot < 0.12), [bRows, snapshot.spot]);
  const bAtmKey = useMemo(() => {
    if (bNear.length === 0) return null;
    let best = bNear[0]!, bestDist = Math.abs(best.strike - snapshot.spot);
    for (const r of bNear) { const d = Math.abs(r.strike - snapshot.spot); if (d < bestDist) { bestDist = d; best = r; } }
    return `${best.type}-${best.strike}`;
  }, [bNear, snapshot.spot]);
  const bChart = bNear.map((r) => ({ strike: r.strike, beDistPct: r.beDistPct * 100, type: r.type }));

  // ── E: subjective valuation ────────────────────────────────────────
  const [eExpiryIdx, setEExpiryIdx] = useState(0);
  const [eDrift, setEDrift] = useState(0.05);
  const [eVrp, setEVrp] = useState(0.02);
  const eRows = useMemo(() => evaluateSubjective(snapshot, eExpiryIdx, { drift: eDrift, vrp: eVrp }, 'both'), [snapshot, eExpiryIdx, eDrift, eVrp]);
  const eSummary = useMemo(() => subjectiveSummary(eRows), [eRows]);
  const eChart = useMemo(() =>
    eRows.filter((r) => r.type === 'call' && Math.abs(r.strike - snapshot.spot) / snapshot.spot < 0.15)
      .map((r) => ({ strike: r.strike, market: r.marketMid, fair: r.subjectivePrice, edge: r.edge })),
  [eRows, snapshot.spot]);
  const eDomain = tightDomain(eChart.flatMap((r) => [r.market, r.fair, r.edge]), 0.08, { includeZero: true });
  const eBestLong = eSummary.bestLong ? `${eSummary.bestLong.type[0]!.toUpperCase()} ${fmtPrice(eSummary.bestLong.strike, 0)} (${fmtSigned(eSummary.bestLong.edge)})` : '—';

  // ── F: Scenario Monte Carlo (explicitly NOT historical) ────────────
  const [weeks, setWeeks] = useState(8);
  const [rv, setRv] = useState(snapshot.expiries[0]?.atmIV ?? 0.35);
  const mcLegs = useMemo(() => templateLegs('short_straddle', snapshot, 0), [snapshot]);
  const mcDays = Math.max(5, weeks * 7);
  const mcSim = useMemo(() =>
    simulatePaths(mcLegs, snapshot, { drift: 0, vol: rv, days: mcDays, steps: Math.min(80, mcDays), paths: 120, seed: 42 }),
  [mcLegs, snapshot, rv, mcDays]);
  const mcHedge = useMemo(() => {
    const d = defaultHedgeFromSnapshot(snapshot);
    if (!d.strike || !d.T || !d.vol) return null;
    return simulateDeltaHedge({
      mode: 'period' as const, threshold: 0.1, tolerance: 0.05, periodSteps: 5,
      type: d.type ?? 'call', strike: d.strike, T: d.T, vol: d.vol, realizedVol: rv, drift: 0,
      days: mcDays, steps: Math.min(60, mcDays), optionQty: -1, hedgeInstrument: 'spot' as const,
      r: snapshot.riskFreeRate, q: snapshot.dividendYield, seed: 7,
    }, snapshot.spot);
  }, [snapshot, rv, mcDays]);
  const mcChart = mcSim.available ? mcSim.t.map((t, i) => ({
    t, p5: mcSim.pnlBands.p5[i], p25: mcSim.pnlBands.p25[i], p50: mcSim.pnlBands.p50[i],
    p75: mcSim.pnlBands.p75[i], p95: mcSim.pnlBands.p95[i],
  })) : [];
  const mcDomain = tightDomain(mcChart.flatMap((r) => [r.p5, r.p95]), 0.08, { includeZero: true });

  const xTitleDate = { xTitle: 'Date', yTitle: 'PnL ($)' } as const;

  return (
    <div data-testid="trade-pnl-workflow" className="flex flex-col gap-2 p-1">
      {/* A — observed-option historical PnL */}
      <DeskToolShell
        controls={<>
          <DeskSelect label="Expiry" value={String(oExpiryIdx)} onChange={(v) => setOExpiryIdx(+v)} options={snapshot.expiries.map((e, i) => ({ value: String(i), label: `${e.expiry} (${e.dte}d)` }))} />
          <DeskSelect label="Type" value={oType} onChange={setOType} options={[{ value: 'call', label: 'Call' }, { value: 'put', label: 'Put' }]} />
          <DeskSelect label="Strike" value={String(oStrike)} onChange={(v) => setOStrike(+v)} options={oStrikes.map((k) => ({ value: String(k), label: fmtPrice(k, k > 1000 ? 0 : 2) }))} />
          <DeskSelect label="Side" value={oSide} onChange={setOSide} options={[{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }]} />
        </>}
        print={<PrintStrip items={oSeries?.available ? [
          { label: 'Term PnL', value: fmtSigned(oSeries.terminalPnl!), tone: (oSeries.terminalPnl ?? 0) >= 0 ? 'up' : 'down' },
          { label: 'Σ Δ', value: fmtSigned(oSeries.totalDelta!) },
          { label: 'Σ Γ', value: fmtSigned(oSeries.totalGamma!) },
          { label: 'Σ Θ', value: fmtSigned(oSeries.totalTheta!) },
          { label: 'Path', value: pathSrc, tone: 'muted' },
          { label: 'Marks', value: 'BS sticky-IV', tone: 'muted' },
        ] : oSeries && !oSeries.available ? [{ label: 'Term PnL', value: '—', tone: 'muted' as const }, { label: 'Reason', value: oSeries.reason ?? 'unavailable', tone: 'muted' as const }, { label: 'Path', value: pathSrc, tone: 'muted' as const }] : [{ label: 'Path', value: pathSrc, tone: 'muted' as const }, { label: 'Marks', value: 'BS sticky-IV', tone: 'muted' as const }]} />}
      >
        {oSeries?.available && oChart.length > 0 ? (
        <DeskChartFrame {...xTitleDate} className="min-h-[260px]" testId="pnl-chart-a" chartPoints={oChart.length} header={<span className="text-muted-foreground">Single option — observed spot history (Historical label from path source)</span>}>
          {/* definite pixel height: ResponsiveContainer cannot resolve height:100%
              inside the DeskChartFrame flex body and otherwise renders no svg. */}
          <div className="w-full min-h-0" style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={oChart} margin={chrome.margin}>
              <CartesianGrid {...chrome.grid} />
              <XAxis dataKey="t" tick={chrome.tick} stroke={chrome.axisLine} interval="preserveStartEnd" />
              <YAxis tick={chrome.tick} stroke={chrome.axisLine} width={52} domain={oDomain} tickFormatter={(v: number) => chartSignedTick(v, 0)} />
              <Tooltip contentStyle={chrome.tooltipStyle} />
              <ReferenceLine y={0} stroke={DESK_SERIES.zero} />
              <Area type="monotone" dataKey="pnl" stroke={DESK_SERIES.historyLive} fill={DESK_SERIES.historyLive} fillOpacity={0.15} name="Mark PnL" />
              <Line type="monotone" dataKey="delta" stroke={CHART_GREEK.delta} strokeWidth={1} dot={false} name="ΣΔ" />
              <Line type="monotone" dataKey="theta" stroke={CHART_GREEK.theta} strokeWidth={1} dot={false} name="ΣΘ" />
            </ComposedChart>
          </ResponsiveContainer>
          </div>
        </DeskChartFrame>
        ) : (
        <div
          data-testid="pnl-chart-unavailable-a"
          role="status"
          className="flex min-h-[220px] flex-col items-center justify-center gap-1 rounded border border-dashed border-border bg-black px-3 text-center font-mono text-type-xs text-muted-foreground"
        >
          <span className="font-bold text-foreground">Single-option PnL unavailable</span>
          <span>No observed spot history — Historical replay needs a loaded chain (reason: {oSeries?.reason ?? 'no-history'} · path: {pathSrc}). Use Scenario Monte Carlo below for labelled synthetic paths.</span>
        </div>
        )}
      </DeskToolShell>

      {/* B — combo historical PnL */}
      <DeskToolShell
        controls={<>
          <DeskSelect label="Structure" value={cTemplate} onChange={setCTemplate} options={[
            { value: 'short_straddle', label: 'Short straddle' }, { value: 'long_straddle', label: 'Long straddle' },
            { value: 'risk_reversal', label: 'Risk reversal' }, { value: 'call_spread', label: 'Call spread' }, { value: 'long_call', label: 'Long call' },
          ]} />
          <DeskSelect label="Expiry" value={String(cExpiryIdx)} onChange={(v) => setCExpiryIdx(+v)} options={snapshot.expiries.map((e, i) => ({ value: String(i), label: `${e.expiry} (${e.dte}d)` }))} />
        </>}
        print={<PrintStrip items={cSeries.available ? [
          { label: 'Term PnL', value: fmtSigned(cSeries.terminalPnl!), tone: (cSeries.terminalPnl ?? 0) >= 0 ? 'up' : 'down' },
          { label: 'Σ Δ', value: fmtSigned(cSeries.totalDelta!) }, { label: 'Σ Γ', value: fmtSigned(cSeries.totalGamma!) },
          { label: 'Σ Θ', value: fmtSigned(cSeries.totalTheta!) }, { label: 'Residual', value: fmtSigned(cSeries.totalResidual!) },
          { label: 'Path', value: pathSrc, tone: 'muted' }, { label: 'Marks', value: 'BS sticky-IV', tone: 'muted' },
        ] : [{ label: 'Term PnL', value: '—', tone: 'muted' as const }, { label: 'Reason', value: cSeries.reason ?? 'unavailable', tone: 'muted' as const }, { label: 'Path', value: pathSrc, tone: 'muted' as const }]} />}
      >
        {cSeries.available && cChart.length > 0 ? (
        <DeskChartFrame {...xTitleDate} className="min-h-[260px]" testId="pnl-chart-b" chartPoints={cChart.length} header={<span className="text-muted-foreground">Combo — observed spot history (Historical) · greeks attribution sticky-IV</span>}>
          <div className="w-full min-h-0" style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={cChart} margin={chrome.margin}>
              <CartesianGrid {...chrome.grid} />
              <XAxis dataKey="t" tick={chrome.tick} stroke={chrome.axisLine} interval="preserveStartEnd" />
              <YAxis tick={chrome.tick} stroke={chrome.axisLine} width={52} domain={cDomain} tickFormatter={(v: number) => chartSignedTick(v, 0)} />
              <Tooltip contentStyle={chrome.tooltipStyle} />
              <ReferenceLine y={0} stroke={DESK_SERIES.zero} />
              <Area type="monotone" dataKey="pnl" stroke={DESK_SERIES.historyLive} fill={DESK_SERIES.historyLive} fillOpacity={0.12} name="Mark PnL" />
              <Line type="monotone" dataKey="delta" stroke={CHART_GREEK.delta} strokeWidth={1} dot={false} name="ΣΔ" />
              <Line type="monotone" dataKey="gamma" stroke={CHART_GREEK.gamma} strokeWidth={1} dot={false} name="ΣΓ" />
              <Line type="monotone" dataKey="theta" stroke={CHART_GREEK.theta} strokeWidth={1} dot={false} name="ΣΘ" />
              <Line type="monotone" dataKey="residual" stroke={DESK_SERIES.zero} strokeWidth={1} strokeDasharray="2 2" dot={false} name="Residual" />
            </ComposedChart>
          </ResponsiveContainer>
          </div>
        </DeskChartFrame>
        ) : (
        <div
          data-testid="pnl-chart-unavailable-b"
          role="status"
          className="flex min-h-[220px] flex-col items-center justify-center gap-1 rounded border border-dashed border-border bg-black px-3 text-center font-mono text-type-xs text-muted-foreground"
        >
          <span className="font-bold text-foreground">Combo PnL unavailable</span>
          <span>No observed spot history — Historical replay needs a loaded chain (reason: {cSeries.reason ?? 'no-history'} · path: {pathSrc}). Use Scenario Monte Carlo below for labelled synthetic paths.</span>
        </div>
        )}
      </DeskToolShell>

      {/* C — straddle break-even / PnL */}
      <DeskToolShell
        controls={<>
          <DeskSelect label="Mode" value={sMode} onChange={setSMode} options={[{ value: 'breakeven', label: 'Break-even' }, { value: 'pnl', label: 'Historical PnL' }]} />
          <DeskSelect label="Side" value={sSide} onChange={setSSide} options={[{ value: 'long', label: 'Long straddle' }, { value: 'short', label: 'Short straddle' }]} />
          <DeskSelect label="Expiry" value={String(sExpiryIdx)} onChange={(v) => setSExpiryIdx(+v)} options={snapshot.expiries.map((e, i) => ({ value: String(i), label: `${e.expiry} (${e.dte}d)` }))} />
        </>}
        print={<PrintStrip items={[
          { label: 'K', value: fmtPrice(sStrike, sStrike > 1000 ? 0 : 2) },
          ...(sStrBe ? [
            { label: 'Premium', value: fmtPrice(sStrBe.totalPremium) },
            { label: 'BE lo', value: fmtPrice(sStrBe.lower, sStrBe.lower > 1000 ? 0 : 2) },
            { label: 'BE hi', value: fmtPrice(sStrBe.upper, sStrBe.upper > 1000 ? 0 : 2) },
          ] : [
            { label: 'Premium', value: 'Unavailable', tone: 'muted' as const },
            { label: 'BE lo', value: 'Unavailable', tone: 'muted' as const },
            { label: 'BE hi', value: 'Unavailable', tone: 'muted' as const },
          ]),
          ...(sMark && !sMark.unavailable ? [
            { label: 'Mark Δ', value: fmtSigned(sMark.greeks.delta, 3), title: 'delta' },
            { label: 'Mark ν', value: fmtSigned(sMark.greeks.vega, 2), title: 'vega' },
          ] : [{ label: 'Mark', value: 'Unavailable', tone: 'muted' as const }]),
          ...(sMode === 'pnl' ? [{ label: 'Path', value: pathSrc, tone: 'muted' as const }] : []),
        ]} />}
      >
        {/* Definite pixel heights below: ResponsiveContainer cannot resolve height:100%
            inside the DeskChartFrame flex body and otherwise renders no svg. */}
        {sMode === 'breakeven' ? (
          <DeskChartFrame xTitle="Spot" yTitle="PnL ($)" className="min-h-[260px]" testId="pnl-chart-c-be" chartPoints={sPayoffChart.length}>
          <div className="w-full min-h-0" style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={sPayoffChart} margin={chrome.margin}>
                <CartesianGrid {...chrome.grid} />
                <XAxis dataKey="spot" tick={chrome.tick} stroke={chrome.axisLine} tickFormatter={(v: number) => chartPriceTick(v)} />
                <YAxis tick={chrome.tick} stroke={chrome.axisLine} width={52} domain={sBeDomain} tickFormatter={(v: number) => chartSignedTick(v, 0)} />
                <Tooltip contentStyle={chrome.tooltipStyle} />
                <ReferenceLine y={0} stroke={DESK_SERIES.zero} />
                <ReferenceLine x={snapshot.spot} stroke={DESK_SERIES.spot} strokeDasharray="3 3" />
                {sStrBe && <ReferenceLine x={sStrBe.lower} stroke={CHART_GREEK.delta} strokeDasharray="2 2" />}
                {sStrBe && <ReferenceLine x={sStrBe.upper} stroke={CHART_GREEK.delta} strokeDasharray="2 2" />}
                {sBe.available ? <Area type="monotone" dataKey="pnl" stroke={DESK_SERIES.combo} fill={DESK_SERIES.combo} fillOpacity={0.2} name="Payoff" /> : <text x="50%" y="50%" textAnchor="middle" fill="var(--muted-foreground)" fontSize={12}>Unavailable — missing executable premium</text>}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          </DeskChartFrame>
        ) : (
          <DeskChartFrame {...xTitleDate} className="min-h-[260px]" testId="pnl-chart-c-pnl" chartPoints={sPnlChart.length}>
          <div className="w-full min-h-0" style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={sPnlChart} margin={chrome.margin}>
                <CartesianGrid {...chrome.grid} />
                <XAxis dataKey="t" tick={chrome.tick} stroke={chrome.axisLine} interval="preserveStartEnd" />
                <YAxis tick={chrome.tick} stroke={chrome.axisLine} width={52} domain={sPnlDomain} tickFormatter={(v: number) => chartSignedTick(v, 0)} />
                <Tooltip contentStyle={chrome.tooltipStyle} />
                <ReferenceLine y={0} stroke={DESK_SERIES.zero} />
                <Area type="monotone" dataKey="pnl" stroke={DESK_SERIES.historyLive} fill={DESK_SERIES.historyLive} fillOpacity={0.15} name="Mark PnL" />
                <Line type="monotone" dataKey="delta" stroke={CHART_GREEK.delta} strokeWidth={1} dot={false} name="ΣΔ" />
                <Line type="monotone" dataKey="theta" stroke={CHART_GREEK.theta} strokeWidth={1} dot={false} name="ΣΘ" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          </DeskChartFrame>
        )}
      </DeskToolShell>

      {/* D — break-even matrix */}
      <DeskToolShell
        controls={<>
          <DeskSelect label="Expiry" value={String(bExpiryIdx)} onChange={(v) => setBExpiryIdx(+v)} options={snapshot.expiries.map((e, i) => ({ value: String(i), label: `${e.expiry} (${e.dte}d)` }))} />
          <DeskSelect label="Type" value={bType} onChange={setBType} options={[{ value: 'call', label: 'Calls' }, { value: 'put', label: 'Puts' }, { value: 'both', label: 'Both' }]} />
        </>}
        print={<PrintStrip items={[{ label: 'Spot', value: fmtPrice(snapshot.spot, snapshot.spot > 1000 ? 0 : 2) }, { label: 'Rows', value: String(bNear.length) }]} />}
        bodyClassName="grid min-h-0 grid-rows-[1fr_minmax(100px,28%)] gap-1"
      >
        <div className="min-h-0 overflow-auto rounded border border-border bg-card">
          <table className="w-full font-mono text-type-xs">
            <thead className="sticky top-0 z-10 border-b border-border bg-card text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left font-normal">K</th>
                <th className="px-2 py-1 text-left font-normal">Type</th>
                <th className="px-2 py-1 text-right font-normal">Mid</th>
                <th className="px-2 py-1 text-right font-normal">BE</th>
                <th className="px-2 py-1 text-right font-normal">BE dist</th>
                <th className="px-2 py-1 text-right font-normal"><Explain term="nd2">N(d2)</Explain></th>
                <th className="px-2 py-1 text-right font-normal">Δ</th>
                <th className="px-2 py-1 text-right font-normal">IV</th>
              </tr>
            </thead>
            <tbody>
              {bNear.map((r) => {
                const key = `${r.type}-${r.strike}`;
                const isAtm = key === bAtmKey;
                return (
                  <tr key={key} className={cn('border-b border-border/50 hover:bg-muted/30', isAtm && 'border-l-2 border-l-amber-500 bg-amber-500/10')}>
                    <td className="px-2 py-0.5 tabular-nums">{fmtPrice(r.strike, r.strike > 1000 ? 0 : 2)}</td>
                    <td className={cn('px-2 py-0.5', r.type === 'call' ? 'text-up' : 'text-down')}>{r.type}</td>
                    <td className="px-2 py-0.5 text-right tabular-nums">{fmtPrice(r.mid)}</td>
                    <td className="px-2 py-0.5 text-right tabular-nums">{fmtPrice(r.beLong, r.beLong > 1000 ? 0 : 2)}</td>
                    <td className={cn('px-2 py-0.5 text-right tabular-nums', r.beDistPct >= 0 ? 'text-up' : 'text-down')}>{fmtPct(r.beDistPct)}</td>
                    <td className="px-2 py-0.5 text-right tabular-nums">{(r.nd2 * 100).toFixed(1)}%</td>
                    <td className="px-2 py-0.5 text-right tabular-nums">{r.delta.toFixed(3)}</td>
                    <td className="px-2 py-0.5 text-right tabular-nums">{fmtPct(r.iv)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DeskChartFrame xTitle="Strike" yTitle="BE dist %" height={120} testId="pnl-chart-d" chartPoints={bChart.length}>
          <div className="w-full min-h-0" style={{ height: 80 }}>
          <ResponsiveContainer width="100%" height={80}>
            <ComposedChart data={bChart} margin={chrome.margin}>
              <CartesianGrid {...chrome.grid} />
              <XAxis dataKey="strike" tick={chrome.tick} stroke={chrome.axisLine} tickFormatter={(v: number) => chartPriceTick(v)} />
              <YAxis tick={chrome.tick} stroke={chrome.axisLine} width={44} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
              <Tooltip contentStyle={chrome.tooltipStyle} formatter={(v: number) => [`${v.toFixed(2)}%`, 'BE dist']} labelFormatter={(k: number) => `K ${chartPriceTick(k)}`} />
              <ReferenceLine y={0} stroke={DESK_SERIES.zero} />
              <ReferenceLine x={snapshot.spot} stroke={DESK_SERIES.spot} strokeDasharray="3 3" />
              <Bar dataKey="beDistPct" fill={DESK_SERIES.median} name="BE dist %" maxBarSize={14} />
            </ComposedChart>
          </ResponsiveContainer>
          </div>
        </DeskChartFrame>
      </DeskToolShell>

      {/* E — subjective valuation */}
      <DeskToolShell
        controls={<>
          <DeskSelect label="Expiry" value={String(eExpiryIdx)} onChange={(v) => setEExpiryIdx(+v)} options={snapshot.expiries.map((e, i) => ({ value: String(i), label: `${e.expiry} (${e.dte}d)` }))} />
          <DeskField label="μ" value={eDrift} onChange={setEDrift} step={0.01} />
          <DeskField label="VRP" value={eVrp} onChange={setEVrp} step={0.005} />
        </>}
        print={<PrintStrip items={[
          { label: 'Avg edge', value: fmtSigned(eSummary.avgEdge), tone: eSummary.avgEdge >= 0 ? 'up' : 'down' },
          { label: 'Cheap', value: String(eSummary.cheapCount), tone: 'up' },
          { label: 'Rich', value: String(eSummary.richCount), tone: 'down' },
          { label: 'Best long', value: eBestLong },
        ]} />}
      >
        <DeskChartFrame xTitle="Strike" yTitle="Price ($)" className="min-h-[260px]" testId="pnl-chart-e" chartPoints={eChart.length} header={<span className="text-muted-foreground">Subjective fair value — user μ/VRP · market mid vs fair</span>}>
          <div className="w-full min-h-0" style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={eChart} margin={chrome.margin}>
              <CartesianGrid {...chrome.grid} />
              <XAxis dataKey="strike" tick={chrome.tick} stroke={chrome.axisLine} tickFormatter={(v: number) => chartPriceTick(v)} />
              <YAxis tick={chrome.tick} stroke={chrome.axisLine} width={52} domain={eDomain} tickFormatter={(v: number) => chartSignedTick(v, 2)} />
              <Tooltip contentStyle={chrome.tooltipStyle} />
              <ReferenceLine x={snapshot.spot} stroke={DESK_SERIES.spot} strokeDasharray="3 3" />
              <Line type="monotone" dataKey="market" stroke={CHART.series.muted} strokeWidth={1.5} dot={false} name={DESK_LEGEND.market} />
              <Line type="monotone" dataKey="fair" stroke={CHART.series.brand} strokeWidth={2} dot={false} name={DESK_LEGEND.fair} />
              <Line type="monotone" dataKey="edge" stroke={CHART.series.info} strokeWidth={1} strokeDasharray="2 2" dot={false} name={DESK_LEGEND.edge} />
            </ComposedChart>
          </ResponsiveContainer>
          </div>
        </DeskChartFrame>
      </DeskToolShell>

      {/* F — Scenario Monte Carlo (NOT historical backtest) */}
      <DeskToolShell
        controls={<>
          <span className="self-center font-mono text-type-2xs text-amber-400" title="Scenario model with user-controlled vol; not a historical backtest with provenance">Scenario Monte Carlo — synthetic GBM · not Historical Backtest</span>
          <DeskField label="Weeks" value={weeks} onChange={setWeeks} step={1} min={1} max={26} />
          <DeskField label="Realized σ" value={rv} onChange={setRv} step={0.01} />
        </>}
        print={<PrintStrip items={[
          { label: 'E[PnL]', value: mcSim.meanTerminalPnl != null ? fmtSigned(mcSim.meanTerminalPnl) : '—', tone: mcSim.meanTerminalPnl != null && mcSim.meanTerminalPnl >= 0 ? 'up' : 'down' },
          { label: 'Win', value: mcSim.winRate != null ? fmtPct(mcSim.winRate) : '—' },
          { label: 'Weeks', value: String(weeks) },
          { label: 'σ', value: rv.toFixed(2) },
          ...(mcHedge ? [{ label: 'Hedge PnL', value: fmtSigned(mcHedge.terminalPnl), tone: (mcHedge.terminalPnl >= 0 ? 'up' : 'down') as 'up' | 'down' }] : []),
        ]} />}
      >
        <DeskChartFrame
          xTitle="Horizon (days)" yTitle="PnL ($)" className="min-h-[260px]" testId="pnl-chart-f" chartPoints={mcChart.length}
          header={<span className="text-muted-foreground" title="Scenario Monte Carlo — seed 42, not live history">Scenario Monte Carlo · {weeks}w · {mcSim.t.length} steps · 120 paths · GBM(μ=0, σ=user) · seed 42</span>}
        >
          <div className="w-full min-h-0" style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={mcChart} margin={chrome.margin}>
              <CartesianGrid {...chrome.grid} />
              <XAxis dataKey="t" tick={chrome.tick} stroke={chrome.axisLine} tickFormatter={(v: number) => chartDayTick(v)} />
              <YAxis tick={chrome.tick} stroke={chrome.axisLine} width={52} domain={mcDomain} tickFormatter={(v: number) => chartSignedTick(v, 0)} />
              <Tooltip contentStyle={chrome.tooltipStyle} />
              <ReferenceLine y={0} stroke={DESK_SERIES.zero} />
              <Area type="monotone" dataKey="p95" stroke="none" fill={DESK_SERIES.bandOuter} fillOpacity={0.12} />
              <Area type="monotone" dataKey="p5" stroke="none" fill="#000" fillOpacity={1} />
              <Area type="monotone" dataKey="p75" stroke="none" fill={DESK_SERIES.bandInner} fillOpacity={0.18} />
              <Area type="monotone" dataKey="p25" stroke="none" fill="#000" fillOpacity={1} />
              <Line type="monotone" dataKey="p50" stroke={DESK_SERIES.median} strokeWidth={2} dot={false} name="p50" />
            </ComposedChart>
          </ResponsiveContainer>
          </div>
        </DeskChartFrame>
      </DeskToolShell>
    </div>
  );
}
