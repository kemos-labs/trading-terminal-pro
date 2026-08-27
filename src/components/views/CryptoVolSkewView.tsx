import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  Bar,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTerminalStore } from '../../store/terminalStore';
import { realizedVolCloseToClose } from '../../lib/options/analytics';
import { fetchDeribitVolHistory, type DeribitVolHistory } from '../../lib/data/deribitClient';
import { useUrlSearchParam } from '../../hooks/useUrlSearchParam';
import { CryptoPageHeader } from './crypto/CryptoPageHeader';
import { Panel } from '../terminal/Panel';
import { EmptyState } from '../common/EmptyState';
import { fmtPct } from '../../lib/format';
import { chartGridProps, chartTooltipStyle } from '../../lib/chartTheme';
import { cn } from '../../lib/utils';

const DELTA_BUCKETS = ['10ΔP', '25ΔP', 'ATM', '25ΔC', '10ΔC'] as const;
const HISTORY_WINDOWS = [7, 30, 90, 180, 365] as const;
type HistoryWindow = (typeof HISTORY_WINDOWS)[number];

/** Nearest-delta quote inside an OTM tolerance band — avoids garbage deep-ITM IVs. */
function closestDelta<T extends { delta: number | null; iv: number | null }>(
  quotes: T[],
  target: number,
  tolerance = 0.14,
): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const q of quotes) {
    if (q.delta == null || q.iv == null || !(q.iv > 0) || q.iv > 3) continue;
    const dist = Math.abs(q.delta - target);
    if (dist > tolerance) continue;
    if (dist < bestDist) { bestDist = dist; best = q; }
  }
  return best;
}

/** ATM quote pair with a wider band (0.35–0.65). */
function atmQuote<T extends { delta: number | null; iv: number | null }>(quotes: T[], side: 1 | -1): T | null {
  return closestDelta(quotes, 0.5 * side, 0.15);
}

