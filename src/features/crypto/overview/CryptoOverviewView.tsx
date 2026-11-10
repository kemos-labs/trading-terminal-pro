import { useEffect, useState } from 'react';
import { fetchDeribitMarket, type DeribitMarketBundle } from '../../../api/deribit';
import { toFundingSnapshot } from '../../../lib/math/carry/funding';
import { fetchFreeCryptoMarket, type FreeCryptoMarket } from '../../../api/freeCrypto';
import { useCryptoAsset } from '../shell/CryptoShell';

export function CryptoOverviewView() {
  const { validatedAsset, isUnsupported, rawAsset, validatedVenue, isUnsupportedVenue, rawVenue } = useCryptoAsset();
  const [bundle, setBundle] = useState<DeribitMarketBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [freeMarket, setFreeMarket] = useState<FreeCryptoMarket | null>(null);
  const [freeError, setFreeError] = useState<string | null>(null);

  useEffect(() => {
    if (isUnsupportedVenue || !validatedVenue) return;
    if (isUnsupported || !validatedAsset) return;
    let cancelled = false;
    setBundle(null);
    setError(null);
    setStale(false);
    fetchDeribitMarket(validatedAsset).then(r => {
      if (cancelled) return;
      setBundle(r);
      setStale(Date.now() - r.fetchedAt > 60_000);
    }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [validatedAsset, isUnsupported, validatedVenue, isUnsupportedVenue]);

  useEffect(() => {
    if (isUnsupported || !validatedAsset) return;
    let cancelled = false;
    setFreeMarket(null);
    setFreeError(null);
    fetchFreeCryptoMarket(validatedAsset).then(r => { if (!cancelled) setFreeMarket(r); }).catch((e: Error) => { if (!cancelled) setFreeError(e.message); });
    return () => { cancelled = true; };
  }, [validatedAsset, isUnsupported]);

  if (isUnsupportedVenue) {
    return (
      <div className="flex min-h-[420px] flex-col gap-3" data-testid="overview-workstation">
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 font-mono text-xs" role="alert" data-testid="overview-venue-unsupported">
          <div className="font-bold">Venue unavailable</div>
          <div className="mt-1 text-muted-foreground">Unsupported venue &quot;{rawVenue}&quot; — supported: deribit. No data fetched.</div>
        </div>
        {freeError ? <FreeUnavailable /> : freeMarket ? <FreeSnapshot market={freeMarket} /> : <div className="p-3 font-mono text-xs animate-pulse">Loading free snapshot…</div>}
      </div>
    );
  }

  if (isUnsupported) {
    return (
      <div className="flex min-h-[420px] flex-col gap-3" data-testid="overview-workstation">
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 font-mono text-xs" role="alert" data-testid="overview-unsupported">
          <div className="font-bold">Asset unavailable</div>
          <div className="mt-1 text-muted-foreground">Unsupported asset &quot;{rawAsset}&quot; — supported: BTC, ETH. No data fetched.</div>
        </div>
        {freeError ? <FreeUnavailable /> : freeMarket ? <FreeSnapshot market={freeMarket} /> : null}
      </div>
    );
  }

  if (!bundle) return (
    <div className="flex min-h-[520px] flex-col gap-3 lg:min-h-[640px] xl:min-h-[660px]" data-testid="overview-workstation">
      {error ? <div className="rounded border border-destructive bg-destructive/10 p-4 font-mono text-xs" role="alert">
        <div className="font-bold">Deribit unavailable</div>
        <div className="mt-1 text-muted-foreground">{error}</div>
      </div> : <div className="rounded border border-muted bg-muted/20 p-4 font-mono text-xs" data-testid="deribit-loading">
        <div className="font-bold">Loading Deribit</div>
        <div className="mt-1 text-muted-foreground">Options, Greeks, option trades, and volatility are loading.</div>
      </div>}
      {freeError ? <FreeUnavailable /> : freeMarket ? <FreeSnapshot market={freeMarket} /> : <div className="p-3 font-mono text-xs animate-pulse">Loading free snapshot…</div>}
    </div>
  );

  const perp = bundle.instruments.find(t => t.kind === 'perp');
  const spot = bundle.indexPrice ?? perp?.markPrice ?? null;
  const now = Date.now();
  const options = bundle.instruments.filter(t => t.kind === 'option' && t.expiryMs != null && t.expiryMs > now);
  const perpBasis = spot != null && perp?.markPrice != null ? perp.markPrice - spot : null;
  const perpBasisBps = spot != null && perpBasis != null && spot > 0 ? (perpBasis / spot) * 10_000 : null;
  const callOptions = options.filter(t => t.optionType === 'call');
  const putOptions = options.filter(t => t.optionType === 'put');
  const totalOptionOi = options.reduce((sum, t) => sum + (t.openInterest ?? 0), 0);
  const callOi = callOptions.reduce((sum, t) => sum + (t.openInterest ?? 0), 0);
  const putOi = putOptions.reduce((sum, t) => sum + (t.openInterest ?? 0), 0);
  const quotedCount = options.filter(t => t.hasQuote).length;
  const expiryGroups = [...new Map(options.map(t => [t.expiryMs as number, true])).keys()]
    .sort((a, b) => a - b)
    .slice(0, 8)
    .map((expiryMs) => ({
      expiryMs,
      dte: Math.round((expiryMs - now) / 86_400_000),
      count: options.filter(t => t.expiryMs === expiryMs).length,
    }));
  const topOi = options
    .filter(t => t.openInterest != null && t.openInterest > 0)
    .sort((a, b) => (b.openInterest ?? 0) - (a.openInterest ?? 0))
    .slice(0, 8);
  const fundingAnn = bundle.funding8h != null
    ? toFundingSnapshot('Deribit', `${bundle.currency}-PERP`, bundle.funding8h, bundle.fetchedAt, {}).simpleAnnualizedRunRate
    : null;
  const optionCount = bundle.instruments.filter(t => t.kind === 'option').length;
  const expiryCount = new Set(bundle.instruments.filter(t => t.kind === 'option' && t.expiryMs != null).map(t => t.expiryMs!)).size;
  const datedFutures = bundle.instruments.filter(t => t.kind === 'future' && t.expiryMs != null && t.expiryMs > now).length;
  const oiRows = bundle.instruments.filter(t => t.openInterest != null).length;

  return (
    <div className="flex min-h-[520px] flex-col gap-3 lg:min-h-[640px] xl:min-h-[660px]" data-testid="overview-workstation">
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
      <div className="grid flex-1 auto-rows-fr grid-cols-1 gap-3 md:grid-cols-2 lg:content-stretch">
        <div className="flex flex-col rounded border p-3">
          <div className="font-mono text-xs font-bold uppercase">Regime Strip</div>
          <div className="mt-2 space-y-1 font-mono text-xs">
            <div>Index: {spot != null ? spot.toFixed(1) : '—'}</div>
            <div>Perp mark: {perp?.markPrice != null ? perp.markPrice.toFixed(1) : '—'}</div>
            <div>Perp bid/ask: {perp?.bidPrice != null ? perp.bidPrice.toFixed(1) : '—'} / {perp?.askPrice != null ? perp.askPrice.toFixed(1) : '—'}</div>
            <div>Perp basis: {perpBasis != null ? `${perpBasis >= 0 ? '+' : ''}${perpBasis.toFixed(1)}${perpBasisBps != null ? ` (${perpBasisBps >= 0 ? '+' : ''}${perpBasisBps.toFixed(1)}bps)` : ''}` : '—'}</div>
            <div>Funding 8h: {bundle.funding8h != null ? `${(bundle.funding8h * 100).toFixed(4)}%` : '—'}</div>
            <div>Perp OI: {perp?.openInterest != null ? perp.openInterest.toLocaleString() : '—'}</div>
            <div className="pt-1">
              <a className="text-sky-500 hover:underline" href="?desk=crypto&view=volatility">Volatility →</a>{' '}
              <a className="text-sky-500 hover:underline" href="?desk=crypto&view=carry">Carry →</a>
            </div>
          </div>
        </div>
        <div className="flex flex-col rounded border p-3">
          <div className="font-mono text-xs font-bold uppercase">Coverage</div>
          <div className="mt-2 space-y-1 font-mono text-xs">
            <div>Catalogue quotes joined: {Math.round((bundle.coverage ?? 0) * 100)}% ({quotedCount}/{options.length} quotes)</div>
            <div>Total option OI: {totalOptionOi > 0 ? `${totalOptionOi.toLocaleString()} (${callOi.toLocaleString()} C / ${putOi.toLocaleString()} P)` : '—'}</div>
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
        <div className="flex flex-col rounded border p-3" data-testid="overview-expiries">
          <div className="font-mono text-xs font-bold uppercase">Listed expiries</div>
          <div className="mt-2 font-mono text-xs">
            {expiryGroups.length > 0 ? expiryGroups.map((g) => (
              <div key={g.expiryMs} className="flex items-baseline justify-between gap-2">
                <a className="hover:underline" href="?desk=crypto&view=volatility">{new Date(g.expiryMs).toISOString().slice(0, 10)}</a>
                <span className="tabular-nums text-muted-foreground">{g.dte}d · {g.count} options</span>
              </div>
            )) : <span className="text-muted-foreground">No dated expiries listed — unavailable.</span>}
          </div>
        </div>
        <div className="flex flex-col rounded border p-3" data-testid="overview-top-oi">
          <div className="font-mono text-xs font-bold uppercase">Top open interest</div>
          <div className="mt-2 font-mono text-xs">
            {topOi.length > 0 ? topOi.map((t) => (
              <div key={t.instrument} className="flex items-baseline justify-between gap-2">
                <span className="truncate" title={t.instrument}>{t.instrument}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">OI {t.openInterest != null ? t.openInterest.toLocaleString() : '—'}</span>
              </div>
            )) : <span className="text-muted-foreground">No reported OI — unavailable, not zero.</span>}
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
  const venues = market.venues.map(v => v.venue);
  const badge = venues.length === 2 ? 'Binance + Bybit' : 'Partial';
  return <div className="rounded border border-sky-500/30 p-3" data-testid="free-market-snapshot">
    <div className="flex flex-wrap items-center gap-2 font-mono text-xs font-bold uppercase">
      <span>Free multi-venue snapshot</span><span className="rounded bg-sky-500/15 px-2 py-1 text-sky-300">{badge}</span>
      {venues.length === 1 && <span className="text-muted-foreground">{venues[0]}</span>}
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
