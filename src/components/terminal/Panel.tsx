import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { ApiSources } from '../macrovol/ApiSources';

interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  subtitle?: string;
  /** API provenance chips (Phase B panel chrome). */
  apis?: string[];
  /** Optional as-of / freshness string shown after title. */
  asOf?: string;
  actions?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Standard terminal panel chrome: title · API · as-of · badge · actions.
 */
export function Panel({
  title,
  subtitle,
  apis,
  asOf,
  actions,
  badge,
  children,
  className,
  ...htmlProps
}: PanelProps) {
  const showHead = title || actions || (apis && apis.length) || asOf || badge;
  return (
    <div {...htmlProps} className={cn('term-panel flex flex-col overflow-hidden', className)}>
      {showHead && (
        <div className="term-fn-bar justify-between gap-2 normal-case tracking-normal">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            {title && (
              <h3 className="text-panel-title font-semibold uppercase tracking-wide text-primary">
                {title}
              </h3>
            )}
            {apis && apis.length > 0 && <ApiSources apis={apis} />}
            {asOf && (
              <span className="font-mono text-type-2xs text-muted-foreground/80 tabular-nums" title="As of">
                {asOf}
              </span>
            )}
            {subtitle && <span className="text-type-xs text-muted-foreground">{subtitle}</span>}
            {badge}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
