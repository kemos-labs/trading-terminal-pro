import { useEffect, useState } from 'react';
import { fetchDeribitTrades, type DeribitTrade } from '../../../api/deribit';

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
          : <span className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-700" title={`Deribit snapshot ${asOf ? new Date(asOf).toISOString() : ''}`}>Observed</span>}
      </div>
      <div className="rounded border">
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
                <td className={`p-2 ${t.side === 'buy' ? 'text-emerald-600' : 'text-red-600'}`}>{t.side}</td>
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
