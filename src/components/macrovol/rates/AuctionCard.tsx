/**
 * Upcoming U.S. Treasury auctions — FiscalData (official supply calendar).
 */
import { useEffect, useState } from 'react';
import { DataBadge } from '../DataBadge';
import { EmptyState } from '../../common/EmptyState';
import {
  macrovolApi,
  type RatesSummary,
  type TreasuryAuctionsData,
  type TreasuryAuctionRow,
} from '../../../lib/macrovol/api';
import { auctionCurveNote } from '../../../lib/rates/carryScores';

function rowLabel(a: TreasuryAuctionRow): string {
  const type = a.security_type || '—';
  const term = a.security_term || '';
  return term ? `${type} ${term}` : type;
}

export function AuctionCard() {
  const [data, setData] = useState<TreasuryAuctionsData | null>(null);
  const [summary, setSummary] = useState<RatesSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      macrovolApi.ratesAuctions(16),
      macrovolApi.ratesSummary().catch(() => null),
    ])
      .then(([res, sum]) => {
        if (cancelled) return;
        setData(res);
        setSummary(sum);
        setError(res.error || null);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setData(null);
        setError(e.message || 'Auctions unavailable');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = data?.auctions ?? [];
  const next = data?.next_coupon || data?.next;
  const curveNote = auctionCurveNote(next, summary?.spread_2s10s ?? null);

  return (
    <div
      id="sec-auctions"
      className="mt-2 rounded border border-border bg-background/40 p-2"
      data-desk-section="1"
    >
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-1">
        <div>
          <div className="font-mono text-type-2xs font-semibold tracking-wide text-foreground">
            TREASURY AUCTIONS · SUPPLY
          </div>
          <div className="font-mono text-type-2xs text-muted-foreground">
            FiscalData upcoming calendar — next to UST curve for supply narrative
          </div>
        </div>
        {data?.total_offering_label && (
          <div className="font-mono text-type-xs tabular-nums text-muted-foreground">
            Known size sum {data.total_offering_label}
          </div>
        )}
      </div>

      {loading && (
        <EmptyState kind="loading" title="Loading auctions…" body="U.S. Treasury FiscalData" compact />
      )}
      {!loading && (error || rows.length === 0) && (
        <EmptyState
          kind="api-down"
          title="No auction calendar"
          body={error || 'FiscalData returned no upcoming auctions'}
          compact
        />
      )}

      {!loading && rows.length > 0 && (
        <>
          {next && (
            <div className="mb-1.5 space-y-0.5 rounded border border-border/80 bg-card/50 px-2 py-1 font-mono text-type-xs">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="text-muted-foreground">Next coupon/supply focus</span>
                <span className="font-semibold text-foreground">{rowLabel(next)}</span>
                <span className="tabular-nums text-foreground">{next.auction_date || '—'}</span>
                {next.offering_label && (
                  <span className="tabular-nums text-amber-500/90">{next.offering_label}</span>
                )}
                {next.reopening && next.reopening !== 'No' && (
                  <span className="text-muted-foreground">reopen</span>
                )}
                {summary?.spread_2s10s != null && (
                  <span className="text-muted-foreground">
                    2s10s {(summary.spread_2s10s * 100).toFixed(0)} bp
                  </span>
                )}
              </div>
              {curveNote && (
                <div className="text-type-2xs text-muted-foreground">{curveNote}</div>
              )}
            </div>
          )}
          <div className="max-h-40 overflow-auto" tabIndex={0} role="region" aria-label="Scrollable data">
            <table className="w-full border-collapse font-mono text-type-2xs">
              <thead className="sticky top-0 bg-background/95 text-muted-foreground">
                <tr className="border-b border-border text-left">
                  <th className="py-0.5 pr-2 font-medium">Auction</th>
                  <th className="py-0.5 pr-2 font-medium">Type / term</th>
                  <th className="py-0.5 pr-2 font-medium">Size</th>
                  <th className="py-0.5 pr-2 font-medium">Issue</th>
                  <th className="py-0.5 font-medium">CUSIP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a, i) => (
                  <tr
                    key={`${a.cusip || a.security_term}-${a.auction_date}-${i}`}
                    className="border-b border-border/40 text-foreground"
                  >
                    <td className="py-0.5 pr-2 tabular-nums">{a.auction_date || '—'}</td>
                    <td className="py-0.5 pr-2">
                      {rowLabel(a)}
                      {a.reopening === 'Yes' ? (
                        <span className="ml-1 text-muted-foreground">R</span>
                      ) : null}
                    </td>
                    <td className="py-0.5 pr-2 tabular-nums">
                      {a.offering_label || '—'}
                    </td>
                    <td className="py-0.5 pr-2 tabular-nums text-muted-foreground">
                      {a.issue_date || '—'}
                    </td>
                    <td className="py-0.5 text-muted-foreground">{a.cusip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <DataBadge
        asOf={data?.as_of}
        source={data?.source || 'FiscalData'}
        note={data?.note}
        down={!!error && rows.length === 0}
        className="mt-1.5"
        staleThresholdMin={12 * 60}
        delayedThresholdMin={6 * 60}
      />
    </div>
  );
}
