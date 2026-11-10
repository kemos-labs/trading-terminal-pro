import type { VolSnapshot } from './types';
import { forwardVol } from '../math/carry/forwardVol';


export const SKEW_DELTA_BUCKETS = ['10ΔP', '25ΔP', 'ATM', '25ΔC', '10ΔC'] as const;
export type SkewBucket = typeof SKEW_DELTA_BUCKETS[number];
export const SKEW_HISTORY_WINDOWS = [7, 30, 90, 180, 365] as const;
/** Target delta per bucket; ATM uses dual ±0.50 proxy. */
export const SKEW_BUCKET_TARGET: Record<SkewBucket, number | null> = {
  '10ΔP': -0.10,
  '25ΔP': -0.25,
  'ATM': null,
  '25ΔC': 0.25,
  '10ΔC': 0.10,
};
/** Known upstream method: Yahoo/FMP quotes expose locally solved mid-price IV (mid=(bid+ask)/2, Black-Scholes invert) and locally computed delta (BS formula with r/q/T). Provider does not supply observed IV/delta; those fields are derived. Assumptions (r, q, day-count) are those used by buildYahooSnapshot; raw provider bid/ask/last preserved in quote but IV/delta provenance is derived. */
export const SKEW_PROVENANCE_NOTE = 'Derived: IV = locally solved mid-price IV; delta = locally computed BS delta; selection = nearest within tolerance; ATM = 50Δ call/put average proxy at possibly different strikes; RR/realized/forward = derived.';

function validIv(iv: number | null | undefined): boolean {
  return iv != null && Number.isFinite(iv) && iv > 0 && iv <= 3;
}

export function closestDelta<T extends { delta: number | null; iv: number | null }>(
  quotes: T[],
  target: number,
  tolerance = 0.14,
): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const q of quotes) {
    if (q.delta == null || !validIv(q.iv)) continue;
    const dist = Math.abs((q.delta as number) - target);
    if (dist > tolerance) continue;
    if (dist < bestDist) { bestDist = dist; best = q; }
  }
  return best;
}

export function atmQuote<T extends { delta: number | null; iv: number | null }>(
  quotes: T[],
  side: 1 | -1,
): T | null {
  return closestDelta(quotes, 0.5 * side, 0.15);
}

export interface WingLegMeta {
  iv: number | null;
  strike: number | null;
  delta: number | null;
  targetDelta: number | null;
}

export interface WingRow {
  expiry: string;
  dte: number;
  cells: Record<SkewBucket, number | null>;
  /** Per-bucket selected-quote metadata for provenance disclosure */
  legs: Record<SkewBucket, WingLegMeta>;
  /** True when same underlying quote reused across multiple buckets (nearest-approximation overlap) */
  reused: boolean;
  /** Which buckets share the same strike (e.g., '10ΔP ↔ 25ΔP') */
  reuseGroups: string[];
  /** ATM proxy uses two possibly different strikes */
  atmCallStrike: number | null;
  atmPutStrike: number | null;
  atmCallDelta: number | null;
  atmPutDelta: number | null;
}

export interface WingMatrix {
  rows: WingRow[];
  wingMin: number | null;
  wingMax: number | null;
  totalAvailable: number;
  displayed: number;
  maxRows: number;
  capped: boolean;
}

type QuoteWithStrike = { delta: number | null; iv: number | null; strike?: number | null };

function legMeta(q: QuoteWithStrike | null, target: number | null): WingLegMeta {
  if (!q || q.iv == null || !validIv(q.iv)) return { iv: null, strike: null, delta: null, targetDelta: target };
  return { iv: q.iv, strike: (q as { strike?: number | null }).strike ?? null, delta: q.delta, targetDelta: target };
}

