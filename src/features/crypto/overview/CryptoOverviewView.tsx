import { useEffect, useState } from 'react';
import { fetchDeribitMarket, type DeribitMarketBundle } from '../../../api/deribit';
import { toFundingSnapshot } from '../../../lib/math/carry/funding';
import { fetchFreeCryptoMarket, type FreeCryptoMarket } from '../../../api/freeCrypto';

export function CryptoOverviewView() {
  const [bundle, setBundle] = useState<DeribitMarketBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [freeMarket, setFreeMarket] = useState<FreeCryptoMarket | null>(null);
  const [freeError, setFreeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDeribitMarket('BTC').then(r => {
      if (cancelled) return;
      setBundle(r);
      setStale(Date.now() - r.fetchedAt > 60_000);
    }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    fetchFreeCryptoMarket('BTC').then(r => { if (!cancelled) setFreeMarket(r); }).catch((e: Error) => { if (!cancelled) setFreeError(e.message); });
    return () => { cancelled = true; };
  }, []);

  if (!bundle) return (
    <div className="space-y-3" data-testid="overview-workstation">
      <div className="rounded border border-destructive bg-destructive/10 p-4 font-mono text-xs" role="alert">
        <div className="font-bold">Deribit unavailable</div>
        <div className="mt-1 text-muted-foreground">{error ?? 'Options, Greeks, option trades, and volatility are unavailable.'}</div>
      </div>
      {freeError ? <FreeUnavailable /> : freeMarket ? <FreeSnapshot market={freeMarket} /> : <div className="p-3 font-mono text-xs animate-pulse">Loading free snapshot…</div>}
    </div>
  );

  const perp = bundle.instruments.find(t => t.kind === 'perp');
  const spot = bundle.indexPrice ?? perp?.markPrice ?? null;
  const now = Date.now();
  // Annualization via canonical math — never inline ×1095 in views.
  const fundingAnn = bundle.funding8h != null
    ? toFundingSnapshot('Deribit', 'BTC-PERP', bundle.funding8h, bundle.fetchedAt, {}).simpleAnnualizedRunRate
    : null;
  const optionCount = bundle.instruments.filter(t => t.kind === 'option').length;
  const expiryCount = new Set(bundle.instruments.filter(t => t.kind === 'option' && t.expiryMs != null).map(t => t.expiryMs!)).size;
  const datedFutures = bundle.instruments.filter(t => t.kind === 'future' && t.expiryMs != null && t.expiryMs > now).length;
  const oiRows = bundle.instruments.filter(t => t.openInterest != null).length;

  return (
    <div className="space-y-3" data-testid="overview-workstation">
      <div className="flex flex-wrap gap-2 font-mono text-xs">
        <span className="rounded bg-muted px-2 py-1">{bundle.currency} · Deribit · {new Date(bundle.fetchedAt).toISOString().slice(11, 19)}Z</span>
        <span className="rounded bg-muted px-2 py-1">Index {spot != null ? spot.toFixed(1) : '—'}</span>
        <span className="rounded bg-muted px-2 py-1">Funding (ann. run-rate) {fundingAnn != null ? `${(fundingAnn * 100).toFixed(2)}%` : '—'}</span>
        {stale
          ? <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-400">Stale</span>
          : (bundle.coverage ?? 0) < 0.5
            ? <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-400" title={`Quotes joined for ${Math.round((bundle.coverage ?? 0) * 100)}% of active catalogue`}>Partial</span>
            : <span className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-400" title={`Deribit snapshot ${new Date(bundle.fetchedAt).toISOString()} — quotes joined for ${Math.round((bundle.coverage ?? 0) * 100)}% of active catalogue`}>Observed</span>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border p-3">
          <div className="font-mono text-xs font-bold uppercase">Regime Strip</div>
          <div className="mt-2 font-mono text-xs">
            <div>Index: {spot != null ? spot.toFixed(1) : '—'}</div>
            <div>Perp mark: {perp?.markPrice != null ? perp.markPrice.toFixed(1) : '—'}</div>
            <div>Perp bid/ask: {perp?.bidPrice != null ? perp.bidPrice.toFixed(1) : '—'} / {perp?.askPrice != null ? perp.askPrice.toFixed(1) : '—'}</div>
            <div>Funding 8h: {bundle.funding8h != null ? `${(bundle.funding8h * 100).toFixed(4)}%` : '—'}</div>
            <div>
              <a className="text-sky-500 hover:underline" href="?desk=crypto&view=volatility">Volatility →</a>{' '}
              <a className="text-sky-500 hover:underline" href="?desk=crypto&view=carry">Carry →</a>
            </div>
          </div>
        </div>
        <div className="rounded border p-3">
          <div className="font-mono text-xs font-bold uppercase">Coverage</div>
          <div className="mt-2 font-mono text-xs">
            <div>Catalogue quotes joined: {Math.round((bundle.coverage ?? 0) * 100)}%</div>
            <div>
              <a className="hover:underline" href="?desk=crypto&view=positioning">OI rows: {oiRows} →</a>
            </div>
            <div>
              <a className="hover:underline" href="?desk=crypto&view=volatility">Options: {optionCount} across {expiryCount} expiries →</a>
            </div>
            <div>
              <a className="hover:underline" href="?desk=crypto&view=carry">Dated futures active: {datedFutures} →</a>
            </div>
            <div>
              <a className="hover:underline" href="?desk=crypto&view=flow">Flow: live trades →</a>
            </div>
          </div>
        </div>
      </div>
      {freeError ? <FreeUnavailable /> : freeMarket && <FreeSnapshot market={freeMarket} />}
    </div>
  );
}

function FreeUnavailable() {
  return <div className="rounded border border-destructive bg-destructive/10 p-3 font-mono text-xs" role="alert" data-testid="free-market-unavailable">
    <strong>Free multi-venue snapshot unavailable</strong>
    <div className="mt-1 text-muted-foreground">Public exchange data; free alternative to Velo, not Velo-normalized.</div>
  </div>;
}

function FreeSnapshot({ market }: { market: FreeCryptoMarket }) {
  return <div className="rounded border border-sky-500/30 p-3" data-testid="free-market-snapshot">
    <div className="flex flex-wrap items-center gap-2 font-mono text-xs font-bold uppercase">
      <span>Free multi-venue snapshot</span><span className="rounded bg-sky-500/15 px-2 py-1 text-sky-300">Binance + Bybit</span>
    </div>
    <div className="mt-2 grid grid-cols-1 gap-2 font-mono text-xs md:grid-cols-2">
      {market.venues.map(v => <div key={v.venue} className="rounded bg-muted/50 p-2">
        <div className="font-bold">{v.venue}</div>
        <div>Mark: {v.mark != null ? v.mark.toFixed(1) : '—'} · Index: {v.index != null ? v.index.toFixed(1) : '—'} · Last: {v.last != null ? v.last.toFixed(1) : '—'}</div>
        <div>Funding 8h: {v.funding8h != null ? `${(v.funding8h * 100).toFixed(4)}%` : '—'} · OI: {v.openInterest != null ? v.openInterest.toLocaleString() : '—'}</div>
      </div>)}
    </div>
    <div className="mt-2 text-[10px] text-muted-foreground">Public exchange data; free alternative to Velo, not Velo-normalized.</div>
  </div>;
}
