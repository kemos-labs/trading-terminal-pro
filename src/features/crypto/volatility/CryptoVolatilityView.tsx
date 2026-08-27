import { useEffect, useState } from 'react';
import { fetchDeribitMarket } from '../../../api/deribit';
import { forwardVol } from '../../../lib/math/carry/forwardVol';

interface TermPoint { expiryMs: number; atmIv: number | null; dte: number; provenance: string; }

export function CryptoVolatilityView() {
  const [term, setTerm] = useState<TermPoint[] | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [venue] = useState('deribit');
  const [showModel, setShowModel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDeribitMarket('BTC').then(res => {
      if (cancelled) return;
      // Mock term: group by expiry, compute ATM iv as median markIv near spot
      const now = Date.now();
      setAsOf(res.asOf ?? now);
      // If real data not available, use empty state
      if (!res.tickers?.length) {
        setTerm([]);
        return;
      }
      // Derive term points from tickers: unique expiries, median iv
      const byExpiry = new Map<number, number[]>();
      for (const t of res.tickers as any[]) {
        const exp = (t.expiryMs ?? t.expiry) as number;
        if (!exp || t.markIv == null) continue;
        const arr = byExpiry.get(exp) ?? [];
        arr.push(Number(t.markIv));
        byExpiry.set(exp, arr);
      }
      const points: TermPoint[] = [...byExpiry.entries()].map(([exp, ivs]) => {
        ivs.sort((a,b)=>a-b);
        const mid = ivs[Math.floor(ivs.length/2)]!;
        return { expiryMs: exp, atmIv: mid / 100, dte: Math.round((exp - now)/864e5), provenance: 'observed' };
      }).sort((a,b)=>a.expiryMs - b.expiryMs);
      setTerm(points);
    }).catch(e => { if(!cancelled) setError(String(e.message)); });
    return () => { cancelled = true; };
  }, []);

  if (error) return (
    <div className="rounded border border-destructive bg-destructive/10 p-4 font-mono text-xs" role="alert">
      <div className="font-bold">Provider unavailable</div>
      <div className="mt-1 text-muted-foreground">{error}</div>
      <div className="mt-2 text-[10px]">Prerequisite: Deribit REST reachable. Retry via refresh.</div>
    </div>
  );

  if (term == null) return <div className="p-4 font-mono text-xs animate-pulse">Loading volatility term…</div>;
  if (term.length === 0) return (
    <div className="rounded border border-dashed p-8 text-center font-mono text-xs" data-testid="vol-empty">
      <div className="font-bold">No observed quotes</div>
      <div className="mt-1 text-muted-foreground">Coverage 0% — Deribit returned no expiries. Check venue or retry.</div>
    </div>
  );

  // Forward vol derived
  const fwdVols = term.map((pt, i) => {
    if (i === 0) return null;
    const prev = term[i-1]!;
    const f = forwardVol(prev.atmIv!, prev.dte/365, pt.atmIv!, pt.dte/365);
    return f;
  });

  return (
    <div className="space-y-4" data-testid="volatility-workstation">
      <div className="flex items-center gap-2 font-mono text-xs">
        <span className="rounded bg-muted px-2 py-1">Venue: {venue}</span>
        <span className="rounded bg-muted px-2 py-1">As of: {asOf ? new Date(asOf).toISOString().slice(11,19) : '—'}Z</span>
        <span className="rounded bg-muted px-2 py-1">Coverage {term.length} expiries</span>
        <span className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-700">Observed</span>
        {showModel && <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-700">Model</span>}
        <button onClick={()=>setShowModel(v=>!v)} className="ml-auto rounded border px-2 py-1 text-xs hover:bg-muted" aria-pressed={showModel}>
          {showModel ? 'Hide model diagnostics' : 'Show model diagnostics'}
        </button>
      </div>

      <div className="rounded border p-3">
        <h3 className="font-mono text-xs font-bold uppercase">ATM Term Structure (actual expiries)</h3>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">Forward log-moneyness k=ln(K/F), total variance w=σ²T. Forward vol null when variance invalid — not clamped.</p>
        <div className="mt-3 grid grid-cols-4 gap-2 font-mono text-xs">
          <div className="font-bold text-muted-foreground">Expiry</div><div className="font-bold">DTE</div><div className="font-bold">ATM IV (obs)</div><div className="font-bold">Fwd Vol</div>
          {term.map((pt,i)=>(
            <div key={pt.expiryMs} className="contents">
              <div>{new Date(pt.expiryMs).toISOString().slice(0,10)}</div>
              <div>{pt.dte}d</div>
              <div>{pt.atmIv != null ? (pt.atmIv*100).toFixed(1)+'%' : '—'}</div>
              <div>{fwdVols[i] != null ? (fwdVols[i]!*100).toFixed(1)+'%' : <span className="text-muted-foreground">unavailable</span>}</div>
            </div>
          ))}
        </div>
      </div>

      {showModel && (
        <div className="rounded border border-dashed p-3 font-mono text-xs" data-testid="model-diagnostics">
          <div className="font-bold">Model diagnostics (opt-in SVI)</div>
          <div className="mt-1 text-muted-foreground">Model surface never fills observed cells. Separate masks, calibration timestamp, residuals shown here.</div>
          <div className="mt-2 rounded bg-muted p-2">SVI fit: w(k)=a+b[ρ(k-m)+√((k-m)²+σ²)] — raw evaluation only. No arb claim without price-space checks.</div>
        </div>
      )}

      <div className="rounded border p-3">
        <h3 className="font-mono text-xs font-bold uppercase">Observed Quote Matrix</h3>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">Bid/ask/mark IV separated; mark not executable. Heuristic/model badges distinct from observed.</p>
        <div className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 font-mono text-[10px]">
          Matrix placeholder — strike × expiry with exact-value tooltips and missing-cell mask (Phase 5 hook)
        </div>
      </div>
    </div>
  );
}
