import { lazy, Suspense, useEffect, useState } from 'react';
import { macrovolApi, type IVSurfaceData } from '../../lib/macrovol/api';
import {
  CHART_RESOLVED,
  PLOTLY_CS_IV,
  PLOTLY_LAYOUT_BASE,
  PLOTLY_SCENE_AXIS,
} from '../../lib/chartTheme';
import { DataBadge } from './DataBadge';
import { useTerminalStore } from '../../store/terminalStore';

const Plot = lazy(() => Promise.resolve({ default: (_props: any) => null as any })); // Plotly removed — V2 uses Canvas

const POPULAR = ['SPY', 'QQQ', 'AAPL', 'TSLA', 'NVDA', 'AMZN', 'MSFT', 'META', 'GLD'];

const TIME_FILTERS = [
  { label: '1M', max_T: 0.08 },
  { label: '3M', max_T: 0.25 },
  { label: '6M', max_T: 0.5 },
  { label: '1Y', max_T: 1.0 },
  { label: 'ALL', max_T: 999 },
];

export function IVSurfaceMacro({ defaultTicker }: { defaultTicker?: string }) {
  const storeSymbol = useTerminalStore((s) => s.symbol);
  const [ticker, setTicker] = useState(defaultTicker || storeSymbol || 'SPY');
  const [input, setInput] = useState(defaultTicker || storeSymbol || 'SPY');
  const [r, setR] = useState<number | null>(null); // null = live SOFR from API
  const [q, setQ] = useState(0.013);
  const [data, setData] = useState<IVSurfaceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [yAxis, setYAxis] = useState<'strike' | 'moneyness'>('moneyness');
  const [maxT, setMaxT] = useState(999);
  const [rLabel, setRLabel] = useState('SOFR live');
  const deskAtm = useTerminalStore((s) => s.snapshot?.expiries[0]?.atmIV ?? null);
  const [pathNote, setPathNote] = useState<string | null>(null);

  useEffect(() => {
    macrovolApi.ratesSummary().then((s) => {
      if (s.risk_free_rate != null) {
        setRLabel(`SOFR ${(s.risk_free_rate * 100).toFixed(2)}%`);
      }
    }).catch(() => {});
  }, []);

  async function load(t: string) {
    setLoading(true);
    setError('');
    setData(null);
    setPathNote(null);
    try {
      // null r → backend uses live SOFR (avoids stale 5% risk-free)
      const res = await macrovolApi.surface(t, r, q);
      setData(res);
      if ((res as IVSurfaceData & { r?: number }).r != null) {
        const used = (res as IVSurfaceData & { r: number }).r;
        setRLabel(`r ${(used * 100).toFixed(2)}%`);
      }
      // Rough ATM from Macro grid nearest spot vs desk chain ATM (paths can diverge).
      if (deskAtm != null && deskAtm > 0 && res.strikes?.length && res.iv_grid?.length) {
        const ki = res.strikes.reduce(
          (best, k, i) =>
            Math.abs(k - res.spot) < Math.abs(res.strikes[best]! - res.spot) ? i : best,
          0,
        );
        const front = res.iv_grid[0];
        const macroAtmPct = front?.[ki];
        if (macroAtmPct != null && macroAtmPct > 0) {
          const deskPct = deskAtm * 100;
          const gap = Math.abs(macroAtmPct - deskPct);
          if (gap > 3) {
            setPathNote(
              `paths diverge: Macro ATM~${macroAtmPct.toFixed(1)}% vs desk ${(deskPct).toFixed(1)}% (fit/filter — not dual market)`,
            );
          } else {
            setPathNote(
              `desk↔Macro ATM within ${gap.toFixed(1)} vol pts · Macro is diagnostic grid`,
            );
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch surface');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(ticker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const yValues = data
    ? yAxis === 'strike'
      ? data.strikes
      : data.strikes.map((k) => parseFloat((Math.log(k / data.spot) * 100).toFixed(3)))
    : [];

  const filteredExpiries = data?.expiries?.filter((t) => t <= maxT) ?? [];
  const filteredGrid = data?.iv_grid?.slice(0, filteredExpiries.length) ?? [];

  return (
    <div className="flex flex-col gap-4 p-3 font-mono">
      {pathNote && (
        <div
          className="rounded border border-border/60 bg-card/50 px-2 py-1 text-type-2xs text-muted-foreground"
          data-testid="macro-desk-path-note"
          title="Desk chain (SVI) and Macro IV grid use different filters/fit — divergence is expected"
        >
          {pathNote}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-type-xs">
        <span className="text-muted-foreground">EXPIRY:</span>
        {TIME_FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setMaxT(f.max_T)}
            className={`rounded border px-2 py-0.5 ${
              maxT === f.max_T
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:border-primary'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {POPULAR.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTicker(t); setInput(t); }}
            className={`rounded-lg border px-2.5 py-1 text-xs ${
              ticker === t
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-primary hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-type-xs text-muted-foreground">Ticker</label>
          <div className="flex gap-1">
            <input
              className="w-24 rounded border border-border bg-background px-2 py-1.5 text-xs outline-none"
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { setTicker(input); load(input); }
              }}
            />
            <button
              type="button"
              onClick={() => { setTicker(input); load(input); }}
              className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground"
            >
              Load
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-type-xs text-muted-foreground">r ({rLabel})</label>
          <input
            type="number"
            step="0.001"
            placeholder="SOFR"
            className="w-24 rounded border border-border bg-background px-2 py-1.5 text-xs"
            value={r ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              setR(v === '' ? null : parseFloat(v));
            }}
            title="Leave empty to use live SOFR from FRED"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-type-xs text-muted-foreground">q (div yield)</label>
          <input
            type="number"
            step="0.001"
            className="w-20 rounded border border-border bg-background px-2 py-1.5 text-xs"
            value={q}
            onChange={(e) => setQ(parseFloat(e.target.value))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-type-xs text-muted-foreground">Y-Axis</label>
          <select
            className="rounded border border-border bg-background px-2 py-1.5 text-xs"
            value={yAxis}
            onChange={(e) => setYAxis(e.target.value as 'strike' | 'moneyness')}
          >
            <option value="moneyness">Log-Moneyness (%)</option>
            <option value="strike">Strike ($)</option>
          </select>
        </div>
        <button
          type="button"
          onClick={() => load(ticker)}
          className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary"
        >
          Rebuild
        </button>
      </div>

      {loading && (
        <div className="text-type-xs text-muted-foreground">
          Fetching option chain for {ticker} via yfinance… 15–30s cold
        </div>
      )}
      {error && (
        <div className="rounded border border-down/40 bg-down/15 px-3 py-2 text-xs text-down">{error}</div>
      )}

      {data && !loading && (
        <>
          <div className="flex flex-wrap gap-4 text-type-xs text-muted-foreground">
            <span>{ticker}</span>
            <span>Spot: <strong className="text-foreground">${data.spot?.toFixed(2)}</strong></span>
            <span>Expiries: <strong className="text-foreground">{filteredExpiries.length}</strong></span>
            <span>Strikes: <strong className="text-foreground">{data.strikes?.length}</strong></span>
            <span>Points: <strong className="text-foreground">{data.raw_points ?? '—'}</strong></span>
            <span>r: <strong className="text-foreground">{rLabel}</strong></span>
            <span>API: <strong className="text-up">yfinance · FRED</strong></span>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Suspense fallback={<div className="p-8 text-center text-xs text-muted-foreground">Loading Plotly…</div>}>
              <Plot
                data={[{
                  type: 'surface',
                  x: filteredExpiries,
                  y: yAxis === 'strike' ? data.strikes : yValues,
                  z: filteredGrid,
                  colorscale: PLOTLY_CS_IV,
                  showscale: true,
                  colorbar: {
                    title: { text: 'IV %', font: { color: CHART_RESOLVED.mutedForeground, size: 11 } },
                    thickness: 16,
                    len: 0.8,
                    tickfont: { color: CHART_RESOLVED.mutedForeground, size: 9 },
                  },
                  hovertemplate: 'T: %{x:.2f}yr · Y: %{y:.2f} · IV: %{z:.1f}%<extra></extra>',
                  contours: {
                    z: {
                      show: true,
                      usecolormap: true,
                      highlightcolor: CHART_RESOLVED.foreground,
                      project: { z: true },
                    },
                  },
                } as never]}
                layout={{
                  ...PLOTLY_LAYOUT_BASE,
                  font: { ...PLOTLY_LAYOUT_BASE.font, size: 11 },
                  margin: { l: 0, r: 70, t: 36, b: 0 },
                  title: {
                    text: `${ticker} IMPLIED VOLATILITY SURFACE`,
                    font: { color: CHART_RESOLVED.brand, size: 12 },
                    x: 0.05,
                  },
                  scene: {
                    xaxis: { title: 'T (years)', ...PLOTLY_SCENE_AXIS },
                    yaxis: {
                      title: yAxis === 'strike' ? 'STRIKE ($)' : 'LOG-MONEYNESS (%)',
                      ...PLOTLY_SCENE_AXIS,
                    },
                    zaxis: { title: 'IV %', ...PLOTLY_SCENE_AXIS },
                    bgcolor: CHART_RESOLVED.card,
                    camera: { eye: { x: 1.6, y: -1.6, z: 0.9 } },
                    aspectmode: 'manual',
                    aspectratio: { x: 2, y: 1.2, z: 0.8 },
                  },
                  height: 520,
                } as never}
                config={{ responsive: true, displayModeBar: true, displaylogo: false }}
                style={{ width: '100%' }}
              />
            </Suspense>
          </div>
          <DataBadge asOf={data.as_of || data.timestamp} source={data.source || 'yfinance'} staleThresholdMin={60} />
        </>
      )}
    </div>
  );
}
