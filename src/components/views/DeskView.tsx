/**
 * MM Desk — toolkit (12 tools):
 * Simulator · Combo PnL · Straddle · Combo Greeks · Greeks · Option PnL ·
 * Break-even · Roll PnL · Basis · Subjective · Δ Follower · Hedging · Grid
 *
 * Pricing: Black–Scholes–Merton (r, q). IV = Newton/bisection invert of BS.
 * Equity chain: yfinance (auto) / FMP. BTC/ETH options: Deribit public.
 */

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import { Panel } from '../terminal/Panel';
import { EmptyState } from '../common/EmptyState';
import { SectionErrorBoundary } from '../common/SectionErrorBoundary';
import { FreshnessFromDomain } from '../common/Freshness';
import { DeskChrome } from '../terminal/DeskChrome';
import { DeskModeBar } from '../terminal/DeskModeBar';
import { fmtPrice } from '../../lib/format';
import { cn } from '../../lib/utils';
import { UI_COPY } from '../../config/uiCopy';
import { isCryptoSymbol } from '../../lib/options/basis';
import { inventoryByExpiry, portfolioGreeks } from '../../lib/options/analytics';
import { DeskLoading } from '../common/Skeleton';
import { consumeDeskJumpOnMount } from '../../lib/market/deskJump';
import { resolveTradeModeSection } from '../../config/deskSections';
const SimTool = lazy(() => import('../desk/tools/SimTool').then(m => ({ default: m.SimTool })));
const ComboGreeksTool = lazy(() => import('../desk/tools/ComboGreeksTool').then(m => ({ default: m.ComboGreeksTool })));
const GridTool = lazy(() => import('../desk/tools/GridTool').then(m => ({ default: m.GridTool })));
const BreakEvenTool = lazy(() => import('../desk/tools/BreakEvenTool').then(m => ({ default: m.BreakEvenTool })));
const SubjectiveTool = lazy(() => import('../desk/tools/SubjectiveTool').then(m => ({ default: m.SubjectiveTool })));
const ComboPnlTool = lazy(() => import('../desk/tools/ComboPnlTool').then(m => ({ default: m.ComboPnlTool })));
const OptionPnlTool = lazy(() => import('../desk/tools/OptionPnlTool').then(m => ({ default: m.OptionPnlTool })));
const StraddleTool = lazy(() => import('../desk/tools/StraddleTool').then(m => ({ default: m.StraddleTool })));
const HedgeTool = lazy(() => import('../desk/tools/HedgeTool').then(m => ({ default: m.HedgeTool })));
const DFollowTool = lazy(() => import('../desk/tools/DFollowTool').then(m => ({ default: m.DFollowTool })));
const BacktestTool = lazy(() => import('../desk/tools/BacktestTool').then(m => ({ default: m.BacktestTool })));
const BasisTool = lazy(() => import('../desk/tools/BasisTool').then(m => ({ default: m.BasisTool })));
const RollTool = lazy(() => import('../desk/tools/RollTool').then(m => ({ default: m.RollTool })));


type ToolId =
  | 'sim' | 'combopnl' | 'straddle' | 'combo' | 'analyze' | 'optionpnl'
  | 'breakeven' | 'roll' | 'basis' | 'subjective' | 'dfollow' | 'hedge' | 'grid'
  | 'backtest';

/** desk-ws-* section id → tool (red bar / function codes). */
const SECTION_TO_TOOL: Record<string, ToolId> = {
  'desk-ws-sim': 'sim',
  'desk-ws-combo': 'combo',
  'desk-ws-grid': 'grid',
  'desk-ws-combopnl': 'combopnl',
  'desk-ws-optionpnl': 'optionpnl',
  'desk-ws-straddle': 'straddle',
  'desk-ws-breakeven': 'breakeven',
  'desk-ws-subjective': 'subjective',
  'desk-ws-hedge': 'hedge',
  'desk-ws-dfollow': 'dfollow',
  'desk-ws-basis': 'basis',
  'desk-ws-roll': 'roll',
  'desk-ws-analyze': 'analyze',
  'desk-ws-backtest': 'backtest',
  // legacy greeks deep-links
  'greeks-desk': 'analyze',
  'greeks-sub-surface3d': 'analyze',
  'greeks-mesh': 'analyze',
};

