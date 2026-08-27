/**
 * Crypto Backtesting Sandbox — Binance-powered
 *
 * Fetches live hourly klines from Binance Futures API and runs the
 * 24h roll-out effect strategy on demand.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
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
import { DeskChromeLabel } from '../terminal/DeskChrome';
import { cn } from '../../lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────

interface BacktestStatus {
  status: 'ok' | 'degraded';
  binance_connected: boolean;
  n_usdt_perps: number;
  trading_symbols?: string[];
  results_available: boolean;
  error?: string;
}

interface BacktestMetrics {
  n_trades: number;
  mean_bps: number;
  win_rate: number;
  sd_pct: number;
  sharpe: number;
  t_stat: number;
  kelly_f: number;
  kelly_half: number;
  worst_trade_pct: number;
  max_drawdown_pct: number;
  daily_return_pct: number;
}

interface BacktestResult {
  symbol: string;
  strategy: { side: string; trigger: number; hold_hours: number; fee_bps: number };
  metrics: BacktestMetrics;
  equity_curve: { time: string; pnl: number; drawdown: number }[];
  data_range: { start: string; end: string; candles: number };
}

interface ScanResult {
  symbol: string;
  n_trades: number;
  metrics: BacktestMetrics | null;
  error?: string;
  data_range?: { start: string; end: string; candles: number };
}

interface ScanResponse {
  scanned: number;
  with_signals: number;
  side: string;
  trigger: number;
  results: ScanResult[];
}

interface BaselineData {
  available: boolean;
  report?: string[];
  baseline_from_readme?: {
    full_sample_signals: number;
    full_sample_mean_bps: number;
    trailing_4y_signals: number;
    trailing_4y_sharpe: number;
    trailing_4y_t_stat: number;
    by_year: Record<string, { mean_bps: number }>;
  };
}

interface PlaceboData {
  available: boolean;
  ages?: number[];
  mean_bps?: number[];
  ci_95?: number[];
  known_values?: { ages: number[]; mean_bps: number[]; ci_95: number[] };
}

interface TailRiskData {
  available: boolean;
  known_values?: {
    mae_percentiles: Record<string, number>;
    liquidation_rates: Record<string, number>;
    worst_trade_pct: number;
  };
}

interface EquityCurveData {
  available: boolean;
  known_values?: {
    total_return_pct: number;
    annualized_sharpe: number;
    max_drawdown_pct: number;
    trades: number;
    net_bps: number;
    monthly_pnl_pct: number[];
    months: string[];
    /** Deployable-capital knee returned by the backtest service. */
    optimal_capital_knee?: number;
  };
}

// ── API ────────────────────────────────────────────────────────────────────
const API = '/api/backtest';

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Mini components ────────────────────────────────────────────────────────

function Stat({ label, value, color, sub }: {
  label: string; value: string; color?: string; sub?: string;
}) {
  return (
    <div className="flex flex-col min-w-[56px] rounded border border-border bg-card/60 px-1.5 py-1">
      <span className="text-type-2xs text-muted-foreground font-mono uppercase">{label}</span>
      <span className="text-type-xs font-bold font-mono tabular-nums" style={{ color: color ?? 'var(--foreground)' }}>
        {value}
      </span>
      {sub && <span className="text-type-2xs text-muted-foreground font-mono leading-tight">{sub}</span>}
    </div>
  );
}

function MetricCard({ label, value, positive, negative }: {
  label: string; value: string; positive?: boolean; negative?: boolean;
}) {
  const color = positive ? 'var(--up)' : negative ? 'var(--down)' : undefined;
  return (
    <div className="flex flex-col rounded border border-border bg-card/60 px-2 py-1">
      <span className="text-type-2xs text-muted-foreground font-mono uppercase tracking-wide">{label}</span>
      <span className="text-type-sm font-bold font-mono tabular-nums" style={{ color }}>{value}</span>
    </div>
  );
}

