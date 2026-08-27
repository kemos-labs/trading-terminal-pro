import { useEffect, useState } from 'react';
import { fetchDeribitTrades, type DeribitTrade } from '../../../api/deribit';

export function CryptoFlowView() {
  const [trades, setTrades] = useState<DeribitTrade[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDeribitTrades('BTC', 24, 100).then(res => {
      if (cancelled) return;
      setTrades(res.trades);
      setAsOf(res.fetchedAt);
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

  const totalPremium = trades.reduce((s, t) => s + t.premium, 0);
  const buyPremium = trades.filter(t => t.side === 'buy').reduce((s, t) => s + t.premium, 0);

  return (
    <div data-testid="flow-workstation" className="space-y-3">
      <div className="flex flex-wrap gap-2 font-mono text-xs">
        <span className="rounded bg-muted px-2 py-1">Taker side only — not opening/closing, not dealer identity</span>
        <span className="rounded bg-muted px-2 py-1">Source: Deribit trades</span>
        <span className="rounded bg-muted px-2 py-1">Coverage {trades.length} trades</span>
        <span className="rounded bg-muted px-2 py-1">As of {asOf ? new Date(asOf).toISOString().slice(11, 19) + 'Z' : '—'}</span>
      </div>
      <div className="rounded border">
        <div className="grid grid-cols-7 gap-2 border-b bg-muted/40 p-2 font-mono text-[10px] font-bold uppercase">
          <div>Time</div><div>Instrument</div><div>Side</div><div>Qty</div><div>Price</div><div>Premium</div><div>Flags</div>
        </div>
        {trades.slice(0, 50).map((t, i) => (
          <div key={i} className="grid grid-cols-7 gap-2 p-2 font-mono text-xs hover:bg-muted/30">
            <div>{new Date(t.timestamp).toISOString().slice(11, 19)}</div>
            <div className="truncate">{t.instrument}</div>
            <div className={t.side === 'buy' ? 'text-emerald-600' : 'text-red-600'}>{t.side}</div>
            <div>{t.quantity}</div>
            <div>{t.price.toFixed(1)}</div>
            <div>{t.premium.toFixed(0)}</div>
            <div>{t.blockTrade ? 'BLOCK' : t.rfq ? 'RFQ' : '—'}</div>
          </div>
        ))}
      </div>
      <div className="rounded border p-2 font-mono text-[10px] text-muted-foreground">
        Total premium: {totalPremium.toFixed(0)} · Buy-side: {buyPremium.toFixed(0)} · Sell-side: {(totalPremium - buyPremium).toFixed(0)}
        {' '}· Block/RFQ only where Deribit reports them.
      </div>
    </div>
  );
}
