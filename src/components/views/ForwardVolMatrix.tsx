/**
 * REF-06 forward-volatility matrix — read-only triangular grid.
 *
 * Pairwise upper triangle over the ordered ATM-term expiry list reusing the
 * canonical total-variance scalar (fwdVol = sqrt((s2^2*T2 - s1^2*T1)/(T2-T1)),
 * annualized, DTE/365 calendar). Rows are start expiry, columns are end expiry.
 * Every diagonal/lower-triangle cell is structurally blank (never computed).
 * Negative implied forward variance — including tiny negatives — renders
 * Unavailable, never a clamped zero. Legs are derived-solved-mid ATM proxies;
 * the matrix is therefore derived, never observed, and never labelled Live.
 */
import { useMemo } from 'react';
import {
  forwardVolMatrix,
  fmtIvPct,
  type ForwardVolMatrix as ForwardVolMatrixData,
} from '../../lib/options/volSkew';
import type { VolSnapshot } from '../../lib/options/types';
import { useTerminalStore } from '../../store/terminalStore';
import { EmptyState } from '../common/EmptyState';

function cellTitle(
  row: number,
  col: number,
  matrix: ForwardVolMatrixData,
): string {
  const cell = matrix.cells[row]![col]!;
  if (cell.structural) return 'Structurally blank — diagonal/lower triangle is never computed (not data).';
  const head = `Forward ${cell.startExpiry} (${cell.startDte}d) → ${cell.endExpiry} (${cell.endDte}d)`;
  const legs = `start ATM IV ${cell.startAtmIv != null ? `${(cell.startAtmIv * 100).toFixed(2)}%` : '—'}`
    + ` (call strike ${cell.startAtmCallStrike ?? '—'} Δ ${cell.startAtmCallDelta != null ? cell.startAtmCallDelta.toFixed(2) : '—'}`
    + ` / put strike ${cell.startAtmPutStrike ?? '—'} Δ ${cell.startAtmPutDelta != null ? cell.startAtmPutDelta.toFixed(2) : '—'})`
    + ` T=${cell.startT != null ? cell.startT.toFixed(4) : '—'}`
    + ` → end ATM IV ${cell.endAtmIv != null ? `${(cell.endAtmIv * 100).toFixed(2)}%` : '—'}`
    + ` (call strike ${cell.endAtmCallStrike ?? '—'} Δ ${cell.endAtmCallDelta != null ? cell.endAtmCallDelta.toFixed(2) : '—'}`
    + ` / put strike ${cell.endAtmPutStrike ?? '—'} Δ ${cell.endAtmPutDelta != null ? cell.endAtmPutDelta.toFixed(2) : '—'})`
    + ` T=${cell.endT != null ? cell.endT.toFixed(4) : '—'}`;
  const basis = `${cell.yearFraction} · ${cell.units} · legs ${cell.ivBasis} · ${cell.formula}`;
  if (cell.value == null) return `${head} — unavailable (${cell.reason ?? 'unknown'}). ${legs}. ${basis}.`;
  return `${head} = ${(cell.value * 100).toFixed(2)}%. ${legs}. ${basis}.`;
}

