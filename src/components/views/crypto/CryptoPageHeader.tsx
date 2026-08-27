import type { ReactNode } from 'react';

/**
 * Reference-style detail page header: large white title, highlight word in
 * italic teal, and a muted multi-line description. Mirrors the analytical
 * product hierarchy (title → subtitle → page body) rather than the compact
 * terminal fn-bar chrome.
 */
export function CryptoPageHeader({
  title,
  highlight,
  description,
  actions,
}: {
  title: string;
  /** A trailing word rendered in italic teal (e.g. "heatmap"). */
  highlight?: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="shrink-0 border-b border-[#20282b] px-4 py-3 bg-[#050708]">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-[19px] font-bold tracking-[0.02em] text-white">
          {title}
          {highlight ? (
            <span className="text-[22px] italic text-[#25d7c5]"> {highlight}</span>
          ) : null}
        </h1>
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {description && (
        <p className="mt-1 max-w-[120ch] text-[12px] leading-snug text-[#8b999f] font-mono">
          {description}
        </p>
      )}
    </div>
  );
}