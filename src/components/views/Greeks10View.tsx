/**
 * Vol · Greeks — same underlier as the global header (no local multi-ticker mini-app).
 * Surfaces / GEX from shared greeksCache (prefetched after terminal chain).
 * FlashAlpha GEX levels live on Flow · Tools (single-name free tier, not SPY).
 */
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
  ComposedChart, Line,
} from 'recharts';
import { dealerExposure } from '../../lib/options/analytics';
import type { VolSnapshot } from '../../lib/options/types';
import { fmtCompact, fmtPrice } from '../../lib/format';
import type { GreeksData, HistoryData } from '../../lib/macrovol/api';
import { getSurfaceProvenance } from '../../lib/macrovol/api';
import {
  loadGreeksPack,
  peekGreeksCache,
  peekGreeksCacheStale,
} from '../../lib/macrovol/greeksCache';
import {
  CHART,
  CHART_GREEK_EXT,
  CHART_HEX,
  PLOTLY_CS_GEX,
  PLOTLY_CS_CHARM,
  chartAxisTick,
  chartGridProps,
  chartTooltipStyle,
} from '../../lib/chartTheme';
import { DataBadge } from '../macrovol/DataBadge';
import { Explain } from '../common/Explain';
import { useTerminalStore } from '../../store/terminalStore';
import type { GreekKey } from './greeksTypes';
import { cn } from '../../lib/utils';
import { ChartZoom, useChartZoom } from '../common/ChartZoom';

// 3D Greeks restored as an explicit-entry lazy chunk (derived nodes, true
// holes, ATM ridge, exact units); 2D profiles + exact tables remain the default.

const GREEKS: { key: GreekKey; label: string; desc: string; formula: string; color: string; unit: string; diverging: boolean }[] = [
  { key: 'delta', label: 'DELTA', desc: 'Rate of price change per $1 move in spot', formula: '∂V/∂S = Φ(d₁)', color: CHART_GREEK_EXT.delta, unit: 'Δ', diverging: true },
  { key: 'gamma', label: 'GAMMA', desc: 'Rate of delta change. Peaks ATM', formula: '∂²V/∂S² = φ(d₁)/(S·σ·√T)', color: CHART_GREEK_EXT.gamma, unit: 'per $', diverging: false },
  { key: 'vega', label: 'VEGA', desc: 'P&L per 1% IV move. Always positive', formula: 'raw S·φ(d₁)·√T → desk ÷100 / vol pt', color: CHART_GREEK_EXT.vega, unit: 'per vol pt', diverging: false },
  { key: 'theta', label: 'THETA', desc: 'θ ≠ free income — pays for Γ/volga/vanna risk', formula: 'raw ∂V/∂T → desk ÷365 / day', color: CHART_GREEK_EXT.theta, unit: 'per day', diverging: true },
  { key: 'vanna', label: 'VANNA', desc: 'dVega/dSpot. How vega changes with spot', formula: '∂²V/∂S∂σ = −φ(d₁)·d₂/σ (raw σ)', color: CHART_GREEK_EXT.vanna, unit: 'raw', diverging: true },
  { key: 'charm', label: 'CHARM', desc: 'dDelta/dTime. Delta decay per day', formula: '∂²V/∂S∂t annual → desk ÷365 / day', color: CHART_GREEK_EXT.charm, unit: 'per day', diverging: true },
];

/** Restored lazy 3D Greek surface — WebGL engine loads only after explicit entry. */
const GreeksSurface3D = lazy(() => import('../charts/GreeksSurface3D'));

