import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTerminalStore } from '../../store/terminalStore';
import { fetchDeribitTrades, type DeribitOptionTrade } from '../../lib/data/deribitClient';
import { useUrlSearchParam } from '../../hooks/useUrlSearchParam';
import { fmtCompact, fmtPct, fmtPrice } from '../../lib/format';
import { chartGridProps, chartTooltipStyle } from '../../lib/chartTheme';
import { Panel } from '../terminal/Panel';
import { EmptyState } from '../common/EmptyState';
import { cn } from '../../lib/utils';
import { CryptoPageHeader } from './crypto/CryptoPageHeader';

type FlowClass = 'call-buy' | 'call-sell' | 'put-buy' | 'put-sell';
type SideFilter = 'all' | FlowClass;

type EnrichedTrade = DeribitOptionTrade & {
  optionType: 'call' | 'put';
  flowClass: FlowClass;
  strike: number | null;
  expiry: string;
  premiumUsd: number;
  notionalUsd: number;
};

const FLOW_META: Record<FlowClass, { label: string; note: string; color: string }> = {
  'call-buy': { label: 'Calls Bought', note: 'Bullish speculation', color: 'var(--up)' },
  'call-sell': { label: 'Calls Sold', note: 'Upside cap / income', color: 'var(--info)' },
  'put-buy': { label: 'Puts Bought', note: 'Bearish hedge / speculation', color: 'var(--down)' },
  'put-sell': { label: 'Puts Sold', note: 'Floor-setting', color: 'var(--warn)' },
};

function enrich(trade: DeribitOptionTrade, fallbackSpot: number): EnrichedTrade {
  const parts = trade.instrument_name.split('-');
  const optionType = parts.at(-1) === 'P' ? 'put' : 'call';
  const strike = Number(parts.at(-2));
  const expiry = parts.at(-3) ?? '—';
  const index = trade.index_price && trade.index_price > 0 ? trade.index_price : fallbackSpot;
  return {
    ...trade,
    optionType,
    flowClass: `${optionType}-${trade.direction}` as FlowClass,
    strike: Number.isFinite(strike) ? strike : null,
    expiry,
    premiumUsd: Math.abs(trade.price * trade.amount * index),
    notionalUsd: Math.abs(trade.amount * index),
  };
}