const TOOL_TO_SECTION: Record<ToolId, string> = {
  sim: 'desk-ws-sim',
  combo: 'desk-ws-combo',
  grid: 'desk-ws-grid',
  combopnl: 'desk-ws-combopnl',
  optionpnl: 'desk-ws-optionpnl',
  straddle: 'desk-ws-straddle',
  breakeven: 'desk-ws-breakeven',
  subjective: 'desk-ws-subjective',
  hedge: 'desk-ws-hedge',
  dfollow: 'desk-ws-dfollow',
  basis: 'desk-ws-basis',
  roll: 'desk-ws-roll',
  analyze: 'desk-ws-analyze',
  backtest: 'desk-ws-backtest',
};

/** Quant workflow: consolidated 3-mode structure (P0 Fix: 14 mini-apps → 3 coherent workflows). Legacy 14 TOOLS collapsed: Structure = combo+grid+sim, PnL/Scenario = optionpnl+combopnl+straddle+breakeven+subjective+backtest(Scenario Monte Carlo), Hedge/Risk = hedge+dfollow+basis+roll. Greeks (analyze) removed — lives on Vol desk. */
const TOOLS: { id: ToolId; label: string; blurb: string; mode: string }[] = [
  { id: 'combo', label: 'Structure', blurb: 'Legs · Greeks · leverage · sim (one engine)', mode: 'trade-sub-structure' },
  { id: 'optionpnl', label: 'PnL / Scenario', blurb: 'Historical PnL (observed history) + Scenario Monte Carlo', mode: 'trade-sub-pnl' },
  { id: 'hedge', label: 'Hedge / Risk', blurb: 'Δ-hedge · basis · roll · Δ follower (shared risk engine)', mode: 'trade-sub-risk' },
];
// Legacy id mapping for deep-links — old 14 map into 3 consolidated workflows
const LEGACY_TO_CONSOLIDATED: Record<string, ToolId> = {
  sim: 'combo', grid: 'combo', combo: 'combo', analyze: 'combo',
  combopnl: 'optionpnl', straddle: 'optionpnl', breakeven: 'optionpnl', subjective: 'optionpnl', backtest: 'optionpnl',
  dfollow: 'hedge', basis: 'hedge', roll: 'hedge',
};

const MODE_DEFAULT_TOOL: Record<string, ToolId> = {
  'trade-sub-structure': 'combo',
  'trade-sub-pnl': 'optionpnl',
  'trade-sub-risk': 'hedge',
};

function toolsForMode(mode: string) {
  return TOOLS.filter((t) => t.mode === mode && t.id !== 'analyze');
}

function apiBadge(
  source: 'demo' | 'live',
  chainUsed: string,
  symbol: string,
): { label: string; detail: string } {
  if (source !== 'live') return { label: 'DEMO', detail: 'Synthetic SVI surface' };
  const crypto = isCryptoSymbol(symbol);
  if (chainUsed === 'deribit') {
    return { label: 'DERIBIT', detail: 'Live options + mark IV · BS greeks' };
  }
  if (chainUsed === 'yfinance') {
    return { label: 'YFINANCE', detail: 'Live chain · IV = BS invert of mid' };
  }
  if (chainUsed === 'fmp') {
    return { label: 'FMP', detail: 'Paid option chain · IV = BS invert' };
  }
  if (crypto) {
    return { label: 'SYNTH+SPOT', detail: 'Crypto smile @ live spot' };
  }
  return { label: 'SYNTH', detail: 'Synthetic surface fallback' };
}

