import type { ActiveTab } from '../lib/options/types';
import { useTerminalStore } from '../store/terminalStore';
import { sectionsForTab } from './deskSections';

export {
  type DeskNavItem,
  RATES_SECTIONS,
  RATES_SECTION_TO_MODE,
  VOL_SECTIONS,
  GREEKS_SECTIONS,
  POSITIONING_SECTIONS,
  CRYPTO_SECTIONS,
  TRADE_SECTIONS,
  THALEX_LAB_TOOLS,
  ACADEMY_SECTIONS,
  TAB_LABELS,
  tabLabel,
  sectionsForTab,
  findSectionMeta,
} from './deskSections';

/** Sections currently mounted in the DOM (ids present). */
export function presentSectionIds(tab: ActiveTab | string): string[] {
  return sectionsForTab(tab)
    .map((s) => s.id)
    .filter((id) => !!document.getElementById(id));
}

/**
 * Scroll to previous/next desk section. Returns the section id jumped to, or null.
 * Uses the store's active desk section as the cursor; for rates-style scroll
 * sections, also scrolls the element into view.
 */
export function jumpDeskSection(tab: ActiveTab | string, direction: 1 | -1): string | null {
  const ids = sectionsForTab(tab).map((s) => s.id);
  if (!ids.length) return null;
  const { deskSectionId, setDeskSection } = useTerminalStore.getState();
  let idx = deskSectionId && ids.includes(deskSectionId) ? ids.indexOf(deskSectionId) : 0;
  if (idx < 0) idx = 0;
  const next = ids[(idx + direction + ids.length) % ids.length]!;
  setDeskSection(next);
  // Mode desks (vol/pos/trade workspaces) switch via store only — no DOM section anchors.
  if (
    !next.startsWith('vol-sub-')
    && !next.startsWith('greeks-')
    && !next.startsWith('desk-ws-')
    && !next.startsWith('trade-sub-')
    && !next.startsWith('pos-sub-')
  ) {
    document.getElementById(next)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  return next;
}
