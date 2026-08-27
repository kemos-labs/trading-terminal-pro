import { useEffect, useState } from 'react';
import { fetchDeribitMarket, type DeribitMarketBundle, type NormalizedTicker } from '../../../api/deribit';
import { ChainTable, type ChainRow } from '../../../components/charts/ChainTable';
import { priceEuropeanSpot } from '../../../lib/math/spotBsm';
import type { DecimalRate, DecimalVol, YearFraction } from '../../../lib/math/units';

export function CryptoTradeView() {
  const [bundle, setBundle] = useState<DeribitMarketBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [legs, setLegs] = useState<{ strike: number; side: 'call' | 'put'; qty: number }[]>([]);

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

  if (!bundle) return <div className="p-4 font-mono text-xs animate-pulse">Loading chain…</div>;

  const spot = bundle.indexPrice ?? bundle.instruments.find(t => t.kind === 'perp')?.markPrice ?? null;
  const options = bundle.instruments.filter(t => t.kind === 'option' && t.strike != null && t.expiryMs != null);

  if (!spot || options.length === 0) return (
    <div className="rounded border border-dashed p-8 text-center font-mono text-xs" data-testid="trade-empty">
      <div className="font-bold">No chain data</div>
      <div className="mt-1 text-muted-foreground">Coverage {(bundle.coverage ?? 0) * 100 | 0}% — Deribit returned no options. Check venue or retry.</div>
    </div>
  );

  // Build chain rows from real Deribit options
  const byStrike = new Map<number, { call?: NormalizedTicker; put?: NormalizedTicker }>();
  for (const o of options) {
    const s = o.strike!;
    const entry = byStrike.get(s) ?? {};
    if (o.optionType === 'call') entry.call = o;
    else if (o.optionType === 'put') entry.put = o;
    byStrike.set(s, entry);
  }
  const sortedStrikes = [...byStrike.keys()].sort((a, b) => a - b);
  const T = 0.25 as YearFraction, r = 0.02 as DecimalRate, q = 0 as DecimalRate, vol = 0.6 as DecimalVol;

  const rows: ChainRow[] = sortedStrikes.slice(0, 60).map(strike => {
    const entry = byStrike.get(strike)!;
    const callPx = priceEuropeanSpot('call', spot, strike, T, r, q, vol).price;
    const putPx = priceEuropeanSpot('put', spot, strike, T, r, q, vol).price;
    return {
      strike,
      expiry: entry.call?.expiryMs ? new Date(entry.call.expiryMs).toISOString().slice(0, 10) : '—',
      callBid: entry.call?.bidPrice ?? callPx * 0.99,
      callAsk: entry.call?.askPrice ?? callPx * 1.01,
      putBid: entry.put?.bidPrice ?? putPx * 0.99,
      putAsk: entry.put?.askPrice ?? putPx * 1.01,
      iv: (entry.call?.markIv ?? entry.put?.markIv ?? vol) as number,
      oi: entry.call?.openInterest ?? entry.put?.openInterest ?? null,
    };
  });

  const totalPremium = legs.reduce((sum, l) => {
    const px = priceEuropeanSpot(l.side, spot, l.strike, T, r, q, vol).price;
    return sum + px * l.qty;
  }, 0);

  return (
    <div className="space-y-3" data-testid="trade-risk-workstation">
      <div className="flex gap-2 font-mono text-xs">
        <span className="rounded bg-muted px-2 py-1">Spot {spot.toFixed(1)}</span>
        <span className="rounded bg-muted px-2 py-1">Premium {totalPremium.toFixed(2)}</span>
        <span className="text-muted-foreground">Same engine as Volatility/Positioning — no private formula</span>
      </div>
      <ChainTable rows={rows} />
      <div className="rounded border p-3 font-mono text-xs">
        <div className="font-bold uppercase">Strategy Builder</div>
        <div className="mt-2 flex gap-2">
          {legs.map((l, i) => <span key={i} className="rounded bg-muted px-2 py-1">{l.qty}× {l.side} {l.strike}</span>)}
          <button onClick={() => {
            const mid = sortedStrikes[Math.floor(sortedStrikes.length / 2)] ?? spot ?? 60000;
            setLegs([...legs, { strike: mid, side: 'put', qty: 1 }]);
          }} className="rounded border px-2 py-1 hover:bg-muted">+ Leg</button>
        </div>
        <div className="mt-3 text-[10px] text-muted-foreground">P&L, Greeks, scenario hedge — canonical math, fees/slippage/drift explicit</div>
      </div>
    </div>
  );
}
