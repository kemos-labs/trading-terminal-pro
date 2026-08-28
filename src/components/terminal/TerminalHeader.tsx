import { useCallback, useState, useEffect } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import { useAccountStore } from '../../store/accountStore';
import { fmtPrice, fmtClock, fmtTime, fmtPct } from '../../lib/format';
import { SymbolDialog } from './SymbolDialog';
import { BillingDialog } from './BillingDialog';
import { FreshnessChip } from '../common/Freshness';
import {
  kindFromProvenance,
  worstFreshnessKind,
  type FreshnessKind,
} from '../../lib/data/freshness';

function ageLabel(ms: number): string {
  if (ms < 1000) return 'now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/** BBG-style desk clocks — session awareness for global desks. */
function zoneClock(tz: string, at: number): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    }).format(at);
  } catch {
    return '--:--';
  }
}

interface TerminalHeaderProps {
  /** Open keyboard shortcuts overlay (same as ?). */
  onOpenShortcuts?: () => void;
}

/**
 * Single top chrome row: symbol + quote + former bottom StatusBar
 * (spot/chain STALE, session, SSE, contracts, dens, hotkeys).
 * Saves the full footer strip.
 */
export function TerminalHeader({ onOpenShortcuts }: TerminalHeaderProps) {
  const {
    symbol,
    snapshot,
    setSymbol,
    loading,
    fmpQuote,
    liveRFR,
    chainUsed,
    chainAvailable,
    spotSource,
    lastUpdate,
    lastSpotUpdate,
    lastChainUpdate,
    provenance,
    session,
    streamConnected,
    historyMode,
    historicalFrames,
    lastSurfacePath,
    uiDensity,
    toggleUiDensity,
  } = useTerminalStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const setBillingOpen = useAccountStore((s) => s.setBillingOpen);
  const user = useAccountStore((s) => s.user);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Real prints only — never seed a demo/preset spot into the header.
  const spot = fmpQuote?.price ?? (snapshot?.spot && snapshot.spot > 0 ? snapshot.spot : null);
  const atmIV = snapshot?.expiries[0]?.atmIV;

  const handleSymbolSelect = useCallback((sym: string) => {
    setSymbol(sym);
    setDialogOpen(false);
  }, [setSymbol]);

  const spotMissing = spotSource === 'none';
  const chainMissing = !chainAvailable || chainUsed === 'none';
  const spotKind = kindFromProvenance(
    provenance.spot?.kind,
    provenance.spot?.asOfMs ?? (lastSpotUpdate > 0 ? lastSpotUpdate : null),
    'spot',
    { demo: false, down: spotMissing },
  );
  const chainKind = kindFromProvenance(
    provenance.chain?.kind,
    provenance.chain?.asOfMs ?? (lastChainUpdate > 0 ? lastChainUpdate : null),
    'chain',
    { demo: false, down: chainMissing },
  );
  const summaryKind = worstFreshnessKind(spotKind, chainKind);
  const streamKind: FreshnessKind = streamConnected ? 'live' : 'unknown';
  const now = Date.now();
  const chainAge = lastChainUpdate > 0 ? now - lastChainUpdate : now - lastUpdate;

  const sessionLabel =
    session.phase === 'open'
      ? 'RTH'
      : session.phase === 'pre'
        ? 'PRE'
        : session.phase === 'after'
          ? 'AH'
          : session.phase === 'holiday'
            ? 'HOL'
            : 'CLOSED';

  const expiryCount = snapshot?.expiries.length ?? 0;
  const quoteCount =
    snapshot?.expiries.reduce((s, e) => s + e.calls.length + e.puts.length, 0) ?? 0;
  const chainLabel = !chainAvailable || chainUsed === 'none'
    ? 'chain:none'
    : `chain:${chainUsed}`;
  const fmpPrice = fmpQuote?.price;

  const spotAsOf = provenance.spot?.asOfMs ?? (lastSpotUpdate > 0 ? lastSpotUpdate : null);
  const chainAsOf = provenance.chain?.asOfMs ?? (lastChainUpdate > 0 ? lastChainUpdate : null);
  const asOfHint = [
    spotAsOf != null ? `spot ${new Date(spotAsOf).toLocaleTimeString()}` : null,
    chainAsOf != null ? `chain ${new Date(chainAsOf).toLocaleTimeString()}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const dataTitle = `Spot: ${spotKind} · Chain: ${chainKind}${asOfHint ? ` · as-of ${asOfHint}` : ''}`;

  return (
    <>
      <header className="flex h-6 shrink-0 items-center justify-between gap-1 border-b border-border bg-card px-1 text-type-2xs font-mono sm:px-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden sm:gap-1.5">
          <span className="term-code shrink-0 tracking-[0.12em]">VT</span>
          <button
            onClick={() => setDialogOpen(true)}
            className="flex items-center gap-0.5 border border-border bg-background px-1 py-0 font-semibold transition-colors hover:border-primary/50 hover:bg-secondary"
            title="Change security (S)"
          >
            <span className="text-primary tabular-nums text-type-xs">{symbol}</span>
            <span className="text-muted-foreground">▼</span>
          </button>
          <span className="tabular-nums text-type-xs font-semibold text-foreground">
            {spot != null ? fmtPrice(spot) : '—'}
          </span>
          {loading && <span className="text-muted-foreground" title="Refreshing">⟳</span>}
          {atmIV != null && (
            <span className="hidden text-muted-foreground sm:inline">
              IV <span className="text-cyan">{fmtPrice(atmIV * 100, 1)}%</span>
            </span>
          )}

          {/* Former StatusBar — feed health + book size */}
          <span className="flex shrink-0 items-center gap-1" title="Spot freshness">
            <span className="hidden text-type-2xs uppercase opacity-70 md:inline">spot</span>
            <FreshnessChip kind={spotKind} />
          </span>
          <span className="flex shrink-0 items-center gap-1" title="Chain / surface freshness">
            <span className="hidden text-type-2xs uppercase opacity-70 md:inline">chain</span>
            <FreshnessChip kind={chainKind} />
          </span>
          <span className="hidden text-muted-foreground/80 sm:inline">{sessionLabel}</span>
          {streamConnected && (
            <span className="flex items-center gap-0.5" title="SSE spot stream">
              <FreshnessChip kind={streamKind} />
              <span className="text-up">SSE</span>
            </span>
          )}
          <span className="hidden min-w-0 truncate text-muted-foreground lg:inline">
            {symbol} · {expiryCount}e · {quoteCount}c
          </span>
          {(fmpPrice != null || snapshot?.spot != null) && (
            <span className="hidden xl:inline">
              spot:{fmtPrice(fmpPrice ?? snapshot?.spot)}
            </span>
          )}
          {liveRFR != null && (
            <span className="hidden text-muted-foreground xl:inline">
              RFR:{fmtPct(liveRFR)}
            </span>
          )}
          <span
            className="hidden min-w-0 truncate text-muted-foreground 2xl:inline"
            title="Data provenance — which API actually served the last load"
          >
            {chainLabel}
            {spotSource === 'deribit'
              ? ' · spot:deribit'
              : spotSource === 'yfinance'
                ? ' · spot:yfinance'
                : spotSource === 'fmp'
                  ? ' · spot:fmp'
                  : ' · spot:synth'}
            {historyMode === 'live' ? ` · hist:buf:${historicalFrames.length}` : ' · hist:synth'}
            {lastSurfacePath
              ? ` · surf:${lastSurfacePath === 'sticky_spot' ? 'sticky' : 'chain'}`
              : ''}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          <button
            type="button"
            onClick={() => setBillingOpen(true)}
            className="rounded px-1 py-0 text-type-2xs uppercase tracking-wider text-muted-foreground hover:bg-muted hover:text-foreground"
            title={user ? `Signed in as ${user.email} — plans & billing` : 'Plans & billing'}
          >
            acct
          </button>
          <button
            type="button"
            onClick={toggleUiDensity}
            className="rounded px-1 py-0 text-type-2xs uppercase tracking-wider text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Toggle dense / readable UI (D)"
          >
            {uiDensity === 'dense' ? 'dens' : 'read'}
          </button>
          <span
            className="hidden text-muted-foreground md:inline"
            title="Age of last surface update"
          >
            chain {ageLabel(chainAge)}
            {lastSpotUpdate > 0 ? ` · spot ${ageLabel(now - lastSpotUpdate)}` : ''}
          </span>
          <span className="hidden tabular-nums text-muted-foreground lg:inline">
            {fmtTime(lastUpdate)}
          </span>
          {/* World clocks — NY / LDN / TYO */}
          <span
            className="hidden tabular-nums text-muted-foreground 2xl:inline"
            title="Desk clocks: New York · London · Tokyo"
          >
            NY {zoneClock('America/New_York', clock)}
            <span className="text-muted-foreground"> · </span>
            LDN {zoneClock('Europe/London', clock)}
            <span className="text-muted-foreground"> · </span>
            TYO {zoneClock('Asia/Tokyo', clock)}
          </span>
          <span className="hidden tabular-nums text-muted-foreground sm:inline">{fmtClock(clock)}</span>
          <span
            className="px-0.5 text-type-2xs uppercase tracking-wider text-muted-foreground/80"
            title="LIVE-only terminal — market feeds only; no demo mode."
            aria-label="LIVE-only terminal — market feeds only; no demo mode."
          >
            LIVE
          </span>
          <FreshnessChip
            kind={summaryKind}
            title={dataTitle}
            aria-label={`Data freshness: ${summaryKind}`}
          />
          <span className="hidden text-muted-foreground/70 xl:inline" title="Hotkeys">
            1–5 · [ ] · R · S · D · ?
          </span>
          <button
            onClick={() => useTerminalStore.getState().refresh()}
            className="text-muted-foreground hover:text-primary transition-colors"
            title="Refresh (R)"
          >
            ↻
          </button>
          <button
            onClick={() => onOpenShortcuts?.()}
            className="text-muted-foreground hover:text-primary transition-colors"
            title="Shortcuts (?)"
          >
            ?
          </button>
        </div>
      </header>
      {dialogOpen && <SymbolDialog onSelect={handleSymbolSelect} onClose={() => setDialogOpen(false)} />}
      <BillingDialog />
    </>
  );
}
