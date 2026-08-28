import { useEffect, useState } from 'react';
import { fetchDeribitMarket, type DeribitMarketBundle, type NormalizedTicker } from '../../../api/deribit';
import { ChainTable, type ChainRow } from '../../../components/charts/ChainTable';
import { priceEuropeanBlack76 } from '../../../lib/math/black76';
import { yearFractionAct365 } from '../../../lib/math/units';

export function CryptoTradeView() {
  const [bundle, setBundle] = useState<DeribitMarketBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [legs, setLegs] = useState<{ strike: number; side: 'call' | 'put'; qty: number }[]>([]);
  const [showModel, setShowModel] = useState(false);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchDeribitMarket('BTC').then(r => {
      if (cancelled) return;
      setBundle(r);
      setStale(Date.now() - r.fetchedAt > 60_000);
    }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  if (error) return (
    <div className="rounded border border-destructive bg-destructive/10 p-4 font-mono text-xs" role="alert">
      <div className="font-bold">Provider unavailable</div>
      <div className="mt-1 text-muted-foreground">{error}</div>
    </div>
  );

  if (!bundle) return <div className="p-4 font-mono text-xs animate-pulse">Loading chain…</div>;

  const now = Date.now();
  const spot = bundle.indexPrice ?? null;
  const perp = bundle.instruments.find(t => t.kind === 'perp');
  // Venue forward: perp mark is the tradable forward proxy; index is fallback. Never a constant.
  const forward = perp?.markPrice ?? spot;

  // Nearest NON-EXPIRED expiry with quoted options
  const expiries = [...new Set(
    bundle.instruments.filter(t => t.kind === 'option' && t.expiryMs != null && t.expiryMs > now).map(t => t.expiryMs!),
  )].sort((a, b) => a - b);
  const selectedExpiry = expiries[0] ?? null;

  if (forward == null || selectedExpiry == null) return (
    <div className="rounded border border-dashed p-8 text-center font-mono text-xs" data-testid="trade-empty">
      <div className="font-bold">No chain data</div>
      <div className="mt-1 text-muted-foreground">
        {forward == null ? 'Venue forward/index unavailable. ' : ''}No valid non-expired options. Check venue or retry.
      </div>
    </div>
  );

  const T = yearFractionAct365(now, selectedExpiry);
  const options = bundle.instruments.filter(t => t.kind === 'option' && t.expiryMs === selectedExpiry);

  // Group by strike — bids/asks only when the venue reports executable quotes.
  // No ±1% synthetic spreads. Missing bid/ask renders unavailable in ChainTable.
  const byStrike = new Map<number, { call?: NormalizedTicker; put?: NormalizedTicker }>();
  for (const o of options) {
    const s = o.strike!;
    const entry = byStrike.get(s) ?? {};
    if (o.optionType === 'call') entry.call = o;
    else if (o.optionType === 'put') entry.put = o;
    byStrike.set(s, entry);
  }
  const sortedStrikes = [...byStrike.keys()].sort((a, b) => a - b);

  // Observed-IV rows; rows without observed mark IV are still listed (model layer unavailable for them)
  const rows: ChainRow[] = sortedStrikes.slice(0, 60).map(strike => {
    const entry = byStrike.get(strike)!;
    const ref = entry.call ?? entry.put;
    return {
      strike,
      expiry: new Date(selectedExpiry).toISOString().slice(0, 10),
      callBid: entry.call?.bidPrice ?? null,
      callAsk: entry.call?.askPrice ?? null,
      putBid: entry.put?.bidPrice ?? null,
      putAsk: entry.put?.askPrice ?? null,
      iv: ref?.markIv ?? null, // decimal; ChainTable renders ×100
      oi: entry.call?.openInterest ?? entry.put?.openInterest ?? null,
    };
  });

  // Model layer: Black-76 at venue forward, observed mark IV, zero-discount (no rate feed in this view).
  // r=0 is an explicit, labelled modelling assumption — not a fabricated market rate.
  const modelPrice = (side: 'call' | 'put', strike: number): number | null => {
    const o = side === 'call' ? byStrike.get(strike)?.call : byStrike.get(strike)?.put;
    const iv = (o?.markIv ?? null);
    if (iv == null || iv <= 0) return null;
    return priceEuropeanBlack76({ side, forward, strike, expiryYears: T, rate: 0 as never, vol: iv as never }).price;
  };

  const totalPremium = legs.reduce((sum, l) => {
    const px = modelPrice(l.side, l.strike);
    return px != null ? sum + px * l.qty : sum;
  }, 0);
  const legsPriced = legs.every(l => modelPrice(l.side, l.strike) != null);

  return (
    <div className="space-y-3" data-testid="trade-risk-workstation">
      <div className="flex flex-wrap gap-2 font-mono text-xs">
        <span className="rounded bg-muted px-2 py-1">Expiry {new Date(selectedExpiry).toISOString().slice(0, 10)} · T={T.toFixed(4)} (ACT/365F)</span>
        <span className="rounded bg-muted px-2 py-1">Forward {forward.toFixed(1)} (venue perp mark)</span>
        <span className="rounded bg-muted px-2 py-1">Premium in BTC (inverse, coin-settled)</span>
        {stale
          ? <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-400">Stale</span>
          : <span className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-400" title={`Deribit snapshot ${new Date(bundle.fetchedAt).toISOString()}`}>Observed</span>}
      </div>

      <ChainTable rows={rows} />

      <div className="rounded border p-3 font-mono text-xs">
        <div className="flex items-center gap-2">
          <div className="font-bold uppercase">Strategy Builder</div>
          <button
            onClick={() => setShowModel(v => !v)}
            className="ml-auto rounded border px-2 py-0.5 text-[10px] hover:bg-muted"
            aria-pressed={showModel}
          >
            {showModel ? 'Hide model layer' : 'Show model layer'}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {legs.map((l, i) => <span key={i} className="rounded bg-muted px-2 py-1">{l.qty}× {l.side} {l.strike}</span>)}
          {legs.length === 0 && <span className="text-muted-foreground">No legs — add from the mid strike below.</span>}
          <button onClick={() => {
            const mid = sortedStrikes[Math.floor(sortedStrikes.length / 2)];
            if (mid != null) setLegs([...legs, { strike: mid, side: 'put', qty: 1 }]);
          }} className="rounded border px-2 py-1 hover:bg-muted">+ Leg @ ATM strike</button>
        </div>
        {showModel && (
          <div className="mt-3 rounded border border-dashed p-2 text-[10px] text-muted-foreground" data-testid="trade-model-layer">
            <div className="font-bold text-foreground">Model layer — not executable</div>
            <div>Black-76 @ venue forward, observed mark IV, zero discount (no rate feed wired; r=0 assumption, labelled).</div>
            <div className="mt-1">Leg premium total: {legs.length === 0 ? '—' : legsPriced ? `${totalPremium.toFixed(4)} BTC` : 'unavailable (leg lacks observed IV)'}</div>
          </div>
        )}
        <div className="mt-2 text-[10px] text-muted-foreground">Bids/asks are observed Deribit executable quotes only — no synthetic spread. Same engine as Volatility/Positioning.</div>
      </div>
    </div>
  );
}
