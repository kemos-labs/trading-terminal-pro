import { useMemo, useState } from 'react';
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  ReferenceLine,
} from 'recharts';
import { useTerminalStore } from '../../store/terminalStore';
import { Panel } from '../terminal/Panel';
import { fmtPct } from '../../lib/format';
import { DiagnosticsStrip } from './DiagnosticsStrip';
import { fitSVI, svi } from '../../lib/math/surface/sviFit';
import { yearFractionFromSlice } from '../../lib/options/time';
import type { OptionQuote } from '../../lib/options/types';
import { Explain } from '../common/Explain';
import { CHART, CHART_SERIES_ORDINAL } from '../../lib/chartTheme';
import { DeskChartFrame, deskChartChrome, deskAxisLabel } from '../desk/DeskChart';
import { PrintStrip } from '../desk/PrintStrip';
import { DESK_SERIES } from '../desk/seriesGrammar';
import { DeskModeBar, deskModeChipClass } from '../terminal/DeskModeBar';
import { cn } from '../../lib/utils';

type XMode = 'moneyness' | 'strike' | 'delta';

const X_MODE_ITEMS = [
  { id: 'moneyness', label: 'Moneyness' },
  { id: 'strike', label: 'Strike' },
  { id: 'delta', label: 'Delta' },
] as const;

function interpolateIV(quotes: OptionQuote[], targetDelta: number): number | null {
  const sorted = [...quotes]
    .filter((q) => q.delta != null && q.iv != null)
    .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));
  if (sorted.length < 2) return null;

  const deltas = sorted.map((q) => q.delta!);
  const ivs = sorted.map((q) => q.iv!);

  if (targetDelta <= deltas[0]!) return ivs[0]!;
  if (targetDelta >= deltas[deltas.length - 1]!) return ivs[ivs.length - 1]!;

  for (let i = 0; i < deltas.length - 1; i++) {
    if (targetDelta >= deltas[i]! && targetDelta <= deltas[i + 1]!) {
      const t = (targetDelta - deltas[i]!) / (deltas[i + 1]! - deltas[i]! || 1);
      return ivs[i]! + t * (ivs[i + 1]! - ivs[i]!);
    }
  }
  return null;
}

function computeSkewMetrics(
  snapshot: ReturnType<typeof useTerminalStore.getState>['snapshot'],
  expiryIdx: number,
) {
  if (!snapshot) return null;
  const slice = snapshot.expiries[expiryIdx];
  if (!slice) return null;

  const allQuotes = [...slice.calls, ...slice.puts].filter((q) => q.iv != null && q.delta != null);
  if (allQuotes.length < 5) return null;

  const atmQuote = allQuotes.reduce(
    (best, q) =>
      Math.abs(q.strike - snapshot.spot) < Math.abs(best.strike - snapshot.spot) ? q : best,
    allQuotes[0]!,
  );

  const atmIV = atmQuote.iv!;
  const callQuotes = slice.calls.filter((q) => q.delta != null && q.delta > 0 && q.iv != null);
  const putQuotes = slice.puts.filter((q) => q.delta != null && q.delta < 0 && q.iv != null);

  const iv25c = interpolateIV(callQuotes, 0.25);
  const iv10c = interpolateIV(callQuotes, 0.1);
  const iv25p = interpolateIV(putQuotes, -0.25);
  const iv10p = interpolateIV(putQuotes, -0.1);

  // Equity desk convention: RR = put wing − call wing (rich puts → positive RR).
  // Fly = average wing − ATM (smile curvature).
  return {
    atmIV,
    rr25: iv25c != null && iv25p != null ? iv25p - iv25c : null,
    fly25: iv25c != null && iv25p != null ? (iv25c + iv25p) / 2 - atmIV : null,
    rr10: iv10c != null && iv10p != null ? iv10p - iv10c : null,
  };
}

interface DataPoint {
  x: number;
  iv: number;
  type: 'call' | 'put';
  strike: number;
  bid?: number;
  ask?: number;
}

interface SVICurvePoint {
  x: number;
  sviIv: number;
}

function xModeTitle(mode: XMode): string {
  if (mode === 'moneyness') return 'Log-m (%)';
  if (mode === 'delta') return 'Delta';
  return 'Strike';
}

function atmX(mode: XMode, spot: number): number | null {
  if (mode === 'moneyness') return 0;
  if (mode === 'strike') return spot;
  return null; // delta: ATM straddles ~ ±0.5; single line is misleading
}

