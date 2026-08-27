/**
 * Futures-desk math — pure functions only (no fetch, no React).
 * Basis / premium / annualized-APR for Deribit dated futures + perpetuals.
 *
 * Conventions:
 *  - premium = mark − index (USD)
 *  - premium % = (mark − index) / index × 100
 *  - APR %     = premium % × 365 / DTE        (simple annualization, task spec)
 *  - funding   = 8h rate (decimal); annualized % = rate8h × 3 × 365 × 100
 *
 * Everything returns null on missing/invalid input — views render "—".
 */
import type { DeribitFutureInstrument, DeribitFutureTicker } from './deribitFutures';

export const MS_PER_DAY = 86_400_000;

export type FuturesKind = 'FUTURE' | 'PERPETUAL';

// ── Instrument helpers ───────────────────────────────────────────────────────

export function isPerpetual(
  inst: Pick<DeribitFutureInstrument, 'settlement_period' | 'instrument_name'>,
): boolean {
  return inst.settlement_period === 'perpetual' || inst.instrument_name.endsWith('-PERPETUAL');
}

export function futuresKind(
  inst: Pick<DeribitFutureInstrument, 'settlement_period' | 'instrument_name'>,
): FuturesKind {
  return isPerpetual(inst) ? 'PERPETUAL' : 'FUTURE';
}

/** 'BTC-27AUG26' → '27AUG26'; 'BTC-PERPETUAL' → 'PERP'. */
export function tenorLabel(instrumentName: string): string {
  const parts = instrumentName.split('-');
  const tail = parts.slice(1).join('-');
  return instrumentName.endsWith('-PERPETUAL') || !tail ? 'PERP' : tail;
}

// ── Core arithmetic ──────────────────────────────────────────────────────────

/** USD premium of mark over index. */
export function premiumUsd(mark: number | null | undefined, index: number | null | undefined): number | null {
  if (mark == null || !Number.isFinite(mark)) return null;
  if (index == null || !Number.isFinite(index) || index === 0) return null;
  return mark - index;
}

/** Premium in PERCENT units (0.25 ⇒ +0.25%). */
export function premiumPct(mark: number | null | undefined, index: number | null | undefined): number | null {
  const usd = premiumUsd(mark, index);
  if (usd == null) return null;
  return (usd / (index as number)) * 100;
}

/** Fractional days to expiry; perp (or past expiry) → null. */
export function dteDays(expirationMs: number | null | undefined, nowMs: number): number | null {
  if (expirationMs == null || !Number.isFinite(expirationMs) || expirationMs <= 0) return null;
  const dte = (expirationMs - nowMs) / MS_PER_DAY;
  return dte > 0 ? dte : null;
}

/** APR% from a premium expressed in percent units. */
export function aprPctFromPremium(premPct: number | null | undefined, dte: number | null | undefined): number | null {
  if (premPct == null || !Number.isFinite(premPct)) return null;
  if (dte == null || !Number.isFinite(dte) || dte <= 0) return null;
  return premPct * (365 / dte);
}

/** APR% straight from prices + expiry timestamp. */
export function aprPct(
  mark: number | null | undefined,
  index: number | null | undefined,
  expirationMs: number | null | undefined,
  nowMs: number,
): number | null {
  return aprPctFromPremium(premiumPct(mark, index), dteDays(expirationMs, nowMs));
}

/** Simple funding annualization: 8h rate (decimal) → percent p.a. */
export function annualizedFundingPct(rate8h: number | null | undefined): number | null {
  if (rate8h == null || !Number.isFinite(rate8h)) return null;
  return rate8h * 3 * 365 * 100;
}

// ── Basis table model ────────────────────────────────────────────────────────

