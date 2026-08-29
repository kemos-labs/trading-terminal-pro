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
      freeFallback: { available: boolean; provider: string; index?: number | null; venues?: string[]; asOf?: number | null };
    };
    ksa: { available: boolean; provider: string; tasi: number | null; tasiChangePct: number | null; delayed: boolean | null; asOf: string | null };
  };
  fromCache?: boolean;
  ageMs?: number;
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

/** Three-state feed health: live (green), degraded/delayed (amber), unavailable (red). */
type FeedState = 'live' | 'degraded' | 'unavailable';

const DOT: Record<FeedState, string> = {
  live: 'bg-up',
  degraded: 'bg-amber',
  unavailable: 'bg-down/70',
};

function DeskCell({
  label, provider, available, asOf, children, testId, degraded = false,
}: {
  label: string; provider: string; available: boolean; asOf: string | number | null; children: React.ReactNode; testId?: string; degraded?: boolean;
}) {
  const state: FeedState = available ? (degraded ? 'degraded' : 'live') : 'unavailable';
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
          <span className={state === 'degraded' ? 'text-amber' : undefined}>
            {state === 'live' ? provider : state === 'degraded' ? `${provider} · delayed` : 'unavailable'}
          </span>
          {asOfLabel && <span title="observation time">· {asOfLabel}</span>}
        </span>
      </header>
      <div className="min-w-0 flex-1 px-2 py-1.5 font-mono text-type-xs">{children}</div>
    </section>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: 'up' | 'down' }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-[1px]">
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

/** Signed-value tone: up green, down red, null neutral (never color-alone — sign is in the text). */
function signedTone(v: number | null | undefined): 'up' | 'down' | undefined {
  if (v == null || !Number.isFinite(v) || v === 0) return undefined;
  return v > 0 ? 'up' : 'down';
}

export function HomeBriefing() {
  const symbol = useTerminalStore((s) => s.symbol);
  const [state, setState] = useState<FetchState>({ data: null, error: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
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
        <DeskCell label="Volatility" provider={d?.equities.provider ?? '—'} available={!!d?.equities.available} asOf={d?.equities.asOf ?? null} testId="home-cell-vol">
          {d?.equities.available ? (
            <>
              <Row k={d.equities.symbol} v={fmtPrice(d.equities.price)} />
              <Row
                k="Δ day"
                v={d.equities.changePct != null ? `${d.equities.changePct >= 0 ? '+' : ''}${d.equities.changePct.toFixed(2)}%` : '—'}
                tone={signedTone(d.equities.changePct)}
              />
              <Row k="ATM IV" v="—" title-="opens with Vol desk" />
            </>
          ) : (
            <p className="text-muted-foreground" title={d?.equities.note ?? undefined}>
              Equity quote unavailable — Vol desk opens fail-closed.
            </p>
          )}
        </DeskCell>

        <DeskCell label="Positioning" provider="derivatives" available={!!d?.equities.available} asOf={d?.equities.asOf ?? null} testId="home-cell-positioning">
          {d?.equities.available ? (
            <p className="text-muted-foreground">
              GEX / DEX profiles build from the live chain — open Flow (POS).
            </p>
          ) : (
            <p className="text-muted-foreground">Needs a live option chain — unavailable now.</p>
          )}
        </DeskCell>

        <DeskCell label="Rates" provider={d?.rates.provider ?? '—'} available={!!d?.rates.available} asOf={d?.rates.asOf ?? null} testId="home-cell-rates">
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

        <DeskCell label="Crypto" provider={d?.crypto.provider ?? '—'} available={!!d?.crypto.available} asOf={d?.crypto.asOf ?? null} testId="home-cell-crypto">
          {d ? (
            <>
              <Row k="BTC index (Deribit)" v={fmtPrice(d.crypto.indexPrice, 1)} />
              <Row k="Perp funding 8h" v={fmtFunding8h(d.crypto.funding8h)} />
              <Row k="Options listed" v={d.crypto.optionCount != null ? String(d.crypto.optionCount) : '—'} />
              <div className="mt-1 border-t border-border/50 pt-1 text-type-2xs text-muted-foreground">
                {d.crypto.freeFallback.available
                  ? <span>Free fallback: {d.crypto.freeFallback.provider} · {fmtPrice(d.crypto.freeFallback.index ?? null, 1)}</span>
                  : <span className="text-muted-foreground/70">Free fallback: unavailable</span>}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">…</p>
          )}
        </DeskCell>
      </div>

      {/* KSA + launcher row */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-3">
        <DeskCell label="KSA (Tadawul)" provider={d?.ksa.provider ?? '—'} available={!!d?.ksa.available} degraded={!!d?.ksa.available} asOf={d?.ksa.asOf ?? null} testId="home-cell-ksa">
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
    </div>
  );
}
