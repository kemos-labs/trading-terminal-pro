import { useEffect, useState } from 'react';
import { fetchDeribitMarket } from '../../../api/deribit';

export function CryptoOverviewView() {
  const [spot, setSpot] = useState<number | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [funding, setFunding] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchDeribitMarket('BTC').then(r=>{
      const ticker = (r.tickers as any[])?.find(t=>t.instrument?.includes('PERP')) ?? (r.tickers as any[])?.[0];
      setSpot(ticker?.markPrice ?? ticker?.lastPrice ?? null);
      setAsOf(r.asOf ?? Date.now());
      setFunding(ticker?.funding ?? null);
      setLoading(false);
    }).catch(()=>setLoading(false));
  }, []);
  if (loading) return <div className="p-4 font-mono text-xs animate-pulse">Loading overview…</div>;
  return (
    <div className="space-y-3" data-testid="overview-workstation">
      <div className="flex flex-wrap gap-2 font-mono text-xs">
        <span className="rounded bg-muted px-2 py-1">BTC · Deribit · {asOf ? new Date(asOf).toISOString().slice(11,19)+'Z' : '—'}</span>
        <span className="rounded bg-muted px-2 py-1">Spot {spot != null ? spot.toFixed(1) : '—'}</span>
        <span className="rounded bg-muted px-2 py-1">Funding {funding != null ? (funding*100).toFixed(4)+'%' : '—'}</span>
        <span className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-700">Observed</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border p-3">
          <div className="font-mono text-xs font-bold uppercase">Regime Strip</div>
          <div className="mt-2 font-mono text-[10px] text-muted-foreground">Spot/forward, ATM/DVOL, RV, term slope, funding/basis, OI/flow coverage — linked callouts</div>
          <div className="mt-3 h-16 rounded bg-muted" />
        </div>
        <div className="rounded border p-3">
          <div className="font-mono text-xs font-bold uppercase">Coverage</div>
          <div className="mt-2 font-mono text-xs">OI  —  Flow  —  Chain  —  Funding </div>
        </div>
      </div>
      <div className="rounded border p-3">
        <div className="font-mono text-xs font-bold uppercase">Decision Callouts</div>
        <div className="mt-2 grid grid-cols-4 gap-2 font-mono text-[10px]">
          <div className="rounded bg-muted p-2">Vol → Volatility</div>
          <div className="rounded bg-muted p-2">Positioning → Positioning</div>
          <div className="rounded bg-muted p-2">Flow → Flow</div>
          <div className="rounded bg-muted p-2">Carry → Carry</div>
        </div>
      </div>
    </div>
  );
}
