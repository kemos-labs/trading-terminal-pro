/**
 * Red function bar — main desks hard-left (hover each for tree dropdown);
 * active desk + baby tabs mid; compact search far-right.
 */
import { useState } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import { functionMenuSections } from '../../config/relatedFunctions';
import { findSectionMeta, sectionsForTab, tabLabel } from '../../config/deskNav';
import { resolveTradeModeSection } from '../../config/deskSections';
import { setDeskJump } from '../../lib/market/deskJump';
import { cn } from '../../lib/utils';
import { TABS } from './tabs';
import type { ActiveTab } from '../../lib/options/types';
import { CommandLine } from './CommandLine';

interface FunctionMenuBarProps {
  onHelp?: () => void;
  onWatchlistFocus?: () => void;
  onOpenDisplay?: () => void;
  focusToken?: number;
}

export function FunctionMenuBar({
  onHelp,
  onWatchlistFocus,
  onOpenDisplay,
  focusToken = 0,
}: FunctionMenuBarProps) {
  const activeTab = useTerminalStore((s) => s.activeTab);
  const sectionId = useTerminalStore((s) => s.deskSectionId);
  const setActiveTab = useTerminalStore((s) => s.setActiveTab);
  const setDeskSection = useTerminalStore((s) => s.setDeskSection);
  const [openTree, setOpenTree] = useState<string | null>(null);

  const sections = functionMenuSections(activeTab);
  const activeDeskLabel = tabLabel(activeTab);

  const goDesk = (id: ActiveTab) => {
    setActiveTab(id);
    const first = sectionsForTab(id)[0]?.id;
    if (first) {
      queueMicrotask(() => setDeskSection(first));
    }
  };

  const goSection = (id: string) => {
    setDeskJump(id);
    const meta = findSectionMeta(id, activeTab);
    useTerminalStore.getState().setDeskContext({
      id,
      label: meta?.label ?? id,
      apis: meta?.apis,
    });
    setDeskSection(id);
    requestAnimationFrame(() => {
      // Mode desks + Academy filters switch via store only (no DOM section anchors).
      if (
        !id.startsWith('vol-sub-')
        && !id.startsWith('greeks-sub-')
        && !id.startsWith('desk-ws-')
        && !id.startsWith('trade-sub-')
        && !id.startsWith('pos-sub-')
        && !id.startsWith('crypto-sub-')
        && !id.startsWith('crypto-ws-')
        && !id.startsWith('rates-mode-')
        && !id.startsWith('academy-sub-')
      ) {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  };

  const goBaby = (tabId: ActiveTab, sectionId: string) => {
    setDeskJump(sectionId);
    setActiveTab(tabId);
    const meta = findSectionMeta(sectionId, tabId);
    useTerminalStore.getState().setDeskContext({
      id: sectionId,
      label: meta?.label ?? sectionId,
      apis: meta?.apis,
    });
    setDeskSection(sectionId);
    setOpenTree(null);
  };

  const handleMouseEnter = (id: string) => {
    setOpenTree(id);
  };

  const handleMouseLeave = () => {
    setOpenTree(null);
  };

  return (
    <div
      className="term-fn-bar-red flex h-5 shrink-0 items-stretch gap-0 overflow-x-auto overflow-y-visible scrollbar-none"
      role="menubar"
      aria-label="Main desks and sections"
    >
      {/* LEFT — main desks, each with a hover tree */}
      <div className="flex shrink-0 items-stretch" role="group" aria-label="Main desks">
        {TABS.map((t) => {
          const on = activeTab === t.id;
          const babies = functionMenuSections(t.id as ActiveTab);
          return (
            <div
              key={t.id}
              className="relative"
              onMouseEnter={() => handleMouseEnter(t.id)}
              onMouseLeave={handleMouseLeave}
            >
              <button
                type="button"
                role="menuitem"
                aria-current={on ? 'page' : undefined}
                aria-expanded={openTree === t.id}
                title={`${t.label} (${t.hotkey})`}
                onClick={() => goDesk(t.id as ActiveTab)}
                className={cn(
                  'shrink-0 border-r border-white/15 px-2 py-0 font-semibold uppercase tracking-wide transition-colors',
                  on
                    ? 'bg-black/45 text-white'
                    : 'text-white/75 hover:bg-black/25 hover:text-white',
                )}
              >
                {t.label}
                <span className="ml-0.5 hidden text-white/40 sm:inline" aria-hidden>
                  {t.hotkey}
                </span>
              </button>

              {/* Dropdown tree — appears on hover */}
              {openTree === t.id && babies.length > 0 && (
                <div
                  className="absolute top-full left-0 z-50 min-w-[140px] border border-white/20 bg-[#0f1118] shadow-xl"
                  onMouseEnter={() => setOpenTree(t.id)}
                  onMouseLeave={() => setOpenTree(null)}
                >
                  {babies.map((s) => {
                    const isActive = activeTab === t.id && sectionId === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => goBaby(t.id as ActiveTab, s.id)}
                        className={cn(
                          'block w-full text-left px-3 py-1.5 text-xs uppercase tracking-wider transition-colors',
                          isActive
                            ? 'bg-white/20 text-white'
                            : 'text-white/70 hover:bg-white/10 hover:text-white',
                        )}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* MID — active desk + its baby tabs */}
      <div className="flex min-w-0 flex-1 items-stretch border-l border-white/25">
        <span
          className="flex shrink-0 items-center bg-black/30 px-2 font-bold uppercase tracking-wider text-amber-200/95"
          title={`Active desk: ${activeDeskLabel}`}
        >
          {activeDeskLabel}
        </span>
        {sections.length === 0 ? (
          <span className="flex items-center px-2 text-white/50">—</span>
        ) : (
          sections.map((s) => {
            const active =
              sectionId === s.id
              || (activeTab === 'desk' && resolveTradeModeSection(sectionId) === s.id);
            // functionMenuSections already prefers DeskNavItem.short for label
            const label = s.label;
            return (
              <button
                key={s.id}
                type="button"
                role="menuitem"
                onClick={() => goSection(s.id)}
                className={cn(
                  'shrink-0 border-r border-white/10 px-1.5 py-0 uppercase tracking-wide transition-colors',
                  active
                    ? 'bg-white/15 text-white'
                    : 'text-white/75 hover:bg-black/25 hover:text-white',
                )}
                title={s.code ? `${s.label} (${s.code})` : s.label}
              >
                {label}
              </button>
            );
          })
        )}
      </div>

      {/* FAR RIGHT — compact search + yellow ▶ / black GO */}
      <CommandLine
        variant="redbar"
        focusToken={focusToken}
        onHelp={onHelp}
        onWatchlistFocus={onWatchlistFocus}
        onOpenDisplay={onOpenDisplay}
      />
    </div>
  );
}
