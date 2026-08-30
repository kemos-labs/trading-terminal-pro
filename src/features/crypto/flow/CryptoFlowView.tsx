import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { fetchDeribitTrades, type DeribitTrade } from '../../../api/deribit';
import { CHART } from '../../../lib/chartTheme';

export function CryptoFlowView() {
  const [trades, setTrades] = useState<DeribitTrade[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchDeribitTrades('BTC', 24, 100).then(res => {
      if (cancelled) return;
      setTrades(res.trades);
      setAsOf(res.fetchedAt);
      setStale(Date.now() - res.fetchedAt > 30_000);
    }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  // Aggregates: call/put × buy/sell taker counts + native premium shares.
  const agg = useMemo(() => {
    const g = { buy: 0, sell: 0 };
    const p = { buy: 0, sell: 0 };
    for (const t of trades ?? []) {
      const isCall = /-C\d+/.test(t.instrument);
      const bucket = isCall ? g : p;
      if (t.side === 'buy') bucket.buy += 1;
      else bucket.sell += 1;
    }
    return { calls: g, puts: p };
  }, [trades]);

  // Trade timeline: per-hour call/put taker counts (bubble proxy via bar height).
  const timeline = useMemo(() => {
    const byHour = new Map<string, { call: number; put: number }>();
    for (const t of trades ?? []) {
      if (t.timestamp == null) continue;
      const h = new Date(t.timestamp).toISOString().slice(11, 13) + 'h';
      const e = byHour.get(h) ?? { call: 0, put: 0 };
      if (/-C\d+/.test(t.instrument)) e.call += 1;
      else e.put += 1;
      byHour.set(h, e);
    }
    return [...byHour.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([h, v]) => ({ hour: h, ...v }));
  }, [trades]);

  // Expiry distribution (top 6 by trade count).
  const byExpiry = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trades ?? []) {
      const mm = t.instrument.match(/(\d+[A-Z])\d?-/);
      const key = mm?.[1] ?? 'other';
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => ({ expiry: k, trades: n }));
  }, [trades]);


  if (error) return (
    <div className="rounded border border-destructive bg-destructive/10 p-4 font-mono text-xs" role="alert">
      <div className="font-bold">Provider unavailable</div>
      <div className="mt-1 text-muted-foreground">{error}</div>
      <div className="mt-2 text-[10px]">Prerequisite: Deribit REST reachable. Retry via refresh.</div>
    </div>
  );

  if (trades == null) return <div className="p-4 font-mono text-xs animate-pulse">Loading flow…</div>;

  if (trades.length === 0) return (
    <div className="rounded border border-dashed p-8 text-center font-mono text-xs" data-testid="flow-empty">
      <div className="font-bold">No trades</div>
      <div className="mt-1 text-muted-foreground">Deribit returned no options trades in the window. Check venue or retry.</div>
    </div>
  );

  // Native premium: price (BTC) × amount (contracts) × contract_size. Settlement ccy, NOT USD.
  const nativeCcy = trades.find(t => t.nativeCurrency)?.nativeCurrency ?? 'BTC (inverse)';
  const totalNative = trades.reduce((s, t) => s + (t.premiumNative ?? 0), 0);
  const buyNative = trades.filter(t => t.side === 'buy').reduce((s, t) => s + (t.premiumNative ?? 0), 0);

  return (
    <div data-testid="flow-workstation" className="space-y-3">
      <div className="flex flex-wrap gap-2 font-mono text-xs">
        <span className="rounded bg-muted px-2 py-1">Taker side only — not opening/closing, not dealer identity</span>
        <span className="rounded bg-muted px-2 py-1">Source: Deribit trades</span>
        <span className="rounded bg-muted px-2 py-1">Coverage {trades.length} trades</span>
        <span className="rounded bg-muted px-2 py-1">As of {asOf ? new Date(asOf).toISOString().slice(11, 19) + 'Z' : '—'}</span>
        {stale
          ? <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-400">Stale</span>
          : <span className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-400" title={`Deribit snapshot ${asOf ? new Date(asOf).toISOString() : ''}`}>Observed</span>}
      </div>
      {/* Primary decision visuals: aggregates + timeline + expiry distribution */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded border p-3" data-testid="flow-aggregates">
          <div className="font-mono text-xs font-bold uppercase">Taker Aggregates</div>
          <div className="mt-2 font-mono text-xs">
            <div className="grid grid-cols-3 gap-1 border-b border-border/60 pb-1 text-muted-foreground"><span /><span className="text-right">buy</span><span className="text-right">sell</span></div>
            <div className="grid grid-cols-3 gap-1 border-b border-border/40 py-0.5"><span>Calls</span><span className="text-right tabular-nums text-up">{agg.calls.buy}</span><span className="text-right tabular-nums text-down">{agg.calls.sell}</span></div>
            <div className="grid grid-cols-3 gap-1 py-0.5"><span>Puts</span><span className="text-right tabular-nums text-up">{agg.puts.buy}</span><span className="text-right tabular-nums text-down">{agg.puts.sell}</span></div>
          </div>
        </div>
        <div className="rounded border p-3 lg:col-span-2" data-testid="flow-timeline">
          <div className="font-mono text-xs font-bold uppercase">Trade Timeline (trades/hour by type)</div>
          {timeline.length === 0 ? (
            <div className="mt-2 font-mono text-[10px] text-muted-foreground">No timestamps in window — timeline unavailable.</div>
          ) : (
            <div className="mt-2 h-28">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timeline} margin={{ top: 2, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="hour" tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} interval={Math.max(0, timeline.length - 8)} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} width={26} allowDecimals={false} />
                  <Bar dataKey="call" stackId="a" fill={CHART.series.up} isAnimationActive={false} />
                  <Bar dataKey="put" stackId="a" fill={CHART.series.down} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
      {byExpiry.length > 0 && (
        <div className="rounded border p-3" data-testid="flow-expiry-dist">
          <div className="font-mono text-xs font-bold uppercase">Expiry Distribution (trade count)</div>
          <div className="mt-2 h-20">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byExpiry} margin={{ top: 2, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="expiry" tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
                <YAxis tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} width={26} allowDecimals={false} />
                <Bar dataKey="trades" fill={CHART.series.rate} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div className="rounded border">
        <div className="border-b bg-muted/40 px-2 py-1 font-mono text-[10px] font-bold uppercase">Tape — recent options trades (taker)</div>
        <table className="w-full" aria-label="Recent Deribit options trades, taker side">
          <thead>
            <tr className="border-b bg-muted/40 font-mono text-[10px] font-bold uppercase">
              <th scope="col" className="p-2 text-left">Time</th>
              <th scope="col" className="p-2 text-left">Instrument</th>
              <th scope="col" className="p-2 text-left">Side</th>
              <th scope="col" className="p-2 text-left">Qty</th>
              <th scope="col" className="p-2 text-left">Price</th>
              <th scope="col" className="p-2 text-left">Premium ({nativeCcy})</th>
              <th scope="col" className="p-2 text-left">Mark IV</th>
              <th scope="col" className="p-2 text-left">Flags</th>
            </tr>
          </thead>
          <tbody>
            {trades.slice(0, 50).map((t, i) => (
              <tr key={i} className="font-mono text-xs hover:bg-muted/30">
                <td className="p-2">{t.timestamp != null ? new Date(t.timestamp).toISOString().slice(11, 19) : '—'}</td>
                <td className="p-2 max-w-40 truncate">{t.instrument}</td>
                <td className={`p-2 ${t.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>{t.side}</td>
                <td className="p-2">{t.quantity}</td>
                <td className="p-2">{t.price.toFixed(4)}</td>
                <td className="p-2">{t.premiumNative != null ? `${t.premiumNative.toFixed(4)} ${t.nativeCurrency ?? ''}` : 'unavailable'}</td>
                <td className="p-2">{t.markIv != null ? `${(t.markIv * 100).toFixed(1)}%` : '—'}</td>
                <td className="p-2">{t.blockTrade ? 'BLOCK' : t.rfq ? 'RFQ' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded border p-2 font-mono text-[10px] text-muted-foreground">
        Premium is NATIVE settlement currency ({nativeCcy}): price × qty × contract_size — inverse options are
        coin-settled; no USD conversion is applied without an authoritative rate. Block/RFQ only where Deribit reports them.
        Native total: {totalNative.toFixed(4)} · Buy-side: {buyNative.toFixed(4)} · Sell-side: {(totalNative - buyNative).toFixed(4)}
      </div>
    </div>
  );
}