export function wingMatrix(snapshot: VolSnapshot, maxRows = 10): WingMatrix {
  const totalAvailable = snapshot.expiries.length;
  const slices = snapshot.expiries.slice(0, maxRows);
  const rows: WingRow[] = slices.map((slice) => {
    const qP10 = closestDelta(slice.puts as QuoteWithStrike[], -0.10, 0.08) as QuoteWithStrike | null;
    const qP25 = closestDelta(slice.puts as QuoteWithStrike[], -0.25, 0.14) as QuoteWithStrike | null;
    const qC25 = closestDelta(slice.calls as QuoteWithStrike[], 0.25, 0.14) as QuoteWithStrike | null;
    const qC10 = closestDelta(slice.calls as QuoteWithStrike[], 0.10, 0.08) as QuoteWithStrike | null;
    const atmC = atmQuote(slice.calls as QuoteWithStrike[], 1) as QuoteWithStrike | null;
    const atmP = atmQuote(slice.puts as QuoteWithStrike[], -1) as QuoteWithStrike | null;
    let atm: number | null = null;
    if (atmC?.iv != null && atmP?.iv != null && validIv(atmC.iv) && validIv(atmP.iv)) atm = (atmC.iv + atmP.iv) / 2;
    else atm = null;
    const atmMeta: WingLegMeta = atm != null ? { iv: atm, strike: null, delta: null, targetDelta: null } : { iv: null, strike: null, delta: null, targetDelta: null };
    // Detect reuse: same strike selected for multiple buckets within same side
    const _strikes = [qP10?.strike, qP25?.strike, qC25?.strike, qC10?.strike].filter((s) => s != null) as number[]; void _strikes;
    const reuseGroups: string[] = [];
    if (qP10 && qP25 && qP10.strike != null && qP10.strike === qP25.strike) reuseGroups.push('10ΔP↔25ΔP');
    if (qC10 && qC25 && qC10.strike != null && qC10.strike === qC25.strike) reuseGroups.push('25ΔC↔10ΔC');
    const reused = reuseGroups.length > 0;
    return {
      expiry: slice.expiry,
      dte: slice.dte,
      cells: { '10ΔP': qP10?.iv ?? null, '25ΔP': qP25?.iv ?? null, ATM: atm, '25ΔC': qC25?.iv ?? null, '10ΔC': qC10?.iv ?? null } as Record<SkewBucket, number | null>,
      legs: {
        '10ΔP': legMeta(qP10, -0.10),
        '25ΔP': legMeta(qP25, -0.25),
        'ATM': atmMeta,
        '25ΔC': legMeta(qC25, 0.25),
        '10ΔC': legMeta(qC10, 0.10),
      } as Record<SkewBucket, WingLegMeta>,
      reused,
      reuseGroups,
      atmCallStrike: (atmC as { strike?: number | null })?.strike ?? null,
      atmPutStrike: (atmP as { strike?: number | null })?.strike ?? null,
      atmCallDelta: atmC?.delta ?? null,
      atmPutDelta: atmP?.delta ?? null,
    };
  });
  const vals: number[] = [];
  for (const r of rows) for (const v of Object.values(r.cells)) if (v != null) vals.push(v);
  const wingMin = vals.length ? Math.min(...vals) : null;
  const wingMax = vals.length ? Math.max(...vals) : null;
  return { rows, wingMin, wingMax, totalAvailable, displayed: rows.length, maxRows, capped: totalAvailable > maxRows };
}

export interface RRRow { expiry: string; dte: number; rr: number | null; c25Iv: number | null; p25Iv: number | null; c25Strike: number | null; p25Strike: number | null; c25Delta: number | null; p25Delta: number | null; }

export function riskReversalRows(snapshot: VolSnapshot): RRRow[] {
  return snapshot.expiries.map((slice) => {
    const c25 = closestDelta(slice.calls as QuoteWithStrike[], 0.25, 0.14) as QuoteWithStrike | null;
    const p25 = closestDelta(slice.puts as QuoteWithStrike[], -0.25, 0.14) as QuoteWithStrike | null;
    const rr = c25?.iv != null && p25?.iv != null ? (c25.iv - p25.iv) : null;
    const rrFinite = rr != null && Number.isFinite(rr) ? rr : null;
    return { expiry: slice.expiry, dte: slice.dte, rr: rrFinite, c25Iv: c25?.iv ?? null, p25Iv: p25?.iv ?? null, c25Strike: (c25 as { strike?: number | null })?.strike ?? null, p25Strike: (p25 as { strike?: number | null })?.strike ?? null, c25Delta: c25?.delta ?? null, p25Delta: p25?.delta ?? null };
  });
}

export interface AtmTermRow { expiry: string; dte: number; atmIv: number | null; fwdIv: number | null; atmCallStrike: number | null; atmPutStrike: number | null; atmCallDelta: number | null; atmPutDelta: number | null; fwdUnavailableReason: string | null; }

function isValidDte(dte: unknown): boolean {
  return typeof dte === 'number' && Number.isFinite(dte) && dte > 0;
}

