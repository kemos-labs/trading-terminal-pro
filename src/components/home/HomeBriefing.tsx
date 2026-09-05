import { useEffect, useState } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import { LAUNCHPAD_CODES, openFunction, resolveFunctionId } from '../../config/functionRegistry';
import { cn } from '../../lib/utils';

/**
 * Home — morning briefing + function launcher (Phase 2).
 * One canonical snapshot from /api/home/briefing (shared server cache; no
 * per-widget upstream polling). Missing providers render honest unavailable
 * states — never synthetic values, never zeros.
 */

interface Briefing {
  schemaVersion: number;
  symbol: string;
  asOf: string;
  sources: string[];
  desks: {
    equities: { available: boolean; provider: string; symbol: string; price: number | null; changePct: number | null; asOf: string | null; note: string | null };
    rates: { available: boolean; provider: string; sofr: number | null; effr: number | null; usy2: number | null; usy10: number | null; spread_2s10s_bps: number | null; asOf: string | null };
    crypto: {
      available: boolean; provider: string; indexPrice: number | null; funding8h: number | null; optionCount: number | null; asOf: number | null;
      freeFallback: { available: boolean; provider: string; venues?: { venue: string; mark: number | null; index: number | null; last: number | null }[]; asOf?: number | null };
    };
    ksa: { available: boolean; provider: string; tasi: number | null; tasiChangePct: number | null; delayed: boolean | null; asOf: string | null };
  };
  fromCache?: boolean;
  ageMs?: number;
  stale?: boolean;
  /** Server-derived aggregate — the single truthful derivation. Display only, never recompute client-side. */
  freshness?: { live: boolean; state: 'live' | 'partial' | 'stale' | 'unavailable' };
  cacheStatus?: { entries?: number | null; budgets?: Record<string, unknown> | null };
}

type FetchState = { data: Briefing | null; error: string | null; loading: boolean };

function fmtPrice(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '' : ''}${v.toFixed(digits)}%`;
}

function fmtBps(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(0)}bp`;
}

