import { useEffect, useState } from 'react';
import { fetchDeribitMarket, type DeribitMarketBundle } from '../../../api/deribit';
import { toFundingSnapshot } from '../../../lib/math/carry/funding';
import { computeBasis } from '../../../lib/math/carry/basis';
import { yearFractionAct365 } from '../../../lib/math/units';

export function CryptoCarryView() {
  const [bundle, setBundle] = useState<DeribitMarketBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  if (!bundle) return <div className="p-4 font-mono text-xs animate-pulse">Loading carry…</div>;

  const perp = bundle.instruments.find(t => t.kind === 'perp');
  const spot = bundle.indexPrice ?? perp?.markPrice ?? null;
  const now = Date.now();

  // Native 8h funding from the perp quote; annualization via canonical math (×1095), labelled as run-rate.
  const funding = bundle.funding8h != null
    ? toFundingSnapshot('Deribit', `${bundle.currency}-PERPETUAL`, bundle.funding8h, perp?.timestamp ?? bundle.fetchedAt, {})
    : null;

  // Dated futures: nearest valid NON-EXPIRED future with an observed price.
  const datedFutures = bundle.instruments
    .filter(t => t.kind === 'future' && t.expiryMs != null && t.expiryMs > now && t.markPrice != null && t.markPrice > 0)
    .sort((a, b) => a.expiryMs! - b.expiryMs!);
  const nearest = datedFutures[0] ?? null;
  const basis = spot != null && nearest
    ? computeBasis(spot, nearest.markPrice!, nearest.expiryMs!, now, { instrument: nearest.instrument })
    : null;

  return (
    <div data-testid="carry-workstation" className="space-y-3">
      <div className="flex flex-wrap gap-2 font-mono text-xs">
        <span className="rounded bg-muted px-2 py-1">As of {new Date(bundle.fetchedAt).toISOString().slice(11, 19)}Z</span>
        {stale
          ? <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-400">Stale</span>
          : <span className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-700" title={`Deribit snapshot ${new Date(bundle.fetchedAt).toISOString()}`}>Observed</span>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border p-3">
          <div className="font-mono text-xs font-bold uppercase">Perpetual Funding (Deribit)</div>
          {funding ? (
            <div className="mt-2 font-mono text-xs">
              <div>Native 8h: {(funding.rawRate8h * 100).toFixed(4)}%</div>
              <div>Simple annualized run-rate: {(funding.simpleAnnualizedRunRate * 100).toFixed(2)}% <span className="text-muted-foreground">(rate8h × 1095 — run-rate, not yield)</span></div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">Direction: {funding.direction} · {new Date(funding.timestamp).toISOString().slice(11, 19)}Z</div>
            </div>
          ) : (
            <div className="mt-2 font-mono text-xs text-muted-foreground" data-testid="funding-unavailable">Unavailable — Deribit perp funding not reported.</div>
          )}
        </div>
        <div className="rounded border p-3">
          <div className="font-mono text-xs font-bold uppercase">Dated Basis</div>
          {basis ? (
            <div className="mt-2 font-mono text-xs">
              <div>Instrument: {basis.instrument} · DTE {basis.dte.toFixed(1)} (ACT/365F T={yearFractionAct365(now, nearest!.expiryMs!).toFixed(4)})</div>
              <div>Absolute: {basis.absolute.toFixed(1)} · %: {(basis.percentage * 100).toFixed(3)}%</div>
              <div>Simple ann: {(basis.simpleAnnualized * 100).toFixed(2)}% · Log ann: {(basis.logAnnualized * 100).toFixed(2)}% <span className="text-muted-foreground">(distinct)</span></div>
              <div className="mt-1 text-[10px] text-muted-foreground">Spot {basis.spot} · Future {basis.futurePrice}</div>
            </div>
          ) : (
            <div className="mt-2 font-mono text-xs text-muted-foreground" data-testid="basis-unavailable">
              {spot == null
                ? 'Unavailable — venue index/spot not reported.'
                : 'Unavailable — no valid non-expired future with observed price.'}
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