export function atmTermRows(snapshot: VolSnapshot): AtmTermRow[] {
  const rows: AtmTermRow[] = snapshot.expiries.map((slice) => {
    const atmC = atmQuote(slice.calls as QuoteWithStrike[], 1) as QuoteWithStrike | null;
    const atmP = atmQuote(slice.puts as QuoteWithStrike[], -1) as QuoteWithStrike | null;
    let atm: number | null = null;
    if (atmC?.iv != null && atmP?.iv != null && validIv(atmC.iv) && validIv(atmP.iv)) atm = (atmC.iv + atmP.iv) / 2;
    else atm = null;
    return { expiry: slice.expiry, dte: slice.dte, atmIv: atm, fwdIv: null, atmCallStrike: (atmC as { strike?: number | null })?.strike ?? null, atmPutStrike: (atmP as { strike?: number | null })?.strike ?? null, atmCallDelta: atmC?.delta ?? null, atmPutDelta: atmP?.delta ?? null, fwdUnavailableReason: null };
  });
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]!;
    const b = rows[i]!;
    // Validate finite positive DTE before kernel; do not silently clamp expired/nonfinite to zero
    if (!isValidDte(a.dte) || !isValidDte(b.dte)) {
      b.fwdUnavailableReason = !isValidDte(b.dte) ? 'expired/nonfinite DTE' : 'prior DTE invalid';
      b.fwdIv = null;
      continue;
    }
    if (a.dte >= b.dte) {
      b.fwdUnavailableReason = 'non-increasing DTE';
      b.fwdIv = null;
      continue;
    }
    const Ta = a.dte / 365;
    const Tb = b.dte / 365;
    if (a.atmIv != null && b.atmIv != null) {
      const fv = forwardVol(a.atmIv, Ta, b.atmIv, Tb);
      if (fv != null && Number.isFinite(fv) && fv > 0 && fv <= 3) b.fwdIv = fv;
      else { b.fwdIv = null; b.fwdUnavailableReason = fv == null ? 'variance invalid/negative' : 'forward out of range'; }
    } else {
      b.fwdIv = null;
      b.fwdUnavailableReason = 'ATM leg missing';
    }
  }
  if (rows.length) { rows[0]!.fwdIv = null; if (rows[0]!.atmIv == null) rows[0]!.fwdUnavailableReason = 'first expiry no forward'; else if (!isValidDte(rows[0]!.dte)) rows[0]!.fwdUnavailableReason = 'expired/nonfinite DTE'; }
  return rows;
}

export function fmtIvPct(iv: number | null): string {
  if (iv == null) return '—';
  return `${(iv * 100).toFixed(2)}%`;
}

/** REF-06 forward-volatility matrix: pairwise upper triangle over ordered ATM-term legs. */
export const FWD_VOL_FORMULA = 'fwdVol = sqrt((sigma2^2*T2 - sigma1^2*T1)/(T2-T1))';
export const FWD_VOL_YEAR_FRACTION = 'DTE/365 calendar';
export const FWD_VOL_UNITS = 'decimal-volatility (annualized; displayed %)';
export const FWD_VOL_IV_BASIS_EQUITY = 'derived-solved-mid';

export interface ForwardVolLeg {
  expiry: string;
  dte: number;
  /** Year fraction T = DTE/365 (calendar). Null when DTE invalid. */
  T: number | null;
  atmIv: number | null;
  atmCallStrike: number | null;
  atmPutStrike: number | null;
  atmCallDelta: number | null;
  atmPutDelta: number | null;
}

export interface ForwardVolCell {
  startIndex: number;
  endIndex: number;
  /** Annualized decimal forward vol; null when unavailable. Exact 0 valid only for zero forward variance. */
  value: number | null;
  /** True for diagonal/lower-triangle cells: structurally blank, never computed. */
  structural: boolean;
  reason: string | null;
  startExpiry: string;
  endExpiry: string;
  startDte: number;
  endDte: number;
  startT: number | null;
  endT: number | null;
  startAtmIv: number | null;
  endAtmIv: number | null;
  startAtmCallStrike: number | null;
  startAtmPutStrike: number | null;
  endAtmCallStrike: number | null;
  endAtmPutStrike: number | null;
  startAtmCallDelta: number | null;
  startAtmPutDelta: number | null;
  endAtmCallDelta: number | null;
  endAtmPutDelta: number | null;
  formula: typeof FWD_VOL_FORMULA;
  yearFraction: typeof FWD_VOL_YEAR_FRACTION;
  units: typeof FWD_VOL_UNITS;
  ivBasis: typeof FWD_VOL_IV_BASIS_EQUITY;
}

export interface ForwardVolMatrix {
  legs: ForwardVolLeg[];
  /** cells[i][j]: rows are start expiry, columns are end expiry; i>=j structural. */
  cells: ForwardVolCell[][];
  /** SPOT/current anchor label — the quote instant, never an expiry column. */
  originLabel: 'SPOT';
  formula: typeof FWD_VOL_FORMULA;
  yearFraction: typeof FWD_VOL_YEAR_FRACTION;
  units: typeof FWD_VOL_UNITS;
  ivBasis: typeof FWD_VOL_IV_BASIS_EQUITY;
  validCount: number;
  unavailableCount: number;
}

