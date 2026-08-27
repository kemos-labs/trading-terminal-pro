import { useEffect, useMemo, useState } from 'react';
import { cn } from '../../../lib/utils';

export type CryptoWorkflow = 'overview' | 'volatility' | 'positioning' | 'flow' | 'carry' | 'trade-risk';

export const WORKFLOWS: { id: CryptoWorkflow; label: string; question: string }[] = [
  { id: 'overview', label: 'Overview', question: 'What regime is the market in?' },
  { id: 'volatility', label: 'Volatility', question: 'Where is volatility priced?' },
  { id: 'positioning', label: 'Positioning', question: 'Where are positions concentrated?' },
  { id: 'flow', label: 'Flow', question: 'What traded, on which side?' },
  { id: 'carry', label: 'Carry', question: 'What carry is embedded?' },
  { id: 'trade-risk', label: 'Trade & Risk', question: 'What does a position do?' },
];

function getWorkflowFromUrl(): CryptoWorkflow {
  const params = new URLSearchParams(window.location.search);
  const v = params.get('view') as CryptoWorkflow | null;
  if (v && WORKFLOWS.some(w => w.id === v)) return v;
  const legacy = params.get('page') || params.get('crypto') || params.get('view');
  if (legacy) {
    const map: Record<string, CryptoWorkflow> = {
      dashboard: 'overview', overview: 'overview',
      vol: 'volatility', volatility: 'volatility', skew: 'volatility',
      greek: 'positioning', heat: 'positioning', positioning: 'positioning', oi: 'positioning', levels: 'positioning',
      flow: 'flow',
      basis: 'carry', funding: 'carry', carry: 'carry', futures: 'carry',
      options: 'trade-risk', calculator: 'trade-risk', trade: 'trade-risk',
    };
    if (map[legacy]) return map[legacy];
  }
  return 'overview';
}

function setWorkflowInUrl(id: CryptoWorkflow) {
  const url = new URL(window.location.href);
  url.searchParams.set('desk', 'crypto');
  url.searchParams.set('view', id);
  // keep asset/venue etc
  window.history.pushState({}, '', url.toString());
}

export function CryptoShell() {
  const [workflow, setWorkflow] = useState<CryptoWorkflow>(() => getWorkflowFromUrl());
  const [asset] = useState(() => new URLSearchParams(window.location.search).get('asset') || 'BTC');
  const [venue] = useState(() => new URLSearchParams(window.location.search).get('venue') || 'deribit');

  useEffect(() => {
    const onPop = () => setWorkflow(getWorkflowFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const active = useMemo(() => WORKFLOWS.find(w => w.id === workflow)!, [workflow]);

  const handleSelect = (id: CryptoWorkflow) => {
    setWorkflow(id);
    setWorkflowInUrl(id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="crypto-v2-shell">
      {/* Global strip: asset/venue/freshness */}
      <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-card px-3 py-2" role="banner" aria-label="Market context">
        <span className="font-mono text-xs font-bold uppercase tracking-wider">VOLATERM</span>
        <span className="h-4 w-px bg-border" aria-hidden />
        <span className="font-mono text-xs">{asset} · {venue} · <span className="text-muted-foreground">live</span></span>
        <span className="ml-auto font-mono text-xs text-muted-foreground" aria-live="polite">Source: Deribit · {new Date().toISOString().slice(0,10)}</span>
      </div>

      {/* Workflow rail */}
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Crypto workflows">
        {WORKFLOWS.map(w => (
          <button
            key={w.id}
            role="tab"
            aria-selected={workflow === w.id}
            aria-controls={`panel-${w.id}`}
            onClick={() => handleSelect(w.id)}
            className={cn(
              'rounded px-3 py-1.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
              workflow === w.id ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
            )}
          >
            {w.label}
          </button>
        ))}
      </div>

      {/* Workflow panel */}
      <div
        id={`panel-${workflow}`}
        role="tabpanel"
        aria-label={active.label}
        className="flex-1 min-h-0 overflow-auto rounded border border-border bg-card p-4"
      >
        <h2 className="text-sm font-bold uppercase tracking-wider">{active.label}</h2>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{active.question}</p>
        <div className="mt-4 rounded border border-dashed border-border p-8 text-center font-mono text-xs text-muted-foreground">
          {workflow === 'overview' && 'Overview skeleton — regime strip, spot/forward, ATM/DVOL, funding/basis, coverage (coming Phase 7)'}
          {workflow === 'volatility' && 'Volatility workstation — term, skew, quote matrix (coming Phase 5)'}
          {workflow === 'positioning' && 'Positioning — OI, GEX/DEX, heatmap (coming Phase 6)'}
          {workflow === 'flow' && 'Flow — trades, taker side, premium matrix (coming Phase 6)'}
          {workflow === 'carry' && 'Carry — funding & basis (coming Phase 7)'}
          {workflow === 'trade-risk' && 'Trade & Risk — chain, strategy, P&L (coming Phase 7)'}
        </div>
        <div className="mt-4 flex gap-2 text-xs">
          <span className="rounded bg-muted px-2 py-1">Observed</span>
          <span className="rounded bg-muted px-2 py-1">Coverage 0%</span>
          <span className="rounded bg-muted px-2 py-1">Stale</span>
        </div>
      </div>
    </div>
  );
}
