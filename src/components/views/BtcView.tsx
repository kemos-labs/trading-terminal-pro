/**
 * Crypto Desk — BTC + ETH dual columns (Thalex-inspired).
 * Live spot (Deribit) · vol term · funding/basis · GEX · roll · equity proxies.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useTerminalStore } from '../../store/terminalStore';
import { Panel } from '../terminal/Panel';
import { Explain } from '../common/Explain';
import { EmptyState } from '../common/EmptyState';
import { SectionErrorBoundary } from '../common/SectionErrorBoundary';
import { FreshnessChip, FreshnessFromDomain } from '../common/Freshness';
import { DeskChromeLabel } from '../terminal/DeskChrome';
import { fmtCompact, fmtPct, fmtPrice, fmtSignedPct } from '../../lib/format';
import { UI_COPY } from '../../config/uiCopy';
import {
  gammaExposure, impliedMove, portfolioGreeks,
  realizedVolCloseToClose, volRiskPremium,
} from '../../lib/options/analytics';
import { buildBasisCurve, liveFundingSeries, rollPnlHeatmap } from '../../lib/options/basis';
import { chartTooltipStyle, chartGridProps } from '../../lib/chartTheme';
import { cn } from '../../lib/utils';
import {
  useCryptoDualBooks,
  type CryptoBookState,
  type DualTapeSnap,
} from '../../hooks/useCryptoDualBooks';
import { classifyDomainFreshness } from '../../lib/data/freshness';
import { PerpBasisBoard } from './PerpBasisBoard';
import { DeskView } from './DeskView';
import { BacktestCryptoView } from './BacktestCryptoView';
import { CryptoOptionsView } from './CryptoOptionsView';
import { THALEX_LAB_TOOLS } from '../../config/deskSections';

function Stat({
  label, value, color, term, sub,
}: {
  label: string; value: string; color?: string; term?: string; sub?: string;
}) {
  return (
    <div className="flex flex-col min-w-[72px]">
      <span className="text-type-xs text-muted-foreground font-mono">
        {term ? <Explain term={term}>{label}</Explain> : label}
      </span>
      <span className="text-sm font-semibold font-mono tabular-nums" style={{ color: color ?? 'var(--foreground)' }}>
        {value}
      </span>
      {sub && <span className="text-type-2xs text-muted-foreground font-mono">{sub}</span>}
    </div>
  );
}

/** Thin dual-pane charts (flag `ui.crypto.dualCharts`) — term · funding · GEX spark. */
function ThinBookPane({
  book,
  active,
  onSelect,
}: {
  book: CryptoBookState | null;
  active: boolean;
  onSelect: (ccy: 'BTC' | 'ETH') => void;
}) {
  const ccy = book?.ccy ?? 'BTC';
  const snap = book?.snapshot ?? null;
  const termData = useMemo(() => {
    if (!snap) return [];
    return snap.expiries.map((e) => ({
      dte: e.dte,
      atm: e.atmIV * 100,
      label: `${e.dte}d`,
    }));
  }, [snap]);
  const fundAnn = book?.market?.fundingAnn ?? snap?.fundingAnn ?? null;
  const funding = useMemo(() => liveFundingSeries(16, fundAnn), [fundAnn]);
  const gexMini = useMemo(() => {
    if (!snap) return [];
    return gammaExposure(snap).points.slice(0, 20).map((p) => ({
      strike: p.strike,
      net: p.netGEX / 1e6,
    }));
  }, [snap]);
  const kind = book?.provenance
    ? classifyDomainFreshness(book.asOf, 'crypto')
    : book?.market
      ? classifyDomainFreshness(book.asOf, 'crypto')
      : 'down';
  const frontAtm = snap?.expiries[0]?.atmIV;

  return (
    <button
      type="button"
      onClick={() => onSelect(ccy)}
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col gap-1 rounded border p-1.5 text-left transition-colors',
        active ? 'border-border bg-secondary' : 'border-border bg-card/50 hover:border-border',
      )}
    >
      <div className="flex items-center gap-1.5 px-0.5">
        <span className="font-mono text-type-xs font-bold text-foreground">{ccy}</span>
        <FreshnessChip kind={kind} />
        {active && <span className="text-type-2xs text-muted-foreground">ACTIVE</span>}
        <span className="ml-auto font-mono text-type-2xs tabular-nums text-muted-foreground">
          {snap ? `ATM ${fmtPct(frontAtm)} · n=${snap.expiries.length}` : 'no book'}
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-1" style={{ height: 112 }}>
        <div className="min-h-0">
          <div className="mb-0.5 font-mono text-type-2xs text-muted-foreground">Term</div>
          {termData.length ? (
            <ResponsiveContainer width="100%" height="90%">
              <ComposedChart data={termData} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
                <Line type="monotone" dataKey="atm" stroke="var(--cyan)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[90%] items-center justify-center font-mono text-type-2xs text-muted-foreground">—</div>
          )}
        </div>
        <div className="min-h-0">
          <div className="mb-0.5 font-mono text-type-2xs text-muted-foreground">
            Fund {fundAnn != null ? fmtPct(fundAnn) : '—'}
          </div>
          {funding.length ? (
            <ResponsiveContainer width="100%" height="90%">
              <ComposedChart data={funding} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
                <Bar dataKey="fundingAnn" fill="var(--primary)" opacity={0.75} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[90%] items-center justify-center font-mono text-type-2xs text-muted-foreground">—</div>
          )}
        </div>
        <div className="min-h-0">
          <div className="mb-0.5 font-mono text-type-2xs text-muted-foreground">GEX</div>
          {gexMini.length ? (
            <ResponsiveContainer width="100%" height="90%">
              <BarChart data={gexMini} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
                <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.4} />
                <Bar dataKey="net" fill="var(--cyan)" opacity={0.85} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[90%] items-center justify-center font-mono text-type-2xs text-muted-foreground">—</div>
          )}
        </div>
      </div>
    </button>
  );
}

