/**
 * Futures desk — "Funding Rates": perpetual funding card + history chart.
 *
 * HONESTY RULE (repo fail-closed policy): VOLATERM currently wires exactly one
 * venue — Deribit public get_funding_rate_history / ticker funding fields.
 * No other exchange is simulated, estimated or placeholder-filled; the page
 * says so in plain text instead of faking cards.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTerminalStore } from '../../../store/terminalStore';
import {
  useDeribitFundingHistory,
  useDeribitFutures,
} from '../../../hooks/useDeribitFutures';
import { useUrlSearchParam } from '../../../hooks/useUrlSearchParam';
import { fmtPrice } from '../../../lib/format';
import { chartGridProps, chartTooltipStyle } from '../../../lib/chartTheme';
import { cn } from '../../../lib/utils';
import { CryptoPageHeader } from './CryptoPageHeader';
import { Panel } from '../../terminal/Panel';
import { EmptyState } from '../../common/EmptyState';

type FundingMetric = 'rate8h' | 'annualized';

const DAYS_OPTIONS: (1 | 7 | 30 | 90)[] = [1, 7, 30, 90];

function signClass(v: number | null): string {
  if (v == null) return 'text-[#8b999f]';
  if (v > 0) return 'text-[#25d7c5]';
  if (v < 0) return 'text-[#e25c5c]';
  return 'text-[#a6b0b4]';
}

function fmtSigned(v: number | null | undefined, dp = 4, suffix = ''): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(dp)}${suffix}`;
}

export function FuturesFundingView({ asset }: { asset?: 'BTC' | 'ETH' }) {
  const symbol = useTerminalStore((s) => s.symbol);
  const currency: 'BTC' | 'ETH' = asset ?? (symbol === 'ETH' ? 'ETH' : 'BTC');

  // Live perp snapshot (funding_8h / current_funding come off the same ticker
  // bulk the basis pages use) + hourly history for the chart.
  const futures = useDeribitFutures(currency);
  // History window is deep-linked (?page=ffund&fdays=30)
  const [daysParam, setDaysParam] = useUrlSearchParam('fdays', ['1', '7', '30', '90'], '7');
  const days = (Number(daysParam) || 7) as 1 | 7 | 30 | 90;
  const setDays = (v: 1 | 7 | 30 | 90) => setDaysParam(String(v));
  const history = useDeribitFundingHistory({ currency, days });

  const [metric, setMetric] = useState<FundingMetric>('annualized');

  useEffect(() => {
    setDaysParam('7');
    setMetric('annualized');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  const perpRow = useMemo(
    () => futures.rows.find((r) => r.kind === 'PERPETUAL') ?? null,
    [futures.rows],
  );

  const chartData = useMemo(
    () =>
      (history.bundle?.points ?? []).map((p) => ({
        t: p.t,
        value: metric === 'rate8h' ? p.rate8h * 100 : p.annualizedPct,
        rate8hPct: p.rate8h * 100,
        annualizedPct: p.annualizedPct,
      })),
    [history.bundle, metric],
  );

  const stats = useMemo(() => {
    const vals = chartData.map((p) => p.value).filter((v) => Number.isFinite(v));
    if (vals.length === 0) return null;
    return {
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: vals.reduce((s, v) => s + v, 0) / vals.length,
      n: vals.length,
    };
  }, [chartData]);

  const tickTime = (t: number) =>
    new Intl.DateTimeFormat(undefined, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
      hour12: false,
    }).format(new Date(t));

  const toggleCls = (active: boolean) =>
    cn(
      'min-h-7 border px-2 font-mono text-[10px] uppercase tracking-wider transition-colors',
      active
        ? 'border-[#25d7c5] bg-[#25d7c5]/10 text-[#25d7c5]'
        : 'border-[#202629] text-[#8b999f] hover:text-white',
    );

  const loadingAll = futures.loading && futures.rows.length === 0 && history.loading && !history.bundle;
  const deadAll =
    !loadingAll &&
    ((futures.error != null && futures.rows.length === 0) || (history.error != null && !history.bundle));

  if (loadingAll || deadAll) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#030506]">
        <CryptoPageHeader
          title="Funding"
          highlight="Rates"
          description={`${currency}-PERPETUAL funding — realized 8h rate and simple annualization · live public Deribit data`}
        />
        <Panel title="Funding Rates" className="m-2 flex-1">
          <EmptyState
            kind={deadAll ? 'api-down' : 'loading'}
            title={(futures.error ?? history.error) ?? 'Loading funding data…'}
            body={deadAll ? 'Deribit funding feed unavailable. Nothing is simulated — retry the feed.' : 'Fetching perp ticker and funding-rate history from the Deribit proxy.'}
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden bg-[#030506]">
      <CryptoPageHeader
        title="Funding"
        highlight="Rates"
        description={`${currency}-PERPETUAL funding — realized 8h rate, simple annualization ×3×365, and ${days}-day history · single honest source: Deribit`}
        actions={
          <>
            {(futures.stale || history.error != null) && (
              <span className="border border-[#6a5322] bg-[#221a08] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#e2a13c]">
                Stale — refresh failed
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                futures.refresh();
                history.refresh();
              }}
              className="min-h-7 border border-[#202629] px-3 font-mono text-[10px] uppercase tracking-wider text-[#8b999f] transition-colors hover:border-[#25d7c5] hover:text-[#25d7c5]"
            >
              Refresh
            </button>
          </>
        }
      />

      {/* Source cards — one per WIRED source only. Others are not faked. */}
      <div className="grid grid-cols-1 gap-px border-b border-[#20282b] bg-[#20282b] md:grid-cols-4">
        <div className="bg-[#090c0d] p-3 md:col-span-1">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Source</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-[16px] font-bold text-white">DERIBIT</span>
            <span className="border border-[#25d7c5]/40 bg-[#25d7c5]/10 px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#25d7c5]">Live</span>
          </div>
          <div className="font-mono text-[10px] text-[#76848a]">{currency}-PERPETUAL · public API</div>
        </div>
        <div className="bg-[#090c0d] p-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Funding 8h</div>
          <div className={cn('font-mono text-[18px] font-bold tabular-nums', signClass(perpRow?.funding8h ?? null))}>
            {fmtSigned(perpRow?.funding8h != null ? perpRow.funding8h * 100 : null, 4, '%')}
          </div>
          <div className="font-mono text-[10px] text-[#76848a]">per 8h interval</div>
        </div>
        <div className="bg-[#090c0d] p-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Annualized</div>
          <div className={cn('font-mono text-[18px] font-bold tabular-nums', signClass(perpRow?.fundingAnnualizedPct ?? null))}>
            {fmtSigned(perpRow?.fundingAnnualizedPct, 2, '%')}
          </div>
          <div className="font-mono text-[10px] text-[#76848a]">8h rate × 3 × 365</div>
        </div>
        <div className="bg-[#090c0d] p-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">{currency} Index</div>
          <div className="font-mono text-[18px] font-bold tabular-nums text-white">
            {perpRow?.indexPrice != null ? `$${fmtPrice(perpRow.indexPrice, 2)}` : '—'}
          </div>
          <div className="font-mono text-[10px] text-[#76848a]">underlying at snapshot</div>
        </div>
      </div>

      {/* Honesty note about unwired venues */}
      <div className="border-b border-[#20282b] bg-[#070a0b] px-3 py-2 font-mono text-[10px] leading-snug text-[#76848a]">
        SINGLE-SOURCE PAGE — VOLATERM wires Deribit public funding only. Binance / OKX / Bybit / Hyperliquid cards are deliberately absent rather than filled with placeholder rates.
      </div>

      <div className="p-2">
        <Panel
          title={`Funding History — ${currency}-PERPETUAL`}
          subtitle={`${history.bundle?.points.length ?? 0} hourly points over ${days}d · Deribit get_funding_rate_history`}
          actions={
            <div className="flex items-center gap-1">
              {DAYS_OPTIONS.map((d) => (
                <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={toggleCls(days === d)}>{d}D</button>
              ))}
              <span className="ml-3 mr-1 font-mono text-[9px] uppercase tracking-wider text-[#76848a]">Metric</span>
              {[{ id: 'annualized' as FundingMetric, label: 'Ann. %' }, { id: 'rate8h' as FundingMetric, label: '8h %' }].map((m) => (
                <button key={m.id} type="button" aria-pressed={metric === m.id} onClick={() => setMetric(m.id)} className={toggleCls(metric === m.id)}>{m.label}</button>
              ))}
            </div>
          }
        >
          <div className="h-[320px] p-1">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
                  <defs>
                    <linearGradient id="fundFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#25d7c5" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#25d7c5" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...chartGridProps} />
                  <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tickTime} tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} minTickGap={64} />
                  <YAxis width={58} tickFormatter={(v: number) => `${v.toFixed(2)}%`} tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    labelFormatter={(l) => `${currency}-PERPETUAL · ${tickTime(Number(l))} UTC`}
                    formatter={(v: number | string, name) => [
                      `${Number(v).toFixed(4)}%`,
                      name === 'value'
                        ? metric === 'rate8h'
                          ? '8h rate'
                          : 'Annualized'
                        : String(name),
                    ]}
                  />
                  <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="2 3" />
                  <Area type="monotone" dataKey="value" stroke="#25d7c5" strokeWidth={1.5} fill="url(#fundFill)" isAnimationActive={false} connectNulls={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                kind={history.error ? 'api-down' : 'no-data'}
                compact
                title={history.error ?? 'No funding points returned'}
                body="Deribit returned no hourly funding points for this window."
              />
            )}
          </div>
          <p className="px-3 pb-2 font-mono text-[10px] text-[#76848a]">
            {stats != null
              ? `Window min/avg/max: ${stats.min.toFixed(4)}% / ${stats.avg.toFixed(4)}% / ${stats.max.toFixed(4)}% (${metric === 'rate8h' ? '8h rate' : 'annualized'}). `
              : ''}
            Annualization is the simple convention rate₈ₕ × 3 × 365 — it ignores compounding by design.
          </p>
        </Panel>
      </div>
    </div>
  );
}
