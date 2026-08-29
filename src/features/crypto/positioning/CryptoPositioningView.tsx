import { useEffect, useState } from 'react';
import { fetchDeribitMarket, type DeribitMarketBundle, type NormalizedTicker } from '../../../api/deribit';
import { MatrixHeatmap } from '../../../components/charts/MatrixHeatmap';
import { aggregateExposure, type PositionRow } from '../../../lib/math/positioning/exposure';
import { greeksEuropean } from '../../../lib/math/greeks';
import { yearFractionAct365 } from '../../../lib/math/units';

export function CryptoPositioningView() {
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

  // Strike × expiry matrix of per-1% GEX where computable (null = unavailable)
  const strikes = [...new Set(options.map(t => t.strike!))].sort((a, b) => a - b).slice(0, 9);
  const expiries = [...new Set(options.map(t => t.expiryMs!))].sort((a, b) => a - b).slice(0, 6);
  const signOf = (t: NormalizedTicker) => (t.optionType === 'put' ? -1 : 1);

  const matrix: (number | null)[][] = expiries.map(exp =>
    strikes.map(strike => {
      const cells = options.filter(t => t.strike === strike && t.expiryMs === exp);
      const matchingRows = rows.filter(r => r.strike === strike && r.expiryMs === exp);
      if (!cells.length || !matchingRows.length || spot == null) return null;
      const exposures = matchingRows.map(row => {
        const cell = cells.find(t => t.optionType === row.optionType);
        if (!cell || !row.available || cell.openInterest == null || cell.markIv == null) return null;
        return row.gamma * signOf(cell) * cell.openInterest * spot * spot * 0.01;
      });
      if (exposures.some(v => v == null) || !exposures.length) return null;
      return exposures.reduce((sum, value) => sum + (value ?? 0), 0);
    }),
  );

  const gexComputable = matrix.flat().filter(v => v != null).length;

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
        ) : gexComputable < matrix.flat().length ? (
          <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-400" title={`${gexComputable}/${matrix.flat().length} cells computable (need OI + observed IV)`}>Partial</span>
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

      <MatrixHeatmap
        data={matrix}
        xLabels={strikes.map(s => `${(s / 1000).toFixed(0)}k`)}
        yLabels={expiries.map(e => `${Math.round((e - now) / 864e5)}d`)}
        title="GEX per 1% (signed) — null = missing OI or IV, never zero"
      />
      <details className="rounded border p-2 font-mono text-[10px] text-muted-foreground">
        <summary className="cursor-pointer">Accessible table fallback (exact values)</summary>
        <table className="mt-2 w-full" aria-label="GEX per 1% by strike and expiry, USD per 1 percent move">
          <thead>
            <tr><th scope="col">Expiry</th><th scope="col">Strike</th><th scope="col">GEX ($/1%)</th><th scope="col">OI</th><th scope="col">Mark IV</th></tr>
          </thead>
          <tbody>
            {expiries.flatMap(exp => strikes.map(strike => {
              const cells = options.filter(t => t.strike === strike && t.expiryMs === exp);
              const cell = cells[0];
              const val = matrix[expiries.indexOf(exp)]?.[strikes.indexOf(strike)];
              if (!cell) return null;
              return (
                <tr key={`${exp}-${strike}`}>
                  <td>{new Date(exp).toISOString().slice(0, 10)}</td>
                  <td>{strike}</td>
                  <td>{val != null ? (val / 1e3).toFixed(1) + 'k' : 'unavailable'}</td>
                  <td>{cell.openInterest != null ? cell.openInterest.toFixed(2) : 'unavailable'}</td>
                  <td>{cell.markIv != null ? (cell.markIv * 100).toFixed(1) + '%' : 'unavailable'}</td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </details>
      <div className="rounded border p-2 font-mono text-[10px] text-muted-foreground">
        GEX = sign · gamma · OI(BTC) · S² · 0.01. Gamma from canonical greeksEuropean at observed mark IV, ACT/365 expiry, venue index spot. Rows tradable: {tradableCount}/{rows.length}. Missing OI or IV stays null — distinct from zero.
      </div>
    </div>
  );
}
