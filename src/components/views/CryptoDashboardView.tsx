import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTerminalStore } from '../../store/terminalStore';
import { gammaExposure, maxPainStrike, realizedVolCloseToClose } from '../../lib/options/analytics';
import { fmtCompact, fmtPct, fmtPrice, fmtSignedPct } from '../../lib/format';
import { chartGridProps, chartTooltipStyle } from '../../lib/chartTheme';
import { Panel } from '../terminal/Panel';
import { EmptyState } from '../common/EmptyState';
import { FreshnessFromDomain } from '../common/Freshness';
import { DeskChromeLabel } from '../terminal/DeskChrome';
import { CryptoPageHeader } from './crypto/CryptoPageHeader';
import { cn } from '../../lib/utils';
import type { DualTapeSnap } from '../../hooks/useCryptoDualBooks';

type DashboardPanel = 'summary' | 'indices' | 'structure' | 'expiries';

const DASHBOARD_PANELS: { id: DashboardPanel; label: string }[] = [
  { id: 'summary', label: 'Market Summary' },
  { id: 'indices', label: 'BTC / ETH Vol Monitor' },
  { id: 'structure', label: 'Structure Charts' },
  { id: 'expiries', label: 'Expiry Ladder' },
];

function initialPanels(): Record<DashboardPanel, boolean> {
  const fallback = { summary: true, indices: true, structure: true, expiries: true };
  try {
    const saved = JSON.parse(localStorage.getItem('ui.crypto.dashboard.panels') ?? '{}') as Partial<Record<DashboardPanel, boolean>>;
    return { ...fallback, ...saved };
  } catch {
    return fallback;
  }
}

function MetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'neutral' | 'up' | 'down' | 'warn' | 'info';
}) {
  const toneClass = {
    neutral: 'text-foreground',
    up: 'text-up',
    down: 'text-down',
    warn: 'text-warn',
    info: 'text-info',
  }[tone];
  return (
    <div className="group min-w-0 border-l-2 border-border bg-card/70 px-3 py-2 transition-colors hover:border-primary hover:bg-secondary/40">
      <div className="truncate font-mono text-type-2xs uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={cn('mt-1 truncate font-mono text-type-lg font-bold tabular-nums', toneClass)}>{value}</div>
      {detail && <div className="mt-0.5 truncate font-mono text-type-2xs text-muted-foreground">{detail}</div>}
    </div>
  );
}