function Btn({ active, onClick, children, className }: {
  active?: boolean; onClick: () => void; children: React.ReactNode; className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded border px-1.5 py-0.5 font-mono text-type-2xs transition-colors',
        active
          ? 'border-primary bg-secondary text-foreground'
          : 'border-border text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── Main View ──────────────────────────────────────────────────────────────

const SIDES = ['short', 'long', 'both'] as const;
const HOLDS = [1, 4, 8, 24] as const;
const TRIGGERS = [0.5, 1, 2, 3, 5, 10] as const; // percent
const LOOKBACKS = [168, 336, 720, 1500] as const; // hours

export function BacktestCryptoView() {
  // ── state ──────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<BacktestStatus | null>(null);
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [symbolInput, setSymbolInput] = useState('BTCUSDT');
  const [side, setSide] = useState<string>('both');
  const [triggerPct, setTriggerPct] = useState(1); // percent
  const [hold, setHold] = useState(1);
  const [lookback, setLookback] = useState(336);

  // Run state
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [triggerDist, setTriggerDist] = useState<Record<string, number> | null>(null);

  // Scan state
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [nScan, setNScan] = useState(20);

  // Research tab state
  const [researchTab, setResearchTab] = useState<string>('placebo');
  const [baselineData, setBaselineData] = useState<BaselineData | null>(null);
  const [placeboData, setPlaceboData] = useState<PlaceboData | null>(null);
  const [tailRiskData, setTailRiskData] = useState<TailRiskData | null>(null);
  const [equityData, setEquityData] = useState<EquityCurveData | null>(null);

  // ATM IV reference state
  const [atmIv, setAtmIv] = useState<number | null>(null);
  const [atmSpot, setAtmSpot] = useState<number | null>(null);

  // ── init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchJson<BacktestStatus>(`${API}/status`).then(setStatus).catch(() => {});
    fetchResearch();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch ATM IV when symbol changes
  useEffect(() => {
    const base = symbol.replace('USDT', '');
    if (['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE'].includes(base)) {
      fetchJson<{ atm_iv: number | null; spot: number | null }>(`${API}/options/atm-iv?underlying=${base}`)
        .then(d => { setAtmIv(d.atm_iv); setAtmSpot(d.spot); })
        .catch(() => {});
    } else {
      setAtmIv(null);
      setAtmSpot(null);
    }
  }, [symbol]);

  const fetchResearch = async () => {
    const [b, p, t, e] = await Promise.all([
      fetchJson<BaselineData>(`${API}/baseline`).catch(() => null),
      fetchJson<PlaceboData>(`${API}/placebo`).catch(() => null),
      fetchJson<TailRiskData>(`${API}/tail-risk`).catch(() => null),
      fetchJson<EquityCurveData>(`${API}/equity-curve`).catch(() => null),
    ]);
    if (b) setBaselineData(b);
    if (p) setPlaceboData(p);
    if (t) setTailRiskData(t);
    if (e) setEquityData(e);
  };

  // ── run single symbol ──────────────────────────────────────────────────
  const runBacktest = useCallback(async () => {
    setResultLoading(true);
    setResultError(null);
    setResult(null);
    setSuggestion(null);
    setTriggerDist(null);

    const params = new URLSearchParams({
      symbol: symbol.toUpperCase(),
      side,
      trigger: String(triggerPct / 100),
      hold_hours: String(hold),
      lookback_hours: String(lookback),
    });

    try {
      const data = await fetchJson<BacktestResult & { suggestion?: string; trigger_distribution_pct?: Record<string, number>; raw_signals?: number }>(
        `${API}/run?${params}`, { method: 'POST' },
      );

      if (data.metrics && data.metrics.n_trades > 0) {
        setResult(data as BacktestResult);
      } else {
        setSuggestion(data.suggestion ?? 'No signals. Try a lower trigger or use both sides.');
        setTriggerDist(data.trigger_distribution_pct ?? null);
      }
    } catch (err: unknown) {
      setResultError(err instanceof Error ? err.message : 'Backtest failed');
    }
    setResultLoading(false);
  }, [symbol, side, triggerPct, hold, lookback]);

  // ── scan universe ──────────────────────────────────────────────────────
  const runScan = useCallback(async () => {
    setScanLoading(true);
    setScanResult(null);
    const params = new URLSearchParams({
      n_symbols: String(nScan),
      side,
      trigger: String(triggerPct / 100),
      hold_hours: String(hold),
      lookback_hours: String(Math.min(lookback, 336)),
    });
    try {
      const data = await fetchJson<ScanResponse>(`${API}/scan?${params}`, { method: 'POST' });
      setScanResult(data);
    } catch (err: unknown) {
      setResultError(err instanceof Error ? err.message : 'Scan failed');
    }
    setScanLoading(false);
  }, [nScan, side, triggerPct, hold, lookback]);

  // ── equity chart data ──────────────────────────────────────────────────
  const equityChart = useMemo(() => {
    if (!result?.equity_curve) return [];
    const step = Math.max(1, Math.floor(result.equity_curve.length / 500));
    return result.equity_curve.filter((_, i) => i % step === 0 || i === result.equity_curve.length - 1)
      .map(p => ({ t: p.time.slice(5, 16), pnl: Number((p.pnl * 100).toFixed(2)), dd: Number((p.drawdown * 100).toFixed(2)) }));
  }, [result]);

  // ── placebo chart data ─────────────────────────────────────────────────
  const placeboChart = useMemo(() => {
    const d = placeboData?.available ? placeboData : placeboData?.known_values;
    if (!d?.ages || !d.mean_bps) return [];
    return d.ages.map((age, i) => ({ age, bps: d.mean_bps![i] ?? 0, ci: d.ci_95![i] ?? 0 }));
  }, [placeboData]);

  // ── monthly chart data ─────────────────────────────────────────────────
  const monthlyChart = useMemo(() => {
    const k = equityData?.known_values;
    if (!k?.months || !k.monthly_pnl_pct) return [];
    return k.months.map((m, i) => ({ month: m.slice(5), pnl: k.monthly_pnl_pct![i] ?? 0 }));
  }, [equityData]);

  // ── render ──────────────────────────────────────────────────────────────

  const binanceOnline = status?.binance_connected;
  const binanceColor = binanceOnline ? 'var(--up)' : 'var(--down)';

  return (
    <div className="flex h-full flex-col overflow-hidden p-1">
      {/* Header bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-1 pb-1">
        <DeskChromeLabel className="mr-0">BACKTEST</DeskChromeLabel>
        <span className="font-mono text-type-2xs" style={{ color: binanceColor }}>
          ● {binanceOnline ? `${status?.n_usdt_perps ?? '?'} USDT perps` : 'Binance offline'}
        </span>
        <span className="font-mono text-type-2xs text-muted-foreground">
          24h roll-out effect · live Binance futures data
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-1 overflow-hidden pt-1">
        {/* ── left column: config ── */}
        <div className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border pr-2">
          <span className="font-mono text-type-xs font-bold text-foreground uppercase tracking-wide">Strategy</span>

          {/* Symbol */}
          <div className="flex flex-col gap-1">
            <span className="font-mono text-type-2xs text-muted-foreground">Symbol</span>
            <div className="flex gap-1">
              <input
                value={symbolInput}
                onChange={e => setSymbolInput(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter') { setSymbol(symbolInput); runBacktest(); } }}
                className="min-w-0 flex-1 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-type-xs text-foreground outline-none focus:border-primary"
                placeholder="BTCUSDT"
              />
              <Btn onClick={() => { setSymbol(symbolInput); runBacktest(); }} className="px-2">→</Btn>
            </div>
            {atmIv != null && (
              <div className="flex gap-2 text-type-2xs font-mono text-muted-foreground mt-0.5">
                {atmSpot != null && <span>Spot <span className="text-foreground">${atmSpot.toFixed(0)}</span></span>}
                <span>ATM IV <span className="text-cyan-400">{(atmIv * 100).toFixed(1)}%</span></span>
              </div>
            )}
          </div>

          {/* Side */}
          <div className="flex flex-col gap-1">
            <span className="font-mono text-type-2xs text-muted-foreground">Side</span>
            <div className="flex gap-0.5">
              {SIDES.map(s => (
                <Btn key={s} active={side === s} onClick={() => setSide(s)} className="flex-1 text-center">
                  {s[0]?.toUpperCase() + s.slice(1)}
                </Btn>
              ))}
            </div>
          </div>

          {/* Trigger */}
          <div className="flex flex-col gap-1">
            <span className="font-mono text-type-2xs text-muted-foreground">Trigger ≥</span>
            <div className="flex flex-wrap gap-0.5">
              {TRIGGERS.map(t => (
                <Btn key={t} active={triggerPct === t} onClick={() => setTriggerPct(t)}>
                  {t}%
                </Btn>
              ))}
            </div>
          </div>

          {/* Hold */}
          <div className="flex flex-col gap-1">
            <span className="font-mono text-type-2xs text-muted-foreground">Hold</span>
            <div className="flex gap-0.5">
              {HOLDS.map(h => (
                <Btn key={h} active={hold === h} onClick={() => setHold(h)} className="flex-1 text-center">
                  {h}h
                </Btn>
              ))}
            </div>
          </div>

          {/* Lookback */}
          <div className="flex flex-col gap-1">
            <span className="font-mono text-type-2xs text-muted-foreground">Lookback</span>
            <div className="flex flex-wrap gap-0.5">
              {LOOKBACKS.map(h => (
                <Btn key={h} active={lookback === h} onClick={() => setLookback(h)}>
                  {h < 24 ? `${h}h` : h < 720 ? `${h / 24}d` : `${h / 24}d`}
                </Btn>
              ))}
            </div>
          </div>

          {/* Run button */}
          <button
            type="button"
            onClick={runBacktest}
            disabled={resultLoading}
            className="mt-1 w-full rounded bg-foreground/10 px-3 py-1.5 font-mono text-type-sm font-bold text-foreground transition-colors hover:bg-foreground/20 disabled:opacity-40"
          >
            {resultLoading ? 'RUNNING…' : 'RUN →'}
          </button>

          {/* Divider */}
          <div className="my-1 border-t border-border" />

          {/* Scan universe */}
          <span className="font-mono text-type-xs font-bold text-foreground uppercase tracking-wide">Scan</span>

          <div className="flex gap-1">
            {[10, 20, 50].map(n => (
              <Btn key={n} active={nScan === n} onClick={() => setNScan(n)} className="flex-1 text-center">
                {n}
              </Btn>
            ))}
          </div>

          <button
            type="button"
            onClick={runScan}
            disabled={scanLoading}
            className="w-full rounded bg-foreground/10 px-3 py-1.5 font-mono text-type-sm font-bold text-foreground transition-colors hover:bg-foreground/20 disabled:opacity-40"
          >
            {scanLoading ? 'SCANNING…' : 'SCAN UNIVERSE →'}
          </button>

          {resultError && (
            <div className="rounded border border-red-900/50 bg-red-950/20 p-1.5 font-mono text-type-2xs text-red-400">
              {resultError}
            </div>
          )}
        </div>

        {/* ── right column: results + research ── */}
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">

          {/* Suggestion / trigger distribution */}
          {suggestion && (
            <div className="shrink-0 rounded border border-amber-900/50 bg-amber-950/20 p-1.5 font-mono text-type-2xs text-amber-400">
              {suggestion}
              {triggerDist && (
                <div className="mt-1 flex gap-2 text-type-2xs text-amber-300">
                  <span>Trigger distribution:</span>
                  {Object.entries(triggerDist).map(([k, v]) => (
                    <span key={k}>{k}: {v}%</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Metrics bar */}
          {result?.metrics && (
            <SectionErrorBoundary name="Backtest metrics">
              <div className="flex shrink-0 flex-wrap gap-1 rounded border border-border bg-card p-1.5">
                <MetricCard label="Trades" value={String(result.metrics.n_trades)} />
                <MetricCard label="Mean" value={`${result.metrics.mean_bps.toFixed(1)} bps`} positive={result.metrics.mean_bps > 0} negative={result.metrics.mean_bps < 0} />
                <MetricCard label="Win" value={`${(result.metrics.win_rate * 100).toFixed(0)}%`} positive={result.metrics.win_rate > 0.5} />
                <MetricCard label="Sharpe" value={result.metrics.sharpe.toFixed(2)} positive={result.metrics.sharpe > 1} />
                <MetricCard label="t-stat" value={result.metrics.t_stat.toFixed(2)} positive={result.metrics.t_stat > 2} />
                <MetricCard label="Kelly ½" value={result.metrics.kelly_half.toFixed(3)} />
                <MetricCard label="σ" value={`${result.metrics.sd_pct.toFixed(1)}%`} />
                <MetricCard label="Worst" value={`${result.metrics.worst_trade_pct.toFixed(1)}%`} negative />
                <MetricCard label="Max DD" value={`${result.metrics.max_drawdown_pct.toFixed(1)}%`} negative />
                <MetricCard label="Daily" value={`${result.metrics.daily_return_pct.toFixed(3)}%`} positive={result.metrics.daily_return_pct > 0} />
              </div>
            </SectionErrorBoundary>
          )}

          {/* Equity curve */}
          {equityChart.length > 1 && (
            <SectionErrorBoundary name="Equity curve">
              <Panel title="Equity Curve" subtitle={`${result?.symbol ?? ''} · cumulative P&L (% of capital)`} className="min-h-[140px] flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={equityChart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--up)" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="var(--up)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                    <XAxis dataKey="t" tick={{ fontSize: 8, fill: 'var(--muted-foreground)', fontFamily: 'JetBrains Mono' }} />
                    <YAxis tick={{ fontSize: 8, fill: 'var(--muted-foreground)', fontFamily: 'JetBrains Mono' }} width={40} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
                    <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', fontSize: 10, fontFamily: 'JetBrains Mono' }} />
                    <Area type="monotone" dataKey="pnl" stroke="var(--up)" fill="url(#eqGrad)" strokeWidth={1.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </Panel>
            </SectionErrorBoundary>
          )}

          {/* Scan results table */}
          {scanResult && scanResult.results.length > 0 && (
            <SectionErrorBoundary name="Scan results">
              <Panel
                title="Universe Scan"
                subtitle={`${scanResult.scanned} scanned · ${scanResult.with_signals} with signals · ${scanResult.side} @ ${scanResult.trigger * 100}% trigger`}
                className="max-h-[200px]"
              >
                <div className="overflow-y-auto text-type-2xs font-mono">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border">
                        <th className="text-left px-1 py-0.5">Symbol</th>
                        <th className="text-right px-1 py-0.5">Trades</th>
                        <th className="text-right px-1 py-0.5">Mean bps</th>
                        <th className="text-right px-1 py-0.5">Win%</th>
                        <th className="text-right px-1 py-0.5">Sharpe</th>
                        <th className="text-right px-1 py-0.5">t-stat</th>
                        <th className="text-right px-1 py-0.5">σ%</th>
                        <th className="text-right px-1 py-0.5">Worst%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scanResult.results.map(r => (
                        <tr key={r.symbol} className="border-b border-border/30 hover:bg-secondary/30 cursor-pointer"
                          onClick={() => { setSymbol(r.symbol); setSymbolInput(r.symbol); runBacktest(); }}>
                          <td className="px-1 py-0.5 font-bold">{r.symbol}</td>
                          <td className="text-right px-1 py-0.5">{r.metrics?.n_trades ?? 0}</td>
                          <td className={cn("text-right px-1 py-0.5", (r.metrics?.mean_bps ?? 0) > 0 ? 'text-up' : 'text-down')}>
                            {r.metrics?.mean_bps.toFixed(1) ?? '—'}
                          </td>
                          <td className="text-right px-1 py-0.5">{r.metrics ? `${(r.metrics.win_rate * 100).toFixed(0)}%` : '—'}</td>
                          <td className={cn("text-right px-1 py-0.5", (r.metrics?.sharpe ?? 0) > 1 ? 'text-up' : '')}>
                            {r.metrics?.sharpe.toFixed(1) ?? '—'}
                          </td>
                          <td className={cn("text-right px-1 py-0.5", (r.metrics?.t_stat ?? 0) > 2 ? 'text-up' : '')}>
                            {r.metrics?.t_stat.toFixed(1) ?? '—'}
                          </td>
                          <td className="text-right px-1 py-0.5">{r.metrics ? `${r.metrics.sd_pct.toFixed(1)}` : '—'}</td>
                          <td className="text-right px-1 py-0.5 text-down">{r.metrics ? `${r.metrics.worst_trade_pct.toFixed(1)}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </SectionErrorBoundary>
          )}

          {/* Research tabs */}
          <SectionErrorBoundary name="Research data">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border bg-card">
              <div className="flex shrink-0 flex-wrap border-b border-border">
                {[
                  { id: 'placebo', label: 'Placebo Test' },
                  { id: 'baseline', label: 'Baseline' },
                  { id: 'tail-risk', label: 'Tail Risk' },
                  { id: 'sweep', label: 'Sweep' },
                ].map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setResearchTab(tab.id)}
                    className={cn(
                      'px-2 py-1 font-mono text-type-2xs transition-colors',
                      researchTab === tab.id
                        ? 'border-b-2 border-primary text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {researchTab === 'placebo' && renderPlacebo(placeboData, placeboChart)}
                {researchTab === 'baseline' && renderBaseline(baselineData, equityData, monthlyChart)}
                {researchTab === 'tail-risk' && renderTailRisk(tailRiskData)}
                {researchTab === 'sweep' && renderSweep()}
              </div>
            </div>
          </SectionErrorBoundary>
        </div>
      </div>
    </div>
  );
}

// ── Research tab renderers ──────────────────────────────────────────────────

function renderPlacebo(data: PlaceboData | null, chart: { age: number; bps: number; ci: number }[]) {
  const d = data?.available ? data : data?.known_values;
  const m = d?.mean_bps;
  const age24 = m?.[23];

  return (
    <div className="flex flex-col gap-2 font-mono text-type-xs">
      <span className="text-type-sm font-bold text-foreground">Placebo Test — The smoking gun</span>
      <p className="text-muted-foreground">
        Side-adjusted next-hour return by age of trailing-24h extreme candle.
        Ages 1-23 average ~noise. Age 24 (roll-out hour): <strong className="text-up">+1.87 bps</strong> (t=4.2).
        This pins the effect on the displayed statistic.
      </p>
      {chart.length > 0 && (
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
              <XAxis dataKey="age" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono' }} domain={[0, 25]} ticks={[1, 4, 8, 12, 16, 20, 24]} />
              <YAxis tick={{ fontSize: 9, fontFamily: 'JetBrains Mono' }} width={36} />
              <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', fontSize: 10, fontFamily: 'JetBrains Mono' }} />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
              <ReferenceLine x={24} stroke="var(--amber)" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="bps" stroke="var(--cyan)" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="flex gap-2">
        <Stat label="Placebo 1-23 avg" value={`${m ? (m.slice(0, 23).reduce((a: number, b: number) => a + b, 0) / 23).toFixed(0) : 0} bps`} />
        <Stat label="Age 24 (roll-out)" value={`${age24 ?? 0} bps`} color="var(--up)" />
        <Stat label="t-stat" value="4.2" color="var(--up)" />
      </div>
    </div>
  );
}

function renderBaseline(data: BaselineData | null, equity: EquityCurveData | null, monthlyChart: { month: string; pnl: number }[]) {
  const b = data?.baseline_from_readme;
  const k = equity?.known_values;

  return (
    <div className="flex flex-col gap-2 font-mono text-type-xs">
      <span className="text-type-sm font-bold text-foreground">Baseline — 24h Roll-Out Effect</span>

      {b ? (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          <Stat label="Total signals" value={b.full_sample_signals.toLocaleString()} />
          <Stat label="Mean return" value={`${b.full_sample_mean_bps} bps`} color="var(--up)" />
          <Stat label="4Y Sharpe" value={String(b.trailing_4y_sharpe)} color="var(--up)" />
          <Stat label="4Y t-stat" value={String(b.trailing_4y_t_stat)} color="var(--up)" />
        </div>
      ) : <span className="text-muted-foreground">Loading…</span>}

      {k && (
        <>
          <span className="text-type-xs font-bold text-foreground mt-1">Deployable Subset (short, ≥10%, ≥$1M vol)</span>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            <Stat label="Return" value={`${k.total_return_pct}%`} color="var(--up)" />
            <Stat label="Max DD" value={`${k.max_drawdown_pct}%`} color="var(--down)" />
            <Stat label="Net bps" value={String(k.net_bps)} color="var(--up)" />
            <Stat label="Knee cap" value={`$${((k.optimal_capital_knee ?? 0) / 1000).toFixed(0)}k`} />
          </div>
          {monthlyChart.length > 0 && (
            <div className="h-[100px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyChart} margin={{ top: 2, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                  <XAxis dataKey="month" tick={{ fontSize: 8, fontFamily: 'JetBrains Mono' }} />
                  <YAxis tick={{ fontSize: 8, fontFamily: 'JetBrains Mono' }} width={32} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                  <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', fontSize: 10, fontFamily: 'JetBrains Mono' }} />
                  <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
                  <Bar dataKey="pnl" fill="var(--up)" opacity={0.8} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function renderTailRisk(data: TailRiskData | null) {
  const k = data?.known_values;
  if (!k) return <span className="text-muted-foreground">Loading…</span>;

  return (
    <div className="flex flex-col gap-2 font-mono text-type-xs">
      <span className="text-type-sm font-bold text-foreground">Tail Risk — Short Subset</span>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        <Stat label="MAE p50" value={`${k.mae_percentiles.p50}%`} />
        <Stat label="MAE p99" value={`${k.mae_percentiles.p99}%`} color="var(--down)" />
        <Stat label="MAE p99.9" value={`${k.mae_percentiles.p99_9}%`} color="var(--down)" />
        <Stat label="Max MAE" value={`${k.mae_percentiles.max}%`} color="var(--down)" />
        <Stat label="Worst trade" value={`${k.worst_trade_pct}%`} color="var(--down)" />
        <Stat label="Liq @ 5x" value={`${((k.liquidation_rates['5x'] ?? 0) * 100).toFixed(2)}%/trade`} />
        <Stat label="Liq @ 10x" value={`${((k.liquidation_rates['10x'] ?? 0) * 100).toFixed(2)}%/trade`} />
      </div>
      <p className="text-muted-foreground">
        +30% hourly candles rose 5.3× in 2026. A 15% stop + 30-min exit caps worst trade at -16%.
      </p>
    </div>
  );
}

function renderSweep() {
  return (
    <div className="flex flex-col gap-2 font-mono text-type-xs">
      <span className="text-type-sm font-bold text-foreground">Parameter Sweep</span>
      <p className="text-muted-foreground">
        135 configurations over 4 years. Full-capital variants produce artifacts;
        honest sizing (5-25% per trade) gives tens of percent to tens of x.
        Short side, 10-20% trigger, 1-4h holds are the sweet spot.
      </p>
      <div className="grid grid-cols-2 gap-2 mt-1">
        <div className="rounded border border-border bg-card/60 p-1.5">
          <span className="text-type-2xs text-muted-foreground">5% sizing</span>
          <div className="text-type-xs text-up">Short, 10-20%, 1-4h: +20% to +121%</div>
        </div>
        <div className="rounded border border-border bg-card/60 p-1.5">
          <span className="text-type-2xs text-muted-foreground">25% sizing</span>
          <div className="text-type-xs text-up">Best cells: 17× to 34×</div>
          <div className="text-type-xs text-down">Bad corners: -98%</div>
        </div>
        <div className="rounded border border-amber-900/50 bg-amber-950/20 p-1.5 col-span-2">
          <span className="text-type-2xs text-amber-400">Full capital (100%)</span>
          <div className="text-type-xs text-amber-300">Artifacts from log-growth drag. Fee-dependent, path-luck dominated. Do not use.</div>
        </div>
      </div>
    </div>
  );
}
