/**
 * Domain-aware data freshness — all thresholds in milliseconds.
 * UI chips (Freshness / DataBadge / StatusBar) should prefer this module.
 */

export type FreshnessDomain = 'spot' | 'chain' | 'macro' | 'crypto' | 'stream';

export type FreshnessKind =
  | 'live'
  | 'delayed'
  | 'stale'
  | 'expired'
  | 'demo'
  | 'down'
  | 'unknown';

export interface FreshnessThresholds {
  delayedMs: number;
  staleMs: number;
  expiredMs: number;
}

/** Domain defaults (ms). Macro matches DataBadge 15m/30m. */
export const FRESHNESS_THRESHOLDS: Record<FreshnessDomain, FreshnessThresholds> = {
  spot: { delayedMs: 45_000, staleMs: 90_000, expiredMs: 600_000 },
  chain: { delayedMs: 60_000, staleMs: 180_000, expiredMs: 900_000 },
  crypto: { delayedMs: 45_000, staleMs: 120_000, expiredMs: 600_000 },
  macro: { delayedMs: 900_000, staleMs: 1_800_000, expiredMs: 14_400_000 },
  stream: { delayedMs: 5_000, staleMs: 30_000, expiredMs: 120_000 },
};

export interface DataProvenance {
  domain: FreshnessDomain;
  source: string;
  asOfMs: number | null;
  fetchedAtMs: number;
  kind: FreshnessKind;
  label?: string;
  sourceKind?: FreshnessKind;
}

export type StoreProvenance = {
  spot: DataProvenance | null;
  chain: DataProvenance | null;
  cryptoBtc: DataProvenance | null;
  cryptoEth: DataProvenance | null;
  macro: DataProvenance | null;
};

export const EMPTY_PROVENANCE: StoreProvenance = {
  spot: null,
  chain: null,
  cryptoBtc: null,
  cryptoEth: null,
  macro: null,
};

/**
 * Classify age with optional hysteresis when leaving LIVE:
 * stay LIVE until age > delayedMs * leaveLiveFactor (default 1.2).
 * Provider freshness is a constraint: local age may downgrade but never upgrade
 * delayed/stale/expired/down/unknown to live. Delayed may still age to stale/expired.
 */
export function classifyDomainFreshness(
  asOfMs: number | null | undefined,
  domain: FreshnessDomain,
  opts?: {
    demo?: boolean;
    down?: boolean;
    previousKind?: FreshnessKind;
    leaveLiveFactor?: number;
    nowMs?: number;
    delayed?: boolean;
    sourceKind?: FreshnessKind;
    sourceFreshness?: FreshnessKind;
  },
): FreshnessKind {
  if (opts?.down) return 'down';
  if (opts?.demo) return 'demo';
  const rawSource = opts?.sourceKind ?? opts?.sourceFreshness ?? (opts?.delayed ? 'delayed' : undefined);
  const sourceKind = rawSource as FreshnessKind | undefined;
  // Unknown observation time is unknown, not live — never substitute fetch time.
  if (asOfMs == null || !Number.isFinite(asOfMs) || asOfMs <= 0) {
    // If source explicitly says live but time unknown, still unknown (conservative)
    if (sourceKind && sourceKind !== 'live') return sourceKind;
    return 'unknown';
  }

  const now = opts?.nowMs ?? Date.now();
  const age = Math.max(0, now - asOfMs);
  const t = FRESHNESS_THRESHOLDS[domain];

  // Base age-derived kind without hysteresis
  let ageKind: FreshnessKind;
  if (age < t.delayedMs) ageKind = 'live';
  else if (age < t.staleMs) ageKind = 'delayed';
  else if (age < t.expiredMs) ageKind = 'stale';
  else ageKind = 'expired';

  // Apply source constraint: worst of source vs age (allow natural aging downgrade)
  let kind: FreshnessKind = ageKind;
  if (sourceKind) {
    const valid: FreshnessKind[] = ['live', 'delayed', 'stale', 'expired', 'demo', 'down', 'unknown'];
    const s: FreshnessKind = valid.includes(sourceKind) ? (sourceKind as FreshnessKind) : 'unknown';
    if (s !== 'live') {
      kind = worstFreshnessKind(s, ageKind);
    }
  }

  // Hysteresis must not override provider downgrade: only when source allows live
  const sourceAllowsLive = !sourceKind || sourceKind === 'live';
  if (sourceAllowsLive && opts?.previousKind === 'live' && kind !== 'live') {
    const leaveLive = (opts?.leaveLiveFactor ?? 1.2) * t.delayedMs;
    if (age <= leaveLive) {
      // Still hysteresis live only if not constrained by source downgrade
      return 'live';
    }
  }
  // If source constrained to delayed/stale/etc, hysteresis cannot promote back to live
  if (!sourceAllowsLive && kind !== 'live' && opts?.previousKind === 'live') {
    // keep clamped kind (delayed/stale...), do not return live
  }
  return kind;
}

