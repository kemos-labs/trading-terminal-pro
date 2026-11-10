/**
 * Red function bar — main desks hard-left (hover each for tree dropdown on
 * pointer-fine devices; touch/pointer tap opens at ≤560px without hover-then-click
 * closing it); active desk + baby tabs mid; compact search far-right.
 * Accessible disclosure: aria-haspopup/controls (only when open), keyboard
 * Enter/Space/ArrowDown/Escape, menu/menuitem semantics, focus return and
 * outside/Escape dismissal (Escape scoped — does not swallow CommandLine).
 * At ≤560px the visible menu is the fixed-position mobile variant; focus
 * routing targets the visible variant so hidden desktop items are not focused.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  const deskButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const menuItemRefs = useRef<Record<string, HTMLButtonElement[]>>({});
  const mobileMenuItemRefs = useRef<Record<string, HTMLButtonElement[]>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const [mobileDropdownPos, setMobileDropdownPos] = useState<{ top: number; left: number } | null>(null);
  // F2: pending keyboard focus intent — consumed after visible mobile/desktop menu mounts and refs are available
  const [pendingFocusIntent, setPendingFocusIntent] = useState<{ deskId: string; index: number } | null>(null);

  useEffect(() => {
    if (!openTree) {
      setMobileDropdownPos(null);
      return;
    }
    const updatePos = () => {
      const btn = deskButtonRefs.current[openTree];
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      // Clamp left so dropdown stays in viewport (min 4px margin)
      const left = Math.min(rect.left, Math.max(4, window.innerWidth - 144));
      setMobileDropdownPos({ top: rect.bottom, left });
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [openTree]);

  // Outside click/touch dismissal and scoped Escape (does not swallow CommandLine)
  useEffect(() => {
    if (!openTree) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(target)) {
        // containerRef wraps the whole bar including fixed dropdown, so contains check covers it.
        setOpenTree(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      // Do not swallow Escape originating inside CommandLine (input/combobox) while menu is open
      if (target && typeof (target as any).closest === 'function' && (target as HTMLElement).closest('[aria-label="Command line"]')) return;
      e.preventDefault();
      const id = openTree;
      setOpenTree(null);
      requestAnimationFrame(() => deskButtonRefs.current[id]?.focus());
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openTree]);

  // Crypto owns a grouped reference-style side rail; avoid duplicate baby tabs here.
  const sections = activeTab === 'crypto' ? [] : functionMenuSections(activeTab);
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
    const prev = tabId;
    setOpenTree(null);
    // focus return to the target desk's button (tab whose section was activated)
    requestAnimationFrame(() => deskButtonRefs.current[prev]?.focus());
  };

  const handlePointerEnter = (e: React.PointerEvent, id: string) => {
    if (e.pointerType === 'touch') return;
    setOpenTree(id);
  };

  const handlePointerLeave = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    setOpenTree(null);
  };

  // Fallback for mouse devices that do not fire pointer events (kept for coverage; pointer path is primary)
  const handleMouseEnter = (id: string) => {
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) return;
    setOpenTree(id);
  };

  const handleMouseLeave = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) return;
    setOpenTree(null);
  };

  const isMobileViewport = useCallback(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 560 || window.matchMedia('(max-width: 560px)').matches;
  }, []);

  const focusMenuItem = useCallback((deskId: string, index: number) => {
    const mobile = isMobileViewport();
    const items = mobile
      ? mobileMenuItemRefs.current[deskId]
      : menuItemRefs.current[deskId];
    // Fallback to the other variant if the preferred one has no refs yet (e.g. position not resolved)
    const fallback = mobile
      ? menuItemRefs.current[deskId]
      : mobileMenuItemRefs.current[deskId];
    const target = items && items[index] ? items : fallback;
    if (!target || !target[index]) return false;
    target[index].focus();
    return true;
  }, [isMobileViewport]);

  // Clear pending intent on dismissal or desk change; do not carry stale intent across desks
  useEffect(() => {
    if (!openTree && pendingFocusIntent) setPendingFocusIntent(null);
  }, [openTree, pendingFocusIntent]);
  useEffect(() => {
    // desk navigation clears any pending keyboard focus
    setPendingFocusIntent(null);
  }, [activeTab]);

  // Consume pending focus intent after the actually mounted visible menu refs are available.
  // Keyed to openTree + mobileDropdownPos (mobile menu mounts only after pos resolved) + pending intent.
  useLayoutEffect(() => {
    if (!pendingFocusIntent) return;
    if (!openTree || pendingFocusIntent.deskId !== openTree) return;
    // At 390px the visible menu is the fixed mobile variant, which only mounts when mobileDropdownPos is set.
    // On desktop the menu mounts immediately with openTree. We wait for the visible variant's ref to exist.
    const mobile = isMobileViewport();
    const needsMobilePos = mobile && !mobileDropdownPos;
    if (needsMobilePos) return;
    const ok = focusMenuItem(pendingFocusIntent.deskId, pendingFocusIntent.index);
    if (ok) setPendingFocusIntent(null);
  }, [pendingFocusIntent, openTree, mobileDropdownPos, isMobileViewport, focusMenuItem]);

  const toggleTree = useCallback((id: string, hasBabies: boolean) => {
    if (!hasBabies) {
      goDesk(id as ActiveTab);
      return;
    }
    const willOpen = openTree !== id;
    if (willOpen) {
      setOpenTree(id);
    } else {
      setOpenTree(null);
    }
    // Still navigate on pointer/touch toggle — preserve desk navigation
    goDesk(id as ActiveTab);
  }, [openTree, goDesk]);

  const handleDeskKeyDown = useCallback((e: React.KeyboardEvent, id: string, hasBabies: boolean) => {
    if (!hasBabies) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const willOpen = openTree !== id;
      if (willOpen) {
        setOpenTree(id);
        // F2: queue pending intent; layout effect focuses after visible (mobile) menu mounts
        setPendingFocusIntent({ deskId: id, index: 0 });
      } else {
        setOpenTree(null);
        setPendingFocusIntent(null);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const willOpen = openTree !== id;
      setOpenTree(id);
      // Only keyboard-open queues focus; do not steal focus for pointer/touch open (handled via pending intent, not direct rAF here)
      if (willOpen || !pendingFocusIntent) {
        setPendingFocusIntent({ deskId: id, index: 0 });
      } else {
        // Already open — focus first item; if refs not yet ready, pending intent will carry it
        const ok = focusMenuItem(id, 0);
        if (!ok) setPendingFocusIntent({ deskId: id, index: 0 });
      }
    } else if (e.key === 'Escape') {
      if (openTree === id) {
        e.preventDefault();
        setOpenTree(null);
        setPendingFocusIntent(null);
      }
    } else if (e.key === 'ArrowUp') {
      if (openTree === id) {
        e.preventDefault();
        const babies = functionMenuSections(id as ActiveTab);
        const last = babies.length - 1;
        const ok = focusMenuItem(id, last);
        if (!ok) setPendingFocusIntent({ deskId: id, index: last });
        else setPendingFocusIntent(null);
      } else {
        // Closed -> open and focus last (keyboard intent)
        e.preventDefault();
        setOpenTree(id);
        const babies = functionMenuSections(id as ActiveTab);
        setPendingFocusIntent({ deskId: id, index: babies.length - 1 });
      }
    }
  }, [openTree, focusMenuItem, pendingFocusIntent]);

  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent, deskId: string, itemIndex: number, itemCount: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusMenuItem(deskId, (itemIndex + 1) % itemCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusMenuItem(deskId, (itemIndex - 1 + itemCount) % itemCount);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusMenuItem(deskId, 0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusMenuItem(deskId, itemCount - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpenTree(null);
      requestAnimationFrame(() => deskButtonRefs.current[deskId]?.focus());
    } else if (e.key === 'Tab') {
      setOpenTree(null);
    }
  }, [focusMenuItem]);

  // Resolve babies for the mobile fixed dropdown (outside scroll clipping context)
  const mobileBabies = openTree ? functionMenuSections(openTree as ActiveTab) : [];

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex h-5 shrink-0 items-stretch gap-0 overflow-visible max-[560px]:overflow-x-auto max-[560px]:overflow-y-hidden max-[560px]:overscroll-x-contain max-[560px]:[scrollbar-width:thin] max-[560px]:touch-pan-x',
        activeTab === 'crypto'
          ? 'border-b border-[#20282b] bg-[#050708] font-mono text-type-2xs text-white'
          : 'term-fn-bar-red',
      )}
      role="toolbar"
      aria-label="Main desks and sections"
      tabIndex={0}
    >
      {/* LEFT — main desks, each with a hover tree — outside scroll so dropdowns are not clipped */}
      <div className="flex shrink-0 items-stretch" role="group" aria-label="Main desks">
        {TABS.map((t) => {
          const on = activeTab === t.id;
          const babies = functionMenuSections(t.id as ActiveTab);
          const hasBabies = babies.length > 0;
          const isOpen = openTree === t.id && hasBabies;
          const menuId = `desk-menu-${t.id}`;
          const mobileMenuId = `desk-menu-${t.id}-mobile`;
          const btnId = `desk-btn-${t.id}`;
          return (
            <div
              key={t.id}
              className="relative"
              onPointerEnter={(e) => handlePointerEnter(e, t.id)}
              onPointerLeave={handlePointerLeave}
              onMouseEnter={() => handleMouseEnter(t.id)}
              onMouseLeave={handleMouseLeave}
            >
              <button
                ref={(el) => {
                  deskButtonRefs.current[t.id] = el;
                }}
                id={btnId}
                type="button"
                role="button"
                aria-current={on ? 'page' : undefined}
                aria-haspopup={hasBabies ? 'menu' : undefined}
                aria-expanded={hasBabies ? isOpen : undefined}
                aria-controls={hasBabies && isOpen ? (mobileDropdownPos ? `${menuId} ${mobileMenuId}` : menuId) : undefined}
                title={`${t.label} (${t.hotkey})`}
                onClick={() => toggleTree(t.id, hasBabies)}
                onKeyDown={(e) => handleDeskKeyDown(e, t.id, hasBabies)}
                className={cn(
                  'shrink-0 border-r border-white/15 px-2 py-0 font-semibold uppercase tracking-wide transition-colors',
                  on
                    ? 'bg-[#ffb000] text-black'
                    : 'text-white/75 hover:bg-black/25 hover:text-white',
                )}
              >
                {t.label}
                <span className={cn('ml-0.5 hidden sm:inline', on ? 'text-black/60' : 'text-white/40')} aria-hidden>
                  {t.hotkey}
                </span>
              </button>

              {/* Dropdown tree — desktop: absolute under overflow-visible ancestor; hidden at <=560px */}
              {isOpen && (
                <div
                  id={menuId}
                  role="menu"
                  aria-labelledby={btnId}
                  aria-orientation="vertical"
                  className="absolute top-full left-0 z-50 min-w-[140px] border border-white/20 bg-[#0f1118] shadow-xl max-[560px]:hidden"
                  onPointerEnter={(e) => { if (e.pointerType !== 'touch') setOpenTree(t.id); }}
                  onPointerLeave={(e) => { if (e.pointerType !== 'touch') setOpenTree(null); }}
                  onMouseEnter={() => handleMouseEnter(t.id)}
                  onMouseLeave={handleMouseLeave}
                >
                  {babies.map((s, idx) => {
                    const isActive = activeTab === t.id && sectionId === s.id;
                    return (
                      <button
                        key={s.id}
                        ref={(el) => {
                          if (!menuItemRefs.current[t.id]) menuItemRefs.current[t.id] = [];
                          (menuItemRefs.current[t.id] as HTMLButtonElement[])[idx] = el as HTMLButtonElement;
                        }}
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        onClick={() => goBaby(t.id as ActiveTab, s.id)}
                        onKeyDown={(e) => handleMenuKeyDown(e, t.id, idx, babies.length)}
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
      {/* MID — active desk + its baby tabs — only this region scrolls at narrow widths */}
      <div className="flex min-w-0 flex-1 items-stretch gap-0 overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-none [-webkit-overflow-scrolling:touch] border-l border-white/25" tabIndex={0} role="region" aria-label="Active desk sections">
        <span
          className={cn(
            'flex shrink-0 items-center bg-black/30 px-2 font-bold uppercase tracking-wider',
            activeTab === 'crypto' ? 'text-[#25d7c5]' : 'text-amber-200/95',
          )}
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
                role="button"
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

      {/* Mobile fixed dropdown — escapes outer overflow-x-auto clipping at <=560px */}
      {openTree && mobileBabies.length > 0 && mobileDropdownPos && (
        <div
          id={`desk-menu-${openTree}-mobile`}
          role="menu"
          aria-labelledby={`desk-btn-${openTree}`}
          aria-orientation="vertical"
          className="fixed z-50 hidden max-[560px]:block min-w-[140px] border border-white/20 bg-[#0f1118] shadow-xl"
          style={{ top: mobileDropdownPos.top, left: mobileDropdownPos.left }}
          onPointerEnter={(e) => { if (e.pointerType !== 'touch') setOpenTree(openTree); }}
          onPointerLeave={(e) => { if (e.pointerType !== 'touch') setOpenTree(openTree); }}
          onMouseEnter={() => { if (typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches) setOpenTree(openTree); }}
          onMouseLeave={() => { if (typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches) setOpenTree(openTree); }}
        >
          {mobileBabies.map((s, idx) => {
            const isActive = activeTab === openTree && sectionId === s.id;
            return (
              <button
                key={s.id}
                ref={(el) => {
                  if (!mobileMenuItemRefs.current[openTree]) mobileMenuItemRefs.current[openTree] = [];
                  (mobileMenuItemRefs.current[openTree] as HTMLButtonElement[])[idx] = el as HTMLButtonElement;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => goBaby(openTree as ActiveTab, s.id)}
                onKeyDown={(e) => handleMenuKeyDown(e, openTree, idx, mobileBabies.length)}
                className={cn(
                  'block w-full text-left px-3 py-1.5 text-xs uppercase tracking-wider transition-colors',
                  isActive ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white',
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      )}

      {/* FAR RIGHT — compact search + yellow ▶ / black GO — pinned on desktop, scrollable at <=560px */}
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
