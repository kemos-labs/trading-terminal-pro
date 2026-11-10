import type { DeribitMarketBundle } from '../../../api/deribit';
import type { SurfaceGrid } from '../../../lib/options/types';
import { activeExpiryMs } from './CryptoVolatilityView';

export interface CryptoSurface {
  grid: SurfaceGrid;
  spot: number;
}

function isFiniteIv(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Pure adapter: DeribitMarketBundle → SurfaceGrid for IvSurface3D.
 * - Maps observed finite markIv cells to strike × expiry grid
 * - Missing/null/NaN/Infinity stay holes (null), never 0 or interpolated
 * - Units remain decimal IV (UI multiplies ×100)
 * - Expired contracts excluded; single expiry/strike returns null (honest empty)
 * - Bid/ask layers kept separate; returned iv is observed markIv only
 */
export function deribitBundleToSurfaceGrid(
  bundle: DeribitMarketBundle | null | undefined,
  nowMs: number = Date.now(),
): CryptoSurface | null {
  if (!bundle || !Array.isArray(bundle.instruments) || bundle.instruments.length === 0) return null;

  const spot = bundle.indexPrice;
  if (spot == null || !Number.isFinite(spot) || spot <= 0) return null;

  const active = bundle.instruments.filter(
    (t) => t.expiryMs != null && t.strike != null && activeExpiryMs(t.expiryMs, nowMs) && t.kind === 'option',
  );
  if (active.length === 0) return null;

  const expirySet = [...new Set(active.map((t) => t.expiryMs as number))].sort((a, b) => a - b);
  const strikeSet = [...new Set(active.map((t) => t.strike as number))].sort((a, b) => a - b);

  // Honest empty: need at least 2 expiries and 2 strikes for a surface
  if (expirySet.length < 2 || strikeSet.length < 2) return null;

  const expiries = expirySet.map((ms) => new Date(ms).toISOString().slice(0, 10));
  const dtes = expirySet.map((ms) => Math.round((ms - nowMs) / 864e5));

  // Build strike→index and expiry→index maps
  const strikeIdx = new Map<number, number>();
  strikeSet.forEach((k, i) => strikeIdx.set(k, i));
  const expiryIdx = new Map<number, number>();
  expirySet.forEach((e, i) => expiryIdx.set(e, i));

  // Initialize holes
  const iv: (number | null)[][] = expirySet.map(() => strikeSet.map(() => null));
  const bid: (number | null)[][] = expirySet.map(() => strikeSet.map(() => null));
  const ask: (number | null)[][] = expirySet.map(() => strikeSet.map(() => null));
  const delta: (number | null)[][] = expirySet.map(() => strikeSet.map(() => null));

  for (const t of active) {
    const r = expiryIdx.get(t.expiryMs as number);
    const c = strikeIdx.get(t.strike as number);
    if (r == null || c == null) continue;
    // Only set first observed cell; don't overwrite with duplicate
    if (iv[r]![c] !== null) continue;
    const v = t.markIv;
    iv[r]![c] = isFiniteIv(v) ? v : null;
    bid[r]![c] = isFiniteIv(t.bidIv) ? t.bidIv as number : null;
    ask[r]![c] = isFiniteIv(t.askIv) ? t.askIv as number : null;
    // delta not in Deribit bundle currently; keep null
  }

  // Verify no NaN/Infinity leaked
  for (const row of iv) for (const v of row) if (v != null && !Number.isFinite(v)) return null;

  // If no observed cell at all, honest empty
  const hasObserved = iv.some((row) => row.some((v) => v != null));
  if (!hasObserved) return null;

  const grid: SurfaceGrid = {
    expiries,
    dtes,
    strikes: strikeSet,
    iv,
    bid,
    ask,
    delta,
  };
  return { grid, spot };
}
