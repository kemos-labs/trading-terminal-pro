/**
 * OI-derived exposure proxy — GEX/DEX/vanna/charm per explicit sign model.
 * Missing OI → unavailable, never volume fallback. Units are delta-notional.
 */

export type Sign = 1 | -1;

export interface PositionRow {
  strike: number;
  expiryMs: number;
  oi: number | null; // underlying amount units (Deribit) or null if missing
  contracts?: number; // alternative when feed reports contracts
  multiplier?: number; // contract multiplier, applied once if OI is in contracts
  gamma: number; // per underlying, raw gamma
  delta: number;
  vannaRaw: number; // per 1.0 vol
  charmRaw: number; // per year, -d delta / dT
  spot: number;
}

export interface ExposureResult {
  gex: number | null; // per 1% move: sign * gamma * Q * S^2 *0.01
  dex: number | null; // sign * delta * Q * S
  vanna: number | null; // per 1 vol point
  charm: number | null; // per day
  coverage: number; // fraction of rows with OI
  missingOiCount: number;
}

export function normalizeQuantity(row: PositionRow): number | null {
  if (row.oi != null && isFinite(row.oi)) return row.oi;
  // Do NOT fallback to volume or unit weight — return null for missing OI
  return null;
}

export function aggregateExposure(
  rows: PositionRow[],
  sign: (row: PositionRow) => Sign,
  _shock?: unknown,
): { perRow: ExposureResult[]; total: ExposureResult } {
  let missing = 0;
  const perRow: ExposureResult[] = rows.map(r => {
    const Q = normalizeQuantity(r);
    if (Q == null) {
      missing++;
      return { gex: null, dex: null, vanna: null, charm: null, coverage: 0, missingOiCount: 1 };
    }
    const s = sign(r) as number;
    const S = r.spot;
    const gex = s * r.gamma * Q * S * S * 0.01;
    const dex = s * r.delta * Q * S;
    const vanna = s * r.vannaRaw * 0.01 * Q * S;
    const charm = s * r.charmRaw / 365 * Q * S;
    return { gex, dex, vanna, charm, coverage: 1, missingOiCount: 0 };
  });

  const coverage = rows.length ? (rows.length - missing) / rows.length : 0;
  const sum = (arr: (number | null)[]) => {
    const valid = arr.filter(v => v != null) as number[];
    if (!valid.length) return null;
    return valid.reduce((a,b)=>a+b,0);
  };
  const total: ExposureResult = {
    gex: sum(perRow.map(r=>r.gex)),
    dex: sum(perRow.map(r=>r.dex)),
    vanna: sum(perRow.map(r=>r.vanna)),
    charm: sum(perRow.map(r=>r.charm)),
    coverage,
    missingOiCount: missing,
  };
  return { perRow, total };
}
