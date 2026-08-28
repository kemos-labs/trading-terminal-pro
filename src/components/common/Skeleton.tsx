import type { CSSProperties } from 'react';
import { cn } from '../../lib/utils';

/**
 * Muted shimmer skeleton (D-PR-3). Replaces animate-pulse "LOADING…" strings.
 * respects prefers-reduced-motion via .skeleton CSS.
 */
export function Skeleton({
  className,
  style,
  label = 'Loading',
}: {
  className?: string;
  style?: CSSProperties;
  /** Accessible name for the work in progress */
  label?: string;
}) {
  return (
    <div
      className={cn('skeleton', className)}
      style={style}
      aria-busy="true"
      aria-label={label}
      role="status"
    />
  );
}

/** Multi-row desk section placeholder */
export function SectionSkeleton({
  rows = 3,
  className,
  label = 'Fitting surface…',
}: {
  rows?: number;
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={cn('flex flex-col gap-2 p-2', className)}
      aria-busy="true"
      aria-label={label}
      role="status"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-16 border border-border"
          style={{ opacity: 1 - i * 0.12 }}
          label={i === 0 ? label : undefined}
        />
      ))}
    </div>
  );
}

/** Centered desk loading with named work copy */
export function DeskLoading({
  message = 'Loading…',
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-full flex-col items-center justify-center gap-3 term-fade-in',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Skeleton className="h-2 w-40" label={message} />
      <p className="font-mono text-type-xs text-foreground">{message}</p>
    </div>
  );
}
