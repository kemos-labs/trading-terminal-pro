import { useEffect, useState } from 'react';
import { fetchDeribitMarket, type DeribitMarketBundle } from '../../../api/deribit';

export function CryptoOverviewView() {
  const [bundle, setBundle] = useState<DeribitMarketBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDeribitMarket('BTC').then(r => {
      if (cancelled) return;
      setBundle(r);
    }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  if (error) return (
    <div className="rounded border border-destructive bg-destructive/10 p-4 font-mono text-xs" role="alert">
      <div className="font-bold">Provider unavailable</div>
      <div className="mt-1 text-muted-foreground">{error}</div>
    </div>
  );

  if (!bundle) return <div className="p-4 font-mono text-xs animate-pulse">Loading overview…</div>;

  const perp = bundle.instruments.find(t => t.kind === 'perp');
  const spot = bundle.indexPrice ?? perp?.markPrice ?? null;
  const funding = bundle.fundingAnnualized;
  const optionCount = bundle.instruments.filter(t => t.kind === 'option').length;
  const expiryCount = new Set(bundle.instruments.map(t => t.expiryMs).filter(Boolean)).size;

  return (
    <div className="space-y-3" data-testid="overview-workstation">
      <div className="flex flex-wrap gap-2 font-mono text-xs">
        <span className="rounded bg-muted px-2 py-1">BTC · Deribit · {new Date(bundle.fetchedAt).toISOString().slice(11, 19)}Z</span>
        <span className="rounded bg-muted px-2 py-1">Spot {spot != null ? spot.toFixed(1) : '—'}</span>
        <span className="rounded bg-muted px-2 py-1">Funding {funding != null ? (funding * 100).toFixed(4) + '%' : '—'}</span>
        <span className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-700">Observed</span>
        <span className="rounded bg-muted px-2 py-1">Coverage {(bundle.coverage ?? 0) * 100 | 0}%</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border p-3">
          <div className="font-mono text-xs font-bold uppercase">Regime Strip</div>
          <div className="mt-2 font-mono text-xs">
            <div>Spot: {spot != null ? spot.toFixed(1) : '—'}</div>
            <div>Perp mark: {perp?.markPrice != null ? perp.markPrice.toFixed(1) : '—'}</div>
            <div>Perp bid/ask: {perp?.bidPrice != null ? perp.bidPrice.toFixed(1) : '—'} / {perp?.askPrice != null ? perp.askPrice.toFixed(1) : '—'}</div>
            <div>Funding (ann): {funding != null ? (funding * 100).toFixed(4) + '%' : '—'}</div>
          </div>
        </div>
        <div className="rounded border p-3">
          <div className="font-mono text-xs font-bold uppercase">Coverage</div>
          <div className="mt-2 font-mono text-xs">
            <div>Options: {optionCount}</div>
            <div>Expiries: {expiryCount}</div>
            <div>Total instruments: {bundle.instruments.length}</div>
            <div>Source: {bundle.source}</div>
          </div>
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