function fmtFunding8h(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(4)}% / 8h`;
}

function sessionNow(): string {
  const d = new Date();
  const h = d.getUTCHours();
  // NY session 13:30–20:00 UTC (approx, DST slop tolerated — this is chrome, not data)
  if (h >= 13 && h < 20) return 'US session';
  if (h >= 7 && h < 16) return 'EU session';
  if (h >= 0 && h < 9) return 'Asia session';
  return 'Off-hours';
}

/** Three-state feed health: live (green), degraded/delayed/stale (amber), unavailable (red). */
type FeedState = 'live' | 'degraded' | 'stale' | 'unavailable';

const DOT: Record<FeedState, string> = {
  live: 'bg-up',
  degraded: 'bg-amber',
  stale: 'bg-amber',
  unavailable: 'bg-down/70',
};

function DeskCell({
  label, provider, available, asOf, children, testId, degraded = false, degradedNote = 'delayed', stale = false,
}: {
  label: string; provider: string; available: boolean; asOf: string | number | null; children: React.ReactNode; testId?: string; degraded?: boolean; degradedNote?: string; stale?: boolean;
}) {
  const state: FeedState = !available ? 'unavailable' : stale ? 'stale' : degraded ? 'degraded' : 'live';
  const asOfLabel = asOf != null
    ? new Date(typeof asOf === 'number' ? asOf : asOf).toISOString().slice(11, 19) + 'Z'
    : null;
  return (
    <section
      data-testid={testId}
      className="flex min-h-0 min-w-0 flex-col rounded border border-border bg-black/40"
      aria-label={label}
    >
      <header className="flex items-center justify-between border-b border-border/60 px-2 py-1 font-mono text-type-2xs">
        <span className="font-bold tracking-wider text-foreground">{label}</span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className={cn('h-1.5 w-1.5 rounded-full', DOT[state])} aria-hidden />
          <span className={state === 'degraded' || state === 'stale' ? 'text-amber' : undefined}>
            {state === 'live' ? provider : state === 'degraded' ? `${provider} · ${degradedNote}` : state === 'stale' ? `${provider} · stale` : 'unavailable'}
          </span>
          {asOfLabel && <span title="observation time">· {asOfLabel}</span>}
        </span>
      </header>
      <div className="min-w-0 flex-1 px-2 py-1.5 font-mono text-type-xs">{children}</div>
    </section>
  );
}

function Row({ k, v, tone, title }: { k: string; v: string; tone?: 'up' | 'down'; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-[1px]" title={title}>
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span
        className={cn(
          'truncate tabular-nums text-foreground',
          tone === 'up' && 'text-up',
          tone === 'down' && 'text-down',
        )}
      >
        {v}
      </span>
    </div>
  );
}

/** Signed-value tone: up green, down red, null neutral (never color-alone — sign is in the text). */function signedTone(v: number | null | undefined): 'up' | 'down' | undefined {
  if (v == null || !Number.isFinite(v) || v === 0) return undefined;
  return v > 0 ? 'up' : 'down';
}

/** Full UTC timestamp for the ledger; null stays an honest dash. */
function fmtEventTime(v: string | number | null | undefined): string {
  if (v == null) return '—';
  const ms = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

/** Snapshot age from an event time against the client clock (labelled, approximate). */
function fmtAge(v: string | number | null | undefined, nowMs: number): string {
  if (v == null) return '—';
  const ms = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (s < 90) return `${s}s`;
  if (s < 90 * 60) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

// Event-age stale rule: an available feed whose observation is older than
// four days is labelled stale, never live — even daily FRED lags never
// legitimately exceed this (a Friday print read on Tuesday is 96h and is
// genuinely the latest available, so the bound is inclusive). Desk cells
// and the freshness ledger share this single derivation.
const STALE_AFTER_MS = 96 * 3600_000;
type LedgerState = 'live' | 'delayed' | 'partial' | 'stale' | 'unavailable';
function deskEventMs(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const ms = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}
function deskState(available: boolean, event: string | number | null | undefined, fresh: LedgerState, nowMs: number): LedgerState {
  if (!available) return 'unavailable';
  const ms = deskEventMs(event);
  if (ms != null && nowMs - ms > STALE_AFTER_MS) return 'stale';
  return fresh;
}

export function HomeBriefing() {
  const symbol = useTerminalStore((s) => s.symbol);
  // Terminal live-chain state, for agreement with the briefing snapshot:
  // the Vol/Positioning desks consume the client chain, not this snapshot.
  const chainAvailable = useTerminalStore((s) => s.chainAvailable);
  const chainAttempted = useTerminalStore((s) => s.chainAttempted);
  const chainUsed = useTerminalStore((s) => s.chainUsed);
  const [state, setState] = useState<FetchState>({ data: null, error: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    // route-parity: GET /api/home/briefing
    fetch(`/api/home/briefing?symbol=${encodeURIComponent(symbol)}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok || !body || body.error) throw new Error(body?.detail ?? body?.error ?? `HTTP ${r.status}`);
        return body as Briefing;
      })
      .then((data) => { if (!cancelled) setState({ data, error: null, loading: false }); })
      .catch((e: Error) => { if (!cancelled) setState({ data: null, error: e.message, loading: false }); });
    return () => { cancelled = true; };
  }, [symbol]);

  const b = state.data;
  const d = b?.desks;

  // Aggregate Feeds chip — displayed from the server derivation only.
  // Partial is never labelled Live or OK; stale is never Live.
  const aggState = b?.stale ? 'stale' : (b?.freshness?.state ?? null);
  const aggLabel =
    aggState === 'live' ? 'Live' :
    aggState === 'partial' ? 'Partial' :
    aggState === 'stale' ? 'Stale' :
    aggState === 'unavailable' ? 'Unavailable' : null;
  const aggTone =
    aggState === 'live' ? 'bg-up' :
    aggState === 'partial' || aggState === 'stale' ? 'bg-amber' : 'bg-down/70';

  // Agreement between the briefing snapshot (server) and the terminal live
  // chain (client, consumed by Vol/Positioning): surface disagreement instead
  // of letting two badges contradict each other. Unattempted chain has no
  // verdict — only a known-down chain disagrees.
  const chainKnownDown = chainAttempted && !chainAvailable;
  const chainKnownUp = chainAvailable && chainUsed !== 'none';
  const eqSnapshotOk = !!d?.equities.available;
  const chainDisagreeDown = eqSnapshotOk && chainKnownDown;
  const chainDisagreeUp = !eqSnapshotOk && chainKnownUp;

  // Cell headers share the ledger's stale derivation: an available feed with
  // a four-day-old observation reads stale in the header too, never live.
  const nowMs = Date.now();
  const eqStale = deskState(!!d?.equities.available, d?.equities.asOf, 'live', nowMs) === 'stale';
  const ratesStale = deskState(!!d?.rates.available, d?.rates.asOf, 'live', nowMs) === 'stale';
  const cryptoShownStale = d?.crypto.available
    ? deskState(true, d.crypto.asOf, 'live', nowMs) === 'stale'
    : deskState(!!d?.crypto.freeFallback.available, d?.crypto.freeFallback.asOf, 'live', nowMs) === 'stale';
  const ksaStale = deskState(!!d?.ksa.available, d?.ksa.asOf, 'delayed', nowMs) === 'stale';

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-3" data-testid="home-briefing">
      {/* Compact header: title + session + freshness */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h1 className="font-mono text-sm font-bold uppercase tracking-wider text-foreground">
          Morning Brief
        </h1>
        <p className="font-mono text-type-2xs text-muted-foreground">
          {sessionNow()} · {b ? `${b.fromCache ? 'cache' : 'fresh'} ${b.ageMs != null ? `(${Math.round(b.ageMs / 1000)}s)` : ''} · ${b.asOf.slice(11, 19)}Z` : 'loading…'} ·
          {' '}one shared snapshot, no per-widget polling
        </p>
      </div>

      {/* Provider / quota health strip */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 pb-1.5 font-mono text-type-2xs text-muted-foreground" data-testid="home-provider-strip">
        <span className="font-bold uppercase tracking-wider text-foreground/80">Feeds</span>
        {aggLabel ? (
          <span
            className="flex items-center gap-1 font-bold uppercase tracking-wider text-foreground"
            data-testid="home-feeds-aggregate"
            title={`Server aggregate${b?.stale ? ' (stale snapshot)' : ''}: ${b?.sources?.length ?? 0} sources · fetch age ${b?.ageMs != null ? `${Math.round(b.ageMs / 1000)}s` : '—'}`}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', aggTone)} aria-hidden />
            {aggLabel}
          </span>
        ) : null}
        {d ? (
          <>
            <span className="flex items-center gap-1">
              <span className={cn('h-1.5 w-1.5 rounded-full', d.equities.available ? 'bg-up' : 'bg-down/70')} aria-hidden />
              Equities {d.equities.available ? 'ok' : 'unavailable'}
            </span>
            <span className="flex items-center gap-1">
              <span className={cn('h-1.5 w-1.5 rounded-full', d.rates.available ? 'bg-up' : 'bg-down/70')} aria-hidden />
              Rates {d.rates.available ? 'ok' : 'unavailable'}
            </span>
            <span className="flex items-center gap-1">
              <span className={cn('h-1.5 w-1.5 rounded-full', d.crypto.available ? 'bg-up' : 'bg-amber')} aria-hidden />
              Crypto {d.crypto.available ? 'ok' : d.crypto.freeFallback.available ? 'free fallback' : 'unavailable'}
            </span>
            <span className="flex items-center gap-1">
              <span className={cn('h-1.5 w-1.5 rounded-full', d.ksa.available ? 'bg-amber' : 'bg-down/70')} aria-hidden />
              KSA {d.ksa.available ? 'delayed' : 'unavailable'}
            </span>
            <span className="ml-auto">{b?.sources?.length ? `sources: ${b.sources.join(' · ')}` : 'sources: —'}</span>
          </>
        ) : (
          <span className="animate-pulse">{state.error ? `briefing unavailable: ${state.error}` : 'checking feeds…'}</span>
        )}
      </div>

      {/* Desk snapshot grid */}
      <div className="grid min-h-0 grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
        <DeskCell label="Volatility" provider={d?.equities.provider ?? '—'} available={!!d?.equities.available} stale={eqStale} asOf={d?.equities.asOf ?? null} testId="home-cell-vol">
          {d?.equities.available ? (
            <>
              <Row k={d.equities.symbol} v={fmtPrice(d.equities.price)} />
              <Row
                k="Δ day"
                v={d.equities.changePct != null ? `${d.equities.changePct >= 0 ? '+' : ''}${d.equities.changePct.toFixed(2)}%` : '—'}
                tone={signedTone(d.equities.changePct)}
              />
              <Row k="ATM IV" v="—" title="opens with Vol desk" />
              {chainDisagreeDown ? (
                <p className="pt-1 text-amber" data-testid="home-chain-disagree">
                  Snapshot fresh · terminal chain down — Vol desk opens fail-closed.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-muted-foreground" title={d?.equities.note ?? undefined}>
                Equity quote unavailable — Vol desk opens fail-closed.
              </p>
              {chainDisagreeUp ? (
                <p className="pt-1 text-amber" data-testid="home-chain-disagree">
                  Snapshot unavailable · terminal chain live — desk may still open.
                </p>
              ) : null}
            </>
          )}
        </DeskCell>

        <DeskCell label="Positioning" provider="derivatives" available={!!d?.equities.available} stale={eqStale} asOf={d?.equities.asOf ?? null} testId="home-cell-positioning">
          {d?.equities.available ? (
            <>
              <p className="text-muted-foreground">
                GEX / DEX profiles build from the live chain — open Flow (POS).
              </p>
              {chainDisagreeDown ? (
                <p className="pt-1 text-amber" data-testid="home-chain-disagree-pos">
                  Snapshot fresh · terminal chain down — profiles unavailable now.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground">Needs a live option chain — unavailable now.</p>
          )}
        </DeskCell>

        <DeskCell label="Rates" provider={d?.rates.provider ?? '—'} available={!!d?.rates.available} stale={ratesStale} asOf={d?.rates.asOf ?? null} testId="home-cell-rates">
          {d?.rates.available ? (
            <>
              <Row k="SOFR" v={fmtPct(d.rates.sofr)} />
              <Row k="EFFR" v={fmtPct(d.rates.effr)} />
              <Row k="UST 2Y" v={fmtPct(d.rates.usy2)} />
              <Row k="UST 10Y" v={fmtPct(d.rates.usy10)} />
              <Row k="2s10s" v={fmtBps(d.rates.spread_2s10s_bps)} />
            </>
          ) : (
            <p className="text-muted-foreground">FRED rates worker unreachable — values stay unavailable.</p>
          )}
        </DeskCell>

        <DeskCell
          label="Crypto"
          provider={d?.crypto.available ? (d?.crypto.provider ?? '—') : (d?.crypto.freeFallback.available ? `${d.crypto.freeFallback.provider} (free)` : (d?.crypto.provider ?? '—'))}
          available={!!d?.crypto.available || !!d?.crypto.freeFallback.available}
          degraded={!d?.crypto.available && !!d?.crypto.freeFallback.available}
          degradedNote="free fallback"
          stale={cryptoShownStale}
          asOf={d?.crypto.available ? (d?.crypto.asOf ?? null) : (d?.crypto.freeFallback.asOf ?? null)}
          testId="home-cell-crypto"
        >
          {d ? (
            <>
              <Row k="BTC index (Deribit)" v={fmtPrice(d.crypto.indexPrice, 1)} />
              <Row k="Perp funding 8h" v={fmtFunding8h(d.crypto.funding8h)} />
              <Row k="Options listed" v={d.crypto.optionCount != null ? String(d.crypto.optionCount) : '—'} />
              <div className="mt-1 border-t border-border/50 pt-1 text-type-2xs text-muted-foreground">
                {d.crypto.freeFallback.available
                  ? <span>Free fallback: {d.crypto.freeFallback.provider} · {(d.crypto.freeFallback.venues ?? []).map((v) => `${v.venue}: ${fmtPrice(v.mark ?? v.index ?? v.last, 1)}`).join(' · ') || 'observed prices unavailable'}</span>
                  : <span className="text-muted-foreground/70">Free fallback: unavailable</span>}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">…</p>
          )}
        </DeskCell>
      </div>

      {/* KSA + launcher row — content-sized: stretched launcher cells were
          the desktop dead space. The freshness ledger below fills the
          remaining viewport with real provenance instead. */}
      <div className="grid min-h-0 grid-cols-1 gap-2 lg:grid-cols-3">
        <DeskCell label="KSA (Tadawul)" provider={d?.ksa.provider ?? '—'} available={!!d?.ksa.available} degraded={!!d?.ksa.available && !ksaStale} stale={ksaStale} asOf={d?.ksa.asOf ?? null} testId="home-cell-ksa">
          {d?.ksa.available ? (
            <>
              <Row k="TASI" v={fmtPrice(d.ksa.tasi, 2)} />
              <Row
                k="Δ day"
                v={d.ksa.tasiChangePct != null ? `${d.ksa.tasiChangePct >= 0 ? '+' : ''}${d.ksa.tasiChangePct.toFixed(2)}%` : '—'}
                tone={signedTone(d.ksa.tasiChangePct)}
              />
              <Row k="Basis" v={d.ksa.delayed ? '15m delayed (per provider)' : 'real-time'} />
            </>
          ) : (
            <p className="text-muted-foreground">Board unavailable or off-session — no proxy values.</p>
          )}
        </DeskCell>

        <div className="lg:col-span-2" data-testid="launchpad-grid">
          <div className="flex h-full flex-col rounded border border-border bg-black/40">
            <div className="flex items-center justify-between border-b border-border/60 px-2 py-0.5 font-mono text-type-2xs">
              <span>
                <span className="font-bold tracking-wider text-amber-500/90">LPAD</span>
                <span className="ml-1.5 text-muted-foreground">function codes</span>
              </span>
              <span className="text-muted-foreground">Ctrl/Cmd+K</span>
            </div>
            <div className="grid flex-1 auto-rows-fr grid-cols-3 gap-px bg-border/80 p-px sm:grid-cols-4 md:grid-cols-7">
              {LAUNCHPAD_CODES.map((code) => {
                const desc = resolveFunctionId(code);
                if (!desc) return null;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => openFunction(code)}
                    title={desc.label}
                    className="bg-black/60 px-1.5 py-1 text-left font-mono transition-colors hover:bg-secondary/80"
                  >
                    <div className="text-type-xs font-semibold tracking-wide text-foreground">{code}</div>
                    <div className="truncate text-type-2xs text-muted-foreground">{desc.label}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Freshness ledger — per-desk provenance from the already-fetched
          snapshot (zero new requests). Fills the desktop viewport with real
          event times and ages instead of dead space. */}
      <FreshnessLedger briefing={b} loading={state.loading} error={state.error} />
    </div>
  );
}

const LEDGER_DOT: Record<LedgerState, string> = {
  live: 'bg-up',
  delayed: 'bg-amber',
  partial: 'bg-amber',
  stale: 'bg-amber',
  unavailable: 'bg-down/70',
};

function FreshnessLedger({
  briefing, loading, error,
}: {
  briefing: Briefing | null;
  loading: boolean;
  error: string | null;
}) {
  const nowMs = Date.now();
  const d = briefing?.desks;
  const agg: LedgerState =
    briefing?.stale ? 'stale' : ((briefing?.freshness?.state ?? 'unavailable') as LedgerState);
  const rows: { desk: string; provider: string; event: string | number | null; state: LedgerState }[] = d
    ? [
        {
          desk: 'Snapshot',
          provider: briefing?.sources?.length ? `${briefing.sources.length} sources` : 'no sources',
          event: briefing?.asOf ?? null,
          state: agg,
        },
        { desk: 'Equities', provider: d.equities.provider, event: d.equities.asOf, state: deskState(d.equities.available, d.equities.asOf, 'live', nowMs) },
        { desk: 'Rates', provider: d.rates.provider, event: d.rates.asOf, state: deskState(d.rates.available, d.rates.asOf, 'live', nowMs) },
        { desk: 'Crypto (Deribit)', provider: d.crypto.provider, event: d.crypto.asOf, state: deskState(d.crypto.available, d.crypto.asOf, 'live', nowMs) },
        {
          desk: 'Crypto (free)',
          provider: d.crypto.freeFallback.provider,
          event: d.crypto.freeFallback.asOf ?? null,
          state: deskState(d.crypto.freeFallback.available, d.crypto.freeFallback.asOf, 'live', nowMs),
        },
        { desk: 'KSA', provider: d.ksa.provider, event: d.ksa.asOf, state: deskState(d.ksa.available, d.ksa.asOf, 'delayed', nowMs) },
      ]
    : [];
  return (
    <section
      data-testid="home-freshness-ledger"
      aria-label="Freshness ledger"
      className="rounded border border-border bg-black/40"
    >
      <header className="flex items-center justify-between border-b border-border/60 px-2 py-1 font-mono text-type-2xs">
        <span className="font-bold uppercase tracking-wider text-foreground/80">Freshness ledger</span>
        <span className="text-muted-foreground" title="Event time is the provider observation time, not fetch completion">
          event time · age vs now (approx)
        </span>
      </header>
      {d ? (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Freshness ledger rows">
          <table className="w-full font-mono text-type-2xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-2 py-1 font-normal">Desk</th>
                <th className="px-2 py-1 font-normal">Provider</th>
                <th className="px-2 py-1 font-normal">Event time (UTC)</th>
                <th className="px-2 py-1 font-normal">Age</th>
                <th className="px-2 py-1 font-normal">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.desk} className="border-t border-border/40">
                  <td className="px-2 py-1 text-foreground">{r.desk}</td>
                  <td className="px-2 py-1 text-muted-foreground">{r.provider}</td>
                  <td className="px-2 py-1 tabular-nums text-muted-foreground">{fmtEventTime(r.event)}</td>
                  <td className="px-2 py-1 tabular-nums text-muted-foreground">{fmtAge(r.event, nowMs)}</td>
                  <td className="px-2 py-1">
                    <span className="flex items-center gap-1.5 uppercase tracking-wider">
                      <span className={cn('h-1.5 w-1.5 rounded-full', LEDGER_DOT[r.state])} aria-hidden />
                      {r.state}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-2 py-1.5 font-mono text-type-2xs text-muted-foreground">
          {error ? `ledger unavailable: ${error}` : loading ? 'loading ledger…' : 'ledger unavailable — no snapshot'}
        </p>
      )}
    </section>
  );
}
