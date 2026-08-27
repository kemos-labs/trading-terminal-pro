/**
 * Positioning desk — chain + dealer stack (GEX/DEX/VEX/Charm) + levels + parity edge.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  ComposedChart, Line, Cell,
} from 'recharts';
import { useTerminalStore } from '../../store/terminalStore';
import { Panel } from '../terminal/Panel';
import { OptionChain } from './OptionChain';
import { DiagnosticsStrip } from './DiagnosticsStrip';
import { Explain } from '../common/Explain';
import { EmptyState } from '../common/EmptyState';
import { SectionErrorBoundary } from '../common/SectionErrorBoundary';
import { VirtualRows } from '../common/VirtualRows';
import { FlashAlphaStrip } from '../positioning/FlashAlphaStrip';
import { fmtCompact, fmtPrice, fmtPct, fmtSigned } from '../../lib/format';

/** Compact signed notional for Δ columns. */
function fmtDeltaCompact(n: number): string {
  const c = fmtCompact(Math.abs(n));
  return n >= 0 ? `+${c}` : `−${c}`;
}
import {
  dealerExposure,
  dealerExposureByExpiry,
  dealerProfiles,
  impliedMove,
  maxPainStrike,
  scanParityEdges,
  type DealerMetric,
  type ExposureWeight,
} from '../../lib/options/analytics';
import { interpretHedgeFlow, riskBudgetGeometry } from '../../lib/options/hedgeFlow';
import { cn } from '../../lib/utils';
import { CHART } from '../../lib/chartTheme';
import {
  useBoardFocus,
  useRegisterBoard,
  type FocusableBoardApi,
} from '../../hooks/useBoardFocus';
import { PERF_BUDGET } from '../../config/perfBudget';
import { GexLevelsStrip } from '../common/GexLevelsStrip';
import { StrategyBuilderStrip } from '../common/StrategyBuilderStrip';
import { consumeDeskJumpOnMount } from '../../lib/market/deskJump';
import { DeskChartFrame, deskChartChrome, deskAxisLabel } from '../desk/DeskChart';
import { PrintStrip } from '../desk/PrintStrip';
import { DESK_SERIES } from '../desk/seriesGrammar';
import { DeskModeBar } from '../terminal/DeskModeBar';
import { DealerGradientPanel } from './DealerGradientPanel';
import { DealerGreekProfiles } from './DealerGreekProfiles';
import { SessionGexHeatmap } from './SessionGexHeatmap';
import {
  computeGexBookDeltas,
  loadGexBook,
  recordGexBook,
  type GexBookDeltas,
} from '../../lib/options/gexBookStore';
import { buildBasisCurve } from '../../lib/options/basis';

/** Book = chain+dealer side-by-side; Tools = levels + edge + strategy stacked. */
type Sub = 'book' | 'tools';

function resolveFlowSub(deskSectionId: string | null): Sub {
  if (
    deskSectionId === 'pos-sub-tools'
    || deskSectionId === 'pos-sub-levels'
    || deskSectionId === 'pos-sub-edge'
    || deskSectionId === 'pos-sub-strategy'
  ) {
    return 'tools';
  }
  // chain, dealer, or default → one Book workspace (not two separate desks)
  return 'book';
}

const METRICS: { id: DealerMetric; label: string; term: string; unit: string }[] = [
  { id: 'gex', label: 'GEX', term: 'gex', unit: '$ γ·S exposure' },
  { id: 'dex', label: 'DEX', term: 'dex', unit: '$ δ notional' },
  { id: 'vex', label: 'VEX', term: 'vex', unit: 'vanna · S' },
  { id: 'charm', label: 'Charm', term: 'charmExposure', unit: '$ Δ / day' },
];

function metricFields(m: DealerMetric) {
  switch (m) {
    case 'dex': return { call: 'callDEX' as const, put: 'putDEX' as const, net: 'netDEX' as const, total: 'totalDEX' as const };
    case 'vex': return { call: 'callVEX' as const, put: 'putVEX' as const, net: 'netVEX' as const, total: 'totalVEX' as const };
    case 'charm': return { call: 'callCharm' as const, put: 'putCharm' as const, net: 'netCharm' as const, total: 'totalCharm' as const };
    default: return { call: 'callGEX' as const, put: 'putGEX' as const, net: 'netGEX' as const, total: 'totalGEX' as const };
  }
}

type StrikeZoom = 'all' | 'atm20' | 'atm10' | 'atm5';
/** Book slice for MenthorQ-style net GEX chart. */
type ExpMode = 'all' | '0dte' | 'front' | string; // string = exact expiry