export function DeskView({
  chrome = 'trade',
}: {
  chrome?: 'trade';
}) {
  const snapshot = useTerminalStore(s => s.snapshot);
  const source = useTerminalStore(s => s.source);
  const chainUsed = useTerminalStore(s => s.chainUsed);
  const chainAvailable = useTerminalStore(s => s.chainAvailable);
  const lastChainUpdate = useTerminalStore(s => s.lastChainUpdate);
  const provenance = useTerminalStore(s => s.provenance);
  const symbol = useTerminalStore(s => s.symbol);
  const deskSectionId = useTerminalStore(s => s.deskSectionId);
  const setDeskContext = useTerminalStore(s => s.setDeskContext);
  // Lab-first default; red bar modes + function codes override via deskSectionId
  const [tool, setTool] = useState<ToolId>('combo');

  useEffect(() => consumeDeskJumpOnMount(), []);

  // Red bar (trade-sub-*) or legacy desk-ws-* function codes → tool workspace (consolidated)
  useEffect(() => {
    if (!deskSectionId) return;

    const legacyToolRaw = SECTION_TO_TOOL[deskSectionId] as ToolId | undefined;
    const legacyTool = legacyToolRaw ? (LEGACY_TO_CONSOLIDATED[legacyToolRaw] ?? legacyToolRaw) : undefined;
    if (legacyTool) {
      setTool(legacyTool as ToolId);
      const meta = TOOLS.find((t) => t.id === legacyTool);
      setDeskContext({
        id: TOOL_TO_SECTION[legacyToolRaw!],
        label: meta?.label ?? legacyTool,
        apis: ['yfinance', 'FMP', 'Deribit'],
      });
      return;
    }

    const mode = resolveTradeModeSection(deskSectionId);
    if (
      deskSectionId === 'trade-sub-structure'
      || deskSectionId === 'trade-sub-pnl'
      || deskSectionId === 'trade-sub-risk'
    ) {
      setTool((prev) => {
        const inMode = toolsForMode(mode).some((t) => t.id === prev);
        return inMode ? prev : (MODE_DEFAULT_TOOL[mode] ?? 'combo');
      });
      const modeLabel =
        mode === 'trade-sub-pnl' ? 'PnL'
          : mode === 'trade-sub-risk' ? 'Hedge'
            : 'Structure';
      setDeskContext({
        id: mode,
        label: modeLabel,
        apis: ['yfinance', 'FMP', 'Deribit'],
      });
    }
  }, [deskSectionId, setDeskContext, chrome]);

  const activeMode = useMemo(() => {
    const fromTool = TOOLS.find((t) => t.id === tool)?.mode;
    if (fromTool) return fromTool;
    return resolveTradeModeSection(deskSectionId);
  }, [tool, deskSectionId]);

  const modeTools = useMemo(() => toolsForMode(activeMode), [activeMode]);

  // Fail-closed: domain classification — never optimistic live without asOf age; re-ticks every 5s
  const chainMissing = !chainAvailable || chainUsed === 'none';
  const chainAsOfMs = provenance.chain?.asOfMs ?? (lastChainUpdate > 0 ? lastChainUpdate : null);

  const inv = useMemo(() => (snapshot ? inventoryByExpiry(snapshot) : []), [snapshot]);
  const port = useMemo(
    () => (snapshot ? portfolioGreeks(snapshot) : { delta: 0, gamma: 0, theta: 0, vega: 0 }),
    [snapshot],
  );
  const topBuckets = inv.slice(0, 5);

  const badge = snapshot ? apiBadge(source, chainUsed, symbol) : null;
  const deskLabel = 'TRADE';
  const deskApis = ['yfinance', 'FMP', 'Deribit'];

  if (!snapshot && tool !== 'analyze') {
    return (
      <Panel title={deskLabel} apis={deskApis} className="h-full">
        <EmptyState
          kind="no-data"
          title="No surface data"
          body={`${UI_COPY.empty.chain} Inventory blotter needs a snapshot. Open Greeks for MacroVol without a full chain.`}
        />
      </Panel>
    );
  }

  return (
    <div className="h-full flex flex-col gap-1 overflow-hidden">
      <div className="flex flex-col gap-1 rounded border border-border bg-card px-2 py-1">
        <DeskChrome
          label={deskLabel}
          labelClassName="mr-0 px-1"
          sticky={false}
          className="border-0 bg-transparent p-0"
          trailing={
            <FreshnessFromDomain
              asOfMs={chainAsOfMs}
              domain="chain"
              down={chainMissing}
              previousKind={provenance.chain?.kind}
            />
          }
        >
          {snapshot && (
            <span className="font-mono text-type-xs text-muted-foreground">
              {snapshot.symbol} @ {fmtPrice(snapshot.spot, snapshot.spot > 1000 ? 1 : 2)}
            </span>
          )}
          {badge && (
            <span
              className="rounded border border-border px-1.5 py-0.5 font-mono text-type-2xs text-muted-foreground"
              title={badge.detail}
            >
              {badge.label}
            </span>
          )}
          <span className="font-mono text-type-2xs text-foreground">
            {TOOLS.find((t) => t.id === tool)?.label ?? tool}
          </span>
          <span className="hidden font-mono text-type-2xs text-muted-foreground md:inline">
            {`Blotter · BS-Merton${chainUsed === 'deribit' ? ' · Deribit mark IV' : ''}`}
          </span>
        </DeskChrome>
        {snapshot && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded border border-border bg-muted/40 px-2 py-1 font-mono text-type-xs">
            <span className="font-bold uppercase tracking-wider text-foreground">Blotter Σ</span>
            <span>
              <span className="text-muted-foreground">Δ </span>
              <span className={cn('font-bold tabular-nums', port.delta >= 0 ? 'text-up' : 'text-down')}>{port.delta.toFixed(1)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Γ </span>
              <span className="font-bold tabular-nums text-foreground">{port.gamma.toFixed(3)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">ν </span>
              <span className="font-bold tabular-nums text-foreground">{port.vega.toFixed(1)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Θ </span>
              <span className={cn('font-bold tabular-nums', port.theta >= 0 ? 'text-up' : 'text-down')}>{port.theta.toFixed(1)}</span>
            </span>
            <span className="text-muted-foreground">|</span>
            {topBuckets.map((b) => (
              <span key={b.expiry} className="text-muted-foreground">
                {b.dte}d Δ<span className="text-foreground">{b.delta.toFixed(0)}</span>
                {' '}ν<span className="text-foreground">{b.vega.toFixed(0)}</span>
              </span>
            ))}
          </div>
        )}
        {modeTools.length > 1 && (
          <DeskModeBar
            items={modeTools.map((t) => ({
              id: t.id,
              label: t.label,
              title: t.blurb,
            }))}
            activeId={tool}
            onSelect={(id) => setTool(id as ToolId)}
          />
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <SectionErrorBoundary key={tool} name={`${deskLabel} ${tool}`}>
          <Suspense fallback={<DeskLoading message="Loading workflow…" />}>
            {tool === 'combo' && snapshot && (
              <div className="flex flex-col gap-2 p-1">
                <div className="rounded border border-border bg-card p-2"><h3 className="font-mono text-type-xs font-semibold">Structure — Combo Greeks (engine: src/lib/math + shared greeksPnl)</h3><p className="text-type-2xs text-muted-foreground">Single engine: computeGreeks (canonical) + portfolio reprice. Controls: legs, strikes, expiry, vol. One workflow, not 3 mini-apps.</p><ComboGreeksTool /></div>
                <div className="rounded border border-border bg-card p-2"><h3 className="font-mono text-type-xs font-semibold">Leverage Grid — Ω · Δ · 1/N(d2)</h3><GridTool /></div>
                <div className="rounded border border-border bg-card p-2"><h3 className="font-mono text-type-xs font-semibold">Simulator — Scenario GBM (not Historical)</h3><p className="text-type-2xs text-amber-700">Scenario Monte Carlo — user σ, drift, seed. Not a historical backtest.</p><SimTool /></div>
              </div>
            )}
          {tool === 'optionpnl' && snapshot && (
            <div className="flex flex-col gap-2 p-1">
              <div className="rounded border border-border bg-card p-2"><h3 className="font-mono text-type-xs font-semibold">PnL / Scenario — Option & Combo (shared historyToSpotBars vs synthetic scenario)</h3><p className="text-type-2xs text-muted-foreground">Observed history (FMP/yfinance) labelled Historical; synthetic GBM labelled Scenario — never mix. Vega 0 = sticky IV note.</p><OptionPnlTool /><div className="mt-2"><ComboPnlTool /></div><div className="mt-2"><StraddleTool /></div><div className="mt-2"><BreakEvenTool /></div><div className="mt-2"><SubjectiveTool /></div></div>
              <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2"><h3 className="font-mono text-type-xs font-semibold text-amber-900">Scenario Monte Carlo — NOT Historical Backtest</h3><p className="text-type-2xs text-muted-foreground">GBM 120 paths, seed 42 · drift 0 · user σ. For historical Binance backtest, use Python crypto-backtest-api (Binance klines).</p><BacktestTool /></div>
              </div>
            )}
            {tool === 'hedge' && snapshot && (
              <div className="flex flex-col gap-2 p-1">
                <div className="rounded border border-border bg-card p-2"><h3 className="font-mono text-type-xs font-semibold">Hedge / Risk — Δ-hedge engine (threshold · tolerance · period)</h3><HedgeTool /><div className="mt-2"><DFollowTool /></div></div>
                <div className="rounded border border-border bg-card p-2"><h3 className="font-mono text-type-xs font-semibold">Basis & Roll — forward basis, ann. carry, funding</h3><BasisTool /><div className="mt-2"><RollTool /></div></div>
              </div>
            )}
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </div>
  );
}