function fwdLeg(row: AtmTermRow): ForwardVolLeg {
  return {
    expiry: row.expiry,
    dte: row.dte,
    T: isValidDte(row.dte) ? row.dte / 365 : null,
    atmIv: row.atmIv,
    atmCallStrike: row.atmCallStrike,
    atmPutStrike: row.atmPutStrike,
    atmCallDelta: row.atmCallDelta,
    atmPutDelta: row.atmPutDelta,
  };
}

function blankCell(i: number, j: number, legs: ForwardVolLeg[], structural: boolean, reason: string | null, value: number | null): ForwardVolCell {
  const a = legs[i]!;
  const b = legs[j]!;
  return {
    startIndex: i, endIndex: j, value, structural, reason,
    startExpiry: a.expiry, endExpiry: b.expiry,
    startDte: a.dte, endDte: b.dte,
    startT: a.T, endT: b.T,
    startAtmIv: a.atmIv, endAtmIv: b.atmIv,
    startAtmCallStrike: a.atmCallStrike, startAtmPutStrike: a.atmPutStrike,
    endAtmCallStrike: b.atmCallStrike, endAtmPutStrike: b.atmPutStrike,
    startAtmCallDelta: a.atmCallDelta, startAtmPutDelta: a.atmPutDelta,
    endAtmCallDelta: b.atmCallDelta, endAtmPutDelta: b.atmPutDelta,
    formula: FWD_VOL_FORMULA, yearFraction: FWD_VOL_YEAR_FRACTION,
    units: FWD_VOL_UNITS, ivBasis: FWD_VOL_IV_BASIS_EQUITY,
  };
}

/**
 * Pairwise upper-triangle forward-vol matrix reusing the canonical
 * total-variance scalar. Rows are start expiry, columns are end expiry.
 * Every diagonal/lower-triangle cell is structurally blank (reason
 * 'structural'). Any negative forward variance — including tiny negatives —
 * is unavailable (never a clamped zero); exact zero with distinct increasing
 * DTE may remain 0. Never emits NaN/Infinity.
 */
export function forwardVolMatrix(snapshot: VolSnapshot): ForwardVolMatrix {
  const term = atmTermRows(snapshot);
  const legs = term.map(fwdLeg);
  const n = legs.length;
  const cells: ForwardVolCell[][] = [];
  let validCount = 0;
  let unavailableCount = 0;
  for (let i = 0; i < n; i++) {
    const row: ForwardVolCell[] = [];
    for (let j = 0; j < n; j++) {
      if (j <= i) {
        unavailableCount += 1;
        row.push(blankCell(i, j, legs, true, 'structural', null));
        continue;
      }
      const a = legs[i]!;
      const b = legs[j]!;
      if (!isValidDte(a.dte) || !isValidDte(b.dte) || a.T == null || b.T == null) {
        unavailableCount += 1;
        row.push(blankCell(i, j, legs, false, 'expired/nonfinite DTE', null));
        continue;
      }
      if (a.dte >= b.dte) {
        unavailableCount += 1;
        row.push(blankCell(i, j, legs, false, 'non-increasing DTE', null));
        continue;
      }
      if (a.atmIv == null || b.atmIv == null || !validIv(a.atmIv) || !validIv(b.atmIv)) {
        unavailableCount += 1;
        row.push(blankCell(i, j, legs, false, 'ATM leg missing', null));
        continue;
      }
      const fv = forwardVol(a.atmIv, a.T, b.atmIv, b.T);
      if (fv == null || !Number.isFinite(fv) || fv < 0 || fv > 3) {
        unavailableCount += 1;
        row.push(blankCell(i, j, legs, false, fv == null ? 'variance invalid/negative' : 'forward out of range', null));
        continue;
      }
      validCount += 1;
      row.push(blankCell(i, j, legs, false, null, fv));
    }
    cells.push(row);
  }
  return {
    legs, cells, originLabel: 'SPOT',
    formula: FWD_VOL_FORMULA, yearFraction: FWD_VOL_YEAR_FRACTION,
    units: FWD_VOL_UNITS, ivBasis: FWD_VOL_IV_BASIS_EQUITY,
    validCount, unavailableCount,
  };
}

export function fmtRR(rr: number | null): string {
  if (rr == null) return '—';
  const vp = rr * 100;
  const s = vp >= 0 ? '+' : '';
  return `${s}${vp.toFixed(2)}`;
}
