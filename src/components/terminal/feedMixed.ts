import type { FreshnessKind } from '../../lib/data/freshness';

/**
 * Aggregate feed label — pure UI decision, no store/math change.
 *
 * Returns `'Mixed'` exactly when spot and chain freshness disagree, so the
 * global status never claims all-live while one resource is stale (or vice
 * versa). Returns `null` when they agree — the summary chip alone already
 * tells the truth then. Unknown-vs-live also counts as mixed (partial truth),
 * never silently live.
 */
export function feedMixedLabel(spot: FreshnessKind, chain: FreshnessKind): 'Mixed' | null {
  if (spot === chain) return null;
  return 'Mixed';
}
