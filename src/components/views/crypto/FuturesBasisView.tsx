/**
 * Futures desk — "Basis: Current Snapshot".
 * All Deribit BTC/ETH dated futures + perpetuals vs the currency index:
 * premium ($ / %), simple-annualized APR, 24h change/volume, USD OI.
 * Live public data via /api/deribit-market/* — missing values render "—".
 */
import { useEffect, useMemo, useState } from 'react';
import { useTerminalStore } from '../../../store/terminalStore';
import { useDeribitFutures } from '../../../hooks/useDeribitFutures';
import {
  filterEndOfMonthExpiries,
  type BasisRow,
} from '../../../lib/data/futuresMath';
import { fmtCompact, fmtPrice } from '../../../lib/format';
import { cn } from '../../../lib/utils';
import { CryptoPageHeader } from './CryptoPageHeader';
import { Panel } from '../../terminal/Panel';
import { EmptyState } from '../../common/EmptyState';

type Metric = 'premium' | 'apr';
type SortKey =
  | 'instrument'
  | 'kind'
  | 'mark'
  | 'indexPrice'
  | 'premiumUsd'
  | 'premiumPct'
  | 'aprPct'
  | 'change24hPct'
  | 'volumeBase'
  | 'openInterestUsd';
type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'instrument', label: 'Instrument', align: 'left' },
  { key: 'kind', label: 'Kind', align: 'left' },
  { key: 'mark', label: 'Mark', align: 'right' },
  { key: 'indexPrice', label: 'Index', align: 'right' },
  { key: 'premiumUsd', label: '$ Prem', align: 'right' },
  { key: 'premiumPct', label: '% Prem', align: 'right' },
  { key: 'aprPct', label: 'APR %', align: 'right' },
  { key: 'change24hPct', label: '24h Chg', align: 'right' },
  { key: 'volumeBase', label: '24h Vol', align: 'right' },
  { key: 'openInterestUsd', label: '$ OI', align: 'right' },
];

/** Sign coloring per reference DNA: positive teal, negative red, none muted. */
function signClass(v: number | null): string {
  if (v == null) return 'text-[#8b999f]';
  if (v > 0) return 'text-[#25d7c5]';
  if (v < 0) return 'text-[#e25c5c]';
  return 'text-[#a6b0b4]';
}