function DualCol({
  d,
  active,
  onSelect,
}: {
  d: DualTapeSnap | null;
  active: boolean;
  onSelect: (ccy: 'BTC' | 'ETH') => void;
}) {
  if (!d) {
    return (
      <div className="flex-1 skeleton rounded border border-border p-2 font-mono text-type-xs text-muted-foreground">
        Fetching book…
      </div>
    );
  }
  const kind = d.ok
    ? classifyDomainFreshness(d.asOf, 'crypto')
    : 'down';
  const chg = d.change24hPct;
  return (
    <button
      type="button"
      onClick={() => onSelect(d.ccy)}
      className={cn(
        'flex min-w-0 flex-1 flex-col gap-0.5 rounded border px-2 py-1.5 text-left font-mono transition-colors',
        active
          ? 'border-border bg-secondary'
          : 'border-border bg-card/60 hover:border-border',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-type-sm font-bold text-foreground">{d.ccy}</span>
        <FreshnessChip kind={kind} />
        {active && <span className="text-type-2xs text-muted-foreground">ACTIVE</span>}
        {d.spotSource === 'coingecko' && (
          <span className="text-type-2xs text-amber-500/90" title="Deribit index down — CoinGecko spot">
            CG
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-type-xs">
        <span>
          <span className="text-muted-foreground">Spot </span>
          <span className="font-semibold tabular-nums text-foreground">
            {d.spot != null ? fmtPrice(d.spot, d.spot > 1000 ? 1 : 2) : '—'}
          </span>
        </span>
        {d.basisBps != null && (
          <span title="Deribit index − CoinGecko spot (bps of spot)">
            <span className="text-muted-foreground">Basis </span>
            <span className={cn(
              'tabular-nums font-semibold',
              d.basisBps >= 0 ? 'text-up' : 'text-down',
            )}>
              {`${d.basisBps >= 0 ? '+' : ''}${d.basisBps.toFixed(0)}bp`}
            </span>
          </span>
        )}
        <span>
          <span className="text-muted-foreground">24h </span>
          <span className={cn(
            'tabular-nums font-semibold',
            chg == null ? 'text-muted-foreground' : chg >= 0 ? 'text-up' : 'text-down',
          )}>
            {chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : '—'}
          </span>
        </span>
        <span>
          <span className="text-muted-foreground">Fund </span>
          <span className={cn(
            'tabular-nums font-semibold',
            (d.fundingAnn ?? 0) >= 0 ? 'text-up' : 'text-down',
          )}>
            {d.fundingAnn != null ? fmtPct(d.fundingAnn) : '—'}
          </span>
        </span>
        <span className="text-muted-foreground">
          opts <span className="text-foreground">{d.optionCount}</span>
        </span>
      </div>
    </button>
  );
}

export function BtcView() {
  const snapshot = useTerminalStore(s => s.snapshot);
  const symbol = useTerminalStore(s => s.symbol);
  const setSymbol = useTerminalStore(s => s.setSymbol);
  const setActiveTab = useTerminalStore(s => s.setActiveTab);
  const deskSectionId = useTerminalStore(s => s.deskSectionId);
  const chainAvailable = useTerminalStore(s => s.chainAvailable);
  const chainUsed = useTerminalStore(s => s.chainUsed);
  const source = useTerminalStore(s => s.source);
  const lastChainUpdate = useTerminalStore(s => s.lastChainUpdate);
  const provenance = useTerminalStore(s => s.provenance);
  const fmpHistory = useTerminalStore(s => s.fmpHistory);
  const fundingAnn = useTerminalStore(s => s.fundingAnn);
  const cryptoDualCharts = useTerminalStore(s => s.cryptoDualCharts);
  const setCryptoDualCharts = useTerminalStore(s => s.setCryptoDualCharts);
  type CryptoAsset = 'BTC' | 'ETH' | 'IBIT' | 'BITO' | 'MSTR';
  const [proxy, setProxy] = useState<CryptoAsset>(
    symbol === 'ETH' || symbol === 'IBIT' || symbol === 'BITO' || symbol === 'MSTR' ? symbol : 'BTC',
  );
  const { tape: dual, books, gecko } = useCryptoDualBooks({ dualCharts: cryptoDualCharts });
  const showThalexTool = Boolean(deskSectionId?.startsWith('desk-ws-'));
  const showLabHome = !deskSectionId || deskSectionId === 'crypto-sub-lab';
  const showOptions = deskSectionId === 'crypto-sub-options';
  const showBacktest = deskSectionId === 'crypto-sub-backtest';

  // Auto-switch to a crypto underlier when entering this tab
  useEffect(() => {
    const allowed: CryptoAsset[] = ['BTC', 'ETH', 'IBIT', 'BITO', 'MSTR'];
    if (!allowed.includes(symbol as CryptoAsset)) {
      setSymbol('BTC');
      setProxy('BTC');
    } else {
      setProxy(symbol as CryptoAsset);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const gex = useMemo(() => (snapshot ? gammaExposure(snapshot) : null), [snapshot]);
  const move = useMemo(() => (snapshot ? impliedMove(snapshot) : null), [snapshot]);
  const port = useMemo(() => (snapshot ? portfolioGreeks(snapshot) : null), [snapshot]);
  // Active strip only — parity with StatusBar asOf (no snapshot.timestamp); FreshnessFromDomain re-ticks
  const chainMissing = !chainAvailable || chainUsed === 'none';
  const stripAsOfMs =
    provenance.chain?.asOfMs ?? (lastChainUpdate > 0 ? lastChainUpdate : null);
  const liveFundingAnn = fundingAnn ?? snapshot?.fundingAnn ?? null;
  const basis = useMemo(
    () => (snapshot ? buildBasisCurve(snapshot, { fundingAnn: liveFundingAnn }) : null),
    [snapshot, liveFundingAnn],
  );
  const funding = useMemo(() => liveFundingSeries(30, liveFundingAnn), [liveFundingAnn]);
  const roll = useMemo(
    () => (snapshot && liveFundingAnn != null
      ? rollPnlHeatmap(snapshot, { fundingAnn: liveFundingAnn })
      : snapshot
        ? rollPnlHeatmap(snapshot, {}) // equity-style r−q carry only; no fake crypto funding
        : null),
    [snapshot, liveFundingAnn],
  );

  const front = snapshot?.expiries[0];
  const mid = snapshot?.expiries.find(e => e.dte >= 30) ?? front;
  const back = snapshot?.expiries[snapshot.expiries.length - 1];

  const termData = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.expiries.map(e => ({
      dte: e.dte,
      atm: e.atmIV * 100,
      label: `${e.dte}d`,
    }));
  }, [snapshot]);

  const basisData = useMemo(() => {
    if (!basis) return [];
    return basis.points.map(p => ({
      dte: p.dte,
      basisPct: (p.basis / basis.spot) * 100,
      carry: p.annCarry * 100,
      label: `${p.dte}d`,
      source: p.source,
    }));
  }, [basis]);

  const priceSeries = useMemo(() => {
    if (fmpHistory && fmpHistory.length > 0) {
      return fmpHistory.slice(-60).map(b => ({
        t: b.date.slice(5),
        close: b.close,
      }));
    }
    // Synthetic path around spot for empty history
    if (!snapshot) return [];
    const S = snapshot.spot;
    return Array.from({ length: 30 }, (_, i) => ({
      t: `T-${30 - i}`,
      close: S * (1 + 0.02 * Math.sin(i / 4) + (i - 15) * 0.001),
    }));
  }, [fmpHistory, snapshot]);

  const skew25 = useMemo(() => {
    if (!mid) return null;
    const calls = mid.calls.filter(c => c.delta != null && c.iv != null);
    const puts = mid.puts.filter(p => p.delta != null && p.iv != null);
    if (!calls.length || !puts.length) return null;
    const c25 = calls.reduce((b, q) => Math.abs((q.delta ?? 0) - 0.25) < Math.abs((b.delta ?? 0) - 0.25) ? q : b, calls[0]!);
    const p25 = puts.reduce((b, q) => Math.abs((q.delta ?? 0) + 0.25) < Math.abs((b.delta ?? 0) + 0.25) ? q : b, puts[0]!);
    if (c25.iv == null || p25.iv == null) return null;
    // Equity/crypto desk RR: put wing − call wing (rich puts → positive)
    return p25.iv - c25.iv;
  }, [mid]);

  const rv = useMemo(() => {
    if (!fmpHistory?.length) return null;
    return realizedVolCloseToClose(fmpHistory.map((b) => b.close));
  }, [fmpHistory]);
  const frontAtm = front?.atmIV ?? mid?.atmIV ?? null;
  const vrp = useMemo(() => volRiskPremium(frontAtm, rv), [frontAtm, rv]);
  const termSpread = useMemo(() => {
    if (!front || !mid) return null;
    return mid.atmIV - front.atmIV;
  }, [front, mid]);

  const selectCcy = (ccy: 'BTC' | 'ETH') => {
    setProxy(ccy);
    setSymbol(ccy);
  };

  // Crypto options analytics desk
  if (showOptions) {
    return <CryptoOptionsView />;
  }

  // Crypto backtesting sandbox
  if (showBacktest) {
    return <BacktestCryptoView />;
  }

  // Thalex lab tools — crypto chrome (not Trade blotter)
  if (showThalexTool) {
    return <DeskView chrome="thalex" />;
  }

  // Lab home = Thalex-style tool card grid (thalextech.github.io)
  if (showLabHome) {
    const openTool = (id: string) => {
      useTerminalStore.getState().setDeskSection(id);
    };
    return (
      <div className="flex h-full flex-col gap-1 overflow-hidden p-1">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-1 py-1">
          <DeskChromeLabel className="mr-0">THALEX LAB</DeskChromeLabel>
          <span className="font-mono text-type-2xs text-muted-foreground">
            Click a card → full Thalex second-screen app (not a shallow replica) ·{' '}
            <a
              href="https://thalextech.github.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 hover:underline"
            >
              thalextech.github.io
            </a>
            {' '}· data: Thalex public API / parquet · Market baby = Deribit tape
          </span>
          <div className="ml-auto flex gap-1">
            {(['BTC', 'ETH'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { setProxy(c); setSymbol(c); }}
                className={cn(
                  'rounded border px-1.5 py-0.5 font-mono text-type-2xs',
                  symbol === c
                    ? 'border-primary bg-secondary text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 gap-2 p-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {THALEX_LAB_TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => openTool(t.id)}
                className="group flex flex-col overflow-hidden rounded border border-border bg-card text-left transition-colors hover:border-primary/50 hover:bg-secondary/40"
              >
                <div className="aspect-[16/10] w-full overflow-hidden bg-muted/40">
                  <img
                    src={t.preview}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover object-top opacity-90 transition-opacity group-hover:opacity-100"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1 p-2">
                  <span className="font-mono text-type-xs font-bold uppercase tracking-wide text-foreground">
                    {t.label}
                  </span>
                  <span className="font-mono text-type-2xs leading-snug text-muted-foreground">
                    {t.blurb}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const hasTape = dual.btc != null || dual.eth != null;
  // Independent desk: paint dual tape / dual charts without waiting on store chain snapshot
  if (!snapshot && !hasTape) {
    return (
      <Panel title="Crypto Desk" apis={['Deribit', 'CoinGecko']} className="h-full">
        <EmptyState kind="loading" title={UI_COPY.load.crypto} />
      </Panel>
    );
  }

  const isEth = proxy === 'ETH' || symbol === 'ETH';
  const deskLabel = isEth ? 'ETH DESK' : proxy === 'BTC' ? 'BTC DESK' : `${proxy} DESK`;

  const gexChart = (gex?.points ?? []).map(p => ({
    strike: p.strike,
    net: p.netGEX / 1e6,
    label: fmtPrice(p.strike, p.strike > 1000 ? 0 : 1),
  }));

  return (
    <div className="h-full flex flex-col gap-1 overflow-hidden">
      {/* Dual BTC | ETH columns (Phase F) */}
      <SectionErrorBoundary name="Dual tape">
        <div className="flex flex-col gap-1 rounded border border-border bg-card px-2 py-1.5 sm:flex-row sm:items-stretch">
          <div className="flex shrink-0 flex-col justify-center px-1">
            <DeskChromeLabel className="mr-0">CRYPTO</DeskChromeLabel>
            <span className="font-mono text-type-2xs text-muted-foreground">
              BTC · ETH dual · Deribit{gecko ? ' + CoinGecko' : ''}
            </span>
          </div>
          <DualCol d={dual.btc} active={symbol === 'BTC'} onSelect={selectCcy} />
          <DualCol d={dual.eth} active={symbol === 'ETH'} onSelect={selectCcy} />
          <div className="flex shrink-0 flex-wrap items-center gap-1 sm:flex-col sm:justify-center">
            {(['IBIT', 'BITO', 'MSTR'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => { setProxy(p); setSymbol(p); }}
                className={cn(
                  'rounded border px-1.5 py-0.5 font-mono text-type-2xs',
                  symbol === p
                    ? 'border-foreground/50 text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCryptoDualCharts(!cryptoDualCharts)}
              className={cn(
                'rounded border px-1.5 py-0.5 font-mono text-type-2xs',
                cryptoDualCharts
                  ? 'border-foreground/50 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
              title="Dual BTC+ETH charts (default off — heavy)"
            >
              2× charts
            </button>
          </div>
        </div>
      </SectionErrorBoundary>

      <SectionErrorBoundary name="Perp basis">
        <PerpBasisBoard className="shrink-0" />
      </SectionErrorBoundary>

      {/* Optional dual-pane thin charts (PR-06 full charts path) */}
      {cryptoDualCharts && (
        <SectionErrorBoundary name="Dual charts">
          <div className="flex shrink-0 flex-col gap-1 sm:flex-row" style={{ minHeight: 132 }}>
            <ThinBookPane book={books.btc} active={symbol === 'BTC'} onSelect={selectCcy} />
            <ThinBookPane book={books.eth} active={symbol === 'ETH'} onSelect={selectCcy} />
          </div>
        </SectionErrorBoundary>
      )}

      {/* Header strip — active book metrics (shared label + freshness badge grammar) */}
      <div className="flex flex-wrap items-center gap-4 px-3 py-2 border border-border bg-card rounded">
        <div className="flex items-center gap-2">
          <DeskChromeLabel className="mr-0 text-type-sm">{deskLabel}</DeskChromeLabel>
          <span className="text-type-xs font-mono text-muted-foreground px-1.5 py-0.5 border border-border rounded">
            {source === 'live'
              ? (chainUsed === 'deribit'
                ? 'DERIBIT LIVE'
                : chainAvailable
                  ? `LIVE CHAIN · ${chainUsed}`
                  : 'LIVE SPOT · SYNTH SMILE')
              : 'DEMO'}
          </span>
          <FreshnessFromDomain
            asOfMs={stripAsOfMs}
            domain="crypto"
            down={chainMissing}
            previousKind={provenance.chain?.kind}
          />
          <span className="text-type-2xs font-mono text-muted-foreground hidden lg:inline">
            {cryptoDualCharts
              ? '2× charts on · click pane or tape to switch active book'
              : 'Click dual tape to switch · charts = active book'}
          </span>
        </div>
        {snapshot ? (
          <>
            <Stat label="Spot" term="spot" value={fmtPrice(snapshot.spot, snapshot.spot > 1000 ? 1 : 2)} color="var(--amber)" />
            <Stat label="ATM IV" term="atmIv" value={fmtPct(front?.atmIV ?? mid?.atmIV)} color="var(--cyan)" sub={front ? `${front.dte}d` : undefined} />
            <Stat label="30d IV" term="atmIv" value={fmtPct(mid?.atmIV)} />
            <Stat label="25Δ RR" term="riskReversal" value={skew25 != null ? fmtSignedPct(skew25) : '—'} color={skew25 != null && skew25 > 0 ? 'var(--up)' : 'var(--down)'} sub={skew25 != null ? 'put−call' : undefined} />
            <Stat
              label="Funding"
              term="rollPnl"
              value={liveFundingAnn != null ? fmtPct(liveFundingAnn) : '—'}
              color={(liveFundingAnn ?? 0) >= 0 ? 'var(--up)' : 'var(--down)'}
              sub={liveFundingAnn != null ? 'ann. (Deribit 8h×3×365)' : undefined}
            />
            <Stat label="Exp Move" term="expectedMove" value={move ? `±${fmtPrice(move.move, 0)}` : '—'} sub={move ? fmtPct(move.movePct) : undefined} />
            <Stat label="RV" value={rv != null ? fmtPct(rv) : '—'} sub={rv != null ? 'close-to-close' : 'need hist'} />
            <Stat
              label="VRP"
              value={vrp != null ? fmtSignedPct(vrp) : '—'}
              color={vrp != null && vrp < 0 ? 'var(--up)' : 'var(--muted-foreground)'}
              sub="IV−RV"
            />
            <Stat
              label="Term 30−front"
              value={termSpread != null ? fmtSignedPct(termSpread) : '—'}
              color={termSpread != null && termSpread < 0 ? 'var(--amber)' : 'var(--cyan)'}
            />
            <Stat label="Net GEX" term="gex" value={gex ? fmtCompact(gex.totalGEX) : '—'} color={(gex?.totalGEX ?? 0) >= 0 ? 'var(--up)' : 'var(--down)'} />
            <Stat label="Γ Flip" term="gammaFlip" value={gex?.gammaFlip != null ? fmtPrice(gex.gammaFlip, 0) : '—'} />
          </>
        ) : (
          <span className="font-mono text-type-xs text-muted-foreground">
            Tape live · waiting on full chain snapshot for active book…
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('desk')}
            className="ml-2 px-2 py-0.5 text-type-xs font-mono rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            MM DESK →
          </button>
        </div>
      </div>

      {!snapshot ? (
        <Panel title="Crypto Desk" apis={['Deribit']} className="min-h-0 flex-1">
          <EmptyState
            kind="loading"
            title={UI_COPY.load.crypto}
            body="Dual tape available above · full charts when Deribit/chain snapshot lands"
          />
        </Panel>
      ) : (
      <div className="flex-1 grid grid-cols-12 grid-rows-2 gap-1 min-h-0">
        {/* Price */}
        <div className="col-span-4 row-span-1 min-h-0">
          <SectionErrorBoundary name="Spot path">
            <Panel
              title={`${proxy} Spot Path`}
              subtitle={
                proxy === 'BTC' || proxy === 'ETH'
                  ? `${proxy}-USD · Deribit / live seed`
                  : `${proxy} equity proxy`
              }
              className="h-full min-h-0"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={priceSeries} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="cryptoFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--amber)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--amber)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...chartGridProps} />
                  <XAxis dataKey="t" tick={{ fontSize: 9, fill: 'var(--muted-foreground)', fontFamily: 'JetBrains Mono' }} interval="preserveStartEnd" />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 9, fill: 'var(--muted-foreground)', fontFamily: 'JetBrains Mono' }} width={48} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Area type="monotone" dataKey="close" stroke="var(--amber)" fill="url(#cryptoFill)" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </Panel>
          </SectionErrorBoundary>
        </div>

        {/* Term structure */}
        <div className="col-span-4 row-span-1 min-h-0">
          <SectionErrorBoundary name="Term">
            <Panel title="Vol Term Structure" subtitle="ATM IV by DTE" className="h-full min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={termData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--muted-foreground)', fontFamily: 'JetBrains Mono' }} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--muted-foreground)', fontFamily: 'JetBrains Mono' }} width={36} unit="%" />
                  <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', fontSize: 11, fontFamily: 'JetBrains Mono' }} />
                  <Line type="monotone" dataKey="atm" stroke="var(--cyan)" strokeWidth={2} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </Panel>
          </SectionErrorBoundary>
        </div>

        {/* Funding / basis — Deribit live print only (no mock path) */}
        <div className="col-span-4 row-span-1 min-h-0">
          <SectionErrorBoundary name="Funding">
            <Panel
              title="Funding / Carry"
              subtitle={
                liveFundingAnn != null
                  ? `Deribit live 8h ann. ${fmtPct(liveFundingAnn)}`
                  : 'Awaiting Deribit funding'
              }
              className="h-full min-h-0"
            >
              {funding.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={funding} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                    <XAxis dataKey="t" tick={{ fontSize: 9, fill: 'var(--muted-foreground)', fontFamily: 'JetBrains Mono' }} />
                    <YAxis yAxisId="l" tick={{ fontSize: 9, fill: 'var(--muted-foreground)', fontFamily: 'JetBrains Mono' }} width={40} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9, fill: 'var(--muted-foreground)', fontFamily: 'JetBrains Mono' }} width={36} tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                    <Tooltip
                      contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                      formatter={(v: number, name: string) => [name === 'fundingAnn' ? `${(v * 100).toFixed(1)}%` : `${(v * 100).toFixed(2)}%`, name === 'fundingAnn' ? 'Funding' : 'Cum']}
                    />
                    <Bar yAxisId="l" dataKey="fundingAnn" fill="var(--primary)" opacity={0.7} />
                    <Line yAxisId="r" type="monotone" dataKey="cumPnl" stroke="var(--up)" strokeWidth={1.5} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState kind="no-data" title="No live funding" body="Deribit funding not loaded. Stay on LIVE · BTC/ETH." />
              )}
            </Panel>
          </SectionErrorBoundary>
        </div>

        {/* GEX */}
        <div className="col-span-5 row-span-1 min-h-0">
          <SectionErrorBoundary name="GEX">
            <Panel title="Dealer GEX" subtitle="Net gamma exposure by strike" className="h-full min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={gexChart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                  <XAxis dataKey="label" tick={{ fontSize: 8, fill: 'var(--muted-foreground)', fontFamily: 'JetBrains Mono' }} interval={Math.max(1, Math.floor(gexChart.length / 10))} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--muted-foreground)', fontFamily: 'JetBrains Mono' }} width={40} tickFormatter={(v: number) => `${v.toFixed(0)}M`} />
                  <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', fontSize: 11, fontFamily: 'JetBrains Mono' }} />
                  <ReferenceLine y={0} stroke="var(--muted-foreground)" />
                  <ReferenceLine x={fmtPrice(snapshot.spot, snapshot.spot > 1000 ? 0 : 1)} stroke="var(--amber)" strokeDasharray="3 3" />
                  <Bar dataKey="net" fill="var(--cyan)" opacity={0.85} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </SectionErrorBoundary>
        </div>

        {/* Basis + roll + book */}
        <div className="col-span-3 row-span-1 min-h-0">
          <SectionErrorBoundary name="Basis">
            <Panel
              title="Fwd Basis Curve"
              subtitle={
                basis?.hasMarketMarks
                  ? `Deribit futures marks${basis.perp ? ` · perp ${fmtPrice(basis.perp.mark, 0)}` : ''}`
                  : 'Theo F − S (r−q / funding carry)'
              }
              className="h-full min-h-0"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={basisData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--muted-foreground)', fontFamily: 'JetBrains Mono' }} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--muted-foreground)', fontFamily: 'JetBrains Mono' }} width={36} unit="%" />
                  <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', fontSize: 11, fontFamily: 'JetBrains Mono' }} />
                  <Area type="monotone" dataKey="basisPct" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </Panel>
          </SectionErrorBoundary>
        </div>

        <div className="col-span-4 row-span-1 min-h-0 overflow-auto">
          <SectionErrorBoundary name="MM Snapshot">
            <Panel title="MM Snapshot" subtitle="Chain inventory Σ + roll map (not a book)" className="h-full min-h-0 overflow-auto">
              <div className="p-2 flex flex-col gap-2 h-full">
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="ΣΔ" term="netDelta" value={port ? fmtCompact(port.delta) : '—'} />
                  <Stat label="ΣΓ" term="netGamma" value={port ? fmtCompact(port.gamma) : '—'} />
                  <Stat label="Σν" term="netVega" value={port ? fmtCompact(port.vega) : '—'} />
                  <Stat label="ΣΘ/d" term="netTheta" value={port ? fmtCompact(port.theta) : '—'} />
                  <Stat label="Back IV" value={fmtPct(back?.atmIV)} />
                  <Stat label="Term slope" value={front && back ? fmtSignedPct(back.atmIV - front.atmIV) : '—'} />
                </div>
                {roll && (
                  <div className="flex-1 min-h-0">
                    <div className="text-type-xs text-muted-foreground font-mono mb-1">
                      <Explain term="rollPnl">Roll / funding PnL</Explain> heatmap (notional × carry × T)
                    </div>
                    <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${roll.horizons.length}, minmax(0, 1fr))` }}>
                      {roll.pnl.flatMap((row, si) =>
                        row.map((v, hi) => {
                          const intensity = Math.min(1, Math.abs(v) / (snapshot.spot * 0.02 + 1e-9));
                          const bg = v >= 0
                            ? `color-mix(in oklch, var(--up) ${Math.round(intensity * 70)}%, transparent)`
                            : `color-mix(in oklch, var(--down) ${Math.round(intensity * 70)}%, transparent)`;
                          return (
                            <div
                              key={`${si}-${hi}`}
                              title={`shock ${(roll.shocks[si]! * 100).toFixed(0)}% · ${roll.horizons[hi]}d → ${v.toFixed(2)}`}
                              className="h-4 text-type-2xs font-mono flex items-center justify-center text-foreground/80"
                              style={{ background: bg }}
                            >
                              {hi === 0 ? `${(roll.shocks[si]! * 100).toFixed(0)}%` : ''}
                            </div>
                          );
                        }),
                      )}
                    </div>
                    <div className="flex justify-between text-type-2xs font-mono text-muted-foreground mt-0.5">
                      {roll.horizons.map(h => <span key={h}>{h}d</span>)}
                    </div>
                  </div>
                )}
                <p className="text-type-2xs text-muted-foreground font-mono leading-snug">
                  {chainUsed === 'deribit'
                    ? `Live Deribit options + ${basis?.hasMarketMarks ? 'futures marks' : 'theo basis'} · funding ${isEth ? 'ETH' : 'BTC'}-PERPETUAL.`
                    : `Deribit unavailable — synth smile on live spot. Retry LIVE or check /api/deribit/market/${proxy === 'ETH' ? 'ETH' : 'BTC'}.`}
                  {' '}Quant focus: funding vs basis (cash-and-carry premium), 25Δ RR, γ walls, roll heatmap.
                  {' '}Σ greeks = listed inventory, not a position. Open{' '}
                  <button type="button" className="text-foreground underline" onClick={() => setActiveTab('desk')}>MM Desk</button>
                  {' '}for hedge / combo / sim.
                </p>
              </div>
            </Panel>
          </SectionErrorBoundary>
        </div>
      </div>
      )}
    </div>
  );
}