export interface BasisRow {
  instrument: string;
  kind: FuturesKind;
  tenorLabel: string;
  expirationMs: number | null;
  /** Fractional days to expiry; perp → null. */
  dte: number | null;
  mark: number | null;
  indexPrice: number | null;
  premiumUsd: number | null;
  premiumPct: number | null;
  /** Perp → null (no expiry to annualize against). */
  aprPct: number | null;
  change24hPct: number | null;
  volumeBase: number | null;
  volumeUsd: number | null;
  openInterestUsd: number | null;
  funding8h: number | null;
  fundingAnnualizedPct: number | null;
}

function finiteOrNull(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

/**
 * One row per active instrument (dated + perp), sorted perp-first then by
 * expiry ascending. Missing tickers produce honest null columns.
 */
export function buildBasisRows(params: {
  instruments: DeribitFutureInstrument[];
  tickers: Record<string, DeribitFutureTicker>;
  /** Canonical currency index price; falls back per-ticker when absent. */
  indexPrice: number | null;
  nowMs: number;
}): BasisRow[] {
  const { instruments, tickers, indexPrice, nowMs } = params;
  const rows = instruments.map((inst) => {
    const t = tickers[inst.instrument_name] ?? null;
    const kind = futuresKind(inst);
    const expirationMs = kind === 'PERPETUAL' ? null : finiteOrNull(inst.expiration_timestamp) || null;
    // Global index wins; per-ticker index_price is still real Deribit data.
    const rowIdx =
      indexPrice != null && Number.isFinite(indexPrice)
        ? indexPrice
        : finiteOrNull(t?.index_price);
    const mark = finiteOrNull(t?.mark_price);
    const premPct = premiumPct(mark, rowIdx);
    const dte = dteDays(expirationMs, nowMs);
    return {
      instrument: inst.instrument_name,
      kind,
      tenorLabel: tenorLabel(inst.instrument_name),
      expirationMs,
      dte,
      mark,
      indexPrice: rowIdx,
      premiumUsd: premiumUsd(mark, rowIdx),
      premiumPct: premPct,
      aprPct: aprPctFromPremium(premPct, dte),
      change24hPct: finiteOrNull(t?.price_change_pct),
      volumeBase: finiteOrNull(t?.volume),
      volumeUsd: finiteOrNull(t?.volume_usd),
      openInterestUsd: finiteOrNull(t?.open_interest),
      funding8h: finiteOrNull(t?.funding_8h),
      fundingAnnualizedPct: annualizedFundingPct(t?.funding_8h),
    } satisfies BasisRow;
  });
  return rows.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'PERPETUAL' ? -1 : 1;
    const ax = a.expirationMs ?? Number.POSITIVE_INFINITY;
    const bx = b.expirationMs ?? Number.POSITIVE_INFINITY;
    return ax - bx;
  });
}

/**
 * "End of month" tenor universe: dated rows only — for each UTC calendar month
 * keep the LATEST expiry. Perps have no expiry and are dropped.
 */
export function filterEndOfMonthExpiries(rows: BasisRow[]): BasisRow[] {
  const lastByMonth = new Map<string, number>();
  for (const r of rows) {
    if (!r.expirationMs) continue;
    const d = new Date(r.expirationMs);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const cur = lastByMonth.get(key);
    if (cur == null || r.expirationMs > cur) lastByMonth.set(key, r.expirationMs);
  }
  const eomSet = new Set(lastByMonth.values());
  return rows.filter((r) => r.expirationMs != null && eomSet.has(r.expirationMs));
}

export interface TermStructurePoint {
  key: string;
  label: string;
  expirationMs: number;
  dte: number | null;
  aprPct: number | null;
  premiumPct: number | null;
}

/** Dated futures only (perp has no DTE → no honest APR), sorted by expiry. */
export function termStructurePoints(rows: BasisRow[]): TermStructurePoint[] {
  return rows
    .filter((r) => r.kind === 'FUTURE' && r.expirationMs != null)
    .map((r) => ({
      key: r.instrument,
      label: r.tenorLabel,
      expirationMs: r.expirationMs as number,
      dte: r.dte,
      aprPct: r.aprPct,
      premiumPct: r.premiumPct,
    }))
    .sort((a, b) => a.expirationMs - b.expirationMs);
}
