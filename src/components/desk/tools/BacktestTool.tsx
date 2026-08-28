import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTerminalStore } from '../../../store/terminalStore';
import { templateLegs } from '../../../lib/options/portfolio';
import { simulatePaths } from '../../../lib/options/pathSim';
import { defaultHedgeFromSnapshot, simulateDeltaHedge } from '../../../lib/options/hedging';
import { fmtPct, fmtSigned } from '../../../lib/format';
import { DeskToolShell } from '../DeskToolShell';
import { DeskField } from '../DeskField';
import { PrintStrip } from '../PrintStrip';
import { DeskChartFrame, deskChartChrome, deskAxisLabel } from '../DeskChart';
import { DESK_SERIES } from '../seriesGrammar';
import { chartDayTick, chartSignedTick, tightDomain } from '../../../lib/chartTheme';

/**
 * P0 Fix: This is a Scenario Monte Carlo (seeded GBM), NOT a historical backtest.
 * Labelled explicitly. Historical backtest via crypto-backtest-api is a separate
 * Python service (Binance klines) — see server/routes backtest allowlist.
 * Do not label this Historical/Observed.
 */
export function BacktestTool() {
  const snapshot = useTerminalStore((s) => s.snapshot)!;
  const [weeks, setWeeks] = useState(8);
  const [rv, setRv] = useState(snapshot.expiries[0]?.atmIV ?? 0.35);
  const legs = useMemo(() => templateLegs('short_straddle', snapshot, 0), [snapshot]);
  const days = Math.max(5, weeks * 7);

  const pathSim = useMemo(
    () =>
      simulatePaths(legs, snapshot, {
        drift: 0,
        vol: rv,
        days,
        steps: Math.min(80, days),
        paths: 120,
        seed: 42,
      }),
    [legs, snapshot, rv, days],
  );

  const hedge = useMemo(() => {
    const d = defaultHedgeFromSnapshot(snapshot);
    if (!d.strike || !d.T || !d.vol) return null;
    return simulateDeltaHedge(
      {
        mode: 'period',
        threshold: 0.1,
        tolerance: 0.05,
        periodSteps: 5,
        type: d.type ?? 'call',
        strike: d.strike,
        T: d.T,
        vol: d.vol,
        realizedVol: rv,
        drift: 0,
        days,
        steps: Math.min(60, days),
        optionQty: -1,
        hedgeInstrument: 'spot',
        r: snapshot.riskFreeRate,
        q: snapshot.dividendYield,
        seed: 7,
      },
      snapshot.spot,
    );
  }, [snapshot, rv, days]);

  const chart = pathSim.t.map((t, i) => ({
    t,
    p5: pathSim.pnlBands.p5[i],
    p25: pathSim.pnlBands.p25[i],
    p50: pathSim.pnlBands.p50[i],
    p75: pathSim.pnlBands.p75[i],
    p95: pathSim.pnlBands.p95[i],
  }));

  const chrome = deskChartChrome();
  const yDomain = tightDomain(
    chart.flatMap((r) => [r.p5, r.p95]),
    0.08,
    { includeZero: true },
  );

  return (
    <DeskToolShell
      controls={
        <>
          <span className="self-center font-mono text-type-2xs text-amber-600" title="Scenario model with user-controlled vol; not a historical backtest with provenance">
            Scenario Monte Carlo — synthetic GBM · not Historical Backtest
          </span>
          <DeskField label="Weeks" value={weeks} onChange={setWeeks} step={1} min={1} max={26} />
          <DeskField label="Realized σ" value={rv} onChange={setRv} step={0.01} />
        </>
      }
      print={
        <PrintStrip
          items={[
            {
              label: 'E[PnL]',
              value: fmtSigned(pathSim.meanTerminalPnl),
              tone: pathSim.meanTerminalPnl >= 0 ? 'up' : 'down',
            },
            { label: 'Win', value: fmtPct(pathSim.winRate) },
            { label: 'Weeks', value: String(weeks) },
            { label: 'σ', value: rv.toFixed(2) },
            ...(hedge
              ? [
                  {
                    label: 'Hedge PnL',
                    value: fmtSigned(hedge.terminalPnl),
                    tone: (hedge.terminalPnl >= 0 ? 'up' : 'down') as 'up' | 'down',
                  },
                ]
              : []),
          ]}
        />
      }
    >
      <DeskChartFrame
        xTitle="Horizon (days)"
        yTitle="PnL ($)"
        className="min-h-[220px]"
        header={
          <span className="text-muted-foreground" title="Scenario Monte Carlo — seed 42, not live history">
            Scenario Monte Carlo · {weeks}w · {pathSim.t.length} steps · 120 paths · GBM(μ=0, σ=user) · seed 42
          </span>
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chart} margin={chrome.margin}>
            <CartesianGrid {...chrome.grid} />
            <XAxis
              dataKey="t"
              tick={chrome.tick}
              stroke={chrome.axisLine}
              tickFormatter={(v: number) => chartDayTick(v)}
              label={deskAxisLabel('Days')}
            />
            <YAxis
              tick={chrome.tick}
              stroke={chrome.axisLine}
              width={52}
              domain={yDomain}
              tickFormatter={(v: number) => chartSignedTick(v, 0)}
              label={deskAxisLabel('PnL ($)', 'insideLeft')}
            />
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
  );
}