export function CryptoFlowView() {
  const symbol = useTerminalStore((s) => s.symbol);
  const snapshot = useTerminalStore((s) => s.snapshot);
  const asset: 'BTC' | 'ETH' = symbol === 'ETH' ? 'ETH' : 'BTC';
  // Lookback window is deep-linked (?page=flow&window=4)
  const [hoursParam, setHoursParam] = useUrlSearchParam('window', ['1', '4', '24'], '24');
  const hours = (Number(hoursParam) || 24) as 1 | 4 | 24;
  const setHours = (v: 1 | 4 | 24) => setHoursParam(String(v));
  const [side, setSide] = useState<SideFilter>('all');
  const [minNotional, setMinNotional] = useState(0);
  const [trades, setTrades] = useState<DeribitOptionTrade[]>([]);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const data = await fetchDeribitTrades(asset, hours, 750);
      if (cancelled) return;
      if (!data) {
        setError('Deribit trade tape unavailable. Retry LIVE or check the Node API.');
      } else {
        setTrades(data.trades);
        setFetchedAt(data.fetchedAt);
        setError('');
      }
      setLoading(false);
    };
    setLoading(true);
    void load();
    const id = setInterval(() => void load(), 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [asset, hours]);

  const enriched = useMemo(() => trades.map((trade) => enrich(trade, snapshot?.spot ?? 0)), [snapshot?.spot, trades]);
  const filtered = useMemo(() => enriched.filter((trade) => (side === 'all' || trade.flowClass === side) && trade.notionalUsd >= minNotional), [enriched, minNotional, side]);
  const totals = useMemo(() => {
    const base: Record<FlowClass, { premium: number; count: number; size: number }> = {
      'call-buy': { premium: 0, count: 0, size: 0 }, 'call-sell': { premium: 0, count: 0, size: 0 },
      'put-buy': { premium: 0, count: 0, size: 0 }, 'put-sell': { premium: 0, count: 0, size: 0 },
    };
    for (const trade of enriched) {
      const row = base[trade.flowClass]; row.premium += trade.premiumUsd; row.count += 1; row.size += trade.amount;
    }
    return base;
  }, [enriched]);
  const totalPremium = Object.values(totals).reduce((sum, row) => sum + row.premium, 0);
  const bullish = totals['call-buy'].premium + totals['put-sell'].premium;
  const bearish = totals['put-buy'].premium + totals['call-sell'].premium;
  const netFlow = bullish - bearish;

  const expiryData = useMemo(() => {
    const map = new Map<string, { expiry: string; calls: number; puts: number }>();
    for (const trade of enriched) {
      const row = map.get(trade.expiry) ?? { expiry: trade.expiry, calls: 0, puts: 0 };
      if (trade.optionType === 'call') row.calls += trade.premiumUsd; else row.puts += trade.premiumUsd;
      map.set(trade.expiry, row);
    }
    return [...map.values()].sort((a, b) => b.calls + b.puts - (a.calls + a.puts)).slice(0, 12);
  }, [enriched]);

  const spotRef = snapshot?.spot ?? 0;
  const flowMap = useMemo(() => {
    const rows = filtered
      .filter((trade) => trade.strike != null && trade.strike > 0 && spotRef > 0)
      .map((trade) => ({
        x: ((trade.strike! - spotRef) / spotRef) * 100,
        y: Math.log10(Math.max(10, trade.premiumUsd)),
        r: Math.min(16, 4 + Math.sqrt(trade.notionalUsd) / 220),
        call: trade.optionType === 'call',
        buy: trade.direction === 'buy',
        strike: trade.strike!, premium: trade.premiumUsd, expiry: trade.expiry,
      }));
    const xMax = 25, xMin = -25, yMin = 1, yMax = Math.max(3.5, ...rows.map((r) => r.y), 3.5);
    return { rows, xMin, xMax, yMin, yMax };
  }, [filtered, spotRef]);

  const moneyness = useMemo(() => {
    const labels = ['Far Below Spot', 'Below Spot', 'Near-the-Money', 'Above Spot', 'Far Above Spot'];
    const bands: { label: string; min: number; max: number; hint: string }[] = [
      { label: labels[0]!, min: -Infinity, max: -20, hint: 'more than 20% below' },
      { label: labels[1]!, min: -20, max: -5, hint: '5 to 20% below' },
      { label: labels[2]!, min: -5, max: 5, hint: 'within 5%' },
      { label: labels[3]!, min: 5, max: 20, hint: '5 to 20% above' },
      { label: labels[4]!, min: 20, max: Infinity, hint: 'more than 20% above' },
    ];
    const buckets = bands.map((band) => ({ ...band, callBuy: 0, callSell: 0, putBuy: 0, putSell: 0 }));
    for (const trade of enriched) {
      if (trade.strike == null || trade.strike <= 0 || spotRef <= 0) continue;
      const pct = ((trade.strike - spotRef) / spotRef) * 100;
      const bucket = buckets.find((b) => pct >= b.min && pct < b.max);
      if (!bucket) continue;
      if (trade.optionType === 'call') {
        if (trade.direction === 'buy') bucket.callBuy += trade.premiumUsd; else bucket.callSell += trade.premiumUsd;
      } else if (trade.direction === 'buy') bucket.putBuy += trade.premiumUsd; else bucket.putSell += trade.premiumUsd;
    }
    return buckets;
  }, [enriched, spotRef]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#030506]">
      <CryptoPageHeader
        title="Options Order"
        highlight="Flow"
        description={`Live ${asset} option fills on Deribit · where interest is landing, net taker direction, premium behind each side, and which expiries concentrate the book · ${fetchedAt ? 'updated ' + new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(fetchedAt) : 'waiting for prints'}`}
        actions={
          <span className="inline-flex min-h-7 items-center gap-1.5 border border-[#2c3337] px-2 font-mono text-[10px] text-[#8b969a]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#25d7c5]" aria-hidden="true" />
            DERIBIT LIVE
          </span>
        }
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#20282b] bg-[#0a0d0e] px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase text-[#8b999f]">Window</span>
        {([1, 4, 24] as const).map((value) => <button key={value} type="button" onClick={() => setHours(value)} aria-pressed={hours === value} className={cn('min-h-6 border px-2 font-mono text-[10px]', hours === value ? 'border-[#25d7c5] text-[#7ee9db]' : 'border-[#2c3337] text-[#8b999f]')}>{value}H</button>)}
        <span className="ml-2 font-mono text-[10px] uppercase text-[#8b999f]">Minimum Notional</span>
        {([0, 10_000, 50_000, 100_000] as const).map((value) => <button key={value} type="button" onClick={() => setMinNotional(value)} aria-pressed={minNotional === value} className={cn('min-h-6 border px-2 font-mono text-[10px]', minNotional === value ? 'border-[#25d7c5] text-[#25d7c5]' : 'border-[#2c3337] text-[#8b999f]')}>{value ? `$${fmtCompact(value)}` : 'ALL'}</button>)}
        <span className="ml-auto font-mono text-type-2xs text-muted-foreground">{filtered.length} / {enriched.length} prints</span>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-border lg:grid-cols-5">
        {(Object.keys(FLOW_META) as FlowClass[]).map((key) => {
          const meta = FLOW_META[key]; const row = totals[key]; const share = totalPremium > 0 ? row.premium / totalPremium : 0;
          return <button key={key} type="button" onClick={() => setSide(side === key ? 'all' : key)} className={cn('bg-card p-2 text-left transition-colors hover:bg-secondary/40', side === key && 'ring-1 ring-inset ring-primary')}><div className="font-mono text-type-2xs uppercase tracking-wider" style={{ color: meta.color }}>{meta.label}</div><div className="font-mono text-type-lg font-bold tabular-nums text-foreground">{fmtCompact(row.premium)}</div><div className="font-mono text-type-2xs text-muted-foreground">{fmtPct(share)} · {row.count} trades</div></button>;
        })}
        <div className="col-span-2 bg-card p-2 lg:col-span-1"><div className="font-mono text-type-2xs uppercase tracking-wider text-muted-foreground">Net Directional Flow</div><div className={cn('font-mono text-type-lg font-bold tabular-nums', netFlow >= 0 ? 'text-up' : 'text-down')}>{netFlow >= 0 ? '+' : ''}{fmtCompact(netFlow)}</div><div className="font-mono text-type-2xs text-muted-foreground">Bullish premium − bearish premium</div></div>
      </div>

      <div className="grid min-h-0 flex-1 gap-1 p-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(360px,0.7fr)]">
        <div className="grid min-h-0 grid-rows-[minmax(240px,0.9fr)_minmax(0,1.1fr)] gap-1">
          <Panel title="Flow Map" subtitle="Fills vs strike distance from spot · size = notional · filled = buy, outlined = sell">
            <div className="relative h-full w-full px-2 pb-1">
              {flowMap.rows.length ? (
                <svg viewBox="0 0 800 240" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="Option fills plotted against strike distance from spot">
                  {([-20, -10, 0, 10, 20]).map((tick) => {
                    const x = ((tick - flowMap.xMin) / (flowMap.xMax - flowMap.xMin)) * 800;
                    return (
                      <g key={tick}>
                        <line x1={x} x2={x} y1={4} y2={220} stroke="#1a2124" strokeWidth={1} />
                        <text x={x} y={234} fill="#5c6a70" fontSize={9} textAnchor="middle" fontFamily="JetBrains Mono, monospace">{tick > 0 ? `+${tick}%` : `${tick}%`}</text>
                      </g>
                    );
                  })}
                  <line x1={0} x2={800} y1={220} y2={220} stroke="#1a2124" strokeWidth={1} />
                  {([1, 2, 3, 4, 5]).map((logP) => {
                    if (logP < flowMap.yMin || logP > flowMap.yMax) return null;
                    const y = 220 - ((logP - flowMap.yMin) / (flowMap.yMax - flowMap.yMin)) * 212;
                    return <text key={logP} x={4} y={y - 3} fill="#5c6a70" fontSize={8} fontFamily="JetBrains Mono, monospace">${fmtCompact(10 ** logP)}</text>;
                  })}
                  {spotRef > 0 && (() => { const x = ((0 - flowMap.xMin) / (flowMap.xMax - flowMap.xMin)) * 800; return <line x1={x} x2={x} y1={4} y2={220} stroke="#25d7c5" strokeDasharray="3 3" strokeWidth={1} />; })()}
                  {flowMap.rows.map((point, index) => {
                    const cx = ((Math.max(flowMap.xMin, Math.min(flowMap.xMax, point.x)) - flowMap.xMin) / (flowMap.xMax - flowMap.xMin)) * 800;
                    const cy = 220 - ((Math.max(flowMap.yMin, Math.min(flowMap.yMax, point.y)) - flowMap.yMin) / (flowMap.yMax - flowMap.yMin)) * 212;
                    const color = point.call ? '#25d7c5' : '#e25c5c';
                    return (
                      <circle key={index} cx={cx} cy={cy} r={point.r} fill={point.buy ? color : 'none'} stroke={color} strokeWidth={point.buy ? 0 : 1.4} fillOpacity={0.55}>
                        <title>{`${point.expiry} K${point.strike} · ${point.call ? 'CALL' : 'PUT'} ${point.buy ? 'BUY' : 'SELL'} · $${fmtCompact(point.premium)} premium`}</title>
                      </circle>
                    );
                  })}
                </svg>
              ) : <EmptyState kind="no-data" title="No fills in range" body="Lower the minimum notional or widen the window." />}
            </div>
          </Panel>
          <Panel title="Recent Trades" subtitle="Live public options tape" apis={['Deribit']}>
          {loading && !trades.length ? <EmptyState kind="loading" title="Loading Deribit trades…" /> : error && !trades.length ? <EmptyState kind="error" title="Trade tape unavailable" body={error} /> : (
            <div className="h-full overflow-auto">
              <table className="w-full min-w-[760px] border-collapse font-mono text-type-2xs">
                <thead className="sticky top-0 z-10 bg-card text-muted-foreground"><tr><th className="px-2 py-1 text-left">Time</th><th className="px-2 py-1 text-left">Instrument</th><th className="px-2 py-1 text-left">Side</th><th className="px-2 py-1 text-right">Price</th><th className="px-2 py-1 text-right">Size</th><th className="px-2 py-1 text-right">Premium</th><th className="px-2 py-1 text-right">Notional</th><th className="px-2 py-1 text-right">IV</th></tr></thead>
                <tbody>{filtered.slice(0, 250).map((trade) => { const meta = FLOW_META[trade.flowClass]; return <tr key={`${trade.trade_id}-${trade.trade_seq ?? 0}`} className="border-t border-border/50 hover:bg-secondary/30"><td className="px-2 py-1 text-muted-foreground">{new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 }).format(trade.timestamp)}</td><td className="px-2 py-1 text-foreground">{trade.instrument_name}</td><td className="px-2 py-1 font-bold" style={{ color: meta.color }}>{trade.direction.toUpperCase()} {trade.optionType === 'call' ? 'C' : 'P'}</td><td className="px-2 py-1 text-right tabular-nums">{trade.price.toFixed(4)} {asset}</td><td className="px-2 py-1 text-right tabular-nums">{trade.amount.toFixed(3)}</td><td className="px-2 py-1 text-right tabular-nums">${fmtCompact(trade.premiumUsd)}</td><td className="px-2 py-1 text-right tabular-nums">${fmtCompact(trade.notionalUsd)}</td><td className="px-2 py-1 text-right tabular-nums text-info">{trade.iv != null ? `${trade.iv.toFixed(1)}%` : '—'}</td></tr>; })}</tbody>
              </table>
            </div>
          )}
          </Panel>
        </div>

        <div className="grid min-h-0 grid-rows-[minmax(190px,0.7fr)_minmax(170px,0.6fr)_minmax(190px,0.7fr)] gap-1">
          <Panel title="Moneyness Flow" subtitle="Premium-weighted by strike distance from spot">
            <div className="h-full overflow-auto">
              <table className="w-full border-collapse font-mono text-[10px]">
                <thead className="sticky top-0 bg-[#0a0d0e] text-[#8b999f]"><tr><th className="px-2 py-1 text-left">Band</th><th className="px-2 py-1 text-right">C Buy</th><th className="px-2 py-1 text-right">C Sell</th><th className="px-2 py-1 text-right">P Buy</th><th className="px-2 py-1 text-right">P Sell</th></tr></thead>
                <tbody>{moneyness.map((bucket) => (
                  <tr key={bucket.label} className="border-t border-[#1a1f22]">
                    <td className="px-2 py-1"><div className="text-[#d7dee0]">{bucket.label}</div><div className="text-[9px] text-[#5c6a70]">{bucket.hint}</div></td>
                    <td className="px-2 py-1 text-right tabular-nums text-[#25d7c5]">{bucket.callBuy ? `$${fmtCompact(bucket.callBuy)}` : '—'}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-[#1a9c8d]">{bucket.callSell ? `$${fmtCompact(bucket.callSell)}` : '—'}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-[#e25c5c]">{bucket.putBuy ? `$${fmtCompact(bucket.putBuy)}` : '—'}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-[#a83f3f]">{bucket.putSell ? `$${fmtCompact(bucket.putSell)}` : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Premium by Expiry" subtitle="Calls vs puts">
            <ResponsiveContainer width="100%" height="100%"><BarChart data={expiryData} margin={{ top: 12, right: 8, left: 0, bottom: 2 }}><CartesianGrid {...chartGridProps} /><XAxis dataKey="expiry" tick={{ fontSize: 8, fill: 'var(--muted-foreground)' }} /><YAxis width={42} tickFormatter={(v: number) => fmtCompact(v)} tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} /><Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [`$${fmtCompact(v)}`, 'Premium']} /><Bar dataKey="calls" stackId="flow" fill="var(--up)" isAnimationActive={false} /><Bar dataKey="puts" stackId="flow" fill="var(--down)" isAnimationActive={false} /></BarChart></ResponsiveContainer>
          </Panel>
          <Panel title="Largest Prints" subtitle="Ranked by premium">
            <div className="h-full overflow-auto p-1">{[...filtered].sort((a, b) => b.premiumUsd - a.premiumUsd).slice(0, 12).map((trade, index) => <div key={trade.trade_id} className="grid grid-cols-[2ch_1fr_auto] items-center gap-2 border-b border-border/50 px-1 py-1 font-mono text-type-2xs"><span className="text-muted-foreground">{index + 1}</span><div className="min-w-0"><div className="truncate text-foreground">{trade.instrument_name}</div><div style={{ color: FLOW_META[trade.flowClass].color }}>{trade.direction.toUpperCase()} · {trade.amount.toFixed(2)} contracts</div></div><div className="text-right"><div className="font-bold tabular-nums text-foreground">${fmtCompact(trade.premiumUsd)}</div><div className="tabular-nums text-muted-foreground">K {trade.strike != null ? fmtPrice(trade.strike, 0) : '—'}</div></div></div>)}</div>
          </Panel>
        </div>
      </div>
      <footer className="shrink-0 border-t border-border px-2 py-1 font-mono text-type-2xs text-muted-foreground">Direction is Deribit’s reported taker direction. Premium USD ≈ option price × contracts × index; verify venue contract conventions before trading.</footer>
    </div>
  );
}