export function ForwardVolMatrixGrid({ matrix }: { matrix: ForwardVolMatrixData }) {
  const n = matrix.legs.length;
  const upper = (n * (n - 1)) / 2;
  const partial = matrix.validCount > 0 && matrix.validCount < upper;
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="Forward volatility matrix — scrollable table, rows are start expiry, columns are end expiry"
      data-testid="forward-vol-matrix"
      className="overflow-x-auto rounded border border-border focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
    >
      <div className="bg-muted/30 px-2 py-1 font-mono text-[11px] font-semibold">
        Forward Vol Matrix — pairwise start → end · derived · DTE/365 · annualized %
        <span className="ml-2 font-normal text-muted-foreground">hover a cell for legs, T, units, provenance</span>
        {partial ? (
          <span data-testid="forward-vol-partial" className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-600">
            Partial {matrix.validCount}/{upper}
          </span>
        ) : null}
      </div>
      <table role="table" aria-label="Forward volatility matrix, pairwise start-expiry rows by end-expiry columns, derived" className="w-full min-w-[560px] border-collapse font-mono text-[11px]">
        <thead>
          <tr className="bg-muted/20 text-muted-foreground">
            <th scope="col" className="px-2 py-1 text-left" title="SPOT is the current quote instant (underlying spot at snapshot time), never an expiry column">
              start ↓ / end →
            </th>
            {matrix.legs.map((leg) => (
              <th key={leg.expiry} scope="col" className="px-2 py-1 text-right" title={`End leg ${leg.expiry}: DTE ${leg.dte}, T=${leg.T != null ? leg.T.toFixed(4) : '—'} (DTE/365), ATM IV ${leg.atmIv != null ? `${(leg.atmIv * 100).toFixed(2)}%` : '—'} (derived-solved-mid proxy)`}>
                {leg.dte}d
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.legs.map((leg, i) => (
            <tr key={leg.expiry} className="border-t border-border" data-testid={`forward-vol-row-${i}`}>
              <th scope="row" className="px-2 py-1 text-left font-semibold" title={`Start leg ${leg.expiry}: DTE ${leg.dte}, T=${leg.T != null ? leg.T.toFixed(4) : '—'} (DTE/365), ATM IV ${leg.atmIv != null ? `${(leg.atmIv * 100).toFixed(2)}%` : '—'} (derived-solved-mid proxy)`}>
                {leg.dte}d
              </th>
              {matrix.cells[i]!.map((cell, j) => {
                if (cell.structural) {
                  return (
                    <td
                      key={j}
                      className="bg-muted/20 px-2 py-1 text-right text-muted-foreground/40"
                      title={cellTitle(i, j, matrix)}
                      aria-label={`row ${leg.dte} days to column ${matrix.legs[j]!.dte} days: structurally blank`}
                      data-testid={`forward-vol-cell-${i}-${j}`}
                    >
                      <span aria-hidden="true">·</span>
                    </td>
                  );
                }
                if (cell.value == null) {
                  return (
                    <td
                      key={j}
                      className="px-2 py-1 text-right text-muted-foreground"
                      title={cellTitle(i, j, matrix)}
                      aria-label={`row ${leg.dte} days to column ${matrix.legs[j]!.dte} days: unavailable, ${cell.reason ?? 'unknown'}`}
                      data-testid={`forward-vol-cell-${i}-${j}`}
                    >
                      —
                    </td>
                  );
                }
                return (
                  <td
                    key={j}
                    className="px-2 py-1 text-right"
                    title={cellTitle(i, j, matrix)}
                    aria-label={`row ${leg.dte} days to column ${matrix.legs[j]!.dte} days: ${(cell.value * 100).toFixed(2)} percent`}
                    data-testid={`forward-vol-cell-${i}-${j}`}
                  >
                    {fmtIvPct(cell.value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-2 py-1 font-mono text-[10px] text-muted-foreground">
        {matrix.formula} · {matrix.yearFraction} · {matrix.units} · legs {matrix.ivBasis} (derived, never observed)
      </div>
    </div>
  );
}

export function ForwardVolMatrixSection({ snapshot }: { snapshot?: VolSnapshot | null }) {
  const storeSnapshot = useTerminalStore((s) => s.snapshot);
  const loading = useTerminalStore((s) => s.loading);
  const symbol = useTerminalStore((s) => s.symbol);
  const snap = snapshot !== undefined ? snapshot : storeSnapshot;
  const matrix = useMemo(() => (snap ? forwardVolMatrix(snap) : null), [snap]);
  if (!snap && loading) {
    return (
      <div data-testid="forward-vol-section" className="shrink-0 border-t border-border p-3">
        <EmptyState kind="loading" title="Loading forwards" body="Requires the active options chain snapshot." />
      </div>
    );
  }
  if (!snap || !matrix) {
    return (
      <div data-testid="forward-vol-section" className="shrink-0 border-t border-border p-3">
        <EmptyState kind="no-data" title="No forwards — chain unavailable" body={`${symbol ?? 'Selected'} options chain unavailable — no values fabricated.`} />
      </div>
    );
  }
  if (matrix.legs.length < 2) {
    return (
      <div data-testid="forward-vol-section" className="shrink-0 border-t border-border p-3">
        <EmptyState kind="no-data" title="No forwards — need two expiries" body="A forward interval needs at least two expiries; the single-expiry triangle is structurally blank." />
      </div>
    );
  }
  const asOf = Number.isFinite(snap.timestamp) && snap.timestamp > 0
    ? new Date(snap.timestamp).toISOString()
    : 'unknown';
  return (
    <div data-testid="forward-vol-section" className="shrink-0 border-t border-border bg-card/20">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <h3 className="font-mono text-xs font-semibold">Forward Volatility</h3>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground" title="Forward vol is derived from ATM legs; never an observed quote">
          Derived
        </span>
        <span data-testid="forward-vol-spot" className="font-mono text-[10px] text-muted-foreground" title="SPOT is the current quote instant (underlying spot at snapshot time), never an expiry column">
          SPOT/current anchor: spot {snap.spot} asOf {asOf}
        </span>
      </div>
      <div className="px-3 pb-3">
        <ForwardVolMatrixGrid matrix={matrix} />
      </div>
    </div>
  );
}
