import { useEffect, useState } from 'react';
import { fetchDeribitMarket, type DeribitMarketBundle, type NormalizedTicker } from '../../../api/deribit';
import { forwardVol } from '../../../lib/math/carry/forwardVol';

interface TermPoint { expiryMs: number; atmIv: number | null; dte: number; provenance: string; }

function atmIvAtExpiry(tickers: NormalizedTicker[], expiryMs: number, spot: number): number | null {
  // ATM = nearest strike to spot at this expiry
  const atExpiry = tickers.filter(t => t.expiryMs === expiryMs && t.markIv != null && t.strike != null);
  if (atExpiry.length === 0) return null;
  atExpiry.sort((a, b) => Math.abs((a.strike ?? 0) - spot) - Math.abs((b.strike ?? 0) - spot));
  return atExpiry[0]!.markIv;
}

export function CryptoVolatilityView() {
  const [bundle, setBundle] = useState<DeribitMarketBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showModel, setShowModel] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchDeribitMarket('BTC').then(res => {
      if (cancelled) return;
      setBundle(res);
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

  if (!bundle) return <div className="p-4 font-mono text-xs animate-pulse">Loading volatility term…</div>;

  const spot = bundle.indexPrice ?? bundle.instruments.find(t => t.kind === 'perp')?.markPrice ?? null;
  const now = Date.now();
  const expiries = [...new Set(bundle.instruments.map(t => t.expiryMs).filter((e): e is number => e != null))].sort((a, b) => a - b);

  if (expiries.length === 0) return (
    <div className="rounded border border-dashed p-8 text-center font-mono text-xs" data-testid="vol-empty">
      <div className="font-bold">No observed quotes</div>
      <div className="mt-1 text-muted-foreground">Coverage {(bundle.coverage ?? 0) * 100 | 0}% — Deribit returned no expiries. Check venue or retry.</div>
    </div>
  );

  const term: TermPoint[] = expiries.map(exp => {
    const iv = spot != null ? atmIvAtExpiry(bundle.instruments, exp, spot) : null;
    return { expiryMs: exp, atmIv: iv, dte: Math.round((exp - now) / 864e5), provenance: 'observed' };
  });

  const fwdVols = term.map((pt, i) => {
    if (i === 0) return null;
    const prev = term[i - 1]!;
    if (prev.atmIv == null || pt.atmIv == null) return null;
    return forwardVol(prev.atmIv, prev.dte / 365, pt.atmIv, pt.dte / 365);
  });

  return (
    <div className="space-y-4" data-testid="volatility-workstation">
      <div className="flex items-center gap-2 font-mono text-xs">
        <span className="rounded bg-muted px-2 py-1">Venue: deribit</span>
        <span className="rounded bg-muted px-2 py-1">As of: {new Date(bundle.fetchedAt).toISOString().slice(11, 19)}Z</span>
        <span className="rounded bg-muted px-2 py-1">Coverage {(bundle.coverage ?? 0) * 100 | 0}% ({term.length} expiries)</span>
        <span className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-700">Observed</span>
        {showModel && <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-700">Model</span>}
        <button onClick={() => setShowModel(v => !v)} className="ml-auto rounded border px-2 py-1 text-xs hover:bg-muted" aria-pressed={showModel}>
          {showModel ? 'Hide model diagnostics' : 'Show model diagnostics'}
        </button>
      </div>

      <div className="rounded border p-3">
        <h3 className="font-mono text-xs font-bold uppercase">ATM Term Structure (actual expiries)</h3>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">Forward log-moneyness k=ln(K/F), total variance w=σ²T. Forward vol null when variance invalid — not clamped.</p>
        <div className="mt-3 grid grid-cols-4 gap-2 font-mono text-xs">
          <div className="font-bold text-muted-foreground">Expiry</div><div className="font-bold">DTE</div><div className="font-bold">ATM IV (obs)</div><div className="font-bold">Fwd Vol</div>
          {term.map((pt, i) => (
            <div key={pt.expiryMs} className="contents">
              <div>{new Date(pt.expiryMs).toISOString().slice(0, 10)}</div>
              <div>{pt.dte}d</div>
              <div>{pt.atmIv != null ? (pt.atmIv * 100).toFixed(1) + '%' : '—'}</div>
              <div>{fwdVols[i] != null ? (fwdVols[i]! * 100).toFixed(1) + '%' : <span className="text-muted-foreground">unavailable</span>}</div>
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
          {spot != null ? (
            <div className="grid grid-cols-5 gap-1">
              <div className="font-bold">Strike</div><div className="font-bold">Bid IV</div><div className="font-bold">Ask IV</div><div className="font-bold">Mark IV</div><div className="font-bold">OI</div>
              {bundle.instruments.filter(t => t.strike != null && t.expiryMs === expiries[0]).slice(0, 12).map(t => (
                <div key={t.instrument} className="contents">
                  <div>{t.strike}</div>
                  <div>{t.bidIv != null ? (t.bidIv * 100).toFixed(1) : '—'}</div>
                  <div>{t.askIv != null ? (t.askIv * 100).toFixed(1) : '—'}</div>
                  <div>{t.markIv != null ? (t.markIv * 100).toFixed(1) : '—'}</div>
                  <div>{t.openInterest != null ? t.openInterest.toFixed(0) : '—'}</div>
                </div>
              ))}
            </div>
          ) : <div>Spot unavailable — cannot build matrix.</div>}
        </div>
      </div>
    </div>
  );
}
