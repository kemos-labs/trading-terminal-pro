/**
 * Shared free-API desk strip — server board only (not per-visitor upstream burns).
 * Default = one compact line. Expand for full board (AV/TV/budgets/eco).
 * W5: denser black-field chrome + DeskSpark for daily path.
 */
import { useEffect, useState } from 'react';
import {
  fetchDeskPack,
  type DeskPack,
} from '../../lib/data/deskFeedsClient';
import { cn } from '../../lib/utils';
import { PrintStrip } from '../desk/PrintStrip';
import { DeskSpark } from '../desk/DeskSpark';
import { DESK_SERIES } from '../desk/seriesGrammar';

function fmtAge(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function BudgetChip({
  label,
  used,
  cap,
  warnAt = 0.8,
}: {
  label: string;
  used?: number;
  cap?: number;
  warnAt?: number;
}) {
  if (used == null || cap == null || cap <= 0) {
    return (
      <span className="rounded border border-border/60 px-1.5 py-0.5 text-type-2xs text-muted-foreground">
        {label}: —
      </span>
    );
  }
  const pct = used / cap;
  return (
    <span
      className={cn(
        'rounded border px-1.5 py-0.5 font-mono text-type-2xs tabular-nums',
        pct >= warnAt ? 'border-warn/50 text-warn' : 'border-border/60 text-muted-foreground',
      )}
      title={`${label} free-tier usage (shared server budget)`}
    >
      {label} {used}/{cap}
    </span>
  );
}

export function SharedDeskStrip({
  symbol = 'SPY',
  className,
}: {
  symbol?: string;
  className?: string;
}) {
  const [pack, setPack] = useState<DeskPack | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchDeskPack(symbol)
        .then((d) => {
          if (!cancelled) {
            setPack(d);
            setErr(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
        });
    };
    load();
    const id = window.setInterval(() => {
      if (document.hidden) return; // background-tab discipline
      load();
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbol]);

  const fh = pack?.finnhub_quote;
  const av = pack?.alphavantage_quote;
  const tv = pack?.tradingview;
  const ov = pack?.alphavantage_overview?.overview;
  const rv = pack?.derived?.realized_vol_20d_pct;
  const eco = (pack?.finnhub_economic_calendar?.events || []).slice(0, 4);
  const rec = pack?.finnhub_recommendation?.latest;
  const peers = pack?.finnhub_peers?.peers || [];
  const bars = pack?.alphavantage_daily?.bars || [];
  const lastBars = bars.slice(-16);
  const sparkCloses = lastBars.map((b) => b.close).filter((c): c is number => c != null && Number.isFinite(c));
  const budgets = pack?.budgets;

  const primary =
    fh?.price != null && fh.price > 0
      ? { price: fh.price, chg: fh.change_pct, src: 'Finnhub', age: fh.ageMs }
      : av?.price != null && av.price > 0
        ? { price: av.price, chg: av.change_pct, src: 'Alpha Vantage', age: av.ageMs }
        : tv?.price != null && tv.price > 0
          ? { price: tv.price, chg: tv.change_pct, src: 'TradingView', age: undefined }
          : null;

  return (
    <div
      data-testid="shared-desk-strip"
      className={cn(
        'rounded border border-border bg-black/40 px-2 py-1 font-mono',
        className,
      )}
    >
      <div className="flex flex-wrap items-end gap-x-2 gap-y-0.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-type-2xs font-bold tracking-wide text-amber-500/90 hover:border-amber-400"
          aria-expanded={open}
          title={open ? 'Collapse shared desk board' : 'Expand shared desk board'}
        >
          SHARED {open ? '▾' : '▸'}
        </button>
        <PrintStrip
          className="min-w-0 flex-1 border-0 bg-transparent p-0"
          items={[
            {
              label: symbol,
              value: primary ? primary.price.toFixed(2) : '—',
              title: primary?.src
                ? `${primary.src}${primary.age != null ? ` · ${fmtAge(primary.age)}` : ''} · server board`
                : 'server board',
            },
            ...(primary?.chg != null
              ? [
                  {
                    label: 'chg',
                    value: `${primary.chg >= 0 ? '+' : ''}${primary.chg.toFixed(2)}%`,
                    tone: (primary.chg >= 0 ? 'up' : 'down') as 'up' | 'down',
                  },
                ]
              : []),
            ...(primary?.src
              ? [
                  {
                    label: 'src',
                    value: `${primary.src}${primary.age != null ? ` · ${fmtAge(primary.age)}` : ''}`,
                    tone: 'muted' as const,
                  },
                ]
              : []),
          ]}
        />
        {sparkCloses.length >= 2 && (
          <DeskSpark
            values={sparkCloses}
            color={DESK_SERIES.long}
            width={72}
            height={16}
            title="AV daily closes"
          />
        )}
        <div className="flex flex-wrap gap-1">
          <BudgetChip
            label="AV"
            used={budgets?.alphavantage?.used}
            cap={budgets?.alphavantage?.capDaily}
          />
          <BudgetChip
            label="FH"
            used={budgets?.finnhub?.used}
            cap={budgets?.finnhub?.capDailySoft}
            warnAt={0.5}
          />
          <BudgetChip
            label="TV"
            used={budgets?.tradingview?.usedMonth}
            cap={budgets?.tradingview?.capMonthly}
          />
        </div>
      </div>

      {open && (
        <div className="mt-1.5 space-y-1.5 border-t border-border/50 pt-1.5">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <div className="rounded border border-border bg-black/50 px-2 py-1">
              <div className="text-type-2xs text-muted-foreground">Finnhub</div>
              <div className="text-sm font-semibold tabular-nums">
                {fh?.price != null ? fh.price.toFixed(2) : '—'}
              </div>
              <div className="text-type-2xs text-muted-foreground">
                {fh?.error ? String(fh.error).slice(0, 24) : fh?.fromCache ? 'cache' : 'live fill'}
              </div>
            </div>
            <div className="rounded border border-border bg-black/50 px-2 py-1">
              <div className="text-type-2xs text-muted-foreground">Alpha Vantage</div>
              <div className="text-sm font-semibold tabular-nums">
                {av?.price != null ? av.price.toFixed(2) : '—'}
              </div>
              <div className="text-type-2xs text-muted-foreground">
                {av?.latest_trading_day || (av?.error ? String(av.error).slice(0, 24) : '—')}
              </div>
            </div>
            <div className="rounded border border-border bg-black/50 px-2 py-1">
              <div className="text-type-2xs text-muted-foreground">TradingView</div>
              <div className="text-sm font-semibold tabular-nums">
                {tv?.price != null ? tv.price.toFixed(2) : '—'}
              </div>
              <div className="truncate text-type-2xs text-muted-foreground" title={tv?.note || ''}>
                {tv?.error ? 'no endpoint / budget' : tv?.source ? 'ok' : '—'}
              </div>
            </div>
            <div className="rounded border border-border bg-black/50 px-2 py-1">
              <div className="text-type-2xs text-muted-foreground">RV20</div>
              <div className="text-sm font-semibold tabular-nums">
                {rv != null ? `${rv.toFixed(1)}%` : '—'}
              </div>
              <div className="text-type-2xs text-muted-foreground">shared AV daily</div>
            </div>
          </div>

          {sparkCloses.length >= 2 && (
            <div className="flex items-center gap-2 px-0.5">
              <span className="text-type-2xs text-muted-foreground">AV path</span>
              <DeskSpark values={sparkCloses} color={DESK_SERIES.long} width={160} height={24} />
            </div>
          )}

          {(ov?.sector || ov?.beta != null || ov?.pe != null) && (
            <div className="flex flex-wrap gap-1.5 text-type-2xs text-muted-foreground">
              {ov?.name ? <span className="font-medium text-foreground/90">{ov.name}</span> : null}
              {ov?.sector ? <span>· {ov.sector}</span> : null}
              {ov?.beta != null ? <span>· β {ov.beta.toFixed(2)}</span> : null}
              {ov?.pe != null ? <span>· PE {ov.pe.toFixed(1)}</span> : null}
            </div>
          )}

          {(rec || peers.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 text-type-2xs text-muted-foreground">
              {rec ? (
                <span>
                  Street B/H/S {(rec.buy ?? 0) + (rec.strongBuy ?? 0)}/{rec.hold ?? 0}/
                  {(rec.sell ?? 0) + (rec.strongSell ?? 0)}
                </span>
              ) : null}
              {peers.length > 0 ? (
                <span className="max-w-full truncate">Peers {peers.slice(0, 6).join(' · ')}</span>
              ) : null}
            </div>
          )}

          {eco.length > 0 && (
            <ul className="space-y-0.5">
              {eco.map((e) => (
                <li key={e.id || `${e.event}-${e.time}`} className="truncate text-type-2xs text-foreground/85">
                  <span className="text-muted-foreground">{e.country || '—'} · </span>
                  {e.event}
                  {e.time ? <span className="text-muted-foreground"> · {e.time}</span> : null}
                </li>
              ))}
            </ul>
          )}

          {(err || pack?.note) && (
            <p className="text-type-2xs text-muted-foreground">{err || pack?.note}</p>
          )}
        </div>
      )}
    </div>
  );
}
