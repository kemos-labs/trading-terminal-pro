import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { CHART } from '../../lib/chartTheme';
import { useTerminalStore } from '../../store/terminalStore';
import { Panel } from '../terminal/Panel';
import { fmtPct, fmtSignedPct } from '../../lib/format';
import { DiagnosticsStrip } from './DiagnosticsStrip';
import { realizedVolCloseToClose, volRiskPremium } from '../../lib/options/analytics';
import { yearFractionFromSlice } from '../../lib/options/time';
import { DeskChartFrame, deskChartChrome, deskAxisLabel } from '../desk/DeskChart';
import { PrintStrip } from '../desk/PrintStrip';
import { DESK_SERIES } from '../desk/seriesGrammar';

export function TermView() {
  const snapshot = useTerminalStore((s) => s.snapshot);
  const sviReadout = useTerminalStore((s) => s.sviReadout);
  const arbResult = useTerminalStore((s) => s.arbResult);
  const fmpHistory = useTerminalStore((s) => s.fmpHistory);

  const rv = useMemo(() => {
    if (!fmpHistory?.length) return null;
    return realizedVolCloseToClose(fmpHistory.map((b) => b.close));
  }, [fmpHistory]);

  const chartData = useMemo(() => {
    if (!snapshot) return [];
    const hvPct = rv != null ? rv * 100 : null;
    return snapshot.expiries.map((s) => ({
      dte: s.dte,
      dteSqrt: Math.sqrt(s.dte),
      label: `${s.dte}d`,
      atmIV: s.atmIV * 100,
      /** Flat HV line from close-to-close realized (same sample for all DTEs) */
      hv: hvPct,
      expiry: s.expiry,
    }));
  }, [snapshot, rv]);

  if (!snapshot || snapshot.expiries.length === 0) {
    return (
      <Panel title="Term Structure" className="h-full" data-testid="vol-term-view">
        <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
          No data
        </div>
      </Panel>
    );
  }

  const frontIV = snapshot.expiries[0]!.atmIV;
  const backIV = snapshot.expiries[snapshot.expiries.length - 1]!.atmIV;
  const termSlope = backIV - frontIV;
  const isContango = termSlope > 0;

  const front = snapshot.expiries[0]!;
  const mid = snapshot.expiries.find((e) => e.dte >= 30) ?? front;
  const back = snapshot.expiries[snapshot.expiries.length - 1]!;
  const Tf = yearFractionFromSlice(front);
  const Tb = yearFractionFromSlice(back);
  let fwdVol: number | null = null;
  if (Tb > Tf + 1e-9) {
    const wf = front.atmIV * front.atmIV * Tf;
    const wb = back.atmIV * back.atmIV * Tb;
    const fv2 = (wb - wf) / (Tb - Tf);
    fwdVol = fv2 > 0 ? Math.sqrt(fv2) : null;
  }

  const rr30 = (() => {
    const calls = mid.calls.filter((c) => c.delta != null && c.iv != null);
    const puts = mid.puts.filter((p) => p.delta != null && p.iv != null);
    if (!calls.length || !puts.length) return null;
    const c25 = calls.reduce(
      (b, q) => (Math.abs((q.delta ?? 0) - 0.25) < Math.abs((b.delta ?? 0) - 0.25) ? q : b),
      calls[0]!,
    );
    const p25 = puts.reduce(
      (b, q) => (Math.abs((q.delta ?? 0) + 0.25) < Math.abs((b.delta ?? 0) + 0.25) ? q : b),
      puts[0]!,
    );
    if (c25.iv == null || p25.iv == null) return null;
    return p25.iv - c25.iv;
  })();

  const midAtm = mid.atmIV;
  const vrp = volRiskPremium(midAtm, rv);
  const chrome = deskChartChrome();

  return (
    <Panel title="Term Structure" className="h-full">
      <div className="flex h-full min-h-0 flex-col gap-1">
        <PrintStrip
          className="mx-1 mt-1"
          items={[
            {
              label: 'Front ATM IV',
              value: fmtPct(frontIV),
              title: 'Nearest expiry ATM IV',
            },
            {
              label: 'Term Slope',
              value: `${(termSlope * 100).toFixed(2)}%`,
              tone: isContango ? 'up' : 'down',
              title: isContango ? 'Contango (back > front)' : 'Backwardation (back < front)',
            },
            {
              label: 'Back ATM IV',
              value: fmtPct(backIV),
              title: `${back.dte}d expiry`,
            },
            {
              label: 'Fwd vol',
              value: fwdVol != null ? fmtPct(fwdVol) : '—',
              title: 'Forward vol front→back',
            },
            {
              label: '~30d 25Δ RR',
              value: rr30 != null ? `${(rr30 * 100).toFixed(2)}%` : '—',
              title: 'Put − call 25Δ at ~30d',
            },
            {
              label: 'HV (c2c)',
              value: rv != null ? fmtPct(rv) : '—',
              tone: 'default',
              title: fmpHistory?.length ? `${fmpHistory.length} bars` : 'need history',
            },
            {
              label: 'VRP',
              value: vrp != null ? fmtSignedPct(vrp) : '—',
              tone: vrp != null && vrp > 0 ? 'down' : 'up',
              title: '~30d IV − HV',
            },
            {
              label: 'Expiries',
              value: String(snapshot.expiries.length),
              title: `${front.dte}–${back.dte}d`,
            },
          ]}
        />

        <DiagnosticsStrip sviReadout={sviReadout} arbResult={arbResult} data-testid="term-diagnostics" />

        <DeskChartFrame xTitle="DTE (√ scale)" yTitle="ATM IV %" className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={chrome.margin}>
              <CartesianGrid {...chrome.grid} />
              <XAxis
                dataKey="dteSqrt"
                tick={chrome.tick}
                tickLine={false}
                stroke={chrome.axisLine}
                tickFormatter={(v: number) => `${(v * v).toFixed(0)}d`}
                label={deskAxisLabel('DTE (√ scale)')}
              />
              <YAxis
                tick={chrome.tick}
                tickLine={false}
                stroke={chrome.axisLine}
                tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                domain={['auto', 'auto']}
                label={deskAxisLabel('ATM IV %', 'insideLeft')}
              />
              <Tooltip
                contentStyle={chrome.tooltipStyle}
                labelStyle={{ color: CHART.tooltipFg }}
                formatter={(value: number, name: string) => [
                  `${Number(value).toFixed(2)}%`,
                  name === 'hv' ? 'HV (realized)' : 'ATM IV',
                ]}
                labelFormatter={(_label: string, payload: readonly { payload?: { label?: string } }[] | undefined) => {
                  const row = payload?.[0]?.payload;
                  return row?.label ?? '';
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, fontFamily: 'JetBrains Mono' }}
                formatter={(v) => (v === 'hv' ? 'HV (c2c)' : 'ATM IV')}
              />
              <defs>
                <linearGradient id="ivGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={DESK_SERIES.historyLive} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={DESK_SERIES.historyLive} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="atmIV"
                name="atmIV"
                stroke={DESK_SERIES.historyLive}
                strokeWidth={2}
                fill="url(#ivGrad)"
                isAnimationActive={false}
              />
              {rv != null && (
                <Line
                  type="monotone"
                  dataKey="hv"
                  name="hv"
                  stroke={DESK_SERIES.spot}
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </DeskChartFrame>
      </div>
    </Panel>
  );
}