function SectionLabel({ code, children }: { code: string; children: string }) {
  return (
    <div className="flex items-center gap-2 py-1 font-mono text-type-2xs uppercase tracking-[0.16em] text-muted-foreground">
      <span className="font-bold text-primary">{code}</span>
      <span>{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Crypto command overview inspired by the information architecture of modern
 * cross-venue options dashboards. All calculations use VOLATERM's own live
 * store snapshot and analytics; no reference-site assets or data are copied.
 */
export function CryptoDashboardView({
  tape,
  onSelectAsset,
}: {
  tape?: { btc: DualTapeSnap | null; eth: DualTapeSnap | null };
  onSelectAsset?: (asset: 'BTC' | 'ETH') => void;
}) {
  const snapshot = useTerminalStore((s) => s.snapshot);
  const symbol = useTerminalStore((s) => s.symbol);
  const source = useTerminalStore((s) => s.source);
  const chainUsed = useTerminalStore((s) => s.chainUsed);
  const chainAvailable = useTerminalStore((s) => s.chainAvailable);
  const lastChainUpdate = useTerminalStore((s) => s.lastChainUpdate);
  const provenance = useTerminalStore((s) => s.provenance);
  const frames = useTerminalStore((s) => s.historicalFrames);
  const history = useTerminalStore((s) => s.fmpHistory);
  const setDeskSection = useTerminalStore((s) => s.setDeskSection);
  const setSymbol = useTerminalStore((s) => s.setSymbol);
  const [panels, setPanels] = useState(initialPanels);
  const [layoutOpen, setLayoutOpen] = useState(false);

  useEffect(() => {
    const applyUrlAsset = () => {
      const requested = new URL(window.location.href).searchParams.get('crypto')?.toUpperCase();
      if ((requested === 'BTC' || requested === 'ETH') && requested !== useTerminalStore.getState().symbol) {
        void useTerminalStore.getState().setSymbol(requested);
      }
    };
    applyUrlAsset();
    window.addEventListener('popstate', applyUrlAsset);
    return () => window.removeEventListener('popstate', applyUrlAsset);
  }, []);

  const selectAsset = (next: 'BTC' | 'ETH') => {
    const url = new URL(window.location.href);
    url.searchParams.set('crypto', next);
    window.history.replaceState({}, '', url);
    if (onSelectAsset) onSelectAsset(next);
    else void setSymbol(next);
  };

  const togglePanel = (id: DashboardPanel) => {
    setPanels((current) => {
      const next = { ...current, [id]: !current[id] };
      try { localStorage.setItem('ui.crypto.dashboard.panels', JSON.stringify(next)); } catch { /* preference only */ }
      return next;
    });
  };

  const model = useMemo(() => {
    if (!snapshot) return null;
    const gex = gammaExposure(snapshot);
    const front = snapshot.expiries[0];
    const month = snapshot.expiries.find((e) => e.dte >= 25) ?? front;
    const back = snapshot.expiries.at(-1);
    const quotes = snapshot.expiries.flatMap((e) => [...e.calls, ...e.puts]);
    const callOi = quotes.filter((q) => q.type === 'call').reduce((sum, q) => sum + q.openInterest, 0);
    const putOi = quotes.filter((q) => q.type === 'put').reduce((sum, q) => sum + q.openInterest, 0);
    const totalOi = callOi + putOi;
    const callWallQuote = quotes.filter((q) => q.type === 'call').reduce((best, q) => q.openInterest > (best?.openInterest ?? -1) ? q : best, undefined as typeof quotes[number] | undefined);
    const putWallQuote = quotes.filter((q) => q.type === 'put').reduce((best, q) => q.openInterest > (best?.openInterest ?? -1) ? q : best, undefined as typeof quotes[number] | undefined);
    const currentIv = month?.atmIV ?? front?.atmIV ?? null;
    const historicalIv = frames.map((f) => f.snapshot.expiries.find((e) => e.dte >= 25)?.atmIV ?? f.snapshot.expiries[0]?.atmIV).filter((v): v is number => v != null);
    const ivPercentile = currentIv == null || historicalIv.length < 2
      ? null
      : historicalIv.filter((v) => v <= currentIv).length / historicalIv.length;
    const rv = history?.length ? realizedVolCloseToClose(history.map((bar) => bar.close)) : null;
    const vrp = currentIv != null && rv != null ? currentIv - rv : null;
    const termSpread = front && month ? month.atmIV - front.atmIV : null;
    const termLabel = termSpread == null ? '—' : termSpread < -0.005 ? 'Backwardation' : termSpread > 0.005 ? 'Contango' : 'Flat';
    const gammaRegime = gex.totalGEX >= 0 ? 'Long Gamma' : 'Short Gamma';

    return {
      gex,
      front,
      month,
      back,
      totalOi,
      putCall: callOi > 0 ? putOi / callOi : null,
      callWall: callWallQuote?.strike ?? null,
      callWallOi: callWallQuote?.openInterest ?? 0,
      putWall: putWallQuote?.strike ?? null,
      putWallOi: putWallQuote?.openInterest ?? 0,
      currentIv,
      ivPercentile,
      rv,
      vrp,
      termSpread,
      termLabel,
      gammaRegime,
      maxPain: maxPainStrike(snapshot),
      optionCount: quotes.length,
      termData: snapshot.expiries.map((e) => ({ dte: e.dte, label: `${e.dte}d`, iv: e.atmIV * 100 })),
      gexData: gex.points.map((p) => ({ strike: p.strike, label: fmtPrice(p.strike, p.strike > 1000 ? 0 : 1), net: p.netGEX / 1e6 })),
      expiryData: snapshot.expiries.map((e) => {
        const all = [...e.calls, ...e.puts];
        return {
          expiry: e.expiry,
          dte: e.dte,
          atm: e.atmIV,
          oi: all.reduce((sum, q) => sum + q.openInterest, 0),
          volume: all.reduce((sum, q) => sum + q.volume, 0),
          instruments: all.length,
        };
      }),
    };
  }, [frames, history, snapshot]);

  if (!snapshot || !model) {
    return (
      <Panel title="Crypto Overview" apis={['Deribit']} className="h-full">
        <EmptyState kind="loading" title="Building crypto market overview…" body="The desk opens immediately; summary analytics appear when the active options book lands." />
      </Panel>
    );
  }

  const asset = symbol === 'ETH' ? 'ETH' : 'BTC';
  const asOf = provenance.chain?.asOfMs ?? (lastChainUpdate > 0 ? lastChainUpdate : null);
  const ivRegime = model.ivPercentile == null ? 'Unranked' : model.ivPercentile >= 0.8 ? 'Extreme' : model.ivPercentile >= 0.6 ? 'Elevated' : model.ivPercentile <= 0.2 ? 'Low' : 'Normal';
  const btcTape = tape?.btc ?? null;
  const ethTape = tape?.eth ?? null;
  const ivDivergence = btcTape?.atmIv30d != null && ethTape?.atmIv30d != null
    ? ethTape.atmIv30d - btcTape.atmIv30d
    : null;

  return (
    <div className="crypto-overview h-full overflow-y-auto overflow-x-hidden bg-[#030506]" aria-label={`${asset} options overview`}>
      <CryptoPageHeader
        title="Market"
        highlight="Overview"
        description={`${asset} options analytics: spot, implied and realized volatility, dealer gamma, open interest and expiry structure · live Deribit chain · ${chainUsed || 'waiting on chain'}`}
        actions={
          <div className="flex items-center gap-1">
            {(['BTC', 'ETH'] as const).map((item) => (
              <button key={item} type="button" onClick={() => selectAsset(item)} aria-pressed={asset === item} className={cn('min-h-7 border px-2 font-mono text-[10px] transition-colors', asset === item ? 'border-[#25d7c5] bg-[#25d7c5]/10 text-[#7ee9db]' : 'border-[#2c3337] text-[#8b999f]')}>{item}</button>
            ))}
            <button type="button" onClick={() => setDeskSection('crypto-sub-heatmaps')} className="min-h-7 border border-[#2c3337] px-2 font-mono text-[10px] text-[#8b969a] transition-colors hover:border-[#25d7c5] hover:text-white">GREEK EXPOSURE →</button>
            <button type="button" onClick={() => setDeskSection('crypto-sub-flow')} className="min-h-7 border border-[#2c3337] px-2 font-mono text-[10px] text-[#8b969a] transition-colors hover:border-[#25d7c5] hover:text-white">ORDER FLOW →</button>
          </div>
        }
      />
      <div className="mx-auto flex w-full max-w-[1340px] flex-col gap-3 px-3 pb-3">
        <header className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
          <DeskChromeLabel className="mr-0">{asset} OVERVIEW</DeskChromeLabel>
          <span className="font-mono text-type-2xs text-muted-foreground">Cross-expiry options command board · {chainUsed || 'chain pending'}</span>
          <FreshnessFromDomain asOfMs={asOf} domain="crypto" down={!chainAvailable} previousKind={provenance.chain?.kind} />
          <div className="ml-auto flex items-center gap-1">
            {(['BTC', 'ETH'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => selectAsset(item)}
                aria-pressed={asset === item}
                className={cn(
                  'min-h-7 border px-2 font-mono text-type-2xs transition-colors',
                  asset === item ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {item}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setDeskSection('crypto-sub-heatmaps')}
              className="min-h-7 border border-border px-2 font-mono text-type-2xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              GREEK HEAT →
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setLayoutOpen((open) => !open)}
                aria-expanded={layoutOpen}
                className="min-h-7 border border-border px-2 font-mono text-type-2xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
              >
                LAYOUT
              </button>
              {layoutOpen && (
                <div className="absolute right-0 top-full z-30 mt-1 w-56 border border-border bg-popover p-2 shadow-2xl">
                  <div className="mb-1 font-mono text-type-2xs uppercase tracking-wider text-primary">Visible Panels</div>
                  {DASHBOARD_PANELS.map((panel) => (
                    <label key={panel.id} className="flex min-h-8 cursor-pointer items-center gap-2 border-b border-border/50 font-mono text-type-xs text-foreground last:border-0">
                      <input type="checkbox" checked={panels[panel.id]} onChange={() => togglePanel(panel.id)} />
                      {panel.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <span className="hidden font-mono text-type-2xs text-muted-foreground sm:inline">{source.toUpperCase()} · {model.optionCount.toLocaleString()} instruments</span>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-3 xl:grid-cols-6">
          <MetricCard label={`${asset} Spot`} value={`$${fmtPrice(snapshot.spot, snapshot.spot > 1000 ? 0 : 2)}`} detail={chainUsed === 'deribit' ? 'Deribit index' : chainUsed} tone="warn" />
          <MetricCard label="ATM IV · 30D" value={fmtPct(model.currentIv)} detail={model.month ? `${model.month.dte}d tenor` : undefined} tone="info" />
          <MetricCard label="Term Structure" value={model.termLabel} detail={model.termSpread != null ? `30D − front ${fmtSignedPct(model.termSpread)}` : undefined} tone={model.termLabel === 'Backwardation' ? 'warn' : 'neutral'} />
          <MetricCard label="Gamma Regime" value={model.gammaRegime} detail={fmtCompact(model.gex.totalGEX)} tone={model.gex.totalGEX >= 0 ? 'up' : 'down'} />
          <MetricCard label="Put / Call OI" value={model.putCall?.toFixed(2) ?? '—'} detail={model.putCall != null && model.putCall < 1 ? 'call-skewed' : 'put-skewed'} />
          <MetricCard label="IV Regime" value={ivRegime} detail={model.ivPercentile != null ? `${Math.round(model.ivPercentile * 100)}th percentile` : 'history building'} tone={ivRegime === 'Extreme' ? 'down' : ivRegime === 'Elevated' ? 'warn' : 'neutral'} />
        </div>

        {panels.summary && (
          <>
        <SectionLabel code="SUMMARY">Cross-expiry market snapshot</SectionLabel>
        <Panel title="Market Summary" subtitle="Volatility, gamma & positioning" apis={['Deribit']}>
          <div className="grid gap-px bg-border md:grid-cols-3">
            <section className="bg-card p-3">
              <h3 className="mb-2 font-mono text-type-2xs font-bold uppercase tracking-wider text-primary">Gamma & Vol</h3>
              <div className="grid grid-cols-2 gap-2">
                <MetricCard label="Net GEX" value={fmtCompact(model.gex.totalGEX)} detail={model.gex.totalGEX >= 0 ? 'May suppress realized vol' : 'May amplify realized vol'} tone={model.gex.totalGEX >= 0 ? 'up' : 'down'} />
                <MetricCard label="Gamma Flip" value={model.gex.gammaFlip != null ? `$${fmtPrice(model.gex.gammaFlip, 0)}` : '—'} detail={model.gex.gammaFlip != null ? fmtSignedPct(model.gex.gammaFlip / snapshot.spot - 1) : 'No zero crossing'} tone="warn" />
                <MetricCard label="IV vs Realized" value={model.vrp != null ? fmtSignedPct(model.vrp) : '—'} detail={model.rv != null ? `IV ${fmtPct(model.currentIv)} · RV ${fmtPct(model.rv)}` : 'Price history required'} tone={model.vrp != null && model.vrp < 0 ? 'up' : 'neutral'} />
                <MetricCard label="Vol Regime" value={ivRegime} detail={model.ivPercentile != null ? `${Math.round(model.ivPercentile * 100)}th percentile` : 'Collecting frames'} tone={ivRegime === 'Extreme' ? 'down' : 'warn'} />
              </div>
            </section>
            <section className="bg-card p-3">
              <h3 className="mb-2 font-mono text-type-2xs font-bold uppercase tracking-wider text-primary">Price & Volatility</h3>
              <div className="grid grid-cols-2 gap-2">
                <MetricCard label="Spot" value={`$${fmtPrice(snapshot.spot, 0)}`} detail={`${asset}-USD`} />
                <MetricCard label="Front ATM IV" value={fmtPct(model.front?.atmIV)} detail={model.front ? `${model.front.dte}d` : undefined} tone="info" />
                <MetricCard label="30D ATM IV" value={fmtPct(model.month?.atmIV)} detail={model.month ? `${model.month.dte}d` : undefined} tone="info" />
                <MetricCard label="Realized Vol" value={model.rv != null ? fmtPct(model.rv) : '—'} detail="Close-to-close" />
              </div>
            </section>
            <section className="bg-card p-3">
              <h3 className="mb-2 font-mono text-type-2xs font-bold uppercase tracking-wider text-primary">Levels & Open Interest</h3>
              <div className="grid grid-cols-2 gap-2">
                <MetricCard label="Call Wall" value={model.callWall != null ? `$${fmtPrice(model.callWall, 0)}` : '—'} detail={`${fmtCompact(model.callWallOi)} OI`} tone="up" />
                <MetricCard label="Put Wall" value={model.putWall != null ? `$${fmtPrice(model.putWall, 0)}` : '—'} detail={`${fmtCompact(model.putWallOi)} OI`} tone="down" />
                <MetricCard label="Max Pain" value={model.maxPain != null ? `$${fmtPrice(model.maxPain, 0)}` : '—'} detail="Front expiry" tone="warn" />
                <MetricCard label="Total OI" value={fmtCompact(model.totalOi)} detail={`${snapshot.expiries.length} expiries`} />
              </div>
            </section>
          </div>
        </Panel>
          </>
        )}

        {panels.indices && (
          <>
            <SectionLabel code="VOL INDEX">Cross-asset volatility monitor</SectionLabel>
            <Panel title="BTC / ETH Vol Monitor" subtitle="Nearest 30D ATM IV from Deribit marks" apis={['Deribit']}>
              <div className="grid gap-px bg-border md:grid-cols-[1fr_1fr_0.8fr]">
                {([['BTC', btcTape], ['ETH', ethTape]] as const).map(([ccy, row]) => {
                  const active = asset === ccy;
                  const change = row?.change24hPct ?? null;
                  return (
                    <button
                      key={ccy}
                      type="button"
                      onClick={() => selectAsset(ccy)}
                      className={cn('bg-card p-3 text-left transition-colors hover:bg-secondary/40', active && 'ring-1 ring-inset ring-primary/70')}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-type-xs font-bold text-primary">{ccy} VOL</span>
                        {active && <span className="font-mono text-type-2xs text-muted-foreground">ACTIVE</span>}
                        <span className={cn('ml-auto font-mono text-type-xs tabular-nums', change == null ? 'text-muted-foreground' : change >= 0 ? 'text-up' : 'text-down')}>
                          {change == null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}% spot`}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <MetricCard label="30D ATM IV" value={fmtPct(row?.atmIv30d)} tone="info" />
                        <MetricCard label="Spot" value={row?.spot != null ? `$${fmtPrice(row.spot, row.spot > 1000 ? 0 : 2)}` : '—'} />
                        <MetricCard label="Options OI" value={row?.totalOpenInterest != null ? fmtCompact(row.totalOpenInterest) : '—'} />
                        <MetricCard label="24h Volume" value={row?.volume24h != null ? fmtCompact(row.volume24h) : '—'} />
                      </div>
                    </button>
                  );
                })}
                <section className="bg-card p-3">
                  <div className="font-mono text-type-2xs font-bold uppercase tracking-wider text-primary">Relative Value</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-1 xl:grid-cols-2">
                    <MetricCard
                      label="ETH − BTC IV"
                      value={ivDivergence != null ? fmtSignedPct(ivDivergence) : '—'}
                      detail={ivDivergence == null ? 'Both books required' : ivDivergence > 0 ? 'ETH vol richer' : 'BTC vol richer'}
                      tone={ivDivergence != null && Math.abs(ivDivergence) > 0.1 ? 'warn' : 'neutral'}
                    />
                    <MetricCard
                      label="Funding Spread"
                      value={btcTape?.fundingAnn != null && ethTape?.fundingAnn != null ? fmtSignedPct(ethTape.fundingAnn - btcTape.fundingAnn) : '—'}
                      detail="ETH − BTC annualized"
                    />
                  </div>
                </section>
              </div>
            </Panel>
          </>
        )}

        {panels.structure && (
          <>
        <SectionLabel code="STRUCTURE">Term curve & dealer positioning</SectionLabel>
        <div className="grid gap-2 lg:grid-cols-2">
          <Panel title="ATM Vol Term Structure" subtitle="All listed expiries" className="h-[300px]" actions={<button type="button" onClick={() => setDeskSection('crypto-sub-volskew')} className="text-type-2xs text-muted-foreground hover:text-foreground">OPEN VOL & SKEW →</button>}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={model.termData} margin={{ top: 18, right: 18, bottom: 8, left: 0 }}>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
                <YAxis width={42} unit="%" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [`${v.toFixed(1)}%`, 'ATM IV']} />
                <Line type="monotone" dataKey="iv" stroke="var(--info)" strokeWidth={2} dot={{ r: 2, fill: 'var(--background)' }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title="Dealer Gamma Profile" subtitle="Net GEX by strike · OI weighted" className="h-[300px]" actions={<button type="button" onClick={() => setDeskSection('crypto-sub-heatmaps')} className="text-type-2xs text-muted-foreground hover:text-foreground">FULL GEX →</button>}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={model.gexData} margin={{ top: 18, right: 18, bottom: 8, left: 0 }}>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="label" interval={Math.max(1, Math.floor(model.gexData.length / 9))} tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
                <YAxis width={46} tickFormatter={(v: number) => `${v.toFixed(0)}M`} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [`${v.toFixed(2)}M`, 'Net GEX']} />
                <ReferenceLine y={0} stroke="var(--muted-foreground)" />
                <Bar dataKey="net" isAnimationActive={false}>
                  {model.gexData.map((point) => <Cell key={point.strike} fill={point.net >= 0 ? 'var(--up)' : 'var(--down)'} opacity={0.82} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </div>
          </>
        )}

        {panels.expiries && (
          <>
        <SectionLabel code="EXPIRIES">Liquidity & volatility ladder</SectionLabel>
        <Panel title="Expiry Ladder" subtitle="ATM IV, open interest & volume">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse font-mono text-type-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-type-2xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left">Expiry</th><th className="px-3 py-2 text-right">DTE</th><th className="px-3 py-2 text-right">ATM IV</th><th className="px-3 py-2 text-right">Open Interest</th><th className="px-3 py-2 text-right">24h Volume</th><th className="px-3 py-2 text-right">Instruments</th>
                </tr>
              </thead>
              <tbody>
                {model.expiryData.map((row) => (
                  <tr key={row.expiry} className="border-b border-border/60 transition-colors hover:bg-secondary/30">
                    <td className="px-3 py-2 text-foreground">{new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(row.expiry))}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.dte}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-info">{fmtPct(row.atm)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtCompact(row.oi)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtCompact(row.volume)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.instruments.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
          </>
        )}
        <p className="pb-2 font-mono text-type-2xs leading-relaxed text-muted-foreground">Analytics are decision support, not trade instructions. GEX assumes dealer-side positioning from listed OI; confirm with live flow before acting.</p>
      </div>
    </div>
  );
}
