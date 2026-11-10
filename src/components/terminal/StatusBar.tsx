import { useTerminalStore } from '../../store/terminalStore';
import { fmtTime, fmtPrice, fmtPct } from '../../lib/format';
import { FreshnessChip } from '../common/Freshness';
import {
  kindFromProvenance,
  type FreshnessKind,
} from '../../lib/data/freshness';

function ageLabel(ms: number): string {
  if (ms < 1000) return 'now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export function StatusBar() {
  const {
    symbol,
    snapshot,
    lastUpdate,
    lastSpotUpdate,
    lastChainUpdate,
    liveRFR,
    fmpQuote,
    chainUsed,
    spotSource,
    chainAvailable,
    chainAttempted,
    spotAttempted,
    loading,
    session,
    streamConnected,
    historyMode,
    historicalFrames,
    uiDensity,
    toggleUiDensity,
    provenance,
  } = useTerminalStore();

  const expiryCount = snapshot?.expiries.length ?? 0;
  const quoteCount =
    snapshot?.expiries.reduce((s, e) => s + e.calls.length + e.puts.length, 0) ?? 0;
  const fmpPrice = fmpQuote?.price;
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

  const chainLabel = !chainAvailable || chainUsed === 'none'
    ? 'chain:none'
    : `chain:${chainUsed}`;

  const spotMissing = spotSource === 'none';
  const chainMissing = !chainAvailable || chainUsed === 'none';
  // Unattempted reads as unknown ('—'), never API DOWN (same rule as header).
  // An in-flight first load is loading, not down.
  const spotTried =
    (spotAttempted || spotSource !== 'none' || lastSpotUpdate > 0) && !loading;
  const chainTried =
    (chainAttempted || chainUsed !== 'none' || lastChainUpdate > 0 || snapshot != null) &&
    !loading;
  const spotKind = kindFromProvenance(
    provenance.spot?.kind,
    provenance.spot?.asOfMs ?? (lastSpotUpdate > 0 ? lastSpotUpdate : null),
    'spot',
    { demo: false, down: spotMissing && spotTried, sourceKind: provenance.spot?.sourceKind },
  );
  const chainKind = kindFromProvenance(
    provenance.chain?.kind,
    provenance.chain?.asOfMs ?? (lastChainUpdate > 0 ? lastChainUpdate : null),
    'chain',
    { demo: false, down: chainMissing && chainTried, sourceKind: provenance.chain?.sourceKind },
  );

  const streamKind: FreshnessKind = streamConnected ? 'live' : 'unknown';

  return (
    <footer className="flex h-4 items-center justify-between border-t border-border bg-card px-1 text-type-2xs font-mono text-muted-foreground sm:px-1.5">
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden sm:gap-2.5">
        <span className="term-code shrink-0 text-type-2xs">VT</span>
        <span className="flex items-center gap-1" title="Spot freshness">
          <span className="text-type-2xs uppercase opacity-70">spot</span>
          <FreshnessChip kind={spotKind} />
        </span>
        <span className="flex items-center gap-1" title="Chain / surface freshness">
          <span className="text-type-2xs uppercase opacity-70">chain</span>
          <FreshnessChip kind={chainKind} />
        </span>
        <span className="text-muted-foreground/80">{sessionLabel}</span>
        {streamConnected && (
          <span className="flex items-center gap-1" title="SSE spot stream">
            <FreshnessChip kind={streamKind} />
            <span className="text-up">SSE</span>
          </span>
        )}
        <span>
          {symbol} · {expiryCount} expiries · {quoteCount} contracts
        </span>
        {(fmpPrice != null || snapshot?.spot != null) && (
          <span>spot:{fmtPrice(fmpPrice ?? snapshot?.spot)}</span>
        )}
        {liveRFR != null && <span>RFR:{fmtPct(liveRFR)}</span>}
        <span title="Data provenance — which API actually served the last load">
          {chainLabel}
          {spotSource === 'deribit'
            ? ' · spot:deribit'
            : spotSource === 'yfinance'
              ? ' · spot:yfinance'
              : spotSource === 'fmp'
                ? ' · spot:fmp'
                : ' · spot:synth'}
          {historyMode === 'live' ? ` · hist:buf:${historicalFrames.length}` : ' · hist:synth'}
        </span>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={toggleUiDensity}
          className="rounded px-1.5 py-0.5 text-type-2xs uppercase tracking-wider hover:bg-muted hover:text-foreground"
          title="Toggle dense / readable UI (D)"
        >
          {uiDensity === 'dense' ? 'dense' : 'read'}
        </button>
        <span title="Age of last surface update">
          chain {ageLabel(chainAge)}
          {lastSpotUpdate > 0 ? ` · spot ${ageLabel(now - lastSpotUpdate)}` : ''}
        </span>
        <span className="hidden sm:inline">Updated: {fmtTime(lastUpdate)}</span>
        <span className="hidden md:inline">1–7 · [ ] · R · S · D dens · ?</span>
      </div>
    </footer>
  );
}
