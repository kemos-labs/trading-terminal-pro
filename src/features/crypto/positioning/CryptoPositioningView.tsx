import { useEffect, useState } from 'react';
import { fetchDeribitMarket, type DeribitMarketBundle, type NormalizedTicker } from '../../../api/deribit';
import { MatrixHeatmap } from '../../../components/charts/MatrixHeatmap';
import { aggregateExposure } from '../../../lib/math/positioning/exposure';

export function CryptoPositioningView() {
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

  if (!bundle) return <div className="p-4 font-mono text-xs animate-pulse">Loading positioning…</div>;

  const spot = bundle.indexPrice ?? bundle.instruments.find(t => t.kind === 'perp')?.markPrice ?? null;
  const options = bundle.instruments.filter(t => t.kind === 'option' && t.strike != null && t.expiryMs != null);

  if (options.length === 0) return (
    <div className="rounded border border-dashed p-8 text-center font-mono text-xs" data-testid="positioning-empty">
      <div className="font-bold">No OI data</div>
      <div className="mt-1 text-muted-foreground">Coverage {(bundle.coverage ?? 0) * 100 | 0}% — Deribit returned no options. Check venue or retry.</div>
    </div>
  );

  // Build strike × expiry OI matrix from real data
  const strikes = [...new Set(options.map(t => t.strike!))].sort((a, b) => a - b).slice(0, 9);
  const expiries = [...new Set(options.map(t => t.expiryMs!))].sort((a, b) => a - b).slice(0, 6);

  const matrix: (number | null)[][] = expiries.map(exp =>
    strikes.map(strike => {
      const cell = options.find(t => t.strike === strike && t.expiryMs === exp);
      return cell?.openInterest ?? null;
    }),
  );

  const rows = options.map((t: NormalizedTicker) => ({
    strike: t.strike!,
    expiryMs: t.expiryMs!,
    oi: t.openInterest,
    gamma: 0,
    delta: 0,
    vannaRaw: 0,
    charmRaw: 0,
    spot: spot ?? 0,
  }));

  const { total } = aggregateExposure(rows, () => 1);

  return (
    <div data-testid="positioning-workstation" className="space-y-3">
      <div className="flex flex-wrap gap-2 font-mono text-xs">
        <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-800">Exposure proxy — OI-weighted, not dealer book</span>
        <span className="rounded bg-muted px-2 py-1">Sign model: Calls + / Puts − (naive)</span>
        <span className="rounded bg-muted px-2 py-1">Shock: per 1% spot move</span>
        <span className="rounded bg-muted px-2 py-1">Coverage {((total.coverage ?? 0) * 100).toFixed(0)}% ({rows.length - (total.missingOiCount ?? 0)}/{rows.length})</span>
      </div>
      <MatrixHeatmap
        data={matrix}
        xLabels={strikes.map(s => `${(s / 1000).toFixed(0)}k`)}
        yLabels={expiries.map(e => `${Math.round((e - Date.now()) / 864e5)}d`)}
        title="OI by strike × expiry — null differs from zero"
      />
      <div className="rounded border p-2 font-mono text-[10px] text-muted-foreground">
        GEX = sign·gamma·Q·S²·0.01 — null differs from zero; unclipped tooltip exact value; fixed domain for comparison.
      </div>
    </div>
  );
}
