/**
 * Balanced strike window helper for surface matrices.
 * Selects up to maxCount strikes nearest to spot, within ±pct, sorted ascending for display.
 * Guarantees nearest ATM (closest to spot) included when reachable.
 */
export function selectStrikeWindow(
  strikes: number[],
  spot: number | null | undefined,
  maxCount = 40,
  pct = 0.18,
): number[] {
  if (!strikes.length) return [];
  // spot unavailable -> fall back to sorted first N (deterministic, no fake spot label)
  if (spot == null || !Number.isFinite(spot) || spot <= 0) {
    return [...strikes].sort((a, b) => a - b).slice(0, maxCount);
  }
  const filtered = strikes.filter((k) => Math.abs(k - spot) / spot < pct);
  const pool = filtered.length ? filtered : [...strikes];
  // Sort by distance to spot, tie-break by strike ascending for determinism
  const byDistance = [...pool].sort((a, b) => {
    const da = Math.abs(a - spot);
    const db = Math.abs(b - spot);
    if (da !== db) return da - db;
    return a - b;
  });
  const window = byDistance.slice(0, Math.min(maxCount, byDistance.length));
  window.sort((a, b) => a - b);
  return window;
}

export function spotStatus(
  spot: number | null | undefined,
  window: number[],
): { offscreen: boolean; nearest: number | null } {
  if (spot == null || !Number.isFinite(spot) || spot <= 0) return { offscreen: true, nearest: null };
  if (!window.length) return { offscreen: true, nearest: null };
  const min = window[0]!;
  const max = window[window.length - 1]!;
  if (spot < min || spot > max) {
    let nearest = window[0]!;
    for (const k of window) if (Math.abs(k - spot) < Math.abs(nearest - spot)) nearest = k;
    return { offscreen: true, nearest };
  }
  let nearest = window[0]!;
  for (const k of window) if (Math.abs(k - spot) < Math.abs(nearest - spot)) nearest = k;
  return { offscreen: false, nearest };
}

/** Interpolated column fraction (0 = first col center, N-1 = last col center). Null if offscreen/unavailable. */
export function spotFraction(spot: number | null | undefined, strikes: number[]): number | null {
  if (spot == null || !Number.isFinite(spot) || spot <= 0) return null;
  if (!strikes.length) return null;
  const min = strikes[0]!;
  const max = strikes[strikes.length - 1]!;
  if (spot < min || spot > max) return null;
  // Exact match
  for (let i = 0; i < strikes.length; i++) if (strikes[i] === spot) return i;
  // Find interval
  for (let i = 0; i < strikes.length - 1; i++) {
    const a = strikes[i]!;
    const b = strikes[i + 1]!;
    if (spot > a && spot < b) {
      const t = (spot - a) / (b - a);
      return i + t;
    }
  }
  // Fallback nearest (should not happen)
  let nearest = 0;
  let best = Infinity;
  for (let i = 0; i < strikes.length; i++) {
    const d = Math.abs(strikes[i]! - spot);
    if (d < best) { best = d; nearest = i; }
  }
  return nearest;
}
