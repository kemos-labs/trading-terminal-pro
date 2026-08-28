/**
 * Subjective valuation — price options under custom drift + variance risk premium
 * and compare to market mid (Thalex Subjective Valuation).
 */

import { priceGreeksMarket } from '../math/adapters';
import { normCdf } from '../math/norm';
import { yearFractionFromSlice } from './time';
import type { VolSnapshot, OptionQuote } from './types';

export interface SubjectiveParams {
  /** Subjective drift μ (decimal annualized) */
  drift: number;
  /** Variance risk premium: subjectiveVol = marketIV - vrp (approx) */
  vrp: number;
  /** Floor for subjective vol */
  minVol?: number;
}

export interface SubjectiveRow {
  strike: number;
  type: 'call' | 'put';
  marketMid: number;
  marketIv: number;
  subjectiveVol: number;
  subjectivePrice: number;
  edge: number;
  edgePct: number;
  /** N(d2) under market IV (approx ITM prob risk-neutral) */
  nd2: number;
  /** Subjective ITM-ish using drift-adjusted forward */
  subjProb: number;
}

/**
 * BS price with an adjusted rate so the risk-neutral drift ≈ μ.
 * We set r_eff such that r_eff - q ≈ drift → r_eff = drift + q.
 */
function priceWithDrift(
  type: 'call' | 'put',
  S: number, K: number, T: number, q: number, vol: number, drift: number,
): number {
  const rEff = drift + q;
  return priceGreeksMarket(type, S, K, T, rEff, q, vol).price;
}

export function subjectiveVol(marketIv: number, vrp: number, minVol = 0.01): number {
  return Math.max(minVol, marketIv - vrp);
}

export function evaluateSubjective(
  snap: VolSnapshot,
  expiryIdx: number,
  params: SubjectiveParams,
  type: 'call' | 'put' | 'both' = 'both',
): SubjectiveRow[] {
  const slice = snap.expiries[expiryIdx];
  if (!slice) return [];
  const T = yearFractionFromSlice(slice);
  const S = snap.spot;
  const q = snap.dividendYield;
  const r = snap.riskFreeRate;
  const minVol = params.minVol ?? 0.01;

  const quotes: OptionQuote[] = [];
  if (type === 'call' || type === 'both') quotes.push(...slice.calls);
  if (type === 'put' || type === 'both') quotes.push(...slice.puts);

  const rows: SubjectiveRow[] = [];
  for (const qt of quotes) {
    if (qt.iv == null || qt.iv <= 0) continue;
    const midRaw = qt.mid ?? (qt.bid != null && qt.ask != null ? (qt.bid + qt.ask)/2 : null);
    if (midRaw == null || !(midRaw > 0)) continue;
    const mid = midRaw as number;
    const sVol = subjectiveVol(qt.iv, params.vrp, minVol);
    const sPrice = priceWithDrift(qt.type, S, qt.strike, T, q, sVol, params.drift);
    const edge = sPrice - mid;
    const sqrtT = Math.sqrt(T);
    const d2 = (Math.log(S / qt.strike) + (r - q - 0.5 * qt.iv * qt.iv) * T) / (qt.iv * sqrtT);
    const nd2 = qt.type === 'call' ? normCdf(d2) : normCdf(-d2);
    // Subjective prob under physical measure approx N(d2*) with drift
    const d2s = (Math.log(S / qt.strike) + (params.drift - q - 0.5 * sVol * sVol) * T) / (sVol * sqrtT);
    const subjProb = qt.type === 'call' ? normCdf(d2s) : normCdf(-d2s);

    rows.push({
      strike: qt.strike,
      type: qt.type,
      marketMid: mid,
      marketIv: qt.iv,
      subjectiveVol: sVol,
      subjectivePrice: sPrice,
      edge,
      edgePct: edge / mid,
      nd2,
      subjProb,
    });
  }
  rows.sort((a, b) => a.strike - b.strike || a.type.localeCompare(b.type));
  return rows;
}

export function subjectiveSummary(rows: SubjectiveRow[]): {
  avgEdge: number;
  cheapCount: number;
  richCount: number;
  bestLong: SubjectiveRow | null;
  bestShort: SubjectiveRow | null;
} {
  if (!rows.length) {
    return { avgEdge: 0, cheapCount: 0, richCount: 0, bestLong: null, bestShort: null };
  }
  const avgEdge = rows.reduce((s, r) => s + r.edge, 0) / rows.length;
  const cheapCount = rows.filter(r => r.edge > 0).length;
  const richCount = rows.filter(r => r.edge < 0).length;
  const bestLong = [...rows].sort((a, b) => b.edge - a.edge)[0] ?? null;
  const bestShort = [...rows].sort((a, b) => a.edge - b.edge)[0] ?? null;
  return { avgEdge, cheapCount, richCount, bestLong, bestShort };
}
