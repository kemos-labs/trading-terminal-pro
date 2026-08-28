/**
 * Bottom control strip — display mode, expiries, sources, help.
 * Moved off the left rail to free horizontal space for desk content.
 */
import { useTerminalStore } from '../../store/terminalStore';
import { fmtPrice, fmtPct, fmtInt } from '../../lib/format';
import { cn } from '../../lib/utils';
import type { DisplayMode } from '../../lib/options/types';

export function SidePanel() {
  const {
    snapshot, selectedExpiry, setSelectedExpiry, displayMode, setDisplayMode,
    source, liveAvailable, chainMode, setChainMode, explainHovers, toggleExplainHovers,
    chainUsed, chainAvailable, spotSource,
  } = useTerminalStore();
  const spot = snapshot?.spot ?? 0;

  // Live = real option chain; Spot only = quote without surface; never Demo.
  const sourceLabel = chainAvailable ? 'Live' : liveAvailable ? 'Spot only' : 'Waiting';
  const sourceDotClass =
    sourceLabel === 'Live' ? 'bg-up' : sourceLabel === 'Spot only' ? 'bg-cyan' : 'bg-amber';

  const modes: { key: DisplayMode; label: string }[] = [
    { key: 'strike', label: 'Strike' },
    { key: 'moneyness', label: 'Mny' },
    { key: 'delta', label: 'Δ' },
  ];

  if (!snapshot) {
    return (
      <div
        className="flex h-6 shrink-0 items-center border-t border-border bg-card px-1.5"
        role="region"
        aria-label="Display and data sources"
      >
        <div className="font-mono text-type-2xs text-muted-foreground">Waiting for surface…</div>
      </div>
    );
  }

  const quoteCount = snapshot.expiries.reduce((s, e) => s + e.calls.length + e.puts.length, 0);

  return (
    <div
      className="flex shrink-0 flex-col border-t border-border bg-card px-1.5 py-0.5 font-mono"
      role="region"
      aria-label="Display and data sources"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {/* Display mode */}
        <div className="flex items-center gap-1">
          <span className="text-type-2xs uppercase tracking-wider text-muted-foreground">Display</span>
          <div className="flex gap-0.5">
            {modes.map((m) => (
              <button
                key={m.key}
                onClick={() => setDisplayMode(m.key)}
                className={cn(
                  'rounded px-1.5 py-0.5 text-type-xs',
                  displayMode === m.key
                    ? 'bg-secondary text-foreground ring-1 ring-border'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <span className="hidden h-3 w-px bg-border sm:block" aria-hidden />

        {/* Expiries — horizontal scroll chips */}
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <span className="shrink-0 text-type-2xs uppercase tracking-wider text-muted-foreground">Exp</span>
          <div className="flex max-w-full gap-0.5 overflow-x-auto scrollbar-none">
            {snapshot.expiries.map((slice) => (
              <button
                key={slice.expiry}
                onClick={() => setSelectedExpiry(slice.expiry)}
                title={`${slice.expiry} · ATM IV ${slice.atmIV > 0 ? fmtPct(slice.atmIV, 1) : '—'}`}
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-type-xs tabular-nums transition-colors',
                  selectedExpiry === slice.expiry
                    ? 'bg-secondary text-foreground ring-1 ring-border'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {slice.dte}d
                <span className="ml-0.5 opacity-70">{slice.expiry.slice(5)}</span>
                {slice.atmIV > 0 && (
                  <span className="ml-1 opacity-80">{fmtPct(slice.atmIV, 0)}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <span className="hidden h-3 w-px bg-border md:block" aria-hidden />

        {/* Snapshot metrics */}
        <div className="flex flex-wrap items-center gap-2 text-type-xs text-muted-foreground">
          <span>
            Spot <span className="tabular-nums text-foreground">{fmtPrice(spot)}</span>
          </span>
          <span>
            r <span className="tabular-nums">{fmtPct(snapshot.riskFreeRate)}</span>
          </span>
          <span>
            q <span className="tabular-nums">{fmtPct(snapshot.dividendYield)}</span>
          </span>
          {snapshot.expiries[0]?.forward != null && (
            <span title="Put–call parity implied forward">
              Fwd <span className="tabular-nums text-cyan">{fmtPrice(snapshot.expiries[0].forward)}</span>
            </span>
          )}
          <span className="tabular-nums">
            {snapshot.expiries.length}exp · {fmtInt(quoteCount)}q
          </span>
        </div>

        <span className="hidden h-3 w-px bg-border lg:block" aria-hidden />

        {/* Source / chain API */}
        <div className="flex flex-wrap items-center gap-1.5 text-type-xs">
          <span className="text-type-2xs uppercase tracking-wider text-muted-foreground">Source</span>
          <span className="flex items-center gap-1" data-testid="source-badge">
            <span className={cn('inline-block h-1.5 w-1.5 rounded-full', sourceDotClass)} />
            {sourceLabel}
          </span>
          {source === 'live' && (
            <>
              {(['auto', 'fmp', 'yfinance', 'deribit'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setChainMode(mode)}
                  title={
                    mode === 'auto'
                      ? 'Equities → yfinance, BTC/ETH → Deribit, FMP fallback'
                      : mode === 'fmp'
                        ? 'Financial Modeling Prep option chain'
                        : mode === 'yfinance'
                          ? 'Yahoo Finance via local Python proxy'
                          : 'BTC/ETH only — Deribit public options'
                  }
                  className={cn(
                    'rounded px-1.5 py-0.5 text-type-xs',
                    chainMode === mode
                      ? 'bg-secondary text-foreground ring-1 ring-border'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {mode === 'yfinance' ? 'yf' : mode}
                </button>
              ))}
              <span
                className="text-muted-foreground"
                data-testid="resolved-api"
                title="Resolved from the last successful fetch"
              >
                chain:
                <span className={cn('ml-0.5 tabular-nums', chainAvailable ? 'text-up' : 'text-warn')}>
                  {chainAvailable ? chainUsed : 'none'}
                </span>
                <span className="ml-1.5">spot:{spotSource}</span>
              </span>
            </>
          )}
        </div>

        {/* Help */}
        <button
          onClick={toggleExplainHovers}
          data-testid="toggle-hints"
          className={cn(
            'ml-auto shrink-0 rounded px-1.5 py-0.5 text-type-xs',
            explainHovers
              ? 'bg-secondary text-foreground ring-1 ring-border'
              : 'text-muted-foreground hover:text-foreground',
          )}
          title="Underlined labels show plain-English explanations on hover"
        >
          Hints {explainHovers ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  );
}