export function Greeks10View() {
  const storeSymbol = useTerminalStore((s) => s.symbol);
  const snapshot = useTerminalStore((s) => s.snapshot);
  const setDeskSection = useTerminalStore((s) => s.setDeskSection);
  const setDeskContext = useTerminalStore((s) => s.setDeskContext);

  // One symbol only — global header underlier. No desk-local multi-ticker chips.
  const ticker = /^[A-Z.^]{1,12}$/i.test(storeSymbol || '') ? storeSymbol : 'SPY';

  const [selectedGreek, setSelectedGreek] = useState('delta');
  const [data, setData] = useState<GreeksData | null>(() => peekGreeksCacheStale(ticker)?.data ?? null);
  const [ohlc, setOhlc] = useState<HistoryData['data']>(() => peekGreeksCacheStale(ticker)?.ohlc ?? []);
  const [loading, setLoading] = useState(() => !peekGreeksCache(ticker));
  const [error, setError] = useState('');

  // Single Greeks home = Vol · Greeks (not Trade).
  useEffect(() => {
    const tab = useTerminalStore.getState().activeTab;
    if (tab === 'desk') {
      useTerminalStore.getState().setActiveTab('vol');
    }
    setDeskSection('vol-sub-greeks');
    setDeskContext({
      id: 'vol-sub-greeks',
      label: 'Greeks',
      apis: ['yfinance', 'FRED'],
    });

    return () => {
      const cur = useTerminalStore.getState().deskSectionId;
      if (cur === 'vol-sub-greeks' || cur === 'desk-ws-analyze' || cur === 'greeks-desk') {
        setDeskContext({ id: null, label: null, apis: [] });
      }
    };
  }, [setDeskSection, setDeskContext]);

  // Shared cache + prefetch: never blank the board if we already have this underlier.
  useEffect(() => {
    let cancelled = false;
    const fresh = peekGreeksCache(ticker);
    if (fresh) {
      setData(fresh.data);
      setOhlc(fresh.ohlc);
      setLoading(false);
      setError('');
      return;
    }
    const stale = peekGreeksCacheStale(ticker);
    if (stale) {
      setData(stale.data);
      setOhlc(stale.ohlc);
      setLoading(true); // soft revalidate
    } else {
      setData(null);
      setOhlc([]);
      setLoading(true);
    }
    setError('');
    const snap = useTerminalStore.getState().snapshot;
    const q =
      snap && snap.symbol === ticker && Number.isFinite(snap.dividendYield)
        ? snap.dividendYield
        : null;
    void loadGreeksPack(ticker, q)
      .then((pack) => {
        if (cancelled) return;
        setData(pack.data);
        setOhlc(pack.ohlc);
        setError('');
      })
      .catch((e) => {
        if (cancelled) return;
        if (!stale) {
          setError(e instanceof Error ? e.message : 'Failed to fetch');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const greek = GREEKS.find((g) => g.key === selectedGreek)!;
  const [show3d, setShow3d] = useState(false);
  const surfaceData = data?.surfaces?.[selectedGreek];
  // Derived-layer nodes built directly from derived per-contract points
  // (no interpolation): each contract contributes one node at (K, T).
  const derivedNodes = useMemo(() => {
    if (!data?.points) return [];
    const out: { strike: number; dte: number; value: number; price_source?: string }[] = [];
    for (const p of data.points) {
      const v = (p as unknown as Record<string, unknown>)[selectedGreek];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (!Number.isFinite(p.K) || !Number.isFinite(p.T)) continue;
      out.push({
        strike: p.K,
        dte: Math.max(0, Math.round(p.T * 365)),
        value: v,
        price_source: (p as unknown as Record<string, unknown>).price_source as string | undefined,
      });
    }
    return out;
  }, [data?.points, selectedGreek]);

  const gexData = data?.gex?.filter((g) => Math.abs(g.gex) > 0) || [];
  const gexTotal = data?.gex_flip?.net_gex ?? gexData.reduce((s, g) => s + g.gex, 0);
  const flipStrike = data?.gex_flip?.strike ?? null;
  const flipSide = data?.gex_flip?.spot_vs_flip ?? null;

  const gexChartData = gexData
    .filter((g) => data && g.strike >= data.spot * 0.93 && g.strike <= data.spot * 1.07)
    .map((g) => ({
      strike: g.strike,
      gex: parseFloat((g.gex / 1e6).toFixed(2)),
      isAtm: Math.abs(g.strike - (data?.spot || 0)) < 3,
    }))
    .sort((a, b) => a.strike - b.strike);

  void (selectedGreek as GreekKey);

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="vol-greeks10-view">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-1">
        <span className="text-type-xs font-mono font-semibold text-foreground">{ticker}</span>
        <span className="text-type-2xs font-mono text-muted-foreground">
          Greeks · yfinance · FRED
          {data?.r != null && (
            <>
              {' '}
              · r={(data.r * 100).toFixed(2)}%
              {data.r_source ? ` (${data.r_source})` : ''}
              {data.q != null && (
                <>
                  {' '}
                  · q={(data.q * 100).toFixed(2)}%
                  {data.q_source ? ` (${data.q_source})` : ''}
                </>
              )}
            </>
          )}
          {loading && !data && ' · loading…'}
          {loading && data && ' · refresh…'}
        </span>
        <span className="ml-auto hidden text-type-2xs text-muted-foreground sm:inline">
          <Explain term="taylorGvv">Taylor / GVV</Explain>
          {' · symbol = header only'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-3 p-2 font-mono">
            {/* OI-weighted charm / vanna from the same terminal chain (no second symbol). */}
            {snapshot && snapshot.symbol === ticker && (
              <CharmVannaStrikeProfiles snapshot={snapshot} />
            )}

            {data?.surface_note && (
              <p className="text-type-2xs leading-snug text-muted-foreground">{data.surface_note}</p>
            )}
            {data?.charm_note && (
              <p className="text-type-2xs leading-snug text-muted-foreground">{data.charm_note}</p>
            )}

            {error && !data && (
              <div className="rounded border border-down/40 bg-down/15 px-3 py-2 text-xs text-down">
                {error} — Check FRED SOFR + yfinance. Change underlier in the header (not here).
              </div>
            )}

            {loading && !data && (
              <div className="rounded border border-border/60 bg-card/40 px-3 py-4 text-type-xs text-muted-foreground">
                Loading Greeks surfaces for {ticker}… (prefetched after chain when possible)
              </div>
            )}

            {data && (
              <>
                {/* ATM snapshot — chips only; formulas live in Explain on greek labels */}
                <div>
                  <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <h3 className="text-type-2xs font-semibold tracking-wide text-foreground">ATM</h3>
                    <span className="text-type-2xs text-muted-foreground">
                      {ticker} · ${data.spot?.toFixed(2)} · {data.total_points} pts
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
                    {GREEKS.map((g) => (
                      <button
                        key={g.key}
                        type="button"
                        onClick={() => setSelectedGreek(g.key)}
                        title={`${g.desc} · ${g.formula}`}
                        className={`rounded border px-1.5 py-1 text-left transition-all ${
                          selectedGreek === g.key
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-card hover:border-border/80'
                        }`}
                      >
                        <div className="text-[10px] font-mono" style={{ color: g.color }}>{g.label}</div>
                        <div className="font-mono text-sm font-bold tabular-nums text-foreground">
                          {data.atm?.[g.key as keyof typeof data.atm] != null
                            ? Number(data.atm[g.key as keyof typeof data.atm]).toFixed(4)
                            : '—'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Greek field — 2D accessible profiles + exact table + lazy 3D on explicit entry. */}
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <h3 className="text-xs font-semibold" style={{ color: greek.color }}>{greek.label} SURFACE</h3>
                    <span className="text-type-xs text-muted-foreground">{greek.desc} · 2D profiles + table</span>
                    <button
                      type="button"
                      data-testid="open-3d-greeks"
                      aria-expanded={show3d}
                      disabled={!surfaceData || surfaceData.T_vals.length === 0}
                      onClick={() => setShow3d((open) => !open)}
                      className="rounded border border-border px-2 py-0.5 font-mono text-type-2xs text-foreground hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-40 focus-ring-term"
                    >
                      {show3d ? 'Close 3D' : 'Open 3D'}
                    </button>
                  </div>
                  <p className="mb-1 text-type-2xs text-muted-foreground">
                    Surface · yfinance OTM field (same API as ATM cards)
                    {data?.r != null && (
                      <span className="ml-2 tabular-nums">
                        r={(data.r * 100).toFixed(2)}%
                        {data.r_source ? ` (${data.r_source})` : ''}
                        {data.q != null ? ` · q=${(data.q * 100).toFixed(2)}%` : ''}
                      </span>
                    )}
                    <span
                      className="ml-2 rounded bg-border/40 px-1.5 py-0.5 text-muted-foreground"
                      data-testid="greeks-grid-provenance-badge"
                      title={getSurfaceProvenance(surfaceData)?.derived_source ?? 'legacy payload without structural provenance'}
                    >
                      {(() => {
                        const prov = getSurfaceProvenance(surfaceData);
                        if (prov) return `${prov.kind} · ${prov.method} · exact table below`;
                        return 'legacy grid · exact table below (provenance unavailable)';
                      })()}
                    </span>
                  </p>
                  <div className="overflow-hidden rounded-xl border border-border bg-card">
                    {surfaceData && surfaceData.T_vals?.length > 0 ? (
                      <div className="p-2">
                        <div className="mb-2 grid grid-cols-2 gap-2 text-type-2xs">
                          <div className="rounded border border-border/60 bg-card/40 p-2">
                            <div className="font-semibold text-foreground">Strike profile (nearest expiry)</div>
                            <div className="text-muted-foreground">T≈{Math.round(surfaceData.T_vals[0]!*365)}d · {surfaceData.K_vals.length} strikes</div>
                            <div className="mt-1 max-h-[180px] overflow-auto">
                              <table className="w-full font-mono text-type-2xs">
                                <caption className="sr-only">{greek.label} by strike — accessible table fallback for Canvas</caption>
                                <thead><tr><th className="text-left">Strike</th><th className="text-right">{greek.label}</th></tr></thead>
                                <tbody>
                                  {surfaceData.K_vals.slice(0, 20).map((k, i) => {
                                    const v = surfaceData.grid?.[0]?.[i];
                                    return <tr key={k} className="border-t border-border/40"><td className="py-0.5 tabular-nums">{k.toFixed(0)}</td><td className="py-0.5 text-right tabular-nums">{v != null && isFinite(v) ? v.toFixed(4) : '—'}</td></tr>;
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                          <div className="rounded border border-border/60 bg-card/40 p-2">
                            <div className="font-semibold text-foreground">Term profile (ATM ~ spot)</div>
                            <div className="text-muted-foreground">{surfaceData.T_vals.length} expiries · ATM column</div>
                            <div className="mt-1 max-h-[180px] overflow-auto">
                              <table className="w-full font-mono text-type-2xs">
                                <caption className="sr-only">{greek.label} term structure — accessible table</caption>
                                <thead><tr><th className="text-left">DTE</th><th className="text-right">{greek.label}</th></tr></thead>
                                <tbody>
                                  {surfaceData.T_vals.slice(0, 12).map((t, ti) => {
                                    // ATM is strike nearest spot, not middle column
                                    let atmIdx = 0;
                                    let bestDist = Infinity;
                                    for (let j=0;j<surfaceData.K_vals.length;j++) {
                                      const d = Math.abs((surfaceData.K_vals[j] as number) - (data.spot ?? 0));
                                      if (d < bestDist) { bestDist = d; atmIdx = j; }
                                    }
                                    const v = surfaceData.grid?.[ti]?.[atmIdx];
                                    return <tr key={t} className="border-t border-border/40"><td className="py-0.5 tabular-nums">{Math.round(t*365)}d</td><td className="py-0.5 text-right tabular-nums">{v != null && isFinite(v) ? v.toFixed(4) : '—'}</td></tr>;
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                        <p className="text-type-2xs text-muted-foreground">
                          Interpolated MODEL grid (linear interior + nearest hole-fill) of BSM-derived Greeks — not provider quotes. Derived-layer nodes ({derivedNodes.length}) are per-contract derived values built without interpolation and render separately in 3D; unavailable cells stay null.{' '}
                          {data?.units?.[selectedGreek as keyof typeof data.units]
                            ? `Units: ${data.units[selectedGreek as keyof typeof data.units]}.` : ''}
                          {data?.surface_provenance?.model_method ? ` Method: ${data.surface_provenance.model_method}.` : ''}
                        </p>
                        {show3d && surfaceData && surfaceData.T_vals.length > 0 && (
                          <div className="mt-2 h-[380px] overflow-hidden rounded-xl border border-border bg-card">
                            <Suspense fallback={<div className="flex h-full items-center justify-center font-mono text-type-2xs text-muted-foreground">3D engine loads on open…</div>}>
                              <GreeksSurface3D
                                grid={surfaceData}
                                derivedNodes={derivedNodes}
                                spot={data?.spot ?? surfaceData.K_vals[Math.floor(surfaceData.K_vals.length / 2)] ?? 0}
                                greek={greek.key}
                                label={greek.label}
                                unit={String(data?.units?.[greek.key as keyof typeof data.units] ?? greek.unit)}
                                diverging={Boolean(greek.diverging)}
                              />
                            </Suspense>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-4 text-center text-type-2xs text-muted-foreground">
                        No yfinance surface grid for {greek.label} yet.
                      </div>
                    )}
                  </div>
                </div>

                {/* Price history + GEX/Charm heatmaps */}
                <HeatMaps
                  gexGrid={data.gex_grid}
                  charmGrid={data.charm_grid}
                  spot={data.spot}
                  ticker={ticker}
                  ohlc={ohlc}
                />

                {/* Dense GEX book: bars ‖ OI ladder ‖ strike×expiry (VS3D / MenthorQ density) */}
                {(gexChartData.length > 0 || data.points) && (
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                      {gexChartData.length > 0 && (
                        <GexBarsPanel
                          gexChartData={gexChartData}
                          gexTotal={gexTotal}
                          flipStrike={flipStrike}
                          flipSide={flipSide}
                          spot={data.spot}
                          ticker={ticker}
                        />
                      )}
                      {data.points && <OiByStrike data={data} ticker={ticker} />}
                    </div>
                    {data.points && <GexCalendar data={data} ticker={ticker} />}
                  </div>
                )}

                <DataBadge
                  asOf={data.as_of}
                  source={[
                    data.source || 'yfinance',
                    'FRED',
                    data.r != null ? `r=${(data.r * 100).toFixed(2)}%` : null,
                    data.r_source ? `(${data.r_source})` : null,
                    data.q != null ? `q=${(data.q * 100).toFixed(2)}%` : null,
                    data.units?.theta ? `θ ${data.units.theta}` : 'θ/charm /day',
                    data.units?.vega ? `ν ${data.units.vega}` : 'ν /1vol',
                    data.units?.surface_side || 'OTM surface',
                  ].filter(Boolean).join(' · ')}
                  staleThresholdMin={60}
                />
              </>
            )}
          </div>
      </div>
    </div>
  );
}

function HeatmapPlot({
  grid,
  label,
  spot,
}: {
  grid: NonNullable<GreeksData['gex_grid']>;
  colorscale: [number, string][];
  label: string;
  spot: number;
}) {
  const dtes = grid.T_vals.slice(0, 6).map((t) => Math.round(t * 365));
  const strikes = grid.K_vals.slice(0, 8);
  return (
    <div className="rounded border border-border bg-card p-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono text-type-xs font-semibold">{label} heatmap</span><span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-type-2xs text-amber-400">2D Fallback</span><span className="text-type-2xs text-muted-foreground">spot {spot.toFixed(0)} dashed</span>
      </div>
      <div className="overflow-auto">
        <table className="w-full font-mono text-type-2xs">
          <caption className="sr-only">{label} by DTE and strike — accessible table fallback</caption>
          <thead><tr><th className="px-1 py-1 text-left">K \ DTE</th>{dtes.map((d) => <th key={d} className="px-1 py-1 text-right tabular-nums">{d}d</th>)}</tr></thead>
          <tbody>{strikes.map((k, ki) => <tr key={k} className="border-t border-border/40"><td className="px-1 py-0.5 tabular-nums">{k.toFixed(0)}</td>{dtes.map((_, di) => { const v = grid.grid?.[di]?.[ki]; return <td key={di} className="px-1 py-0.5 text-right tabular-nums">{v != null && isFinite(v) ? v.toFixed(2) : '—'}</td>; })}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function HeatMaps({
  gexGrid, charmGrid, spot, ticker, ohlc,
}: {
  gexGrid?: GreeksData['gex_grid'];
  charmGrid?: GreeksData['charm_grid'];
  spot: number;
  ticker: string;
  ohlc: HistoryData['data'];
}) {
  const hasGex = !!(gexGrid?.T_vals?.length && gexGrid?.K_vals?.length);
  const hasCharm = !!(charmGrid?.T_vals?.length && charmGrid?.K_vals?.length);

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
        {ohlc.length > 0 && (
          <div className="overflow-hidden rounded border border-border bg-card lg:col-span-1">
            <div className="p-2">
              <div className="mb-1 font-mono text-type-2xs font-semibold">{ticker} price — close line (candlestick Plotly removed)</div>
              <div className="h-[140px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={ohlc.slice(-60).map((d) => ({ date: d.date.slice(5), close: d.close }))} margin={{ top: 2, right: 6, left: 0, bottom: 2 }}>
                    <CartesianGrid {...chartGridProps} vertical={false} />
                    <XAxis dataKey="date" tick={{ ...chartAxisTick, fontSize: 8 }} interval="preserveStartEnd" />
                    <YAxis tick={{ ...chartAxisTick, fontSize: 8 }} width={36} domain={['auto','auto']} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Line type="monotone" dataKey="close" stroke={CHART.series.brand} strokeWidth={1.5} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-1 max-h-[100px] overflow-auto">
                <table className="w-full font-mono text-type-2xs"><caption className="sr-only">{ticker} OHLC — accessible table fallback</caption><thead><tr><th className="text-left">Date</th><th className="text-right">Close</th></tr></thead><tbody>{ohlc.slice(-10).map((d) => <tr key={d.date} className="border-t border-border/40"><td>{d.date}</td><td className="text-right tabular-nums">{d.close.toFixed(2)}</td></tr>)}</tbody></table>
              </div>
            </div>
          </div>
        )}
        <div className={cn('grid grid-cols-1 gap-2 md:grid-cols-2', ohlc.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3')}>
          {hasGex && gexGrid && (
            <div className="overflow-hidden rounded border border-border bg-card">
              <ChartZoom title={`${ticker} GEX heatmap`} bodyClassName="min-h-0" expandedHeightClass="h-[min(90vh,960px)]">
                <HeatmapPlot grid={gexGrid} colorscale={PLOTLY_CS_GEX} label="GEX" spot={spot} />
              </ChartZoom>
            </div>
          )}
          {hasCharm && charmGrid && (
            <div className="overflow-hidden rounded border border-border bg-card">
              <ChartZoom title={`${ticker} CHARM heatmap`} bodyClassName="min-h-0" expandedHeightClass="h-[min(90vh,960px)]">
                <HeatmapPlot grid={charmGrid} colorscale={PLOTLY_CS_CHARM} label="CHARM" spot={spot} />
              </ChartZoom>
            </div>
          )}
        </div>
      </div>
      {!hasGex && (
        <div className="rounded border border-border bg-card py-3 text-center text-type-2xs text-muted-foreground">
          No GEX heatmap — need ≥10 γ×OI points
        </div>
      )}
    </div>
  );
}

function GexBarsPanel({
  gexChartData,
  gexTotal,
  flipStrike,
  flipSide,
  spot,
  ticker,
}: {
  gexChartData: { strike: number; gex: number; isAtm: boolean }[];
  gexTotal: number;
  flipStrike: number | null;
  flipSide: string | null;
  spot: number;
  ticker: string;
}) {
  return (
    <div className="rounded border border-border bg-card/50">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-border/60 px-2 py-1">
        <Explain term="gex">
          <span className="text-type-2xs font-semibold tracking-wide text-foreground">GEX</span>
        </Explain>
        <span className={cn('font-mono text-type-xs tabular-nums font-bold', gexTotal > 0 ? 'text-up' : 'text-down')}>
          ${(gexTotal / 1e6).toFixed(1)}M
        </span>
        <span className="text-type-2xs text-muted-foreground">net</span>
        <span className="text-type-2xs text-muted-foreground">· flip</span>
        <span className="font-mono text-type-xs tabular-nums text-foreground">
          {flipStrike != null ? flipStrike.toFixed(0) : '—'}
        </span>
        <span className={cn(
          'font-mono text-type-2xs uppercase',
          flipSide === 'above' ? 'text-up' : flipSide === 'below' ? 'text-down' : 'text-muted-foreground',
        )}>
          {flipSide ? `spot ${flipSide}` : ''}
        </span>
        <span className="ml-auto text-type-2xs text-muted-foreground/70">OI-inferred · ±7%</span>
      </div>
      <div className="px-1 pb-1 pt-0.5">
        <ChartZoom title={`${ticker} GEX by strike`} bodyClassName="min-h-0" expandedHeightClass="h-[min(88vh,900px)]">
          <GexBarsChart data={gexChartData} spot={spot} />
        </ChartZoom>
      </div>
    </div>
  );
}

function GexBarsChart({
  data,
  spot,
}: {
  data: { strike: number; gex: number; isAtm: boolean }[];
  spot: number;
}) {
  const { zoomed } = useChartZoom();
  const h = zoomed ? '100%' : 148;
  return (
    <div className={cn('w-full', zoomed ? 'h-full min-h-0' : '')} style={zoomed ? { height: '100%' } : { height: 148 }}>
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={data} margin={{ top: 2, right: 6, left: 0, bottom: 2 }}>
          <CartesianGrid {...chartGridProps} vertical={false} />
          <XAxis
            dataKey="strike"
            tick={{ ...chartAxisTick, fontSize: 8 }}
            interval="preserveStartEnd"
            tickFormatter={(v) => String(Math.round(Number(v)))}
            height={18}
          />
          <YAxis
            tick={{ ...chartAxisTick, fontSize: 8 }}
            width={36}
            tickFormatter={(v) => `${v}M`}
          />
          <Tooltip
            contentStyle={chartTooltipStyle}
            formatter={(v: number) => [`$${v}M`, 'GEX']}
            labelFormatter={(l) => `K ${l}`}
          />
          <ReferenceLine y={0} stroke={CHART.refLine} strokeWidth={1} />
          <ReferenceLine
            x={Math.round(spot)}
            stroke={CHART.series.brand}
            strokeDasharray="3 2"
            strokeWidth={1}
          />
          <Bar dataKey="gex" isAnimationActive={false} maxBarSize={10}>
            {data.map((entry, index) => (
              <Cell
                key={index}
                fill={entry.isAtm ? CHART.series.brand : entry.gex >= 0 ? CHART.series.up : CHART.series.down}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** VS3D-style OI ladder: put OI left (amber), call OI right (info) — fixed height, nearest strikes. */
function OiByStrike({ data, ticker }: { data: GreeksData; ticker: string }) {
  const oiByStrike: Record<number, { calls: number; puts: number }> = {};
  // Missing OI (null) stays unavailable and never contributes as zero.
  data.points.forEach((p) => {
    if (p.oi == null) return;
    if (!oiByStrike[p.K]) oiByStrike[p.K] = { calls: 0, puts: 0 };
    if (p.type === 'call') oiByStrike[p.K]!.calls += p.oi;
    else oiByStrike[p.K]!.puts += p.oi;
  });
  const strikeOIData = Object.entries(oiByStrike)
    .map(([k, v]) => ({
      strike: parseFloat(k),
      calls: v.calls,
      puts: -v.puts,
      net: v.calls - v.puts,
    }))
    .filter((d) => d.strike >= data.spot * 0.92 && d.strike <= data.spot * 1.08)
    .sort((a, b) => Math.abs(a.strike - data.spot) - Math.abs(b.strike - data.spot))
    .slice(0, 22)
    .sort((a, b) => b.strike - a.strike);

  if (strikeOIData.length === 0) return null;

  const maxAbs = Math.max(...strikeOIData.map((d) => Math.max(d.calls, -d.puts)), 1);

  return (
    <div className="rounded border border-border bg-card/50">
      <div className="flex flex-wrap items-baseline gap-x-2 border-b border-border/60 px-2 py-1">
        <span className="text-type-2xs font-semibold tracking-wide text-foreground">OI BY STRIKE</span>
        <span className="text-type-2xs text-muted-foreground">
          put ← · call → · spot {data.spot?.toFixed(0)}
        </span>
        <span className="ml-auto text-type-2xs text-muted-foreground/70">listed OI · not MM book</span>
      </div>
      <div className="px-1 pb-1 pt-0.5">
        <ChartZoom title={`${ticker} OI by strike`} bodyClassName="min-h-0" expandedHeightClass="h-[min(88vh,900px)]">
          <OiLadderChart data={strikeOIData} maxAbs={maxAbs} />
        </ChartZoom>
      </div>
    </div>
  );
}

function OiLadderChart({
  data,
  maxAbs,
}: {
  data: { strike: number; calls: number; puts: number }[];
  maxAbs: number;
}) {
  const { zoomed } = useChartZoom();
  const h = zoomed ? '100%' : 148;
  return (
    <div className={cn('w-full', zoomed ? 'h-full min-h-0' : '')} style={zoomed ? { height: '100%' } : { height: 148 }}>
      <ResponsiveContainer width="100%" height={h}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 4, left: 0, bottom: 0 }}
          barCategoryGap={1}
          barGap={0}
        >
          <CartesianGrid {...chartGridProps} horizontal={false} />
          <XAxis
            type="number"
            domain={[-maxAbs * 1.05, maxAbs * 1.05]}
            tick={{ ...chartAxisTick, fontSize: 8 }}
            tickFormatter={(v) => fmtCompact(Math.abs(v))}
            height={16}
          />
          <YAxis
            type="category"
            dataKey="strike"
            tick={{ ...chartAxisTick, fontSize: 8 }}
            width={40}
            tickFormatter={(v) => String(Math.round(Number(v)))}
          />
          <Tooltip
            contentStyle={chartTooltipStyle}
            formatter={(v: number, name: string) => [
              Math.abs(v).toLocaleString(),
              name === 'calls' ? 'Call OI' : 'Put OI',
            ]}
            labelFormatter={(l) => `K ${l}`}
          />
          <ReferenceLine x={0} stroke={CHART.refLine} strokeWidth={1} />
          <Bar dataKey="puts" fill={CHART.series.warn} name="puts" isAnimationActive={false} maxBarSize={8} stackId="a" />
          <Bar dataKey="calls" fill={CHART.series.info} name="calls" isAnimationActive={false} maxBarSize={8} stackId="a" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Strike × DTE GEX heat table — dense position-grid language (VS3D Pack B4). */
function GexCalendar({ data, ticker }: { data: GreeksData; ticker: string }) {
  const gexCalendar: Record<string, Record<number, number>> = {};
  const allExpiries = new Set<number>();
  const allStrikes = new Set<number>();

  data.points.forEach((p) => {
    // Missing OI is unavailable — never treated as zero.
    if (p.oi == null) return;
    const sign = p.type === 'call' ? 1 : -1;
    const gex = sign * p.gamma * p.oi * 100 * data.spot * data.spot * 0.01;
    const T = p.T.toFixed(3);
    if (!gexCalendar[T]) gexCalendar[T] = {};
    gexCalendar[T]![p.K] = (gexCalendar[T]![p.K] || 0) + gex;
    allExpiries.add(p.T);
    allStrikes.add(p.K);
  });

  const expiries = [...allExpiries].sort((a, b) => a - b).slice(0, 8);
  const strikes = [...allStrikes]
    .filter((k) => k >= data.spot * 0.94 && k <= data.spot * 1.06)
    .sort((a, b) => Math.abs(a - data.spot) - Math.abs(b - data.spot))
    .slice(0, 18)
    .sort((a, b) => b - a);

  if (expiries.length < 2 || strikes.length < 2) return null;

  const maxGex = Math.max(...expiries.flatMap((T) =>
    strikes.map((K) => Math.abs(gexCalendar[T.toFixed(3)]?.[K] || 0)),
  ), 1);

  function gexColor(value: number): string {
    if (value === 0) return 'transparent';
    const intensity = Math.min(Math.abs(value) / maxGex, 1);
    if (value > 0) {
      const a = 0.15 + intensity * 0.75;
      return `color-mix(in srgb, ${CHART_HEX.up} ${Math.round(a * 100)}%, transparent)`;
    }
    const a = 0.15 + intensity * 0.75;
    return `color-mix(in srgb, ${CHART_HEX.down} ${Math.round(a * 100)}%, transparent)`;
  }

  return (
    <div className="rounded border border-border bg-card/50">
      <div className="flex flex-wrap items-baseline gap-x-2 border-b border-border/60 px-2 py-1">
        <span className="text-type-2xs font-semibold tracking-wide text-foreground">GEX CALENDAR</span>
        <span className="text-type-2xs text-muted-foreground">K × DTE · +γ dampen · −γ free-to-move</span>
        <span className="ml-auto text-type-2xs text-muted-foreground/70">naive dealer · OI×γ</span>
      </div>
      <div className="px-1 pb-1 pt-0.5">
        <ChartZoom title={`${ticker} GEX calendar`} bodyClassName="min-h-0" expandedHeightClass="h-[min(90vh,960px)]">
          <GexCalendarTable
            expiries={expiries}
            strikes={strikes}
            gexCalendar={gexCalendar}
            maxGex={maxGex}
            spot={data.spot}
            gexColor={gexColor}
          />
        </ChartZoom>
      </div>
    </div>
  );
}

function GexCalendarTable({
  expiries,
  strikes,
  gexCalendar,
  maxGex,
  spot,
  gexColor,
}: {
  expiries: number[];
  strikes: number[];
  gexCalendar: Record<string, Record<number, number>>;
  maxGex: number;
  spot: number;
  gexColor: (v: number) => string;
}) {
  const { zoomed } = useChartZoom();
  return (
    <div
      className={cn('overflow-auto', zoomed ? 'h-full min-h-0' : 'max-h-[200px]')}
    >
      <table className={cn(
        'w-full border-collapse font-mono leading-none',
        zoomed ? 'text-type-xs' : 'text-[10px]',
      )}>
        <thead className="sticky top-0 z-[1] bg-card">
          <tr>
            <th className="w-10 px-1 py-0.5 text-right font-normal text-muted-foreground">K</th>
            {expiries.map((T) => (
              <th key={T} className="min-w-[2.25rem] px-0.5 py-0.5 text-center font-normal text-muted-foreground">
                {Math.round(T * 365)}d
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {strikes.map((K) => {
            const isSpot = Math.abs(K - spot) < spot * 0.004;
            return (
              <tr key={K} className={isSpot ? 'bg-primary/10' : undefined}>
                <td className={cn(
                  'px-1 py-0.5 text-right tabular-nums',
                  isSpot ? 'font-bold text-foreground' : 'text-muted-foreground',
                )}>
                  {Math.round(K)}
                </td>
                {expiries.map((T) => {
                  const val = gexCalendar[T.toFixed(3)]?.[K] || 0;
                  const show = Math.abs(val) > maxGex * 0.12;
                  return (
                    <td
                      key={T}
                      style={{ background: gexColor(val) }}
                      className="px-0.5 py-0.5 text-center tabular-nums text-foreground/90"
                      title={`K=${K} · ${Math.round(T * 365)}d · $${(val / 1e3).toFixed(1)}K`}
                    >
                      {show ? `${val > 0 ? '+' : ''}${(val / 1e6).toFixed(1)}` : ''}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Terminal-chain OI-weighted charm & vanna by strike (sister to greeks heatmaps). */
function CharmVannaStrikeProfiles({ snapshot }: { snapshot: VolSnapshot }) {
  const chartData = useMemo(() => {
    const d = dealerExposure(snapshot, { weight: 'oi' });
    const S = snapshot.spot;
    return d.points
      .filter((p) => Math.abs(p.strike - S) / S <= 0.12)
      .map((p) => ({
        strike: p.strike,
        label: fmtPrice(p.strike, p.strike > 1000 ? 0 : 2),
        charm: p.netCharm / 1e6,
        vanna: p.netVEX / 1e6,
      }));
  }, [snapshot]);

  if (chartData.length < 2) return null;

  return (
    <div className="rounded-lg border border-border/70 bg-card/40 p-2">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-type-2xs text-muted-foreground">
        <Explain term="charmExposure">
          <span className="font-semibold text-foreground">CHARM · VANNA STRIKE</span>
        </Explain>
        <span>OI-weighted $ exposure · terminal chain · ±12% spot</span>
        <span className="text-muted-foreground/80">· not greeks API grid (see heatmaps below)</span>
      </div>
      <ChartZoom title="Charm · Vanna by strike" bodyClassName="min-h-0" expandedHeightClass="h-[min(88vh,900px)]">
        <CharmVannaChart data={chartData} />
      </ChartZoom>
    </div>
  );
}

function CharmVannaChart({
  data,
}: {
  data: { strike: number; label: string; charm: number; vanna: number }[];
}) {
  const { zoomed } = useChartZoom();
  const h = zoomed ? '100%' : 144;
  return (
    <div className={cn('w-full', zoomed ? 'h-full min-h-0' : '')} style={zoomed ? { height: '100%' } : { height: 144 }}>
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid {...chartGridProps} />
          <XAxis
            dataKey="label"
            tick={chartAxisTick}
            stroke={CHART.axisLine}
            interval={Math.max(0, Math.floor(data.length / 10))}
          />
          <YAxis
            yAxisId="charm"
            tick={chartAxisTick}
            stroke={CHART.axisLine}
            width={44}
            tickFormatter={(v) => fmtCompact(Number(v) * 1e6)}
          />
          <YAxis
            yAxisId="vanna"
            orientation="right"
            tick={chartAxisTick}
            stroke={CHART.axisLine}
            width={44}
            tickFormatter={(v) => fmtCompact(Number(v) * 1e6)}
          />
          <ReferenceLine yAxisId="charm" y={0} stroke={CHART.refLine} />
          <Tooltip
            contentStyle={chartTooltipStyle}
            formatter={(v: number, name: string) => [
              fmtCompact(v * 1e6),
              name === 'charm' ? 'Charm $ / day' : 'VEX (vanna·S)',
            ]}
          />
          <Bar
            yAxisId="charm"
            dataKey="charm"
            name="charm"
            fill={CHART_GREEK_EXT.charm}
            fillOpacity={0.55}
            isAnimationActive={false}
          />
          <Line
            yAxisId="vanna"
            type="monotone"
            dataKey="vanna"
            name="vanna"
            stroke={CHART_GREEK_EXT.vanna}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
