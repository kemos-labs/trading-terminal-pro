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
const StructureWorkflow = lazy(() => import('../desk/workflows/StructureWorkflow').then(m => ({ default: m.StructureWorkflow })));
const PnlWorkflow = lazy(() => import('../desk/workflows/PnlWorkflow').then(m => ({ default: m.PnlWorkflow })));
const HedgeWorkflow = lazy(() => import('../desk/workflows/HedgeWorkflow').then(m => ({ default: m.HedgeWorkflow })));


type ToolId = 'structure' | 'pnl' | 'risk';

/** Every legacy desk-ws-* / greeks-* id maps directly to one of the 3 canonical workflows. */
const SECTION_TO_TOOL: Record<string, ToolId> = {
  'desk-ws-sim': 'structure',
  'desk-ws-combo': 'structure',
  'desk-ws-grid': 'structure',
  'desk-ws-analyze': 'structure',
  'greeks-desk': 'structure',
  'greeks-sub-surface3d': 'structure',
  'greeks-mesh': 'structure',
  'desk-ws-combopnl': 'pnl',
  'desk-ws-optionpnl': 'pnl',
  'desk-ws-straddle': 'pnl',
  'desk-ws-breakeven': 'pnl',
  'desk-ws-subjective': 'pnl',
  'desk-ws-backtest': 'pnl',
  'desk-ws-hedge': 'risk',
  'desk-ws-dfollow': 'risk',
  'desk-ws-basis': 'risk',
  'desk-ws-roll': 'risk',
};

const TOOL_TO_SECTION: Record<ToolId, string> = {
  structure: 'trade-sub-structure',
  pnl: 'trade-sub-pnl',
  risk: 'trade-sub-risk',
};

/** 3 canonical Trade workflows — sole presentation shells. Engines live in src/lib/options. */
const TOOLS: { id: ToolId; label: string; blurb: string; mode: string }[] = [
  { id: 'structure', label: 'Structure', blurb: 'Legs · Greeks · leverage · sim (one engine)', mode: 'trade-sub-structure' },
  { id: 'pnl', label: 'PnL / Scenario', blurb: 'Historical PnL (observed history) + Scenario Monte Carlo', mode: 'trade-sub-pnl' },
  { id: 'risk', label: 'Hedge / Risk', blurb: 'Δ-hedge · basis · roll · Δ follower (shared risk engine)', mode: 'trade-sub-risk' },
];

const MODE_DEFAULT_TOOL: Record<string, ToolId> = {
  'trade-sub-structure': 'structure',
  'trade-sub-pnl': 'pnl',
  'trade-sub-risk': 'risk',
};

function toolsForMode(mode: string) {
  return TOOLS.filter((t) => t.mode === mode);
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
  const [tool, setTool] = useState<ToolId>('structure');

  useEffect(() => consumeDeskJumpOnMount(), []);

  // Canonical 3-workflow default; red-bar modes + legacy desk-ws-* redirects override via deskSectionId
  useEffect(() => {
    if (!deskSectionId) return;
    const mapped = SECTION_TO_TOOL[deskSectionId];
    if (mapped) {
      setTool(mapped);
      const meta = TOOLS.find((t) => t.id === mapped);
      setDeskContext({
        id: deskSectionId,
        label: meta?.label ?? mapped,
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
      const next = MODE_DEFAULT_TOOL[mode] ?? 'structure';
      setTool((prev) => (toolsForMode(mode).some((t) => t.id === prev) ? prev : next));
      const modeLabel = mode === 'trade-sub-pnl' ? 'PnL' : mode === 'trade-sub-risk' ? 'Hedge' : 'Structure';
      setDeskContext({ id: mode, label: modeLabel, apis: ['yfinance', 'FMP', 'Deribit'] });
    }
  }, [deskSectionId, setDeskContext]);

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

  if (!snapshot) {
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
            {tool === 'structure' && <StructureWorkflow />}
            {tool === 'pnl' && <PnlWorkflow />}
            {tool === 'risk' && <HedgeWorkflow />}
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </div>
  );
}