export function SmileView() {
  const snapshot = useTerminalStore((s) => s.snapshot);
  const surface = useTerminalStore((s) => s.surface);
  const sviReadout = useTerminalStore((s) => s.sviReadout);
  const arbResult = useTerminalStore((s) => s.arbResult);
  const [xMode, setXMode] = useState<XMode>('moneyness');
  const [showBidAsk, setShowBidAsk] = useState(false);
  const [selectedExpiryIdx, setSelectedExpiryIdx] = useState<number>(0);
  const hasBidAskIv = useMemo(() => {
    if (!snapshot) return false;
    return snapshot.expiries.some((e) => [...e.calls, ...e.puts].some((q) => q.bidIv != null || q.askIv != null));
  }, [snapshot]);

  const chartData = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.expiries.slice(0, 6).map((slice, i) => {
      const T = yearFractionFromSlice(slice);
      const F = slice.forward ?? snapshot.spot * Math.exp((snapshot.riskFreeRate - snapshot.dividendYield) * T);
      const mapQuote = (q: OptionQuote, type: 'call' | 'put'): (DataPoint & { bidIv?: number; askIv?: number }) => ({
        x: xMode === 'moneyness' ? Math.log(q.strike / F) * 100 : xMode === 'delta' ? (q.delta ?? 0) : q.strike,
        iv: (q.midIv ?? q.iv!) * 100,
        bidIv: showBidAsk && hasBidAskIv && q.bidIv != null ? q.bidIv * 100 : undefined,
        askIv: showBidAsk && hasBidAskIv && q.askIv != null ? q.askIv * 100 : undefined,
        type,
        strike: q.strike,
        bid: q.bid ?? undefined,
        ask: q.ask ?? undefined,
      });
      const calls: (DataPoint & { bidIv?: number; askIv?: number })[] = slice.calls
        .filter((q) => (q.midIv ?? q.iv) != null && (q.midIv ?? q.iv!) > 0)
        .sort((a, b) => a.strike - b.strike)
        .map((q) => mapQuote(q, 'call'));
      const puts: (DataPoint & { bidIv?: number; askIv?: number })[] = slice.puts
        .filter((q) => (q.midIv ?? q.iv) != null && (q.midIv ?? q.iv!) > 0)
        .sort((a, b) => a.strike - b.strike)
        .map((q) => mapQuote(q, 'put'));
      return {
        expiry: slice.expiry,
        dte: slice.dte,
        label: `${slice.dte}d`,
        visible: i === selectedExpiryIdx,
        calls,
        puts,
        all: [...calls, ...puts].sort((a, b) => a.x - b.x),
      };
    });
  }, [snapshot, xMode, selectedExpiryIdx, showBidAsk]);

  const sviCurve = useMemo(() => {
    if (!surface || !snapshot) return null;
    const expiryIdx = selectedExpiryIdx;
    const row = surface.iv[expiryIdx];
    if (!row) return null;
    const dte = surface.dtes[expiryIdx] ?? 30;
    const expiry = surface.expiries[expiryIdx] ?? snapshot.expiries[expiryIdx]?.expiry ?? '';
    const T = yearFractionFromSlice({ expiry, dte });
    const slice = snapshot.expiries[expiryIdx];
    const F = slice?.forward ?? snapshot.spot * Math.exp((snapshot.riskFreeRate - snapshot.dividendYield) * T);
    const fit = fitSVI(surface.strikes, row, F, T);
    if (!fit) return null;

    const kStrikes = surface.strikes.map((s) => Math.log(s / F));
    const minK = Math.min(...kStrikes);
    const maxK = Math.max(...kStrikes);
    const points: SVICurvePoint[] = [];
    const n = 50;
    for (let i = 0; i <= n; i++) {
      const k = minK + (maxK - minK) * (i / n);
      const w = svi(fit.params, k);
      const iv = Math.sqrt(Math.max(0, w / T));
      const strike = F * Math.exp(k);
      let x: number;
      if (xMode === 'moneyness') {
        x = k * 100;
      } else if (xMode === 'delta') {
        const d1 = (Math.log(F / strike) + T * 0.5 * iv * iv) / (iv * Math.sqrt(T));
        const nd = 0.5 * (1 + (d1 / Math.sqrt(2)) * (1 - (d1 * d1) / 6));
        x = nd * 2 - 1;
      } else {
        x = strike;
      }
      points.push({ x, sviIv: iv * 100 });
    }
    return { points, params: fit.params, rmse: fit.rmse };
  }, [surface, snapshot, selectedExpiryIdx, xMode]);

  const skewMetrics = useMemo(
    () => computeSkewMetrics(snapshot, selectedExpiryIdx),
    [snapshot, selectedExpiryIdx],
  );

  if (!snapshot) {
    return (
      <Panel title="IV Smile / Skew" className="h-full" data-testid="vol-smile-view">
        <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
          No data
        </div>
      </Panel>
    );
  }

  const colors = CHART_SERIES_ORDINAL;
  const chrome = deskChartChrome();
  const xTitle = xModeTitle(xMode);
  const atm = atmX(xMode, snapshot.spot);

  const printItems = [
    {
      label: 'ATM',
      value: skewMetrics
        ? `${(skewMetrics.atmIV * 100).toFixed(1)}%`
        : fmtPct(snapshot.expiries[selectedExpiryIdx]?.atmIV ?? 0),
      title: 'ATM IV for selected expiry',
    },
    {
      label: '25Δ RR',
      value:
        skewMetrics?.rr25 != null
          ? `${skewMetrics.rr25 > 0 ? '+' : ''}${(skewMetrics.rr25 * 100).toFixed(2)}%`
          : '—',
      tone:
        skewMetrics?.rr25 != null
          ? skewMetrics.rr25 > 0
            ? ('up' as const)
            : ('down' as const)
          : ('muted' as const),
      title: 'RR = IV(25Δ put) − IV(25Δ call); + = put wing richer',
    },
    {
      label: '25Δ Fly',
      value: skewMetrics?.fly25 != null ? `${(skewMetrics.fly25 * 100).toFixed(2)}%` : '—',
      title: 'Smile curvature (avg wing − ATM)',
    },
    {
      label: '10Δ RR',
      value:
        skewMetrics?.rr10 != null
          ? `${skewMetrics.rr10 > 0 ? '+' : ''}${(skewMetrics.rr10 * 100).toFixed(2)}%`
          : '—',
      tone:
        skewMetrics?.rr10 != null
          ? skewMetrics.rr10 > 0
            ? ('up' as const)
            : ('down' as const)
          : ('muted' as const),
      title: 'RR = IV(10Δ put) − IV(10Δ call)',
    },
    ...(sviCurve
      ? [
          {
            label: 'SVI RMSE',
            value: `${(sviCurve.rmse * 100).toFixed(3)}%`,
            title: 'SVI fit RMSE on selected expiry',
          },
        ]
      : []),
  ];

  return (
    <Panel title="IV Smile / Skew" className="h-full">
      <div className="flex h-full min-h-0 flex-col gap-1">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-1">
          <DeskModeBar
            items={[...X_MODE_ITEMS]}
            activeId={xMode}
            onSelect={(id) => setXMode(id as XMode)}
          />
          <button
            type="button"
            onClick={() => hasBidAskIv && setShowBidAsk((s) => !s)}
            disabled={!hasBidAskIv}
            title={hasBidAskIv ? 'Show independently inverted bid/ask IV (no proxy)' : 'Bid/Ask IV unavailable for this chain'}
            className={deskModeChipClass(showBidAsk) + (!hasBidAskIv ? ' opacity-40 cursor-not-allowed' : '')}
            aria-disabled={!hasBidAskIv}
          >
            Bid-Ask
          </button>
          <div className="flex-1" />
          <span className="font-mono text-type-xs text-muted-foreground">
            <Explain term="atmIV">ATM IV</Explain>:{' '}
            {fmtPct(snapshot.expiries[selectedExpiryIdx]?.atmIV ?? 0)}
          </span>
        </div>

        <PrintStrip items={printItems} className="mx-1" />

        <DiagnosticsStrip
          sviReadout={sviReadout}
          arbResult={arbResult}
          data-testid="smile-diagnostics"
        />

        <DeskChartFrame xTitle={xTitle} yTitle="IV %" className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart margin={chrome.margin}>
              <CartesianGrid {...chrome.grid} />
              <XAxis
                dataKey="x"
                type="number"
                domain={['auto', 'auto']}
                tick={chrome.tick}
                tickLine={false}
                stroke={chrome.axisLine}
                label={deskAxisLabel(xTitle)}
              />
              <YAxis
                tick={chrome.tick}
                tickLine={false}
                stroke={chrome.axisLine}
                tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                domain={['auto', 'auto']}
                label={deskAxisLabel('IV %', 'insideLeft')}
              />
              <Tooltip
                contentStyle={chrome.tooltipStyle}
                labelStyle={{ color: CHART.tooltipFg }}
              />

              {atm != null && (
                <ReferenceLine
                  x={atm}
                  stroke={DESK_SERIES.spot}
                  strokeDasharray="3 3"
                  label={{
                    value: 'ATM',
                    position: 'top',
                    fill: DESK_SERIES.spot,
                    fontSize: 9,
                    fontFamily: 'JetBrains Mono',
                  }}
                />
              )}

              {chartData.map((slice, i) => (
                <Line
                  key={`call-${slice.expiry}`}
                  data={slice.calls}
                  type="monotone"
                  dataKey="iv"
                  stroke={
                    i === selectedExpiryIdx ? CHART.series.selected : colors[i % colors.length]
                  }
                  strokeWidth={i === selectedExpiryIdx ? 2.5 : 1}
                  strokeOpacity={i === selectedExpiryIdx ? 1 : 0.3}
                  dot={
                    i === selectedExpiryIdx
                      ? {
                          r: 3,
                          fill: CHART.tooltipBg,
                          stroke: CHART.series.selected,
                          strokeWidth: 1.5,
                        }
                      : false
                  }
                  name={`${slice.label} Calls — derived midpoint`}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}

              {chartData.map((slice, i) => (
                <Line
                  key={`put-${slice.expiry}`}
                  data={slice.puts}
                  type="monotone"
                  dataKey="iv"
                  stroke={
                    i === selectedExpiryIdx ? CHART.series.selected : colors[i % colors.length]
                  }
                  strokeWidth={i === selectedExpiryIdx ? 2 : 0.8}
                  strokeOpacity={i === selectedExpiryIdx ? 0.8 : 0.2}
                  strokeDasharray={i === selectedExpiryIdx ? '6 3' : '3 3'}
                  dot={
                    i === selectedExpiryIdx
                      ? {
                          r: 2.5,
                          fill: CHART.tooltipBg,
                          stroke: CHART.series.selected,
                          strokeWidth: 1,
                        }
                      : false
                  }
                  name={`${slice.label} Puts — derived midpoint`}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
              {showBidAsk && hasBidAskIv && chartData.map((slice, i) => i === selectedExpiryIdx && (
                <Line key={`bid-${slice.expiry}`} data={[...slice.calls, ...slice.puts].filter((d) => (d as unknown as { bidIv?: number }).bidIv != null)} type="monotone" dataKey="bidIv" stroke={CHART.series.muted} strokeWidth={1} strokeDasharray="2 2" dot={false} name={`${slice.label} Bid IV (derived)`} connectNulls isAnimationActive={false} />
              ))}
              {showBidAsk && hasBidAskIv && chartData.map((slice, i) => i === selectedExpiryIdx && (
                <Line key={`ask-${slice.expiry}`} data={[...slice.calls, ...slice.puts].filter((d) => (d as unknown as { askIv?: number }).askIv != null)} type="monotone" dataKey="askIv" stroke={CHART.series.muted} strokeWidth={1} strokeDasharray="4 1" dot={false} name={`${slice.label} Ask IV (derived)`} connectNulls isAnimationActive={false} />
              ))}

              {sviCurve && (
                <Line
                  data={sviCurve.points}
                  type="monotone"
                  dataKey="sviIv"
                  stroke={CHART.series.svi}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  name={`SVI fit (RMSE ${(sviCurve.rmse * 100).toFixed(2)}%)`}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </DeskChartFrame>

        {sviCurve && (
          <div className="flex shrink-0 gap-3 border-t border-border px-3 py-0.5 font-mono text-type-2xs text-muted-foreground">
            <span>
              SVI: a={sviCurve.params.a.toFixed(4)} b={sviCurve.params.b.toFixed(4)} ρ=
              {sviCurve.params.rho.toFixed(3)} m={sviCurve.params.m.toFixed(4)} σ=
              {sviCurve.params.sigma.toFixed(4)}
            </span>
            <span className="text-purple">
              <Explain term="sviRmse">RMSE</Explain> {(sviCurve.rmse * 100).toFixed(3)}%
            </span>
          </div>
        )}

        <div className="flex shrink-0 flex-wrap gap-1 border-t border-border px-2 py-1">
          {chartData.map((slice, i) => (
            <button
              key={slice.expiry}
              type="button"
              onClick={() => setSelectedExpiryIdx(i)}
              className={cn(
                deskModeChipClass(i === selectedExpiryIdx),
                'border-l-2',
              )}
              style={{ borderLeftColor: colors[i % colors.length] }}
            >
              {slice.label}
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
}
