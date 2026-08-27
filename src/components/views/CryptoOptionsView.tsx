/**
 * Crypto Options Desk — Binance Options data with Greeks, IV surface,
 * smile, term structure, and Greeks analytics.
 *
 * Mirrors the Vol desk's SurfaceView/SmileView/TermView/GreeksView
 * but powered by Binance Options API (eapi.binance.com).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Panel } from '../terminal/Panel';
import { SectionErrorBoundary } from '../common/SectionErrorBoundary';
import { cn } from '../../lib/utils';
import { CryptoPageHeader } from './crypto/CryptoPageHeader';
import { CryptoSurface3D } from './crypto/CryptoSurface3D';
import type { SurfaceField } from './crypto/CryptoSurface3D';
import { CryptoGreeksSurface } from './crypto/CryptoGreeksSurface';

// ── Types ──────────────────────────────────────────────────────────────────

interface OptionGreek {
  symbol: string;
  mark_price: number;
  mark_iv: number;
  bid_iv: number;
  ask_iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  risk_free: number;
}

interface StrikeRow {
  strike: number;
  call: OptionGreek | null;
  put: OptionGreek | null;
}

interface ExpiryGroup {
  expiry_ms: number;
  dte: number;
  n_strikes: number;
  strikes: StrikeRow[];
}

interface OptionsChain {
  underlying: string;
  underlying_price: number;
  n_options: number;
  n_expiries: number;
  expiries: ExpiryGroup[];
}

export interface SurfacePoint {
  expiry_ms: number;
  dte: number;
  strike: number;
  moneyness: number;
  side: string;
  mark_iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface SurfaceData {
  underlying: string;
  underlying_price: number;
  n_points: number;
  points: SurfacePoint[];
}

interface ExchangeInfo {
  n_symbols: number;
  underlyings: Record<string, { n_options: number; n_expiries: number }>;
}

// ── API ────────────────────────────────────────────────────────────────────

const API = '/api/backtest/options';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Underlying config ──────────────────────────────────────────────────────

const UNDERLYINGS = [
  { id: 'BTC', label: 'BTC', color: 'var(--amber)' },
  { id: 'ETH', label: 'ETH', color: 'var(--cyan)' },
  { id: 'SOL', label: 'SOL', color: 'var(--up)' },
  { id: 'XRP', label: 'XRP', color: 'var(--down)' },
  { id: 'BNB', label: 'BNB', color: 'var(--primary)' },
  { id: 'DOGE', label: 'DOGE', color: 'var(--muted-foreground)' },
] as const;

type SubView = 'chain' | 'surface' | 'smile' | 'greeks';
type WingMode = 'otm' | 'itm' | 'atm' | 'all';
type DisplayMode = 'strike' | 'moneyness';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtPrice(v: number | null | undefined, decimals = 2): string {
  if (v == null) return '—';
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(decimals);
  return v.toFixed(4);
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function fmtDelta(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toFixed(4);
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

// ── CryptoOptionsView ──────────────────────────────────────────────────────

export function CryptoOptionsView() {
  const [underlying, setUnderlying] = useState('BTC');
  const [subView, setSubView] = useState<SubView>('chain');
  const [selectedExpiry, setSelectedExpiry] = useState<number | null>(null);
  const [greeksSubView, setGreeksSubView] = useState<'charts' | '3d'>('charts');
  const [wingMode, setWingMode] = useState<WingMode>('all');
  const [surfaceField, setSurfaceField] = useState<SurfaceField>('iv');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('strike');

  // Data state
  const [exchangeInfo, setExchangeInfo] = useState<ExchangeInfo | null>(null);
  const [chain, setChain] = useState<OptionsChain | null>(null);
  const [surface, setSurface] = useState<SurfaceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch exchange info once
  useEffect(() => {
    fetchJson<ExchangeInfo>(`${API}/exchange-info`).then(setExchangeInfo).catch(() => {});
  }, []);

  // Fetch chain + surface when underlying changes
  const fetchData = useCallback(async (u: string) => {
    setLoading(true);
    setError(null);
    try {
      const [c, s] = await Promise.all([
        fetchJson<OptionsChain>(`${API}/chain?underlying=${u}`),
        fetchJson<SurfaceData>(`${API}/surface?underlying=${u}`),
      ]);
      setChain(c);
      setSurface(s);
      if (c.expiries.length > 0) {
        const firstExpiry = c.expiries[0];
        if (firstExpiry) setSelectedExpiry(firstExpiry.expiry_ms);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load options data');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(underlying); }, [underlying, fetchData]);

  // ── Derived data ─────────────────────────────────────────────────────────

  const smileData = useMemo(() => {
    if (!surface || !selectedExpiry) return [];
    return surface.points
      .filter(p => p.expiry_ms === selectedExpiry)
      .sort((a, b) => a.strike - b.strike);
  }, [surface, selectedExpiry]);

  const callSmile = useMemo(() =>
    smileData.filter(p => p.side === 'call').map(p => ({ strike: p.strike, iv: p.mark_iv, delta: p.delta })),
    [smileData],
  );
  const putSmile = useMemo(() =>
    smileData.filter(p => p.side === 'put').map(p => ({ strike: p.strike, iv: p.mark_iv, delta: p.delta })),
    [smileData],
  );

  const termData = useMemo(() => {
    if (!chain?.expiries) return [];
    return chain.expiries.map(exp => {
      const ivs = exp.strikes
        .flatMap(sk => [sk.call?.mark_iv, sk.put?.mark_iv])
        .filter((iv): iv is number => iv != null && iv > 0);
      const atm = ivs.length > 0 ? ivs.reduce((a, b) => a + b, 0) / ivs.length : 0;
      return { dte: exp.dte, atmIv: atm, n: exp.n_strikes, label: `${Math.round(exp.dte)}d` };
    });
  }, [chain]);

  const sk = useMemo(() => {
    if (!chain?.expiries || !chain.underlying_price) return null;
    const front = chain.expiries[0];
    if (!front || !front.strikes.length) return null;
    const S = chain.underlying_price;
    const firstStrike = front.strikes[0];
    if (!firstStrike) return null;
    const atmStrike = front.strikes.reduce((best, s) =>
      Math.abs(s.strike - S) < Math.abs(best.strike - S) ? s : best, firstStrike);
    const callIV = atmStrike.call?.mark_iv ?? null;
    const putIV = atmStrike.put?.mark_iv ?? null;
    return {
      spot: S,
      frontDte: front.dte,
      nExpiries: chain.n_expiries,
      callIV,
      putIV,
      atmIV: callIV != null && putIV != null ? (callIV + putIV) / 2 : (callIV ?? putIV),
    };
  }, [chain]);

  // Greeks grid for selected expiry
  const greeksData = useMemo(() => {
    if (!chain?.expiries) return [];
    const exp = chain.expiries.find(e => e.expiry_ms === selectedExpiry);
    if (!exp) return [];
    return exp.strikes
      .filter(sk => sk.call || sk.put)
      .map(sk => ({
        strike: sk.strike,
        moneyness: chain.underlying_price ? sk.strike / chain.underlying_price : 1,
        callDelta: sk.call?.delta ?? null,
        putDelta: sk.put?.delta ?? null,
        callGamma: sk.call?.gamma ?? null,
        putGamma: sk.put?.gamma ?? null,
        callTheta: sk.call?.theta ?? null,
        putTheta: sk.put?.theta ?? null,
        callVega: sk.call?.vega ?? null,
        putVega: sk.put?.vega ?? null,
        callIV: sk.call?.mark_iv ?? null,
        putIV: sk.put?.mark_iv ?? null,
      }));
  }, [chain, selectedExpiry]);

  // ── Render ────────────────────────────────────────────────────────────────

  const expiries = chain?.expiries ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#030506]">
      <CryptoPageHeader
        title="Chain &"
        highlight="Surfaces"
        description={`Binance Options · ${exchangeInfo?.n_symbols ?? '?'} symbols · ${exchangeInfo ? Object.keys(exchangeInfo.underlyings).length : '?'} underlyings · chain, IV surface, smile, and Greeks per underlying · served by the local backtest API`}
        actions={
          <div className="flex items-center gap-1">
            {UNDERLYINGS.map(u => (
              <button
                key={u.id}
                type="button"
                onClick={() => setUnderlying(u.id)}
                className={cn(
                  'min-h-7 border px-2 font-mono text-[10px] transition-colors',
                  underlying === u.id
                    ? 'border-[#25d7c5] bg-[#25d7c5]/10 text-[#7ee9db]'
                    : 'border-[#2c3337] text-[#8b999f] hover:text-white',
                )}
              >
                {u.label}
              </button>
            ))}
          </div>
        }
      />

      {/* Sub-view tabs + controls */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[#20282b] bg-[#0a0d0e] px-3 py-1.5">
        {/* Left: tabs */}
        <div className="flex gap-1">
          {(['chain', 'surface', 'smile', 'greeks'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setSubView(v)}
              className={cn(
                'px-2 py-0.5 font-mono text-type-2xs rounded transition-colors',
                subView === v
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {v === 'chain' ? 'Chain' : v === 'surface' ? 'Surface' : v === 'smile' ? 'Smile' : 'Greeks'}
            </button>
          ))}
        </div>

        {/* Expiry selector (for smile/greeks) */}
        {(subView === 'smile' || subView === 'greeks') && expiries.length > 0 && (
          <div className="flex items-center gap-1 ml-2">
            <span className="font-mono text-type-2xs text-muted-foreground">Expiry:</span>
            <select
              value={selectedExpiry ?? ''}
              onChange={e => setSelectedExpiry(Number(e.target.value))}
              className="bg-card border border-border rounded px-1 py-0.5 font-mono text-type-2xs text-foreground"
            >
              {expiries.map(exp => (
                <option key={exp.expiry_ms} value={exp.expiry_ms}>
                  {fmtDate(exp.expiry_ms)} ({Math.round(exp.dte)}d)
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Right: surface controls */}
        {subView === 'surface' && (
          <div className="ml-auto flex items-center gap-2">
            {/* X-axis: strike vs moneyness */}
            <div className="flex items-center gap-1">
              <span className="font-mono text-type-2xs text-muted-foreground">Axis</span>
              <div className="flex gap-0.5 rounded border border-border bg-card p-0.5">
                {(['strike', 'moneyness'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDisplayMode(m)}
                    className={cn(
                      'rounded px-1.5 py-0.5 font-mono text-type-2xs transition-colors',
                      displayMode === m
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {m === 'strike' ? 'Strike' : 'Moneyness'}
                  </button>
                ))}
              </div>
            </div>

            {/* Chain side */}
            <div className="flex items-center gap-1">
              <span className="font-mono text-type-2xs text-muted-foreground">Chain side</span>
              <div className="flex gap-0.5 rounded border border-border bg-card p-0.5">
                {(['otm', 'itm', 'atm', 'all'] as const).map(w => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setWingMode(w)}
                    className={cn(
                      'rounded px-1.5 py-0.5 font-mono text-type-2xs transition-colors',
                      wingMode === w
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {w.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Surface field */}
            <div className="flex items-center gap-1">
              <span className="font-mono text-type-2xs text-muted-foreground">Surface</span>
              <div className="flex gap-0.5 rounded border border-border bg-card p-0.5">
                {([
                  { key: 'iv' as SurfaceField, label: 'IV' },
                  { key: 'delta' as SurfaceField, label: 'Δ' },
                  { key: 'gamma' as SurfaceField, label: 'Γ' },
                  { key: 'theta' as SurfaceField, label: 'Θ' },
                  { key: 'vega' as SurfaceField, label: 'ν' },
                ]).map(f => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setSurfaceField(f.key)}
                    className={cn(
                      'rounded px-1.5 py-0.5 font-mono text-type-2xs transition-colors',
                      surfaceField === f.key
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Right: stats for non-surface tabs */}
        {subView !== 'surface' && sk && (
          <div className="ml-auto flex gap-2 font-mono text-type-2xs">
            <span className="text-muted-foreground">Spot <span className="text-foreground">${fmtPrice(sk.spot, 0)}</span></span>
            <span className="text-muted-foreground">ATM IV <span className="text-cyan-400">{fmtPct(sk.atmIV)}</span></span>
            <span className="text-muted-foreground">Expiries <span className="text-foreground">{sk.nExpiries}</span></span>
            {chain && <span className="text-muted-foreground">Options <span className="text-foreground">{chain.n_options}</span></span>}
          </div>
        )}
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center flex-1 font-mono text-type-xs text-muted-foreground">
          Loading {underlying} options…
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center flex-1 font-mono text-type-xs text-red-400">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="min-h-0 flex-1 overflow-hidden">
          {subView === 'chain' && renderChainView(chain)}
          {subView === 'surface' && renderSurfaceView(surface, underlying, loading, wingMode, surfaceField, displayMode)}
          {subView === 'smile' && renderSmileView(callSmile, putSmile, termData, chain?.underlying_price)}
          {subView === 'greeks' && (
            <div className="flex h-full flex-col">
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-1 py-0.5">
                <div className="flex gap-1">
                  {(['charts', '3d'] as const).map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setGreeksSubView(v)}
                      className={`px-2 py-0.5 font-mono text-type-2xs rounded transition-colors ${
                        greeksSubView === v
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {v === 'charts' ? 'Charts' : '3D Surface'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-h-0 flex-1">
                {greeksSubView === 'charts' && renderGreeksView(greeksData)}
                {greeksSubView === '3d' && (
                  <div className="h-full w-full">
                    <CryptoGreeksSurface
                      surface={surface}
                      underlyingPrice={chain?.underlying_price}
                      loading={loading}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Chain View ──────────────────────────────────────────────────────────────

function renderChainView(chain: OptionsChain | null) {
  if (!chain || !chain.expiries.length) {
    return <div className="flex items-center justify-center h-full font-mono text-type-xs text-muted-foreground">No options data available</div>;
  }

  return (
    <div className="h-full overflow-y-auto">
      {chain.expiries.map(exp => (
        <SectionErrorBoundary key={exp.expiry_ms} name={`expiry-${exp.expiry_ms}`}>
          <div className="mb-1 rounded border border-border bg-card">
            <div className="border-b border-border px-2 py-1 font-mono text-type-xs font-bold text-foreground">
              {fmtDate(exp.expiry_ms)} · {Math.round(exp.dte)}d · {exp.n_strikes} strikes
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-type-2xs font-mono border-collapse">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="text-left px-1 py-0.5 min-w-[60px]">Strike</th>
                    <th className="text-right px-1 py-0.5 min-w-[44px]">C.IV</th>
                    <th className="text-right px-1 py-0.5 min-w-[44px]">C.Δ</th>
                    <th className="text-right px-1 py-0.5 min-w-[44px]">C.Γ</th>
                    <th className="text-right px-1 py-0.5 min-w-[44px]">C.Θ</th>
                    <th className="text-right px-1 py-0.5 min-w-[44px]">C.ν</th>
                    <th className="text-right px-1 py-0.5 min-w-[44px]">P.IV</th>
                    <th className="text-right px-1 py-0.5 min-w-[44px]">P.Δ</th>
                    <th className="text-right px-1 py-0.5 min-w-[44px]">P.Γ</th>
                    <th className="text-right px-1 py-0.5 min-w-[44px]">P.Θ</th>
                    <th className="text-right px-1 py-0.5 min-w-[44px]">P.ν</th>
                  </tr>
                </thead>
                <tbody>
                  {exp.strikes.map(sk => {
                    const call = sk.call;
                    const put = sk.put;
                    const isAtm = chain.underlying_price && Math.abs(sk.strike - chain.underlying_price) / chain.underlying_price < 0.02;
                    return (
                      <tr key={sk.strike} className={cn(
                        'border-b border-border/30 hover:bg-secondary/30',
                        isAtm && 'bg-amber-950/10',
                      )}>
                        <td className={cn('px-1 py-0.5 font-bold', isAtm && 'text-amber-400')}>
                          ${fmtPrice(sk.strike, 0)}
                        </td>
                        <td className="text-right px-1 py-0.5 text-cyan-400">{call ? fmtPct(call.mark_iv) : '—'}</td>
                        <td className="text-right px-1 py-0.5">{call ? fmtDelta(call.delta) : '—'}</td>
                        <td className="text-right px-1 py-0.5">{call ? fmtDelta(call.gamma) : '—'}</td>
                        <td className="text-right px-1 py-0.5 text-down">{call ? fmtDelta(call.theta) : '—'}</td>
                        <td className="text-right px-1 py-0.5">{call ? fmtDelta(call.vega) : '—'}</td>
                        <td className="text-right px-1 py-0.5 text-cyan-400">{put ? fmtPct(put.mark_iv) : '—'}</td>
                        <td className="text-right px-1 py-0.5">{put ? fmtDelta(put.delta) : '—'}</td>
                        <td className="text-right px-1 py-0.5">{put ? fmtDelta(put.gamma) : '—'}</td>
                        <td className="text-right px-1 py-0.5 text-down">{put ? fmtDelta(put.theta) : '—'}</td>
                        <td className="text-right px-1 py-0.5">{put ? fmtDelta(put.vega) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </SectionErrorBoundary>
      ))}
    </div>
  );
}

// ── Surface View ────────────────────────────────────────────────────────────

function renderSurfaceView(surface: SurfaceData | null, _underlying: string, loading?: boolean, wing: WingMode = 'all', field: SurfaceField = 'iv', displayMode: 'strike' | 'moneyness' = 'strike') {
  const underlyingPrice = surface?.underlying_price ?? undefined;
  return (
    <div className="h-full w-full">
      <CryptoSurface3D surface={surface} underlyingPrice={underlyingPrice} loading={loading} wing={wing} field={field} displayMode={displayMode} />
    </div>
  );
}

// ── Smile View ──────────────────────────────────────────────────────────────

function renderSmileView(
  calls: { strike: number; iv: number; delta: number }[],
  puts: { strike: number; iv: number; delta: number }[],
  termData: { dte: number; atmIv: number; label: string }[],
  spot: number | undefined,
) {
  // IV vs Strike
  const allPoints = [
    ...puts.map(p => ({ strike: p.strike, iv: p.iv, type: 'put' })),
    ...calls.map(c => ({ strike: c.strike, iv: c.iv, type: 'call' })),
  ].sort((a, b) => a.strike - b.strike);

  // IV vs Delta
  const deltaPoints = [
    ...puts.map(p => ({ delta: p.delta, iv: p.iv, type: 'put' })),
    ...calls.map(c => ({ delta: c.delta, iv: c.iv, type: 'call' })),
  ].sort((a, b) => a.delta - b.delta);

  return (
    <div className="h-full overflow-y-auto">
      <SectionErrorBoundary name="Smile strike">
        <Panel title="IV Smile — Strike" subtitle="Mark IV by strike price" className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={allPoints} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
              <XAxis dataKey="strike" tick={{ fontSize: 8, fontFamily: 'JetBrains Mono' }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <YAxis tick={{ fontSize: 8, fontFamily: 'JetBrains Mono' }} width={36} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
              <Tooltip contentStyle={{ fontFamily: 'JetBrains Mono', fontSize: 10, background: 'var(--card)', border: '1px solid var(--border)' }} />
              {spot && <ReferenceLine x={spot} stroke="var(--amber)" strokeDasharray="3 3" />}
              <Line type="monotone" dataKey="iv" stroke="var(--cyan)" strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      </SectionErrorBoundary>

      <SectionErrorBoundary name="Smile delta">
        <Panel title="IV Smile — Delta" subtitle="Mark IV by option delta" className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={deltaPoints} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
              <XAxis dataKey="delta" tick={{ fontSize: 8, fontFamily: 'JetBrains Mono' }} domain={[-1, 1]} />
              <YAxis tick={{ fontSize: 8, fontFamily: 'JetBrains Mono' }} width={36} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
              <Tooltip contentStyle={{ fontFamily: 'JetBrains Mono', fontSize: 10, background: 'var(--card)', border: '1px solid var(--border)' }} />
              <ReferenceLine x={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="iv" stroke="var(--primary)" strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      </SectionErrorBoundary>

      <SectionErrorBoundary name="Term">
        <Panel title="Term Structure" subtitle="Mean mark IV by DTE" className="h-[160px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={termData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
              <XAxis dataKey="label" tick={{ fontSize: 8, fontFamily: 'JetBrains Mono' }} />
              <YAxis tick={{ fontSize: 8, fontFamily: 'JetBrains Mono' }} width={36} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
              <Tooltip contentStyle={{ fontFamily: 'JetBrains Mono', fontSize: 10, background: 'var(--card)', border: '1px solid var(--border)' }} />
              <Line type="monotone" dataKey="atmIv" stroke="var(--up)" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      </SectionErrorBoundary>
    </div>
  );
}

// ── Greeks View ─────────────────────────────────────────────────────────────

function renderGreeksView(data: {
  strike: number;
  moneyness: number;
  callDelta: number | null;
  putDelta: number | null;
  callGamma: number | null;
  putGamma: number | null;
  callTheta: number | null;
  putTheta: number | null;
  callVega: number | null;
  putVega: number | null;
  callIV: number | null;
  putIV: number | null;
}[]) {
  if (!data.length) {
    return <div className="flex items-center justify-center h-full font-mono text-type-xs text-muted-foreground">No Greeks data</div>;
  }

  const deltaChart = data.map(d => ({ strike: d.strike, callDelta: d.callDelta ?? 0, putDelta: d.putDelta ?? 0 }));
  const gammaChart = data.map(d => ({ strike: d.strike, callGamma: d.callGamma ?? 0, putGamma: d.putGamma ?? 0 }));
  const vegaChart = data.map(d => ({ strike: d.strike, callVega: d.callVega ?? 0, putVega: d.putVega ?? 0 }));
  const thetaChart = data.map(d => ({ strike: d.strike, callTheta: d.callTheta ?? 0, putTheta: d.putTheta ?? 0 }));

  return (
    <div className="h-full overflow-y-auto">
      <SectionErrorBoundary name="Delta">
        <Panel title="Delta" subtitle="Δ by strike" className="h-[140px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={deltaChart} margin={{ top: 2, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
              <XAxis dataKey="strike" tick={{ fontSize: 7, fontFamily: 'JetBrains Mono' }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
              <YAxis tick={{ fontSize: 7, fontFamily: 'JetBrains Mono' }} width={28} domain={[-1, 1]} />
              <Tooltip contentStyle={{ fontFamily: 'JetBrains Mono', fontSize: 9, background: 'var(--card)', border: '1px solid var(--border)' }} />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="callDelta" stroke="var(--up)" strokeWidth={1.5} dot={false} name="Call Δ" />
              <Line type="monotone" dataKey="putDelta" stroke="var(--down)" strokeWidth={1.5} dot={false} name="Put Δ" />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      </SectionErrorBoundary>

      <SectionErrorBoundary name="Gamma">
        <Panel title="Gamma" subtitle="Γ by strike" className="h-[140px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={gammaChart} margin={{ top: 2, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
              <XAxis dataKey="strike" tick={{ fontSize: 7, fontFamily: 'JetBrains Mono' }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
              <YAxis tick={{ fontSize: 7, fontFamily: 'JetBrains Mono' }} width={28} />
              <Tooltip contentStyle={{ fontFamily: 'JetBrains Mono', fontSize: 9, background: 'var(--card)', border: '1px solid var(--border)' }} />
              <Line type="monotone" dataKey="callGamma" stroke="var(--cyan)" strokeWidth={1.5} dot={false} name="Call Γ" />
              <Line type="monotone" dataKey="putGamma" stroke="var(--amber)" strokeWidth={1.5} dot={false} name="Put Γ" />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      </SectionErrorBoundary>

      <SectionErrorBoundary name="Vega">
        <Panel title="Vega" subtitle="ν by strike" className="h-[140px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={vegaChart} margin={{ top: 2, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
              <XAxis dataKey="strike" tick={{ fontSize: 7, fontFamily: 'JetBrains Mono' }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
              <YAxis tick={{ fontSize: 7, fontFamily: 'JetBrains Mono' }} width={28} />
              <Tooltip contentStyle={{ fontFamily: 'JetBrains Mono', fontSize: 9, background: 'var(--card)', border: '1px solid var(--border)' }} />
              <Line type="monotone" dataKey="callVega" stroke="var(--up)" strokeWidth={1.5} dot={false} name="Call ν" />
              <Line type="monotone" dataKey="putVega" stroke="var(--down)" strokeWidth={1.5} dot={false} name="Put ν" />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      </SectionErrorBoundary>

      <SectionErrorBoundary name="Theta">
        <Panel title="Theta" subtitle="Θ by strike (daily)" className="h-[140px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={thetaChart} margin={{ top: 2, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
              <XAxis dataKey="strike" tick={{ fontSize: 7, fontFamily: 'JetBrains Mono' }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
              <YAxis tick={{ fontSize: 7, fontFamily: 'JetBrains Mono' }} width={28} />
              <Tooltip contentStyle={{ fontFamily: 'JetBrains Mono', fontSize: 9, background: 'var(--card)', border: '1px solid var(--border)' }} />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="callTheta" stroke="var(--down)" strokeWidth={1.5} dot={false} name="Call Θ" />
              <Line type="monotone" dataKey="putTheta" stroke="var(--up)" strokeWidth={1.5} dot={false} name="Put Θ" />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      </SectionErrorBoundary>
    </div>
  );
}