function fmtSigned(v: number | null, dp = 2, suffix = ''): string {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(dp)}${suffix}`;
}

function fmtMark(v: number | null): string {
  if (v == null) return '—';
  return fmtPrice(v, Math.abs(v) >= 1000 ? 1 : 2);
}

function cellValue(row: BasisRow, key: SortKey): number | string | null {
  switch (key) {
    case 'instrument':
      return row.instrument;
    case 'kind':
      return row.kind;
    case 'mark':
      return row.mark;
    case 'indexPrice':
      return row.indexPrice;
    case 'premiumUsd':
      return row.premiumUsd;
    case 'premiumPct':
      return row.premiumPct;
    case 'aprPct':
      return row.aprPct;
    case 'change24hPct':
      return row.change24hPct;
    case 'volumeBase':
      return row.volumeBase;
    case 'openInterestUsd':
      return row.openInterestUsd;
  }
}

export function FuturesBasisView({ asset }: { asset?: 'BTC' | 'ETH' }) {
  const symbol = useTerminalStore((s) => s.symbol);
  const currency: 'BTC' | 'ETH' = asset ?? (symbol === 'ETH' ? 'ETH' : 'BTC');
  const { loading, error, stale, indexPrice, rows, asOf, refresh } = useDeribitFutures(currency);

  const [metric, setMetric] = useState<Metric>('premium');
  const [eomOnly, setEomOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('instrument');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Reset sorting when the asset flips (different tenor sets).
  useEffect(() => {
    setSortKey('instrument');
    setSortDir('asc');
  }, [currency]);

  // EOM universe keeps only month-end expiries (dated rows); perp stays visible
  // in the default "all" universe where it belongs.
  const universeRows = useMemo(
    () => (eomOnly ? filterEndOfMonthExpiries(rows) : rows),
    [rows, eomOnly],
  );

  const sortedRows = useMemo(() => {
    const dirMul = sortDir === 'asc' ? 1 : -1;
    return [...universeRows].sort((a, b) => {
      const va = cellValue(a, sortKey);
      const vb = cellValue(b, sortKey);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // missing values always sink regardless of dir
      if (vb == null) return -1;
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va).localeCompare(String(vb)) * dirMul;
      }
      return (va - vb) * dirMul;
    });
  }, [universeRows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'instrument' || key === 'kind' ? 'asc' : 'desc');
    }
  };

  const summary = useMemo(() => {
    const dated = rows.filter((r) => r.kind === 'FUTURE');
    const perp = rows.find((r) => r.kind === 'PERPETUAL') ?? null;
    const frontApr = dated.find((r) => r.aprPct != null)?.aprPct ?? null;
    const maxAbsPrem = dated.reduce<number | null>(
      (best, r) => (r.premiumPct != null && (best == null || Math.abs(r.premiumPct) > Math.abs(best)) ? r.premiumPct : best),
      null,
    );
    const vol = rows.reduce((s, r) => s + (r.volumeBase ?? 0), 0);
    const oi = rows.reduce((s, r) => s + (r.openInterestUsd ?? 0), 0);
    return {
      frontApr,
      maxAbsPrem,
      perpFundingAnn: perp?.fundingAnnualizedPct ?? null,
      perpFunding8h: perp?.funding8h ?? null,
      vol,
      oi,
      count: rows.length,
    };
  }, [rows]);

  const asOfLabel = asOf
    ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false }).format(new Date(asOf))
    : '—';

  if ((loading && rows.length === 0) || (!loading && error && rows.length === 0)) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#030506]">
        <CryptoPageHeader
          title="Basis"
          highlight="Current Snapshot"
          description={`${currency} futures basis vs Deribit index · premium $/%, annualized APR, flow and open interest · live public Deribit data`}
        />
        <Panel title="Basis Snapshot" className="m-2 flex-1">
          <EmptyState
            kind={error ? 'api-down' : 'loading'}
            title={error ?? 'Loading basis snapshot…'}
            body={error ? `${error}. Nothing is estimated — retry the feed.` : 'Fetching instruments, tickers and index from the Deribit proxy.'}
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden bg-[#030506]">
      <CryptoPageHeader
        title="Basis"
        highlight="Current Snapshot"
        description={`${currency} dated futures + perpetual vs Deribit ${currency} index · premium = mark − index · APR = premium% × 365/DTE · ${summary.count} instruments`}
        actions={
          <>
            {stale && (
              <span className="border border-[#6a5322] bg-[#221a08] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#e2a13c]">
                Stale — refresh failed
              </span>
            )}
            <span className="font-mono text-[10px] text-[#76848a]" title="Snapshot time (UTC)">AS OF {asOfLabel} UTC</span>
            <button
              type="button"
              onClick={refresh}
              className="min-h-7 border border-[#202629] px-3 font-mono text-[10px] uppercase tracking-wider text-[#8b999f] transition-colors hover:border-[#25d7c5] hover:text-[#25d7c5]"
            >
              Refresh
            </button>
          </>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-px border-b border-[#20282b] bg-[#20282b] lg:grid-cols-4">
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">{currency} Index</div><div className="font-mono text-[18px] font-bold tabular-nums text-white">{indexPrice != null ? `$${fmtPrice(indexPrice, 2)}` : '—'}</div><div className="font-mono text-[10px] text-[#76848a]">deribit btc/eth usd index</div></div>
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Front Future APR</div><div className={cn('font-mono text-[18px] font-bold tabular-nums', signClass(summary.frontApr))}>{fmtSigned(summary.frontApr, 2, '%')}</div><div className="font-mono text-[10px] text-[#76848a]">nearest dated expiry</div></div>
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Perp Funding Ann.</div><div className={cn('font-mono text-[18px] font-bold tabular-nums', signClass(summary.perpFundingAnn))}>{fmtSigned(summary.perpFundingAnn, 2, '%')}</div><div className="font-mono text-[10px] text-[#76848a]">8h {summary.perpFunding8h != null ? fmtSigned(summary.perpFunding8h * 100, 4, '%') : '—'} × 3 × 365</div></div>
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">24h Volume / $ OI</div><div className="font-mono text-[18px] font-bold tabular-nums text-white">{fmtCompact(summary.vol)}<span className="ml-2 text-[11px] text-[#76848a]">${fmtCompact(summary.oi)}</span></div><div className="font-mono text-[10px] text-[#76848a]">{currency} contracts · reversed OI notional</div></div>
      </div>

      <div className="px-2 pt-2">
        <Panel
          title={`Basis Table — ${currency}`}
          subtitle="Click a header to sort · missing upstream fields render “—”"
          actions={
            <div className="flex items-center gap-1">
              <span className="mr-1 font-mono text-[9px] uppercase tracking-wider text-[#76848a]">Universe</span>
              {[{ id: false, label: 'All Tenors' }, { id: true, label: 'End of Month' }].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  aria-pressed={eomOnly === opt.id}
                  onClick={() => setEomOnly(opt.id)}
                  className={cn(
                    'min-h-7 border px-2 font-mono text-[10px] uppercase tracking-wider transition-colors',
                    eomOnly === opt.id
                      ? 'border-[#25d7c5] bg-[#25d7c5]/10 text-[#25d7c5]'
                      : 'border-[#202629] text-[#8b999f] hover:text-white',
                  )}
                >
                  {opt.label}
                </button>
              ))}
              <span className="ml-3 mr-1 font-mono text-[9px] uppercase tracking-wider text-[#76848a]">Color by</span>
              {[{ id: 'premium' as Metric, label: '% Premium' }, { id: 'apr' as Metric, label: 'APR' }].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={metric === m.id}
                  onClick={() => setMetric(m.id)}
                  className={cn(
                    'min-h-7 border px-2 font-mono text-[10px] uppercase tracking-wider transition-colors',
                    metric === m.id
                      ? 'border-[#25d7c5] bg-[#25d7c5]/10 text-[#25d7c5]'
                      : 'border-[#202629] text-[#8b999f] hover:text-white',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse font-mono text-[11px]">
              <thead className="bg-[#0a0d0e] text-[#8b999f]">
                <tr>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                      className={cn('px-3 py-1.5', col.align === 'right' ? 'text-right' : 'text-left')}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'uppercase tracking-wider',
                          sortKey === col.key ? 'text-[#25d7c5]' : 'hover:text-white',
                        )}
                      >
                        {col.label}
                        {sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const primaryVal = metric === 'premium' ? row.premiumPct : row.aprPct;
                  const secondaryVal = metric === 'premium' ? row.aprPct : row.premiumPct;
                  const secondaryCls = secondaryVal != null ? 'text-[#a6b0b4]' : 'text-[#8b999f]';
                  return (
                    <tr
                      key={row.instrument}
                      className={cn('border-t border-[#1a1f22]', row.kind === 'PERPETUAL' && 'bg-[#101619]')}
                    >
                      <td className="px-3 py-1.5 font-bold text-white">
                        {row.instrument}
                        {row.dte != null && row.dte <= 2 && (
                          <span className="ml-1.5 text-[9px] text-[#e2a13c]">{row.dte < 1 ? '<1D' : `${Math.ceil(row.dte)}D`}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={cn(
                          'border px-1 py-0.5 text-[9px] uppercase tracking-wider',
                          row.kind === 'PERPETUAL' ? 'border-[#25d7c5]/40 text-[#25d7c5]' : 'border-[#2a3236] text-[#8b999f]',
                        )}>{row.kind}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#d7dee0]">{fmtMark(row.mark)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#8b999f]">{fmtMark(row.indexPrice)}</td>
                      <td className={cn('px-3 py-1.5 text-right tabular-nums', metric === 'premium' ? signClass(row.premiumUsd) : 'text-[#a6b0b4]')}>
                        {fmtSigned(row.premiumUsd, 2)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-1.5 text-right tabular-nums',
                          metric === 'premium' ? signClass(primaryVal) : secondaryCls,
                        )}
                      >
                        {fmtSigned(row.premiumPct, 3, '%')}
                      </td>
                      <td className={cn(
                        'px-3 py-1.5 text-right tabular-nums',
                        metric === 'apr' ? signClass(row.aprPct) : secondaryCls,
                      )}
                      >
                        {fmtSigned(row.aprPct, 2, '%')}
                      </td>
                      <td className={cn('px-3 py-1.5 text-right tabular-nums', signClass(row.change24hPct))}>
                        {fmtSigned(row.change24hPct, 2, '%')}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#d7dee0]">{row.volumeBase != null ? fmtCompact(row.volumeBase) : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#d7dee0]">{row.openInterestUsd != null ? `$${fmtCompact(row.openInterestUsd)}` : '—'}</td>
                    </tr>
                  );
                })}
                {sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-[#8b999f]">
                      No instruments in this universe.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="px-3 py-2 font-mono text-[10px] text-[#76848a]">
            Source: Deribit public API via our own server proxy (mark, index, stats, OI). Premium = mark − index; APR = (mark−index)/index × 365/DTE, simple annualization. Perp APR is “—” by construction (no expiry). BTC/ETH futures are reversed (coin-margined): OI and volume_usd are USD notional. Max |% prem| across dated tenors: {summary.maxAbsPrem != null ? `${summary.maxAbsPrem.toFixed(3)}%` : '—'}.
          </p>
        </Panel>
      </div>
    </div>
  );
}
