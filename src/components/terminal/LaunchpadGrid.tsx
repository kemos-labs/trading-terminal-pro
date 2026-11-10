/**
 * Home launchpad — registry-driven function codes.
 * W5: denser black-field mono grid (Bloomberg-style function board).
 */
import { useMemo } from 'react';
import {
  LAUNCHPAD_CODES,
  openFunction,
  resolveFunctionId,
} from '../../config/functionRegistry';
import { cn } from '../../lib/utils';

export function LaunchpadGrid({ className }: { className?: string }) {
  const items = useMemo(() => {
    return LAUNCHPAD_CODES.map((code) => {
      const d = resolveFunctionId(code);
      return {
        code,
        label: d?.label ?? code,
        ok: !!d,
      };
    }).filter((x) => x.ok);
  }, []);

  return (
    <div
      data-testid="launchpad-grid"
      className={cn('flex flex-col rounded border border-border bg-black/40', className)}
    >
      <div className="flex items-center justify-between border-b border-border/60 px-2 py-0.5 font-mono text-type-2xs">
        <span>
          <span className="font-bold tracking-wider text-amber-500/90">LPAD</span>
          <span className="ml-1.5 text-muted-foreground">function codes</span>
        </span>
        <span className="text-muted-foreground">Ctrl/Cmd+K</span>
      </div>
      <div className="grid flex-1 auto-rows-fr grid-cols-3 gap-px bg-border/80 p-px sm:grid-cols-4 md:grid-cols-7">
        {items.map((it) => (
          <button
            key={it.code}
            type="button"
            onClick={() => openFunction(it.code)}
            title={it.label}
            className="bg-black/60 px-1.5 py-1 text-left font-mono transition-colors hover:bg-secondary/80"
          >
            <div className="text-type-xs font-semibold tracking-wide text-foreground">{it.code}</div>
            <div className="truncate text-type-2xs text-muted-foreground">{it.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