export function CryptoVolSkewView() {
  const snapshot = useTerminalStore((s) => s.snapshot);
  const symbol = useTerminalStore((s) => s.symbol);
  const history = useTerminalStore((s) => s.fmpHistory);
  const asset = symbol === 'ETH' ? 'ETH' : 'BTC';

  // IV/RV lookback is deep-linked (?page=volskew&hist=30)
  const [histParam, setHistParam] = useUrlSearchParam(
    'hist',
    HISTORY_WINDOWS.map(String),
    '90',
  );
  const histWindow = (Number(histParam) || 90) as HistoryWindow;
  const setHistWindow = (w: HistoryWindow) => setHistParam(String(w));
  const [volHistory, setVolHistory] = useState<DeribitVolHistory | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchDeribitVolHistory(asset, histWindow).then((data) => {
      if (!cancelled) setVolHistory(data);
    });
    return () => { cancelled = true; };
  }, [asset, histWindow]);

  const historySeries = useMemo(() => {
    if (!volHistory) return [];
    const rvByDay = new Map(volHistory.realized.map((p) => [Math.floor(p.t / 86_400_000), p.vol]));
    return volHistory.dvol.map((p) => {
      const day = Math.floor(p.t / 86_400_000);
      const rv = rvByDay.get(day) ?? rvByDay.get(day - 1) ?? null;
      return {
        date: new Date(p.t).toISOString().slice(5, 10),
        iv: p.close,
        rv: rv,
      };
    });
  }, [volHistory]);

  const model = useMemo(() => {
    if (!snapshot) return null;
    const rv = history?.length ? realizedVolCloseToClose(history.map((b) => b.close)) : null;

    const term = snapshot.expiries.map((slice) => {
      const atmCall = atmQuote(slice.calls, 1);
      const atmPut = atmQuote(slice.puts, -1);
      const atm = ((atmCall?.iv ?? 0) + (atmPut?.iv ?? 0)) / 2 || atmCall?.iv || atmPut?.iv || null;
      return {
        label: `${slice.dte}d`,
        dte: slice.dte,
        iv: atm != null ? atm * 100 : null,
        expiry: slice.expiry,
      };
    });

    const rr = snapshot.expiries.map((slice) => {
      const c25 = closestDelta(slice.calls, 0.25);
      const p25 = closestDelta(slice.puts, -0.25);
      const value = c25?.iv != null && p25?.iv != null ? (c25.iv - p25.iv) * 100 : null;
      return { label: `${slice.dte}d`, dte: slice.dte, rr: value, expiry: slice.expiry };
    });

    const wings = snapshot.expiries.slice(0, 10).map((slice) => {
      const pick = (quotes: typeof slice.calls, target: number, tol?: number) => closestDelta(quotes, target, tol)?.iv ?? null;
      const atmC = atmQuote(slice.calls, 1);
      const atmP = atmQuote(slice.puts, -1);
      return {
        expiry: slice.expiry,
        dte: slice.dte,
        cells: {
          '10ΔP': pick(slice.puts, -0.10, 0.08),
          '25ΔP': pick(slice.puts, -0.25, 0.14),
          'ATM': atmC?.iv != null && atmP?.iv != null ? (atmC.iv + atmP.iv) / 2 : atmC?.iv ?? atmP?.iv,
          '25ΔC': pick(slice.calls, 0.25, 0.14),
          '10ΔC': pick(slice.calls, 0.10, 0.08),
        } as Record<(typeof DELTA_BUCKETS)[number], number | null>,
      };
    });
    const wingMin = Math.min(...wings.flatMap((w) => Object.values(w.cells).filter((v): v is number => v != null)));
    const wingMax = Math.max(...wings.flatMap((w) => Object.values(w.cells).filter((v): v is number => v != null)));

    return { rv, term, rr, wings, wingMin, wingMax };
  }, [history, snapshot]);

  if (!snapshot || !model) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#030506]">
        <CryptoPageHeader title="Volatility" highlight="Structure" description={`${asset} term structure, realized vol, and skew · live Deribit chain`} />
        <Panel title="Volatility" className="m-2 flex-1">
          <EmptyState kind="loading" title="Loading volatility structure…" body="Requires the active options chain snapshot." />
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden bg-[#030506]">
      <CryptoPageHeader
        title="Volatility"
        highlight="Structure"
        description={`${asset} ATM term structure vs realized vol and 25Δ risk reversal per expiry · ${model.rv != null ? `realized ${fmtPct(model.rv)} close-to-close` : 'realized vol needs price history'}`}
      />

      <div className="grid gap-2 p-2 lg:grid-cols-2">
        <Panel title="ATM Term Structure" subtitle="ATM IV per expiry (%)" className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={model.term} margin={{ top: 10, right: 10, bottom: 2, left: 0 }}>
              <CartesianGrid {...chartGridProps} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
              <YAxis unit="%" width={40} tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
              <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [`${v.toFixed(1)}%`, 'ATM IV']} />
              <Line type="monotone" dataKey="iv" stroke="#25d7c5" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="25Δ Risk Reversal" subtitle="Call IV − put IV per expiry (vp) · positive = calls rich" className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={model.rr} margin={{ top: 10, right: 10, bottom: 2, left: 0 }}>
              <CartesianGrid {...chartGridProps} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
              <YAxis unit="vp" width={44} tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
              <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [`${v.toFixed(2)} vp`, '25Δ RR']} />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" />
              <Bar dataKey="rr" isAnimationActive={false}>
                {model.rr.map((row) => <Cell key={row.expiry} fill={(row.rr ?? 0) >= 0 ? '#25d7c5' : '#e25c5c'} opacity={0.85} />)}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="px-2">
        <Panel
          title="IV vs RV History"
          subtitle={`Deribit DVOL (implied) vs 30d realized-vol index · ${asset} · ${historySeries.length} sessions`}
          actions={
            <div className="flex gap-1">
              {HISTORY_WINDOWS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setHistWindow(w)}
                  className={cn(
                    'border px-1.5 font-mono text-[10px] uppercase',
                    w === histWindow ? 'border-[#25d7c5] bg-[#25d7c5]/10 text-[#25d7c5]' : 'border-[#20282b] text-[#8b999f] hover:text-[#d7dee0]',
                  )}
                >
                  {w}d
                </button>
              ))}
            </div>
          }
        >
          {historySeries.length ? (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={historySeries} margin={{ top: 10, right: 10, bottom: 2, left: 0 }}>
                  <CartesianGrid {...chartGridProps} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis unit="%" width={40} tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number, name) => [`${v.toFixed(1)}%`, name === 'iv' ? 'DVOL (implied)' : 'Realized 30d']} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="iv" name="iv" stroke="#25d7c5" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="rv" name="rv" stroke="#eab308" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState kind="loading" title="Loading volatility history…" body="Deribit DVOL + realized-volatility index (public)." />
          )}
        </Panel>
      </div>

      <div className="px-2">
        <Panel title="Wing Matrix" subtitle="IV by delta bucket per expiry · teal = cheap, red = rich">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse font-mono text-[11px]">
              <thead className="bg-[#0a0d0e] text-[#8b999f]"><tr><th className="px-3 py-1.5 text-left">Expiry</th>{DELTA_BUCKETS.map((bucket) => <th key={bucket} className="px-3 py-1.5 text-right">{bucket}</th>)}</tr></thead>
              <tbody>{model.wings.map((row) => (
                <tr key={row.expiry} className="border-t border-[#1a1f22]">
                  <td className="px-3 py-1.5"><span className="font-bold text-white">{row.dte}d</span> <span className="text-[10px] text-[#76848a]">{new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(row.expiry))}</span></td>
                  {DELTA_BUCKETS.map((bucket) => {
                    const value = row.cells[bucket];
                    const mid = (model.wingMin + model.wingMax) / 2;
                    const rich = value != null && value > mid;
                    const intensity = value == null ? 0 : Math.min(0.5, Math.abs(value - mid) / Math.max(1e-9, model.wingMax - model.wingMin));
                    return (
                      <td key={bucket} className={cn('px-3 py-1.5 text-right tabular-nums', value == null && 'text-[#4a565b]')}
                        style={value != null ? { background: `color-mix(in oklab, ${rich ? '#e25c5c' : '#25d7c5'} ${Math.round(intensity * 60)}%, transparent)` } : undefined}>
                        {value != null ? fmtPct(value) : 'n/a'}
                      </td>
                    );
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="px-3 py-2 font-mono text-[10px] text-[#76848a]">Red = rich vs the expiry mid · teal = cheap. Wing richness compares each delta bucket against the average IV across the shown expiries.</p>
        </Panel>
      </div>

      <div className="px-2 pb-2">
        <Panel title="Skew Callouts" subtitle="Largest absolute 25Δ risk reversal">
          <div className="grid gap-2 p-3 sm:grid-cols-3">
            {[...model.rr].filter((r) => r.rr != null).sort((a, b) => Math.abs(b.rr!) - Math.abs(a.rr!)).slice(0, 3).map((row) => (
              <div key={row.expiry} className="border-l-2 border-[#20282b] bg-[#090c0d] px-3 py-2">
                <div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">{row.dte}d expiry</div>
                <div className={cn('font-mono text-[16px] font-bold tabular-nums', row.rr! >= 0 ? 'text-[#25d7c5]' : 'text-[#e25c5c]')}>{row.rr! >= 0 ? '+' : ''}{row.rr!.toFixed(2)} vp</div>
                <div className="font-mono text-[10px] text-[#76848a]">{row.rr! >= 0 ? 'calls rich — upside demand' : 'puts rich — downside hedge demand'}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
