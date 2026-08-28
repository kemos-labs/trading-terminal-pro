import { FreshnessFromAsOf, formatRelative, classifyFreshness } from '../common/Freshness';

interface DataBadgeProps {
  asOf?: string | null;
  source?: string | null;
  note?: string | null;
  staleThresholdMin?: number;
  delayedThresholdMin?: number;
  /** Daily FRED/NYFed print cadence (also auto for YYYY-MM-DD asOf). */
  daily?: boolean;
  demo?: boolean;
  down?: boolean;
  className?: string;
}

/**
 * Provenance + freshness for any widget (Phase D).
 * Shows LIVE / DELAYED / STALE / EXPIRED chip + relative age + source.
 */
export function DataBadge({
  asOf,
  source,
  note,
  staleThresholdMin = 30,
  delayedThresholdMin = 15,
  daily,
  demo,
  down,
  className = '',
}: DataBadgeProps) {
  if (!asOf && !source && !down && !demo) return null;

  const kind = classifyFreshness(asOf, {
    staleMin: staleThresholdMin,
    delayedMin: delayedThresholdMin,
    demo,
    down,
    daily,
  });

  return (
    <div
      className={`flex flex-wrap items-center gap-2 text-type-xs font-mono text-muted-foreground ${className}`}
      title={note || (asOf ? `As of: ${new Date(asOf).toLocaleString()}` : undefined)}
      data-freshness={kind}
    >
      <FreshnessFromAsOf
        asOf={asOf}
        staleMin={staleThresholdMin}
        delayedMin={delayedThresholdMin}
        daily={daily}
        demo={demo}
        down={down}
      />
      {source && <span className="text-muted-foreground/90">{source}</span>}
      {source && asOf && <span className="opacity-80">·</span>}
      {asOf && <span className="tabular-nums">{formatRelative(asOf)}</span>}
      {note && <span className="opacity-80">· {note}</span>}
    </div>
  );
}