/** Build a provenance record for store / StatusBar. */
export function makeProvenance(
  domain: FreshnessDomain,
  source: string,
  asOfMs: number | null,
  opts?: { demo?: boolean; down?: boolean; label?: string; fetchedAtMs?: number; previousKind?: FreshnessKind; delayed?: boolean; sourceKind?: FreshnessKind; sourceFreshness?: FreshnessKind },
): DataProvenance {
  const fetchedAtMs = opts?.fetchedAtMs ?? Date.now();
  const sourceKind = opts?.sourceKind ?? opts?.sourceFreshness ?? (opts?.delayed ? 'delayed' : undefined);
  const kind = classifyDomainFreshness(asOfMs, domain, {
    demo: opts?.demo,
    down: opts?.down,
    previousKind: opts?.previousKind,
    delayed: opts?.delayed,
    sourceKind: sourceKind as FreshnessKind | undefined,
  });
  return {
    domain,
    source,
    asOfMs,
    fetchedAtMs,
    kind,
    label: opts?.label,
    sourceKind: sourceKind as FreshnessKind | undefined,
  };
}

/**
 * Recompute domain freshness from asOf + previous store kind.
 * Shared by StatusBar and TerminalHeader so missing→down / hysteresis stay in lockstep.
 */
export function kindFromProvenance(
  previousKind: FreshnessKind | undefined,
  asOfMs: number | null | undefined,
  domain: FreshnessDomain,
  opts?: { demo?: boolean; down?: boolean; nowMs?: number; delayed?: boolean; sourceKind?: FreshnessKind; sourceFreshness?: FreshnessKind },
): FreshnessKind {
  return classifyDomainFreshness(asOfMs, domain, {
    demo: opts?.demo,
    down: opts?.down,
    previousKind,
    nowMs: opts?.nowMs,
    delayed: opts?.delayed,
    sourceKind: (opts?.sourceKind ?? opts?.sourceFreshness) as FreshnessKind | undefined,
  });
}

/**
 * Worst (least trusted) freshness among kinds — for header summary chips.
 * Rank: down < expired < stale < delayed < unknown < live.
 * `demo` ranks with stale (synthetic is not market-live).
 */
const FRESHNESS_RANK: Record<FreshnessKind, number> = {
  down: 0,
  expired: 1,
  stale: 2,
  demo: 2,
  delayed: 3,
  unknown: 4,
  live: 5,
};

export function worstFreshnessKind(...kinds: FreshnessKind[]): FreshnessKind {
  if (kinds.length === 0) return 'unknown';
  let worst = kinds[0]!;
  let worstRank = FRESHNESS_RANK[worst];
  for (let i = 1; i < kinds.length; i++) {
    const k = kinds[i]!;
    const r = FRESHNESS_RANK[k];
    if (r < worstRank) {
      worst = k;
      worstRank = r;
    }
  }
  return worst;
}

/** YYYY-MM-DD only — FRED/NYFed observation dates, not fetch timestamps. */
export function isObservationDateOnly(asOf: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(asOf.trim());
}

/**
 * Legacy ISO / minute-based classifier (DataBadge / macro widgets).
 * Defaults: delayed 15m, stale **30m** (aligned with DataBadge, not the old 60).
 *
 * Date-only stamps (YYYY-MM-DD) use **daily print** cadence so SOFR T−1/T−3
 * is LIVE/DELAYED, not false EXPIRED (minute thresholds are for feeds).
 */
export function classifyFreshnessFromIso(
  asOf: string | null | undefined,
  opts?: {
    delayedMin?: number;
    staleMin?: number;
    demo?: boolean;
    down?: boolean;
    /** Force daily observation cadence even when asOf includes a time. */
    daily?: boolean;
  },
): FreshnessKind {
  if (opts?.down) return 'down';
  if (opts?.demo) return 'demo';
  if (!asOf) return 'unknown';
  const trimmed = asOf.trim();
  const date = new Date(trimmed);
  if (isNaN(date.getTime())) return 'unknown';

  const useDaily = opts?.daily || isObservationDateOnly(trimmed);
  if (useDaily) {
    // Calendar days since print (UTC date of stamp vs local today is fine for UI).
    const ageDays = (Date.now() - date.getTime()) / 86_400_000;
    if (ageDays < 2.5) return 'live'; // T+0 … weekend → Mon SOFR still LIVE
    if (ageDays < 6) return 'delayed';
    if (ageDays < 14) return 'stale';
    return 'expired';
  }

  const delayedMin = opts?.delayedMin ?? 15;
  const staleMin = opts?.staleMin ?? 30;
  const ageMin = (Date.now() - date.getTime()) / 60_000;
  if (ageMin < delayedMin) return 'live';
  if (ageMin < staleMin) return 'delayed';
  if (ageMin < staleMin * 4) return 'stale';
  return 'expired';
}
