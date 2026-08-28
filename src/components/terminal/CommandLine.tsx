/**
 * Always-on Bloomberg-style command line with categorized autocomplete.
 * Default full-width row, or compact red-bar embed (far-right, GO play).
 * Categories: FUNCTIONS · SECURITIES (ticker) · SEARCH (keyword hits).
 * Enter / GO runs openFunction; Esc clears highlight / blurs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  openFunction,
  searchFunctions,
  type FunctionDescriptor,
} from '../../config/functionRegistry';
import { sanitizeSymbol } from '../../lib/validation';
import { cn } from '../../lib/utils';

export type CmdCategory = 'FUNCTIONS' | 'SECURITIES' | 'SEARCH';

export type CmdRow = {
  key: string;
  category: CmdCategory;
  label: string;
  code: string;
  d?: FunctionDescriptor;
  /** Raw ticker for securities row */
  symbol?: string;
};

interface CommandLineProps {
  onHelp?: () => void;
  onWatchlistFocus?: () => void;
  /** Display / expiry strip toggle (was PanelToolbar — chrome cut) */
  onOpenDisplay?: () => void;
  /** When true, focus input (e.g. after Ctrl+K) */
  focusToken?: number;
  /**
   * `redbar` — compact search docked far-right on the red function bar
   * (yellow ▶ on black GO, logical width, saves a full chrome row).
   */
  variant?: 'full' | 'redbar';
}

function categorize(query: string, hits: FunctionDescriptor[]): CmdRow[] {
  const q = query.trim();
  const upper = q.toUpperCase();
  const rows: CmdRow[] = [];

  // Exact / prefix code matches → FUNCTIONS
  const functions = hits.filter((d) =>
    d.codes.some(
      (c) =>
        c.toUpperCase() === upper ||
        c.toUpperCase().startsWith(upper) ||
        (!q && d.codes.length > 0),
    ),
  );
  for (const d of functions.slice(0, 8)) {
    rows.push({
      key: `fn-${d.functionId}`,
      category: 'FUNCTIONS',
      label: d.label,
      code: d.codes[0] ?? d.functionId,
      d,
    });
  }

  // Bare ticker-looking input → SECURITIES
  if (q && /^[A-Za-z][A-Za-z0-9./-]{0,11}$/.test(q)) {
    const sym = sanitizeSymbol(q);
    if (sym) {
      rows.push({
        key: `sec-${sym}`,
        category: 'SECURITIES',
        label: `Load ${sym}`,
        code: sym,
        symbol: sym,
      });
    }
  }

  // Remaining keyword hits → SEARCH
  const used = new Set(rows.map((r) => r.d?.functionId).filter(Boolean));
  for (const d of hits) {
    if (used.has(d.functionId)) continue;
    if (rows.length >= 14) break;
    rows.push({
      key: `sr-${d.functionId}`,
      category: 'SEARCH',
      label: d.label,
      code: d.codes[0] ?? d.functionId,
      d,
    });
  }

  return rows;
}

export function CommandLine({
  onHelp,
  onWatchlistFocus,
  onOpenDisplay,
  focusToken = 0,
  variant = 'full',
}: CommandLineProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const redbar = variant === 'redbar';

  const hits = useMemo(() => searchFunctions(query, 16), [query]);
  const rows = useMemo(() => categorize(query, hits), [query, hits]);

  useEffect(() => {
    if (focusToken > 0) {
      inputRef.current?.focus();
      setOpen(true);
    }
  }, [focusToken]);

  useEffect(() => {
    setHi(0);
  }, [query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const run = useCallback(
    (row?: CmdRow | null) => {
      if (row?.symbol) {
        openFunction(row.symbol, { onHelp, onWatchlistFocus });
        setQuery('');
        setOpen(false);
        return;
      }
      if (row?.d) {
        openFunction(row.d.codes[0] ?? row.d.functionId, {
          onHelp,
          onWatchlistFocus,
        });
        setQuery('');
        setOpen(false);
        return;
      }
      const raw = query.trim();
      if (!raw) return;
      const r = openFunction(raw, { onHelp, onWatchlistFocus });
      if (r.ok) {
        setQuery('');
        setOpen(false);
      }
    },
    [query, onHelp, onWatchlistFocus],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (open) setOpen(false);
      else {
        setQuery('');
        inputRef.current?.blur();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHi((i) => Math.min(i + 1, Math.max(0, rows.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && rows[hi]) run(rows[hi]);
      else run(null);
    }
  };

  // Group headers for dropdown
  let lastCat: CmdCategory | null = null;

  return (
    <div
      ref={wrapRef}
      className={cn(
        'relative flex shrink-0 items-stretch',
        redbar
          ? 'h-full w-[min(14rem,32vw)] min-w-[9.5rem] max-w-[16rem] border-l border-white/25 bg-black/50'
          : 'h-6 border-b border-border bg-[#060a10]',
      )}
      role="group"
      aria-label="Command line"
    >
      {/* Yellow ▶ on black — BBG GO / play */}
      <button
        type="button"
        className={cn(
          'flex shrink-0 items-center justify-center font-bold leading-none',
          redbar
            ? 'w-5 bg-black text-amber-400 hover:bg-black/90 hover:text-amber-300'
            : 'w-7 bg-primary text-primary-foreground',
        )}
        title="GO — run command"
        aria-label="GO"
        onClick={() => run(open && rows[hi] ? rows[hi] : null)}
      >
        <span className={cn(redbar ? 'text-[10px]' : 'text-sm')}>▶</span>
      </button>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={redbar ? 'Search…' : '<Search functions & securities — Enter GO>'}
        className={cn(
          'min-w-0 flex-1 bg-transparent font-mono outline-none',
          redbar
            ? 'px-1 text-type-2xs text-white placeholder:text-white/40'
            : 'px-2 text-type-sm text-foreground placeholder:text-muted-foreground',
        )}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-controls="cmd-line-list"
        aria-expanded={open && rows.length > 0}
      />
      {!redbar && (
        <>
          <kbd className="mr-1 hidden self-center border border-border/60 px-1 py-0.5 font-mono text-type-2xs text-muted-foreground lg:inline">
            Enter
          </kbd>
          {onOpenDisplay && (
            <button
              type="button"
              title="Display / expiries strip"
              onClick={onOpenDisplay}
              className="shrink-0 border-l border-border/70 px-1.5 font-mono text-type-2xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            >
              Disp
            </button>
          )}
          <button
            type="button"
            title="Help (?)"
            onClick={() => onHelp?.()}
            className="shrink-0 border-l border-border/70 px-1.5 font-mono text-type-2xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          >
            ?
          </button>
        </>
      )}

      {open && rows.length > 0 && (
        <ul
          id="cmd-line-list"
          role="listbox"
          className={cn(
            'absolute z-50 max-h-80 overflow-y-auto border border-border bg-card shadow-2xl',
            redbar
              ? 'right-0 top-full w-[min(22rem,90vw)]'
              : 'left-0 right-0 top-full',
          )}
        >
          {rows.map((row, i) => {
            const showHead = row.category !== lastCat;
            lastCat = row.category;
            return (
              <li key={row.key}>
                {showHead && (
                  <div className="border-b border-border/50 bg-muted/40 px-2 py-0.5 font-mono text-type-2xs font-semibold uppercase tracking-wider text-primary">
                    {row.category}
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === hi}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-2 py-1 text-left font-mono text-type-xs',
                    i === hi
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-muted/50',
                  )}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => run(row)}
                >
                  <span className="truncate">{row.label}</span>
                  <span className="term-code shrink-0">{row.code}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