export function PositioningView() {
  const deskSectionId = useTerminalStore((s) => s.deskSectionId);
  // Book = chain + dealer together; Tools = Lvl+Edge+Strat stacked.
  const sub: Sub = resolveFlowSub(deskSectionId);
  const flowSplit = sub === 'book';
  const [metric, setMetric] = useState<DealerMetric>('gex');
  const [weight, setWeight] = useState<ExposureWeight>('oi');
  const [strikeZoom, setStrikeZoom] = useState<StrikeZoom>('atm20');
  const [expMode, setExpMode] = useState<ExpMode>('all');
  const [profileOn, setProfileOn] = useState(true);
  const snapshot = useTerminalStore((s) => s.snapshot);
  const symbol = useTerminalStore((s) => s.symbol);
  const sviReadout = useTerminalStore((s) => s.sviReadout);
  const arbResult = useTerminalStore((s) => s.arbResult);
  const setDeskContext = useTerminalStore((s) => s.setDeskContext);
  const [bookDeltas, setBookDeltas] = useState<GexBookDeltas>(() =>
    computeGexBookDeltas(loadGexBook(symbol)),
  );

  useEffect(() => consumeDeskJumpOnMount(), []);

  useEffect(() => {
    if (sub === 'tools') {
      setDeskContext({ id: 'pos-sub-tools', label: 'Tools', apis: [] });
    } else {
      setDeskContext({ id: 'pos-sub-chain', label: 'Book', apis: [] });
    }
    return () => setDeskContext({ id: null, label: null, apis: [] });
  }, [sub, setDeskContext]);

  const dealerOpts = useMemo(() => {
    const base: { weight: ExposureWeight; maxDte?: number; expiry?: string } = { weight };
    if (expMode === '0dte') base.maxDte = 0;
    else if (expMode === 'front' && snapshot?.expiries[0]) {
      base.expiry = snapshot.expiries[0].expiry;
    } else if (expMode !== 'all' && expMode !== '0dte' && expMode !== 'front') {
      base.expiry = expMode;
    }
    return base;
  }, [weight, expMode, snapshot]);

  const dealer = useMemo(
    () => (snapshot ? dealerExposure(snapshot, dealerOpts) : null),
    [snapshot, dealerOpts],
  );
  /** Full book for strip totals / matrix Tot row (unfiltered by expMode). */
  const dealerAll = useMemo(
    () => (snapshot ? dealerExposure(snapshot, { weight }) : null),
    [snapshot, weight],
  );
  const expiryRows = useMemo(
    () => (snapshot ? dealerExposureByExpiry(snapshot, { weight }) : []),
    [snapshot, weight],
  );

  /** Sample book for 1D / session GEX·DEX Δ (browser localStorage). */
  useEffect(() => {
    if (!dealerAll || !snapshot) return;
    const store = recordGexBook(
      symbol,
      dealerAll.totalGEX,
      dealerAll.totalDEX,
      expiryRows,
    );
    setBookDeltas(computeGexBookDeltas(store));
  }, [
    symbol,
    dealerAll?.totalGEX,
    dealerAll?.totalDEX,
    expiryRows,
    snapshot,
  ]);

  useEffect(() => {
    setBookDeltas(computeGexBookDeltas(loadGexBook(symbol)));
  }, [symbol]);

  const profiles = useMemo(() => (dealer ? dealerProfiles(dealer) : []), [dealer]);
  const equityBasis = useMemo(
    () => (snapshot ? buildBasisCurve(snapshot) : null),
    [snapshot],
  );
  const maxPain = useMemo(() => (snapshot ? maxPainStrike(snapshot) : null), [snapshot]);
  const move = useMemo(() => (snapshot ? impliedMove(snapshot) : null), [snapshot]);
  const flowBrief = useMemo(() => {
    if (!snapshot || !dealer) return null;
    return interpretHedgeFlow({
      totalGEX: dealer.totalGEX,
      totalVEX: dealer.totalVEX,
      totalCharm: dealer.totalCharm,
      spot: snapshot.spot,
      gammaFlip: dealer.gammaFlip,
    });
  }, [snapshot, dealer]);
  const riskBudget = useMemo(() => {
    if (!snapshot?.expiries[0]) return null;
    const front = snapshot.expiries[0];
    return riskBudgetGeometry({
      spot: snapshot.spot,
      atmIV: front.atmIV,
      dte: front.dte,
      expiry: front.expiry,
      straddle: move?.straddle,
    });
  }, [snapshot, move]);
  const parity = useMemo(
    () => (snapshot ? scanParityEdges(snapshot) : []),
    [snapshot],
  );

  const fields = metricFields(metric);
  const totalVal = dealer ? (dealer[fields.total] as number) : 0;

  const zoomThr = strikeZoom === 'atm5' ? 0.05 : strikeZoom === 'atm10' ? 0.10 : strikeZoom === 'atm20' ? 0.20 : Infinity;

  const chartData = useMemo(() => {
    if (!dealer || !snapshot) return [];
    const spot = snapshot.spot;
    const profByStrike = new Map(profiles.map((p) => [p.strike, p]));
    return dealer.points
      .filter((p) => zoomThr === Infinity || Math.abs(p.strike - spot) / spot <= zoomThr)
      .map((p) => {
        const prof = profByStrike.get(p.strike);
        return {
          strike: p.strike,
          label: fmtPrice(p.strike, p.strike > 1000 ? 0 : 2),
          call: (p[fields.call] as number) / 1e6,
          put: (p[fields.put] as number) / 1e6,
          net: (p[fields.net] as number) / 1e6,
          netGex: p.netGEX / 1e6,
          netDex: p.netDEX / 1e6,
          gexCum: (prof?.gexCum ?? 0) / 1e6,
          dexCum: (prof?.dexCum ?? 0) / 1e6,
        };
      });
  }, [dealer, fields.call, fields.put, fields.net, snapshot, zoomThr, profiles]);

  /** Snap a price to nearest chart category label (Recharts categorical X needs exact match). */
  const nearestLabel = (price: number | null | undefined): string | null => {
    if (price == null || !chartData.length) return null;
    let best = chartData[0]!;
    let bestAbs = Math.abs(best.strike - price);
    for (const p of chartData) {
      const d = Math.abs(p.strike - price);
      if (d < bestAbs) {
        bestAbs = d;
        best = p;
      }
    }
    return best.label;
  };
  const spotLabel = nearestLabel(snapshot?.spot);
  const flipLabel = metric === 'gex' ? nearestLabel(dealer?.gammaFlip) : null;
  const callWallLabel = metric === 'gex' ? nearestLabel(dealer?.callWall) : null;
  const putWallLabel = metric === 'gex' ? nearestLabel(dealer?.putWall) : null;
  const hvlLabel = metric === 'gex' ? nearestLabel(dealer?.highVolLevel) : null;

  /** Top GEX expiries for 2×2 small multiples (Phase 0.5). */
  const multiExpPanels = useMemo(() => {
    if (!snapshot || expiryRows.length === 0) return [];
    const byAbs = [...expiryRows].sort((a, b) => Math.abs(b.totalGEX) - Math.abs(a.totalGEX));
    const picks: typeof expiryRows = [];
    if (expiryRows[0]) picks.push(expiryRows[0]); // front
    if (expiryRows[1] && !picks.find((p) => p.expiry === expiryRows[1]!.expiry)) {
      picks.push(expiryRows[1]!);
    }
    for (const r of byAbs) {
      if (picks.length >= 4) break;
      if (!picks.find((p) => p.expiry === r.expiry)) picks.push(r);
    }
    return picks.slice(0, 4).map((row) => {
      const d = dealerExposure(snapshot, { expiry: row.expiry, weight });
      const pts = d.points
        .filter((p) => Math.abs(p.strike - snapshot.spot) / snapshot.spot <= 0.08)
        .map((p) => ({
          label: fmtPrice(p.strike, 0),
          net: p.netGEX / 1e6,
        }));
      return { row, pts, spot: snapshot.spot };
    });
  }, [snapshot, expiryRows, weight]);

  const chartRef = useRef(chartData);
  chartRef.current = chartData;
  const { focused: dealerFocused, rowIndex: dealerRow, focusRow: focusDealer } = useBoardFocus('dealer-bars');
  const dealerApi = useMemo<FocusableBoardApi>(
    () => ({
      scrollToRow: () => {},
      getCellText: (row, colKey) => {
        const r = chartRef.current[row];
        if (!r) return '';
        if (colKey === 'net') return String(r.net);
        return String(r.strike);
      },
      rowCount: () => chartRef.current.length,
      colKeys: () => ['strike', 'net'],
    }),
    [],
  );
  useRegisterBoard('dealer-bars', flowSplit && chartData.length ? dealerApi : null);

  const oiByExpiry = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.expiries.map((e) => {
      const callOI = e.calls.reduce((s, q) => s + q.openInterest, 0);
      const putOI = e.puts.reduce((s, q) => s + q.openInterest, 0);
      return {
        label: `${e.dte}d`,
        callOI,
        putOI,
        total: callOI + putOI,
        pcr: callOI > 0 ? putOI / callOI : null,
      };
    });
  }, [snapshot]);

  const tradeableParity = parity.filter((r) => r.tradeable);

  const flip = dealer?.gammaFlip;
  const aboveFlip = flip != null && snapshot ? snapshot.spot >= flip : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sticky GEX walls + regime + session path (Phase 2.5 / 3) */}
      <GexLevelsStrip className="bg-card/50" showSpark />

      {/* Print strip under sticky walls — B density */}
      {snapshot && (
        <div className="border-b border-border px-2 py-1">
          <PrintStrip
            items={[
              {
                label: 'γ-flip',
                value:
                  flip == null
                    ? '—'
                    : aboveFlip
                      ? `ABOVE ${fmtPrice(flip, 0)}`
                      : `BELOW ${fmtPrice(flip, 0)}`,
                tone: flip == null ? 'muted' : aboveFlip ? 'up' : 'down',
              },
              {
                label: 'Max pain',
                value: maxPain != null ? fmtPrice(maxPain, 0) : '—',
              },
              {
                label: 'Move',
                value: move ? `±${fmtPrice(move.move)}` : '—',
                tone: 'muted',
              },
              {
                label: 'Parity',
                value: tradeableParity.length > 0 ? String(tradeableParity.length) : '0',
                tone: tradeableParity.length > 0 ? 'default' : 'muted',
              },
              {
                label: 'Weight',
                value: dealer?.weight ?? '—',
                tone: 'muted',
                title: dealer?.unitNote,
              },
            ]}
          />
        </div>
      )}

      <div className="min-h-0 flex-1">
        {flowSplit && (
          <div className="flex h-full min-h-0 flex-col lg:flex-row">
            <div className="min-h-0 min-w-0 flex-1 border-b border-border lg:border-b-0 lg:border-r">
        <SectionErrorBoundary name="Chain">
            <Panel title="Option Chain" className="h-full">
              <div className="flex h-full flex-col">
                <DiagnosticsStrip sviReadout={sviReadout} arbResult={arbResult} />
                <div className="min-h-0 flex-1">
                  <OptionChain />
                </div>
              </div>
            </Panel>
          </SectionErrorBoundary>
            </div>
            <div className="min-h-0 min-w-0 flex-[1.15]">
          <SectionErrorBoundary name="Dealer">
          <Panel
            title={<Explain term="dealerStack">Net GEX · DEX Profile</Explain>}
            subtitle="OI-inferred · customer-long OI · dealers short that book · not verified MM books"
            className="h-full"
          >
            {!dealer || dealer.points.length === 0 ? (
              <EmptyState
                kind="no-data"
                title="No dealer exposure"
                body="Chain has no open interest, volume, or γ to weight. Wait for a live chain or try another symbol."
              />
            ) : (
              <div className="flex h-full min-h-0 flex-col overflow-y-auto">
                {dealer.weightFallback && (
                  <div
                    className="shrink-0 border-b border-warn/30 bg-warn/10 px-3 py-1 font-mono text-type-2xs text-warn"
                    role="status"
                  >
                    {dealer.unitNote}
                  </div>
                )}
                <div className="flex flex-col gap-1 border-b border-border px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <DeskModeBar
                      items={METRICS.map((m) => ({
                        id: m.id,
                        label: m.label,
                        title: m.unit,
                      }))}
                      activeId={metric}
                      onSelect={(id) => setMetric(id as DealerMetric)}
                    />
                    <DeskModeBar
                      items={[
                        { id: 'all', label: 'All exp', short: 'All' },
                        { id: '0dte', label: '0DTE', short: '0D' },
                        { id: 'front', label: 'Front', short: 'Fr' },
                      ]}
                      activeId={
                        expMode === 'all' || expMode === '0dte' || expMode === 'front'
                          ? expMode
                          : 'all'
                      }
                      onSelect={(id) => setExpMode(id as ExpMode)}
                      className="ml-1"
                    />
                    <DeskModeBar
                      items={[
                        {
                          id: 'oi',
                          label: dealer.weightFallback && weight === 'oi' ? 'OI·auto' : 'OI',
                          title: 'Open interest (auto→volume if OI missing)',
                        },
                        { id: 'volume', label: 'Vol', title: 'Session volume weight' },
                        { id: 'unit', label: 'Unit', title: '1 per listed contract' },
                      ]}
                      activeId={
                        weight === 'oi' || weight === 'volume' || weight === 'unit'
                          ? weight
                          : dealer.weight
                      }
                      onSelect={(id) => setWeight(id as ExposureWeight)}
                      className="ml-1"
                    />
                    <DeskModeBar
                      items={[
                        { id: 'atm5', label: '±5%' },
                        { id: 'atm10', label: '±10%' },
                        { id: 'atm20', label: '±20%' },
                        { id: 'all', label: 'All K' },
                      ]}
                      activeId={strikeZoom}
                      onSelect={(id) => setStrikeZoom(id as StrikeZoom)}
                      className="ml-1"
                    />
                    <button
                      type="button"
                      onClick={() => setProfileOn((v) => !v)}
                      className={cn(
                        'rounded px-1.5 py-0.5 font-mono text-type-2xs border',
                        profileOn
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border text-muted-foreground',
                      )}
                      title="Toggle cumulative GEX/DEX profile lines"
                    >
                      <Explain term="gexProfile">Profiles</Explain>
                    </button>
                  </div>
                  <PrintStrip
                    items={[
                      {
                        label: `Σ ${metric.toUpperCase()}`,
                        value: fmtCompact(totalVal),
                        tone: totalVal >= 0 ? 'up' : 'down',
                      },
                      {
                        label: 'DEX',
                        value: fmtCompact(dealer.totalDEX),
                        tone: dealer.totalDEX >= 0 ? 'up' : 'down',
                      },
                      {
                        label: 'CR',
                        value: dealer.callWall != null ? fmtPrice(dealer.callWall, 0) : '—',
                        tone: 'up',
                      },
                      {
                        label: 'PS',
                        value: dealer.putWall != null ? fmtPrice(dealer.putWall, 0) : '—',
                        tone: 'down',
                      },
                      {
                        label: 'HVL',
                        value: dealer.highVolLevel != null ? fmtPrice(dealer.highVolLevel, 0) : '—',
                      },
                      {
                        label: 'Flip',
                        value: dealer.gammaFlip != null ? fmtPrice(dealer.gammaFlip, 0) : '—',
                      },
                    ]}
                  />
                </div>
                <div className="flex min-h-[220px] flex-1 flex-col lg:flex-row">
                  <div className="relative min-h-[200px] min-w-0 flex-1 basis-0 lg:min-h-0">
                    <div className="absolute inset-0 p-0.5">
                      <DeskChartFrame
                        xTitle="Strike"
                        yTitle={
                          metric === 'gex'
                            ? 'Net GEX ($M)'
                            : `Net ${metric.toUpperCase()} ($M)`
                        }
                        className="h-full"
                      >
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={chartData}
                          margin={{
                            ...deskChartChrome().margin,
                            right: profileOn ? 44 : deskChartChrome().margin.right,
                            top: 18,
                          }}
                        >
                          <CartesianGrid {...deskChartChrome().grid} />
                          <XAxis
                            dataKey="label"
                            tick={{ ...deskChartChrome().tick, fontSize: 9 }}
                            tickLine={false}
                            stroke={deskChartChrome().axisLine}
                            interval={Math.max(0, Math.floor(chartData.length / 14))}
                            label={deskAxisLabel('Strike')}
                          />
                          <YAxis
                            yAxisId="bar"
                            tick={deskChartChrome().tick}
                            tickLine={false}
                            stroke={deskChartChrome().axisLine}
                            width={44}
                            tickFormatter={(v: number) => `${v.toFixed(0)}M`}
                            label={deskAxisLabel(
                              metric === 'gex' ? 'Net GEX ($M)' : `Net ${metric.toUpperCase()} ($M)`,
                              'insideLeft',
                            )}
                          />
                          {profileOn && metric === 'gex' && (
                            <YAxis
                              yAxisId="cum"
                              orientation="right"
                              tick={{ ...deskChartChrome().tick, fontSize: 8 }}
                              tickLine={false}
                              stroke={deskChartChrome().axisLine}
                              width={40}
                              tickFormatter={(v: number) => `${v.toFixed(0)}M`}
                              label={deskAxisLabel('Cum ($M)', 'insideRight')}
                            />
                          )}
                          <Tooltip contentStyle={deskChartChrome().tooltipStyle} />
                          <ReferenceLine yAxisId="bar" y={0} stroke={DESK_SERIES.zero} />
                          {spotLabel && (
                            <ReferenceLine
                              yAxisId="bar"
                              x={spotLabel}
                              stroke={DESK_SERIES.spot}
                              strokeDasharray="4 4"
                              label={{ value: 'Spot', position: 'top', fill: DESK_SERIES.spot, fontSize: 9, fontFamily: 'JetBrains Mono' }}
                            />
                          )}
                          {flipLabel && flipLabel !== spotLabel && (
                            <ReferenceLine
                              yAxisId="bar"
                              x={flipLabel}
                              stroke={CHART.series.down}
                              strokeDasharray="3 3"
                              label={{ value: 'Flip', position: 'top', fill: CHART.series.down, fontSize: 8, fontFamily: 'JetBrains Mono' }}
                            />
                          )}
                          {callWallLabel && (
                            <ReferenceLine
                              yAxisId="bar"
                              x={callWallLabel}
                              stroke={CHART.series.up}
                              strokeDasharray="2 4"
                              label={{ value: 'CR', position: 'top', fill: CHART.series.up, fontSize: 8, fontFamily: 'JetBrains Mono' }}
                            />
                          )}
                          {putWallLabel && putWallLabel !== callWallLabel && (
                            <ReferenceLine
                              yAxisId="bar"
                              x={putWallLabel}
                              stroke={CHART.series.down}
                              strokeOpacity={0.85}
                              strokeDasharray="2 4"
                              label={{ value: 'PS', position: 'top', fill: CHART.series.down, fontSize: 8, fontFamily: 'JetBrains Mono' }}
                            />
                          )}
                          {hvlLabel && hvlLabel !== callWallLabel && hvlLabel !== putWallLabel && (
                            <ReferenceLine
                              yAxisId="bar"
                              x={hvlLabel}
                              stroke={CHART.series.amber}
                              strokeDasharray="5 3"
                              label={{ value: 'HVL', position: 'top', fill: CHART.series.amber, fontSize: 8, fontFamily: 'JetBrains Mono' }}
                            />
                          )}
                          {metric === 'gex' ? (
                            <Bar yAxisId="bar" dataKey="netGex" name="Net GEX $M" isAnimationActive={false}>
                              {chartData.map((row) => (
                                <Cell
                                  key={row.strike}
                                  fill={row.netGex >= 0 ? CHART.series.up : CHART.series.down}
                                  fillOpacity={0.88}
                                />
                              ))}
                            </Bar>
                          ) : (
                            <Bar yAxisId="bar" dataKey="net" fill={CHART.series.cyan} opacity={0.9} name="Net" isAnimationActive={false} />
                          )}
                          {profileOn && metric === 'gex' && (
                            <>
                              <Line
                                yAxisId="cum"
                                type="monotone"
                                dataKey="gexCum"
                                name="GEX profile"
                                stroke={CHART.series.amber}
                                strokeWidth={1.75}
                                dot={false}
                                isAnimationActive={false}
                              />
                              <Line
                                yAxisId="cum"
                                type="monotone"
                                dataKey="dexCum"
                                name="DEX profile"
                                stroke={DESK_SERIES.short}
                                strokeWidth={1.5}
                                strokeDasharray="4 2"
                                dot={false}
                                isAnimationActive={false}
                              />
                            </>
                          )}
                        </ComposedChart>
                      </ResponsiveContainer>
                      </DeskChartFrame>
                    </div>
                  </div>
                  <div className="flex h-44 w-full shrink-0 flex-col border-t border-border lg:h-auto lg:min-h-0 lg:w-48 lg:border-l lg:border-t-0">
                    <div className="shrink-0 border-b border-border/60 px-1.5 py-0.5 font-mono text-type-2xs text-muted-foreground">
                      STRIKES · j/k · y copy
                    </div>
                    <div className="min-h-0 flex-1">
                      <VirtualRows
                        items={chartData}
                        rowHeight={22}
                        overscanCount={PERF_BUDGET.virtualOverscan}
                        height="100%"
                        className="h-full"
                        renderRow={({ index, style, item: r }) => {
                          const isFocused = dealerFocused && index === dealerRow;
                          return (
                            <div
                              style={style}
                              role="row"
                              aria-selected={isFocused}
                              onClick={() => focusDealer(index, 'strike')}
                              className={cn(
                                'flex cursor-default items-center justify-between gap-1 border-b border-border/30 px-1.5 font-mono text-type-2xs hover:bg-muted/20',
                                isFocused && 'focus-ring-term-inset bg-primary/10',
                              )}
                            >
                              <span className="tabular-nums text-foreground">{r.label}</span>
                              <span
                                className={cn(
                                  'tabular-nums',
                                  r.net >= 0 ? 'text-up' : 'text-down',
                                )}
                              >
                                {r.net.toFixed(1)}M
                              </span>
                            </div>
                          );
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Expiry matrix + 1D / session Δ */}
                {expiryRows.length > 0 && (
                  <div className="shrink-0 border-t border-border">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1 font-mono text-type-2xs text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        EXPIRY MATRIX · GEX / DEX / Δ1D · CR / PS / HVL
                      </span>
                      <Explain term="gexChange1d">
                        <span className="cursor-help underline decoration-dotted">
                          {bookDeltas.hasPriorDay
                            ? `Δ1D vs ${bookDeltas.priorDay}`
                            : 'Δ1D after prior day sample'}
                        </span>
                      </Explain>
                      {bookDeltas.gexSession != null && (
                        <span title="Session change from first sample today">
                          sess GEX{' '}
                          <span className={bookDeltas.gexSession >= 0 ? 'text-up' : 'text-down'}>
                            {fmtDeltaCompact(bookDeltas.gexSession)}
                          </span>
                        </span>
                      )}
                    </div>
                    <div className="max-h-40 overflow-auto">
                      <table className="w-full border-collapse font-mono text-type-2xs">
                        <thead className="sticky top-0 bg-card">
                          <tr className="text-muted-foreground">
                            <th className="px-2 py-0.5 text-left font-normal">DTE</th>
                            <th className="px-1 py-0.5 text-right font-normal">GEX</th>
                            <th className="px-1 py-0.5 text-right font-normal">ΔG1D</th>
                            <th className="px-1 py-0.5 text-right font-normal">%G</th>
                            <th className="px-1 py-0.5 text-right font-normal">DEX</th>
                            <th className="px-1 py-0.5 text-right font-normal">ΔD1D</th>
                            <th className="px-1 py-0.5 text-right font-normal">CR</th>
                            <th className="px-1 py-0.5 text-right font-normal">PS</th>
                            <th className="px-1 py-0.5 text-right font-normal">HVL</th>
                            <th className="px-1 py-0.5 text-right font-normal">EM</th>
                          </tr>
                        </thead>
                        <tbody>
                          {expiryRows.map((r) => {
                            const d1 = bookDeltas.byExpiry1d.get(r.expiry);
                            return (
                              <tr
                                key={r.expiry}
                                className={cn(
                                  'cursor-pointer border-t border-border/40 hover:bg-muted/20',
                                  expMode === r.expiry && 'bg-primary/10',
                                )}
                                onClick={() => setExpMode(r.expiry)}
                              >
                                <td className="px-2 py-0.5 tabular-nums text-foreground">{r.dte}d</td>
                                <td className={cn('px-1 py-0.5 text-right tabular-nums', r.totalGEX >= 0 ? 'text-up' : 'text-down')}>
                                  {fmtCompact(r.totalGEX)}
                                </td>
                                <td
                                  className={cn(
                                    'px-1 py-0.5 text-right tabular-nums',
                                    d1?.gex1d == null
                                      ? 'text-muted-foreground'
                                      : d1.gex1d >= 0
                                        ? 'text-up'
                                        : 'text-down',
                                  )}
                                >
                                  {d1?.gex1d != null ? fmtDeltaCompact(d1.gex1d) : '—'}
                                </td>
                                <td className="px-1 py-0.5 text-right tabular-nums text-muted-foreground">
                                  {(r.gexShare * 100).toFixed(0)}%
                                </td>
                                <td className={cn('px-1 py-0.5 text-right tabular-nums', r.totalDEX >= 0 ? 'text-up' : 'text-down')}>
                                  {fmtCompact(r.totalDEX)}
                                </td>
                                <td
                                  className={cn(
                                    'px-1 py-0.5 text-right tabular-nums',
                                    d1?.dex1d == null
                                      ? 'text-muted-foreground'
                                      : d1.dex1d >= 0
                                        ? 'text-up'
                                        : 'text-down',
                                  )}
                                >
                                  {d1?.dex1d != null ? fmtDeltaCompact(d1.dex1d) : '—'}
                                </td>
                                <td className="px-1 py-0.5 text-right tabular-nums text-up">
                                  {r.callWall != null ? fmtPrice(r.callWall, 0) : '—'}
                                </td>
                                <td className="px-1 py-0.5 text-right tabular-nums text-down">
                                  {r.putWall != null ? fmtPrice(r.putWall, 0) : '—'}
                                </td>
                                <td className="px-1 py-0.5 text-right tabular-nums text-amber">
                                  {r.highVolLevel != null ? fmtPrice(r.highVolLevel, 0) : '—'}
                                </td>
                                <td className="px-1 py-0.5 text-right tabular-nums text-muted-foreground">
                                  {r.expMove != null ? `±${fmtPrice(r.expMove, 0)}` : '—'}
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="border-t border-border bg-muted/10 font-semibold">
                            <td className="px-2 py-0.5">Tot</td>
                            <td className={cn('px-1 py-0.5 text-right', (dealerAll?.totalGEX ?? 0) >= 0 ? 'text-up' : 'text-down')}>
                              {dealerAll ? fmtCompact(dealerAll.totalGEX) : '—'}
                            </td>
                            <td
                              className={cn(
                                'px-1 py-0.5 text-right',
                                bookDeltas.gex1d == null
                                  ? 'text-muted-foreground'
                                  : bookDeltas.gex1d >= 0
                                    ? 'text-up'
                                    : 'text-down',
                              )}
                            >
                              {bookDeltas.gex1d != null
                                ? fmtDeltaCompact(bookDeltas.gex1d)
                                : '—'}
                            </td>
                            <td className="px-1 py-0.5 text-right text-muted-foreground">100%</td>
                            <td className={cn('px-1 py-0.5 text-right', (dealerAll?.totalDEX ?? 0) >= 0 ? 'text-up' : 'text-down')}>
                              {dealerAll ? fmtCompact(dealerAll.totalDEX) : '—'}
                            </td>
                            <td
                              className={cn(
                                'px-1 py-0.5 text-right',
                                bookDeltas.dex1d == null
                                  ? 'text-muted-foreground'
                                  : bookDeltas.dex1d >= 0
                                    ? 'text-up'
                                    : 'text-down',
                              )}
                            >
                              {bookDeltas.dex1d != null
                                ? fmtDeltaCompact(bookDeltas.dex1d)
                                : '—'}
                            </td>
                            <td colSpan={4} className="px-1 py-0.5 text-right text-muted-foreground">
                              all exp · browser sample
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Gamma + Charm strike profiles (VS3D teaching cards) */}
                {snapshot && (
                  <div className="shrink-0 border-t border-border p-2">
                    <DealerGreekProfiles
                      snapshot={snapshot}
                      weight={weight}
                      expiry={
                        expMode !== 'all' && expMode !== '0dte' && expMode !== 'front'
                          ? expMode
                          : expMode === 'front' && snapshot.expiries[0]
                            ? snapshot.expiries[0].expiry
                            : null
                      }
                      maxDte={expMode === '0dte' ? 0 : null}
                    />
                  </div>
                )}

                {/* VS3D/TRACE session 3-pane: pos ‖ γ ‖ charm (K × time) */}
                {snapshot && (
                  <SessionGexHeatmap
                    snapshot={snapshot}
                    symbol={symbol}
                    weight={weight}
                  />
                )}

                {/* Calendar K×DTE gradients (structure across expiries) */}
                {snapshot && (
                  <DealerGradientPanel
                    snapshot={snapshot}
                    weight={weight}
                    onExpiryPick={(exp: any) => setExpMode(exp)}
                  />
                )}

                {/* Multi-exp small multiples */}
                {multiExpPanels.length >= 2 && (
                  <div className="shrink-0 border-t border-border p-2">
                    <div className="mb-1 font-mono text-type-2xs font-semibold text-muted-foreground">
                      FOCUS EXPIRIES · net GEX ±8%
                    </div>
                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                      {multiExpPanels.map(({ row, pts }) => (
                        <button
                          key={row.expiry}
                          type="button"
                          onClick={() => setExpMode(row.expiry)}
                          className={cn(
                            'rounded border border-border bg-card/40 p-1 text-left hover:border-primary/50',
                            expMode === row.expiry && 'border-primary/60 ring-1 ring-primary/30',
                          )}
                        >
                          <div className="mb-0.5 flex justify-between font-mono text-type-2xs">
                            <span className="text-foreground">{row.dte}d</span>
                            <span className={row.totalGEX >= 0 ? 'text-up' : 'text-down'}>
                              {fmtCompact(row.totalGEX)}
                            </span>
                          </div>
                          <div className="h-16 rounded border border-border/40 bg-black">
                            {pts.length === 0 ? (
                              <div className="flex h-full items-center justify-center text-type-2xs text-muted-foreground">—</div>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={pts} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
                                  <ReferenceLine y={0} stroke={DESK_SERIES.zero} />
                                  <Bar dataKey="net" isAnimationActive={false}>
                                    {pts.map((p, i) => (
                                      <Cell
                                        key={i}
                                        fill={p.net >= 0 ? CHART.series.up : CHART.series.down}
                                        fillOpacity={0.85}
                                      />
                                    ))}
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <div className="mt-0.5 flex gap-1 font-mono text-type-2xs text-muted-foreground">
                            <span className="text-up">CR {row.callWall != null ? fmtPrice(row.callWall, 0) : '—'}</span>
                            <span className="text-down">PS {row.putWall != null ? fmtPrice(row.putWall, 0) : '—'}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="border-t border-border px-3 py-1 font-mono text-type-2xs text-muted-foreground leading-snug">
                  Green/red bars = net GEX by strike. Yellow line = cum GEX profile; dashed orange = cum DEX profile.
                  CR = Call Resistance · PS = Put Support · HVL = max |GEX| strike. OI-inferred · not a free signal.
                </div>
              </div>
            )}
          </Panel>
          </SectionErrorBoundary>
            </div>
          </div>
        )}

        {sub === 'tools' && (
          <SectionErrorBoundary name="Flow tools">
          <div className="h-full overflow-y-auto p-2 space-y-2">
            {/* Levels · Edge · Strat stacked — one red-bar "Tools" entry */}
            {flowBrief && (
              <Panel
                title={<Explain term="hedgeFlow">Hedge Flow Brief</Explain>}
                className="mb-2"
              >
                <div className="space-y-1.5 p-3 font-mono text-type-2xs leading-snug">
                  <p
                    className={cn(
                      'text-type-xs font-semibold',
                      flowBrief.tone === 'up'
                        ? 'text-up'
                        : flowBrief.tone === 'down'
                          ? 'text-down'
                          : flowBrief.tone === 'warn'
                            ? 'text-warn'
                            : 'text-foreground',
                    )}
                  >
                    {flowBrief.headline}
                  </p>
                  <p className="text-muted-foreground">{flowBrief.bias}</p>
                  {flowBrief.interaction && (
                    <p className="text-warn/90">{flowBrief.interaction}</p>
                  )}
                  <p className="text-muted-foreground/80">{flowBrief.sessionNote}</p>
                  <p className="text-muted-foreground/70">
                    OI-inferred inventory · not verified dealer books · not a trade signal
                  </p>
                </div>
              </Panel>
            )}
            <FlashAlphaStrip />
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              <Panel title={<Explain term="keyLevels">Dealer Levels</Explain>}>
                <div className="flex flex-col gap-1.5 p-2">
                  <PrintStrip
                    items={[
                      { label: 'Spot', value: snapshot ? fmtPrice(snapshot.spot) : '—' },
                      {
                        label: 'γ-flip',
                        value: dealer?.gammaFlip != null ? fmtPrice(dealer.gammaFlip, 0) : '—',
                      },
                      {
                        label: 'CR',
                        value: dealer?.callWall != null ? fmtPrice(dealer.callWall, 0) : '—',
                        tone: 'up',
                      },
                      {
                        label: 'PS',
                        value: dealer?.putWall != null ? fmtPrice(dealer.putWall, 0) : '—',
                        tone: 'down',
                      },
                      {
                        label: 'HVL',
                        value: dealer?.highVolLevel != null ? fmtPrice(dealer.highVolLevel, 0) : '—',
                      },
                      {
                        label: 'Max pain',
                        value: maxPain != null ? fmtPrice(maxPain, 0) : '—',
                      },
                    ]}
                  />
                  <PrintStrip
                    items={[
                      {
                        label: 'Σ GEX',
                        value: dealer ? fmtCompact(dealer.totalGEX) : '—',
                        tone: (dealer?.totalGEX ?? 0) >= 0 ? 'up' : 'down',
                      },
                      {
                        label: 'Σ DEX',
                        value: dealer ? fmtCompact(dealer.totalDEX) : '—',
                        tone: (dealer?.totalDEX ?? 0) >= 0 ? 'up' : 'down',
                      },
                      {
                        label: 'Σ Charm/d',
                        value: dealer ? fmtCompact(dealer.totalCharm) : '—',
                      },
                      {
                        label: 'Σ VEX',
                        value: dealer ? fmtCompact(dealer.totalVEX) : '—',
                      },
                      {
                        label: 'EM $',
                        value: move ? `±${fmtPrice(move.move)}` : '—',
                        tone: 'muted',
                      },
                      {
                        label: 'EM %',
                        value: move ? fmtPct(move.movePct) : '—',
                        tone: 'muted',
                      },
                      {
                        label: 'P(touch)',
                        value: move ? fmtPct(move.probTouch) : '—',
                        tone: 'muted',
                      },
                    ]}
                  />
                  <p className="font-mono text-type-2xs text-muted-foreground leading-snug">
                    Walls = call/put GEX extremes. Flip = cum net GEX zero-cross. Max pain = min aggregate payoff at front.
                  </p>
                </div>
              </Panel>

              {equityBasis && equityBasis.points.length > 0 && (
                <Panel
                  title={<Explain term="equityForwardBasis">Cash–forward / basis</Explain>}
                  subtitle={
                    equityBasis.hasMarketMarks
                      ? 'Market futures marks + theo fills'
                      : 'Theo F = S e^{(r−q)T} · no listed futures marks'
                  }
                >
                  <div className="max-h-44 overflow-auto">
                    <table className="w-full border-collapse font-mono text-type-2xs">
                      <thead className="sticky top-0 bg-card">
                        <tr className="text-muted-foreground">
                          <th className="px-2 py-0.5 text-left font-normal">DTE</th>
                          <th className="px-1 py-0.5 text-right font-normal">F</th>
                          <th className="px-1 py-0.5 text-right font-normal">F−S</th>
                          <th className="px-1 py-0.5 text-right font-normal">Ann %</th>
                          <th className="px-1 py-0.5 text-left font-normal">Src</th>
                        </tr>
                      </thead>
                      <tbody>
                        {equityBasis.points.slice(0, 12).map((p) => (
                          <tr key={p.expiry} className="border-t border-border/40">
                            <td className="px-2 py-0.5 tabular-nums text-foreground">{p.dte}d</td>
                            <td className="px-1 py-0.5 text-right tabular-nums">
                              {fmtPrice(p.forward, p.forward > 1000 ? 1 : 2)}
                            </td>
                            <td
                              className={cn(
                                'px-1 py-0.5 text-right tabular-nums',
                                p.basis >= 0 ? 'text-up' : 'text-down',
                              )}
                            >
                              {p.basis >= 0 ? '+' : ''}
                              {fmtPrice(p.basis, 2)}
                            </td>
                            <td className="px-1 py-0.5 text-right tabular-nums text-muted-foreground">
                              {(p.annCarry * 100).toFixed(1)}%
                            </td>
                            <td className="px-1 py-0.5 text-muted-foreground">
                              {p.source === 'market' ? p.instrument || 'mkt' : 'theo'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {equityBasis.perp && (
                    <p className="border-t border-border px-3 py-1 font-mono text-type-2xs text-muted-foreground">
                      Perp {equityBasis.perp.instrument}: mark {fmtPrice(equityBasis.perp.mark)} · basis{' '}
                      <span className={equityBasis.perp.basis >= 0 ? 'text-up' : 'text-down'}>
                        {equityBasis.perp.basis >= 0 ? '+' : ''}
                        {fmtPrice(equityBasis.perp.basis, 2)}
                      </span>
                    </p>
                  )}
                  <p className="border-t border-border px-3 py-1.5 font-mono text-type-2xs text-muted-foreground leading-snug">
                    Equity cash–forward curve (not UST CTD basis). Spot {fmtPrice(equityBasis.spot)} · r=
                    {(equityBasis.r * 100).toFixed(2)}% · q={(equityBasis.q * 100).toFixed(2)}%.
                  </p>
                </Panel>
              )}

              <Panel title={<Explain term="riskBudget">Risk Budget · stop vs option</Explain>}>
                <div className="flex flex-col gap-1.5 p-2">
                  <PrintStrip
                    items={[
                      {
                        label: 'ATM ≈0.4·S·σ√T',
                        value: riskBudget ? fmtPrice(riskBudget.atmPremiumApprox) : '—',
                      },
                      {
                        label: 'Straddle',
                        value:
                          riskBudget && riskBudget.straddle > 0
                            ? fmtPrice(riskBudget.straddle)
                            : '—',
                      },
                      {
                        label: 'Stop@prem',
                        value: riskBudget ? `±${fmtPrice(riskBudget.stopAtPremium)}` : '—',
                      },
                      {
                        label: 'P(touch)prem',
                        value: riskBudget ? fmtPct(riskBudget.probTouchPremium) : '—',
                        tone: 'muted',
                      },
                      {
                        label: 'Stop@50%',
                        value: riskBudget ? `±${fmtPrice(riskBudget.stopAtHalfTouch)}` : '—',
                      },
                      {
                        label: 'P(touch)½',
                        value: riskBudget ? fmtPct(riskBudget.probTouchHalf) : '—',
                        tone: 'muted',
                      },
                    ]}
                  />
                  <p className="font-mono text-type-2xs text-muted-foreground leading-snug">
                    Stop underlier ≈ ATM premium (~69% touch BM). ~50% touch ≈ 1.7× prem. ATM vol only.
                  </p>
                </div>
              </Panel>

              <Panel title="Open Interest by Expiry">
                <div className="h-64 p-1">
                  {oiByExpiry.length === 0 ? (
                    <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
                      No chain data
                    </div>
                  ) : (
                    <DeskChartFrame xTitle="Expiry (DTE)" yTitle="OI (K)" className="h-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={oiByExpiry} margin={deskChartChrome().margin}>
                          <CartesianGrid {...deskChartChrome().grid} />
                          <XAxis
                            dataKey="label"
                            tick={{ ...deskChartChrome().tick, fontSize: 9 }}
                            stroke={deskChartChrome().axisLine}
                            label={deskAxisLabel('Expiry (DTE)')}
                          />
                          <YAxis
                            tick={{ ...deskChartChrome().tick, fontSize: 9 }}
                            stroke={deskChartChrome().axisLine}
                            width={40}
                            tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`}
                            label={deskAxisLabel('OI (K)', 'insideLeft')}
                          />
                          <Tooltip contentStyle={deskChartChrome().tooltipStyle} />
                          <Bar dataKey="callOI" stackId="oi" fill={CHART.series.up} name="Call OI" opacity={0.85} />
                          <Bar dataKey="putOI" stackId="oi" fill={CHART.series.down} name="Put OI" opacity={0.85} />
                        </BarChart>
                      </ResponsiveContainer>
                    </DeskChartFrame>
                  )}
                </div>
              </Panel>

              {snapshot && dealer && (
                <Panel title="Net GEX near spot (±8%)" className="lg:col-span-2">
                  <div className="h-56 p-1">
                    <DeskChartFrame xTitle="Strike" yTitle="Net GEX ($M)" className="h-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={dealer.points
                            .filter((p) => Math.abs(p.strike / snapshot.spot - 1) <= 0.08)
                            .map((p) => ({
                              label: fmtPrice(p.strike, 0),
                              net: p.netGEX / 1e6,
                            }))}
                          margin={deskChartChrome().margin}
                        >
                          <CartesianGrid {...deskChartChrome().grid} />
                          <XAxis
                            dataKey="label"
                            tick={{ ...deskChartChrome().tick, fontSize: 8 }}
                            stroke={deskChartChrome().axisLine}
                            interval={Math.max(0, Math.floor(dealer.points.length / 20))}
                            label={deskAxisLabel('Strike')}
                          />
                          <YAxis
                            tick={{ ...deskChartChrome().tick, fontSize: 9 }}
                            stroke={deskChartChrome().axisLine}
                            width={36}
                            tickFormatter={(v) => `${v.toFixed(0)}M`}
                            label={deskAxisLabel('Net GEX ($M)', 'insideLeft')}
                          />
                          <Tooltip contentStyle={deskChartChrome().tooltipStyle} />
                          <ReferenceLine y={0} stroke={DESK_SERIES.zero} />
                          <ReferenceLine
                            x={fmtPrice(snapshot.spot, 0)}
                            stroke={DESK_SERIES.spot}
                            strokeDasharray="3 3"
                          />
                          <Bar dataKey="net" fill={CHART.series.cyan} name="Net GEX $M" opacity={0.9} />
                        </BarChart>
                      </ResponsiveContainer>
                    </DeskChartFrame>
                  </div>
                </Panel>
              )}
            </div>
          <Panel
            title={<Explain term="parityEdge">Put–Call Parity Edge</Explain>}
            subtitle="European residual · tradeable only if |res| > half-spreads"
            className="min-h-[280px]"
          >
            <div className="flex h-full flex-col">
              <div className="border-b border-border px-2 py-1">
                <PrintStrip
                  items={[
                    { label: 'Pairs', value: String(parity.length) },
                    {
                      label: 'Tradeable',
                      value: String(tradeableParity.length),
                      tone: tradeableParity.length ? 'default' : 'muted',
                    },
                    {
                      label: 'Model',
                      value: 'C−P − (Se⁻qT−Ke⁻rT)',
                      tone: 'muted',
                      title: 'Residual band ±6% · DTE≤120 · after half-spreads',
                    },
                  ]}
                />
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {parity.length === 0 ? (
                  <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
                    No ATM pairs with mids — need live chain
                  </div>
                ) : (
                  <table className="w-full font-mono text-type-xs">
                    <thead className="sticky top-0 bg-card border-b border-border text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 text-left">DTE</th>
                        <th className="px-2 py-1.5 text-right">Strike</th>
                        <th className="px-2 py-1.5 text-right">C mid</th>
                        <th className="px-2 py-1.5 text-right">P mid</th>
                        <th className="px-2 py-1.5 text-right">Residual</th>
                        <th className="px-2 py-1.5 text-right">vs Spot</th>
                        <th className="px-2 py-1.5 text-right">½ spr</th>
                        <th className="px-2 py-1.5 text-left">Flag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parity.map((row) => (
                        <tr
                          key={`${row.expiry}-${row.strike}`}
                          className={cn(
                            'border-b border-border/50',
                            row.tradeable && 'bg-amber/5',
                          )}
                        >
                          <td className="px-2 py-1">{row.dte}d</td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtPrice(row.strike, 0)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtPrice(row.callMid)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtPrice(row.putMid)}</td>
                          <td className={cn(
                            'px-2 py-1 text-right tabular-nums',
                            row.residual >= 0 ? 'text-up' : 'text-down',
                          )}>
                            {fmtSigned(row.residual)}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                            {(row.residualPctSpot * 100).toFixed(3)}%
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                            {fmtPrice(row.halfSpread)}
                          </td>
                          <td className="px-2 py-1">
                            {row.tradeable ? (
                              <span className="text-warn">EDGE?</span>
                            ) : (
                              <span className="text-muted-foreground">noise</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="border-t border-border px-3 py-1.5 font-mono text-type-2xs text-muted-foreground leading-snug">
                Positive residual ⇒ synthetic stock (C−P) rich vs cash-and-carry. American early exercise,
                borrow, and dividends can explain residuals — do not auto-trade. Crypto: use carefully (often European on Deribit).
              </div>
            </div>
          </Panel>
            <div id="pos-sub-strategy" data-desk-section="1" className="flex flex-col gap-2 p-1">
              <StrategyBuilderStrip />
              <p className="px-1 font-mono text-type-2xs text-muted-foreground">
                Same units as chain greeks (per contract). Source may differ from Vol · Greeks 1.0 —
                use MM Desk for path sim / hedge tools.
              </p>
            </div>
          </div>
          </SectionErrorBoundary>
        )}
      </div>
    </div>
  );
}

