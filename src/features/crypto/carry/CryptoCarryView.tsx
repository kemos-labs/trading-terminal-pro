import { useEffect, useState } from 'react';
import { fetchDeribitMarket, type DeribitMarketBundle } from '../../../api/deribit';
import { toFundingSnapshot } from '../../../lib/math/carry/funding';
import { computeBasis } from '../../../lib/math/carry/basis';

export function CryptoCarryView() {
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

  if (!bundle) return <div className="p-4 font-mono text-xs animate-pulse">Loading carry…</div>;

  const perp = bundle.instruments.find(t => t.kind === 'perp');
  const spot = bundle.indexPrice ?? perp?.markPrice ?? null;
  const now = Date.now();

  const funding = bundle.fundingAnnualized != null
    ? toFundingSnapshot('Deribit', 'BTC-PERP', bundle.fundingAnnualized / (3 * 365), now, {})
    : null;

  // Dated basis: find nearest futures expiry
  const datedFutures = [...new Set(bundle.instruments.filter(t => t.expiryMs != null).map(t => t.expiryMs!))].sort();
  const nearestExpiry = datedFutures[0] ?? null;
  const futureTicker = nearestExpiry ? bundle.instruments.find(t => t.expiryMs === nearestExpiry) : null;
  const futurePrice = futureTicker?.markPrice ?? null;
  const basis = (spot != null && futurePrice != null && nearestExpiry != null)
    ? computeBasis(spot, futurePrice, nearestExpiry, now, { instrument: `BTC-${new Date(nearestExpiry).toISOString().slice(0, 10)}` })
    : null;

  return (
    <div data-testid="carry-workstation" className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border p-3">
          <div className="font-mono text-xs font-bold uppercase">Perpetual Funding (Deribit)</div>
          {funding ? (
            <div className="mt-2 font-mono text-xs">
              <div>Annualized (simple): {(funding.simpleAnnualizedRunRate * 100).toFixed(2)}% <span className="text-muted-foreground">(simpleAnnualizedRunRate, not yield)</span></div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">Direction: {funding.direction} · {new Date(funding.timestamp).toISOString().slice(11, 19)}Z</div>
            </div>
          ) : (
            <div className="mt-2 font-mono text-xs text-muted-foreground">Unavailable — Deribit perp funding not reported.</div>
          )}
        </div>
        <div className="rounded border p-3">
          <div className="font-mono text-xs font-bold uppercase">Dated Basis</div>
          {basis ? (
            <div className="mt-2 font-mono text-xs">
              <div>Absolute: {basis.absolute.toFixed(1)} · %: {(basis.percentage * 100).toFixed(3)}%</div>
              <div>Simple ann: {(basis.simpleAnnualized * 100).toFixed(2)}% · Log ann: {(basis.logAnnualized * 100).toFixed(2)}% <span className="text-muted-foreground">(distinct)</span></div>
              <div className="mt-1 text-[10px] text-muted-foreground">DTE {basis.dte.toFixed(0)} · Spot {basis.spot} · Future {basis.futurePrice}</div>
            </div>
          ) : (
            <div className="mt-2 font-mono text-xs text-muted-foreground">
              {spot == null ? 'Unavailable — spot/future prices not reported.' : `Nearest future: ${nearestExpiry ? new Date(nearestExpiry).toISOString().slice(0, 10) : 'none'}`}
            </div>
          )}
        </div>
      </div>
      <div className="rounded border p-2 font-mono text-[10px] text-muted-foreground">
        Perpetual funding stays separate from dated maturity; no unlabeled APR; no synthetic missing expiry.
      </div>
    </div>
  );
}
