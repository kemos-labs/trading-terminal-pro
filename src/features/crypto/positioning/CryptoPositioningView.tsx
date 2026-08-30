import { useEffect, useMemo, useState } from 'react';
import { fetchDeribitMarket, type DeribitMarketBundle, type NormalizedTicker } from '../../../api/deribit';
import { HeatmapEngine, type HeatmapCellData, type HeatmapAxisKey } from '../../../components/charts/HeatmapEngine';
import { aggregateExposure, type PositionRow } from '../../../lib/math/positioning/exposure';
import { greeksEuropean } from '../../../lib/math/greeks';
import { yearFractionAct365 } from '../../../lib/math/units';

type CryptoMetric = 'gex' | 'dex' | 'vanna' | 'charm';

const METRIC_META: Record<CryptoMetric, { label: string; unit: string }> = {
  gex: { label: 'GEX', unit: '$/1%' },
  dex: { label: 'DEX', unit: '$' },
  vanna: { label: 'Vanna', unit: '$/vol pt' },
  charm: { label: 'Charm', unit: '$/day' },
};

export function CryptoPositioningView() {
  const [bundle, setBundle] = useState<DeribitMarketBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [metric, setMetric] = useState<CryptoMetric>('gex');

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

  if (!bundle) return <div className="p-4 font-mono text-xs animate-pulse">Loading positioning…</div>;

  const spot = bundle.indexPrice ?? bundle.instruments.find(t => t.kind === 'perp')?.markPrice ?? null;
  const options = bundle.instruments.filter(t => t.kind === 'option' && t.strike != null && t.expiryMs != null);

  if (options.length === 0) return (
    <div className="rounded border border-dashed p-8 text-center font-mono text-xs" data-testid="positioning-empty">
      <div className="font-bold">No OI data</div>
      <div className="mt-1 text-muted-foreground">Deribit returned no active options. Check venue or retry.</div>
    </div>
  );

  // Canonical Greeks from OBSERVED mark IV + ACT/365 expiry + venue index.
  // Rows missing OI or mark IV contribute null exposure — never zero, never volume fallback.
  const now = Date.now();
  const rows: PositionRow[] = options.map((t: NormalizedTicker) => {
    const T = t.expiryMs != null && t.expiryMs > now ? yearFractionAct365(now, t.expiryMs) : null;
    const tradable = t.openInterest != null && t.markIv != null && T != null && T > 0 && spot != null;
    if (!tradable) {
      return { optionType: t.optionType === 'put' ? 'put' : 'call', strike: t.strike!, expiryMs: t.expiryMs!, oi: t.openInterest, gamma: 0, delta: 0, vannaRaw: 0, charmRaw: 0, spot: spot ?? 0, available: false };
    }
    const g = greeksEuropean(t.optionType === 'put' ? 'put' : 'call', spot!, t.strike!, T, 0 as never, 0 as never, t.markIv as never);
    return { optionType: t.optionType === 'put' ? 'put' : 'call', strike: t.strike!, expiryMs: t.expiryMs!, oi: t.openInterest, gamma: g.gamma, delta: g.delta, vannaRaw: g.vanna, charmRaw: g.charm, spot: spot!, available: true };
  });

  const tradableCount = rows.filter(r => r.oi != null && r.gamma !== 0 || (r.oi != null && r.gamma === 0 && r.spot > 0)).length;
  const { total } = aggregateExposure(rows, (r) => (r.optionType === 'put' ? -1 : 1));

  // Strike × expiry exposure matrix — metric-switchable, spot-centered (never first-N).
  // Sign model: calls +1 / puts −1 applied to OI-weighted canonical greeks.
  const strikes = useMemo(() => {
    const all = [...new Set(options.map(t => t.strike!))].sort((a, b) => a - b);
    if (spot == null) return all.slice(0, 16);
    const windowed = all.filter((k) => Math.abs(k - spot) / spot <= 0.15);
    return (windowed.length >= 6 ? windowed : all).slice(0, 16);
  }, [options, spot]);
  const expiries = useMemo(
    () => [...new Set(options.map(t => t.expiryMs!))].sort((a, b) => a - b).slice(0, 6),
    [options],
  );
  const signOf = (t: NormalizedTicker) => (t.optionType === 'put' ? -1 : 1);

  const matrixCells: HeatmapCellData[][] = useMemo(() => expiries.map((exp) =>
    strikes.map((strike) => {
      const cells = options.filter(t => t.strike === strike && t.expiryMs === exp);
      const matchingRows = rows.filter(r => r.strike === strike && r.expiryMs === exp);
      if (!cells.length || !matchingRows.length || spot == null) {
        return { value: null, source: 'deribit (observed)', coverage: 'no rows' } as HeatmapCellData;
      }
      const exposures = matchingRows.map((row) => {
        const cell = cells.find(t => t.optionType === row.optionType);
        if (!cell || !row.available || cell.openInterest == null || cell.markIv == null) return null;
        const S = spot;
        const oi = cell.openInterest;
        switch (metric) {
          case 'gex': return row.gamma * signOf(cell) * oi * S * S * 0.01;
          case 'dex': return row.delta * signOf(cell) * oi * S;
          case 'vanna': return row.vannaRaw * signOf(cell) * oi * S;
          case 'charm': return row.charmRaw * signOf(cell) * oi * S;
        }
      });
      if (exposures.some(v => v == null) || !exposures.length) {
        return {
          value: null,
          source: 'deribit (observed)',
          coverage: 'missing OI or IV',
          sides: cells.map((c) => c.optionType).join('+'),
        } as HeatmapCellData;
      }
      const sum = exposures.reduce<number>((acc, v) => acc + (v ?? 0), 0);
      return {
        value: sum,
        sides: cells.map((c) => c.optionType).join('+'),
        coverage: `OI ${cells.reduce((s, c) => s + (c.openInterest ?? 0), 0).toFixed(2)} BTC`,
        source: 'deribit (observed) · OI-weighted',
        asOf: bundle?.fetchedAt ?? null,
        assumption: 'Sign model: calls +1 / puts −1 · OI proxy, not dealer inventory',
      } as HeatmapCellData;
    }),
  ), [expiries, strikes, options, rows, spot, metric, bundle]);

  const matrixRows: HeatmapAxisKey[] = expiries.map((e) => ({
    key: String(e), label: `${Math.round((e - now) / 864e5)}d`, num: Math.round((e - now) / 864e5),
  }));
  const matrixCols: HeatmapAxisKey[] = strikes.map((k) => ({
    key: String(k), label: k >= 1000 ? `${(k / 1000).toFixed(1)}k` : String(k), num: k,
  }));
  const spotCol = spot != null
    ? strikes.reduce((best, k) => (Math.abs(k - spot) < Math.abs(best - spot) ? k : best), strikes[0]!)
    : null;

  const computableCount = matrixCells.flat().filter((c) => c.value != null).length;
  const matrixTotal = matrixRows.length * matrixCols.length;
  const gexComputable = computableCount;
  void matrixTotal;

  return (
    <div data-testid="positioning-workstation" className="space-y-3">
      <div className="flex flex-wrap gap-2 font-mono text-xs">
        <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-400" title="OI-weighted exposure proxy from public Deribit data — not dealer inventory">
          Exposure proxy — not dealer book
        </span>
        <span className="rounded bg-muted px-2 py-1" title="Calls +1 / Puts −1 applied to OI-weighted greeks">Sign model: Calls + / Puts − (naive)</span>
        <span className="rounded bg-muted px-2 py-1" title="GEX units: sign · gamma · OI(BTC) · S² · 0.01 = USD per 1% spot move">GEX: USD per 1% move</span>
        <span className="rounded bg-muted px-2 py-1" title="Greeks from canonical Black-Scholes greeksEuropean at observed mark IV, ACT/365 expiry">
          Greeks: Black-Scholes @ observed mark IV
        </span>
        {stale ? (
          <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-400">Stale</span>
        ) : gexComputable < matrixTotal ? (
          <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-400" title={`${computableCount}/${matrixTotal} cells computable (need OI + observed IV)`}>Partial</span>
        ) : (
          <span className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-400" title={`Deribit snapshot ${new Date(bundle.fetchedAt).toISOString()}`}>Observed</span>
        )}
        <span className="rounded bg-muted px-2 py-1" data-testid="positioning-coverage" title="Coverage is calculated from rows with observed OI and all required observed inputs.">Coverage {((total.coverage ?? 0) * 100).toFixed(0)}% ({rows.length - (total.missingOiCount ?? 0)}/{rows.length} rows available)</span>
        <span className={`rounded px-2 py-1 ${total.coverageState === 'observed' || total.coverageState === 'observed-zero' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`} data-testid="positioning-coverage-state">OI {total.coverageState}</span>
      </div>

      {total.gex == null ? (
        <div className="rounded border border-dashed p-4 font-mono text-xs text-muted-foreground" data-testid="positioning-unavailable">
          GEX unavailable — no rows have both OI and observed mark IV. Display falls back to OI concentration below.
        </div>
      ) : (
        <div className="rounded border p-3 font-mono text-xs">
          <div className="font-bold uppercase">Aggregate exposure (canonical math)</div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            <div>GEX: <span className="tabular-nums">{(total.gex / 1e6).toFixed(2)}M</span> $/1%</div>
            <div>DEX: <span className="tabular-nums">{(total.dex != null ? total.dex / 1e6 : null)?.toFixed(2) ?? '—'}M</span> $</div>
            <div>Vanna: <span className="tabular-nums">{total.vanna != null ? (total.vanna / 1e3).toFixed(1) : '—'}k</span> $/vol pt</div>
            <div>Charm: <span className="tabular-nums">{total.charm != null ? (total.charm / 1e3).toFixed(1) : '—'}k</span> $/day</div>
          </div>
        </div>
      )}

      <div data-testid="crypto-exposure-matrix" className="rounded border p-2">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-1 font-mono text-type-2xs">
          <span className="font-bold uppercase">Exposure matrix — {METRIC_META[metric].label} ({METRIC_META[metric].unit})</span>
          <span className="flex items-center gap-1">
            {(['gex', 'dex', 'vanna', 'charm'] as CryptoMetric[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                aria-pressed={metric === m}
                className={`rounded border px-1.5 py-0.5 font-mono transition-colors ${metric === m ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                {METRIC_META[m].label}
              </button>
            ))}
            <span className="ml-2 text-muted-foreground">{computableCount}/{matrixTotal} computable</span>
          </span>
        </div>
        <div className="h-56">
          <HeatmapEngine
            rows={matrixRows}
            cols={matrixCols}
            cells={matrixCells}
            diverging
            units={METRIC_META[metric].unit === '$/1%' ? '$mm/1%' : METRIC_META[metric].unit === '$' ? '$mm' : 'k'}
            metricLabel={METRIC_META[metric].label}
            spotRef={spotCol != null && spot != null ? { colKey: String(spotCol), label: `SPOT ${spot.toLocaleString(undefined, { maximumFractionDigits: 0 })}` } : null}
            caption={`${METRIC_META[metric].label} by strike and expiry (signed)`}
            emptyMessage="No computable cells — missing OI or observed IV."
          />
        </div>
      </div>
      <div className="rounded border p-2 font-mono text-[10px] text-muted-foreground">
        GEX = sign · gamma · OI(BTC) · S² · 0.01. Gamma from canonical greeksEuropean at observed mark IV, ACT/365 expiry, venue index spot. Rows tradable: {tradableCount}/{rows.length}. Missing OI or IV stays null — distinct from zero.
      </div>
    </div>
  );
}
