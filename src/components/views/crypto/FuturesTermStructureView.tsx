/**
 * Futures desk — "Term Structure": annualized basis APR (or premium %) across
 * dated tenors, with an all-tenors vs end-of-month universe filter and the
 * per-instrument table underneath. Live public Deribit data only.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTerminalStore } from '../../../store/terminalStore';
import { useDeribitFutures } from '../../../hooks/useDeribitFutures';
import {
  filterEndOfMonthExpiries,
  termStructurePoints,
} from '../../../lib/data/futuresMath';
import { fmtPrice } from '../../../lib/format';
import { chartGridProps, chartTooltipStyle } from '../../../lib/chartTheme';
import { cn } from '../../../lib/utils';
import { CryptoPageHeader } from './CryptoPageHeader';
import { Panel } from '../../terminal/Panel';
import { EmptyState } from '../../common/EmptyState';

type Metric = 'apr' | 'premium';
type Universe = 'all' | 'eom';

function signClass(v: number | null): string {
  if (v == null) return 'text-[#8b999f]';
  if (v > 0) return 'text-[#25d7c5]';
  if (v < 0) return 'text-[#e25c5c]';
  return 'text-[#a6b0b4]';
}

function fmtSigned(v: number | null, dp = 2, suffix = ''): string {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(dp)}${suffix}`;
}

export function FuturesTermStructureView({ asset }: { asset?: 'BTC' | 'ETH' }) {
  const symbol = useTerminalStore((s) => s.symbol);
  const currency: 'BTC' | 'ETH' = asset ?? (symbol === 'ETH' ? 'ETH' : 'BTC');
  const { loading, error, stale, rows, asOf, refresh } = useDeribitFutures(currency);

  const [metric, setMetric] = useState<Metric>('apr');
  const [universe, setUniverse] = useState<Universe>('all');

  useEffect(() => {
    setMetric('apr');
    setUniverse('all');
  }, [currency]);

  // Chart uses DATED futures only (perp has no DTE → no honest APR point);
  // the table additionally shows the perpetual row when universe = all.
  const chartPoints = useMemo(() => {
    const base = universe === 'eom' ? filterEndOfMonthExpiries(rows) : rows;
    return termStructurePoints(base)
      .map((p) => ({ ...p, value: metric === 'apr' ? p.aprPct : p.premiumPct }))
      .filter((p) => p.value != null);
  }, [rows, universe, metric]);

  const tableRows = useMemo(
    () => (universe === 'eom' ? filterEndOfMonthExpiries(rows) : rows),
    [rows, universe],
  );

  const aprRange = useMemo(() => {
    const vals = termStructurePoints(universe === 'eom' ? filterEndOfMonthExpiries(rows) : rows)
      .map((p) => p.aprPct)
      .filter((v): v is number => v != null);
    if (vals.length === 0) return null;
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }, [rows, universe]);

  const asOfLabel = asOf
    ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false }).format(new Date(asOf))
    : '—';

  const toggleCls = (active: boolean) =>
    cn(
      'min-h-7 border px-2 font-mono text-[10px] uppercase tracking-wider transition-colors',
      active
        ? 'border-[#25d7c5] bg-[#25d7c5]/10 text-[#25d7c5]'
        : 'border-[#202629] text-[#8b999f] hover:text-white',
    );

  if ((loading && rows.length === 0) || (!loading && error && rows.length === 0)) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#030506]">
        <CryptoPageHeader
          title="Term"
          highlight="Structure"
          description={`${currency} basis APR across dated tenors · annualization premium% × 365/DTE · live public Deribit data`}
        />
        <Panel title="Term Structure" className="m-2 flex-1">
          <EmptyState
            kind={error ? 'api-down' : 'loading'}
            title={error ?? 'Loading term structure…'}
            body={error ? `${error}. Nothing is estimated — retry the feed.` : 'Fetching instruments and tickers from the Deribit proxy.'}
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden bg-[#030506]">
      <CryptoPageHeader
        title="Term"
        highlight="Structure"
        description={`${currency} basis curve across dated tenors · x = expiry, y = ${metric === 'apr' ? 'annualized APR %' : 'premium %'} · ${chartPoints.length} plotted points`}
        actions={
          <>
            {stale && (
              <span className="border border-[#6a5322] bg-[#221a08] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#e2a13c]">
                Stale — refresh failed
              </span>
            )}
            <span className="font-mono text-[10px] text-[#76848a]" title="Snapshot time (UTC)">AS OF {asOfLabel} UTC</span>
            <button
              type="button"
              onClick={refresh}
              className="min-h-7 border border-[#202629] px-3 font-mono text-[10px] uppercase tracking-wider text-[#8b999f] transition-colors hover:border-[#25d7c5] hover:text-[#25d7c5]"
            >
              Refresh
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-px border-b border-[#20282b] bg-[#20282b] lg:grid-cols-4">
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Curve Shape</div><div className="font-mono text-[18px] font-bold tabular-nums text-white">{aprRange == null ? '—' : `${(aprRange.max - aprRange.min).toFixed(2)}pp`}</div><div className="font-mono text-[10px] text-[#76848a]">APR spread back minus front</div></div>
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Front APR</div><div className={cn('font-mono text-[18px] font-bold tabular-nums', signClass(chartPoints[0]?.aprPct ?? null))}>{fmtSigned(chartPoints[0]?.aprPct ?? null, 2, '%')}</div><div className="font-mono text-[10px] text-[#76848a]">{chartPoints[0]?.label ?? '—'}</div></div>
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Back APR</div><div className={cn('font-mono text-[18px] font-bold tabular-nums', signClass(chartPoints.at(-1)?.aprPct ?? null))}>{fmtSigned(chartPoints.at(-1)?.aprPct ?? null, 2, '%')}</div><div className="font-mono text-[10px] text-[#76848a]">{chartPoints.at(-1)?.label ?? '—'}</div></div>
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Dated Tenors</div><div className="font-mono text-[18px] font-bold tabular-nums text-white">{chartPoints.length}</div><div className="font-mono text-[10px] text-[#76848a]">{universe === 'eom' ? 'end-of-month universe' : 'all expiries'}</div></div>
      </div>

      <div className="p-2">
        <Panel
          title={`${metric === 'apr' ? 'Annualized APR' : 'Premium %'} by Tenor`}
          subtitle="Dated futures only — the perpetual carries no DTE, so it has no honest point on this axis"
          actions={
            <div className="flex items-center gap-1">
              {[{ id: 'apr' as Metric, label: 'APR %' }, { id: 'premium' as Metric, label: '% Premium' }].map((m) => (
                <button key={m.id} type="button" aria-pressed={metric === m.id} onClick={() => setMetric(m.id)} className={toggleCls(metric === m.id)}>{m.label}</button>
              ))}
              <span className="ml-3 mr-1 font-mono text-[9px] uppercase tracking-wider text-[#76848a]">Tenors</span>
              {[{ id: 'all' as Universe, label: 'All' }, { id: 'eom' as Universe, label: 'End of Month' }].map((u) => (
                <button key={u.id} type="button" aria-pressed={universe === u.id} onClick={() => setUniverse(u.id)} className={toggleCls(universe === u.id)}>{u.label}</button>
              ))}
            </div>
          }
        >
          <div className="h-[320px] p-1">
            {chartPoints.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartPoints} margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid {...chartGridProps} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} interval={0} angle={-30} textAnchor="end" height={44} />
                  <YAxis width={54} tickFormatter={(v: number) => `${v.toFixed(1)}%`} tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    formatter={(v: number | string) => [`${Number(v).toFixed(3)}%`, metric === 'apr' ? 'APR ann.' : 'Premium']}
                    labelFormatter={(l) => `${currency} · ${String(l)}`}
                  />
                  <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="2 3" />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#25d7c5"
                    strokeWidth={1.5}
                    dot={{ r: 2.5, fill: '#25d7c5' }}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState kind="no-data" compact title="No dated tenors to plot" body="The selected universe has no expiries with a computable value." />
            )}
          </div>
          <p className="px-3 pb-2 font-mono text-[10px] text-[#76848a]">
            APR = (mark − index)/index × 365/DTE at snapshot time; premium shown for comparison via the toggle. Expiries settle 08:00 UTC on Deribit.
          </p>
        </Panel>
      </div>

      <div className="px-2 pb-2">
        <Panel title={`Instruments — ${currency}`} subtitle={universe === 'eom' ? 'End-of-month expiries + perp excluded' : 'All active futures + perpetual'}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse font-mono text-[11px]">
              <thead className="bg-[#0a0d0e] text-[#8b999f]"><tr><th className="px-3 py-1.5 text-left">TENOR</th><th className="px-3 py-1.5 text-left">KIND</th><th className="px-3 py-1.5 text-right">MARK</th><th className="px-3 py-1.5 text-right">DTE</th><th className="px-3 py-1.5 text-right">% PREM</th><th className="px-3 py-1.5 text-right">APR %</th></tr></thead>
              <tbody>
                {tableRows.map((row) => (
                  <tr key={row.instrument} className={cn('border-t border-[#1a1f22]', row.kind === 'PERPETUAL' && 'bg-[#101619]')}>
                    <td className="px-3 py-1.5 font-bold text-white">{row.tenorLabel}</td>
                    <td className="px-3 py-1.5">
                      <span className={cn('border px-1 py-0.5 text-[9px] uppercase tracking-wider', row.kind === 'PERPETUAL' ? 'border-[#25d7c5]/40 text-[#25d7c5]' : 'border-[#2a3236] text-[#8b999f]')}>{row.kind}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[#d7dee0]">{row.mark != null ? fmtPrice(row.mark, Math.abs(row.mark) >= 1000 ? 1 : 2) : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[#8b999f]">{row.dte != null ? row.dte.toFixed(2) : '—'}</td>
                    <td className={cn('px-3 py-1.5 text-right tabular-nums', signClass(row.premiumPct))}>{fmtSigned(row.premiumPct, 3, '%')}</td>
                    <td className={cn('px-3 py-1.5 text-right tabular-nums', signClass(row.aprPct))}>{fmtSigned(row.aprPct, 2, '%')}</td>
                  </tr>
                ))}
                {tableRows.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-[#8b999f]">No instruments in this universe.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
