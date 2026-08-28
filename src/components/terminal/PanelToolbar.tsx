/**
 * Bloomberg-style panel toolbar:
 * security dropdown · function mnemonic · Related Functions Menu · utility icons
 * Evidence: student-guide panel anatomy (toolbar above command line).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import {
  currentFunctionLabel,
  relatedFunctions,
} from '../../config/relatedFunctions';
import { openFunction, type FunctionDescriptor } from '../../config/functionRegistry';
import { cn } from '../../lib/utils';
import { SymbolDialog } from './SymbolDialog';

interface PanelToolbarProps {
  onHelp?: () => void;
  onWatchlistFocus?: () => void;
  onOpenDisplay?: () => void;
}

export function PanelToolbar({
  onHelp,
  onWatchlistFocus,
  onOpenDisplay,
}: PanelToolbarProps) {
  const symbol = useTerminalStore((s) => s.symbol);
  const activeTab = useTerminalStore((s) => s.activeTab);
  const sectionId = useTerminalStore((s) => s.deskSectionId);
  const setSymbol = useTerminalStore((s) => s.setSymbol);
  const [symOpen, setSymOpen] = useState(false);
  const [relOpen, setRelOpen] = useState(false);
  const relRef = useRef<HTMLDivElement>(null);

  const { code, label } = currentFunctionLabel(activeTab, sectionId);
  const related = relatedFunctions(activeTab, sectionId);

  useEffect(() => {
    if (!relOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (relRef.current && !relRef.current.contains(e.target as Node)) {
        setRelOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [relOpen]);

  const runRelated = useCallback(
    (d: FunctionDescriptor) => {
      openFunction(d.codes[0] ?? d.functionId, {
        onHelp,
        onWatchlistFocus,
      });
      setRelOpen(false);
    },
    [onHelp, onWatchlistFocus],
  );

  return (
    <>
      <div
        className="flex h-6 shrink-0 items-center gap-1 border-b border-border bg-[#0a0e14] px-1 font-mono text-type-2xs sm:px-1.5"
        role="toolbar"
        aria-label="Panel toolbar"
      >
        {/* Panel back/forward chrome (visual only — single panel v1) */}
        <span className="hidden text-muted-foreground sm:inline" aria-hidden>
          ◂ ▸
        </span>

        {/* Security */}
        <button
          type="button"
          onClick={() => setSymOpen(true)}
          className="flex max-w-[10rem] items-center gap-0.5 border border-border/80 bg-background px-1.5 py-0.5 text-foreground hover:border-primary/50 sm:max-w-[14rem]"
          title="Load security"
        >
          <span className="truncate font-semibold text-primary">{symbol}</span>
          <span className="text-muted-foreground">Equity</span>
          <span className="text-muted-foreground/70">▼</span>
        </button>

        {/* Function mnemonic box */}
        <div
          className="flex min-w-[2.5rem] items-center justify-center border border-border/80 bg-background px-1.5 py-0.5 font-bold tracking-wider text-primary"
          title={label}
          aria-label={`Function ${code}`}
        >
          {code}
        </div>

        {/* Related Functions Menu */}
        <div className="relative" ref={relRef}>
          <button
            type="button"
            onClick={() => setRelOpen((o) => !o)}
            className={cn(
              'flex items-center gap-1 border border-border/80 bg-background px-1.5 py-0.5 text-muted-foreground hover:border-primary/40 hover:text-foreground',
              relOpen && 'border-primary/50 text-primary',
            )}
            aria-haspopup="menu"
            aria-expanded={relOpen}
            title="Related Functions Menu"
          >
            <span className="hidden sm:inline">Related Functions Menu</span>
            <span className="sm:hidden">Related</span>
            <span aria-hidden>▼</span>
          </button>
          {relOpen && (
            <ul
              role="menu"
              className="absolute left-0 top-full z-50 mt-0.5 max-h-72 w-64 overflow-y-auto border border-border bg-card py-0.5 shadow-xl"
            >
              {related.length === 0 && (
                <li className="px-2 py-1.5 text-muted-foreground">No related</li>
              )}
              {related.map((d) => (
                <li key={d.functionId} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left hover:bg-secondary"
                    onClick={() => runRelated(d)}
                  >
                    <span className="truncate text-muted-foreground">{d.label}</span>
                    <span className="term-code shrink-0 text-type-2xs">
                      {d.codes[0] ?? d.functionId}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <span className="ml-1 hidden truncate text-muted-foreground lg:inline">
          {label}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onOpenDisplay}
            className="border border-border/60 px-1.5 py-0.5 text-muted-foreground hover:text-primary"
            title="Display / expiry / chain sources"
          >
            Display
          </button>
          <button
            type="button"
            onClick={onHelp}
            className="border border-border/60 px-1 py-0.5 text-muted-foreground hover:text-primary"
            title="Help / shortcuts"
          >
            ?
          </button>
        </div>
      </div>
      {symOpen && (
        <SymbolDialog
          onSelect={(sym) => {
            setSymbol(sym);
            setSymOpen(false);
          }}
          onClose={() => setSymOpen(false)}
        />
      )}
    </>
  );
}
