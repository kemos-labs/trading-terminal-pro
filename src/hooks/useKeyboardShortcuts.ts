import { useEffect, useRef } from 'react';
import { useTerminalStore } from '../store/terminalStore';

type ShortcutMap = Record<string, () => void>;

/**
 * Global keyboard shortcuts.
 * - Bare letter/number keys fire when no modifier (except Shift for `?`).
 * - `mod+k` (Ctrl/Cmd+K) registered explicitly for command palette.
 * - Inputs/selects/contenteditable ignored.
 * - Tab / Shift+Tab are ALWAYS native focus navigation: never hijacked here.
 * - ArrowUp/ArrowDown are board-scoped: they dispatch + preventDefault only
 *   when a board holds focus; otherwise native scroll is preserved.
 * - Space toggles play only on non-interactive targets; buttons/links/options
 *   and dialogs keep their default keyboard actions.
 */
function boardFocusActive(): boolean {
  try {
    const s = useTerminalStore.getState();
    return Boolean(s.keyboardBoardFocusEnabled && s.boardFocus.boardId);
  } catch { return false; }
}

function inDialog(target: HTMLElement | null): boolean {
  try { return Boolean(target?.closest?.('[role="dialog"]')); } catch { return false; }
}

function isSpaceInteractive(target: HTMLElement | null): boolean {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'BUTTON' || tag === 'A') return true;
  try {
    if (target.closest?.('button, a, [role="button"], [role="option"], [role="listbox"], [role="dialog"], [role="menu"], [role="menuitem"]')) return true;
  } catch { /* ignore */ }
  return false;
}
export function useKeyboardShortcuts(shortcuts: ShortcutMap) {
  const ref = useRef(shortcuts);
  ref.current = shortcuts;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      const mod = e.metaKey || e.ctrlKey;

      // Command palette chord
      if (mod && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        ref.current['mod+k']?.();
        return;
      }

      // Ignore bare-key handlers when modifiers held (prevents Cmd+K → board k, Alt+1 → tab1)
      if (mod || e.altKey) return;

      // Preserve [ ] before lowercasing
      const raw = e.key;
      // Dialogs keep default keyboard behavior; only Escape/?/palette chord apply.
      if (raw !== 'Escape' && raw !== '?' && inDialog(e.target as HTMLElement)) return;
      if (raw === '[' || raw === ']') {
        e.preventDefault();
        ref.current[raw]?.();
        return;
      }
      const key = raw === ' ' ? 'space' : raw.toLowerCase();
      if (key >= '1' && key <= '9') {
        ref.current[`tab${key}`]?.();
        return;
      }
      if (raw === 'ArrowUp') {
        if (!boardFocusActive() || inDialog(e.target as HTMLElement)) return;
        e.preventDefault();
        ref.current.arrowup?.();
        return;
      }
      if (raw === 'ArrowDown') {
        if (!boardFocusActive() || inDialog(e.target as HTMLElement)) return;
        e.preventDefault();
        ref.current.arrowdown?.();
        return;
      }
      if (raw === 'ArrowLeft' || raw === 'ArrowRight') {
        if (inDialog(e.target as HTMLElement)) return;
        if (boardFocusActive()) return;
        const t = e.target as HTMLElement | null;
        if (t && t !== document.body && (t.tagName === 'BUTTON' || t.tagName === 'A')) return;
        ref.current[raw === 'ArrowLeft' ? 'arrowleft' : 'arrowright']?.();
        return;
      }
      // Tab / Shift+Tab: native focus movement only. Never cycle desks here;
      // desk access stays via visible navigation + number-key shortcuts.
      if (raw === 'Tab') return;
      if (raw === 'Escape') {
        ref.current.escape?.();
        return;
      }
      // Shift+/ is often `?` — allow without treating Shift as a blocker for ?
      if (key === '?' || (e.shiftKey && raw === '/')) {
        ref.current['?']?.();
        return;
      }
      // Space on interactive targets (buttons/links/options/dialogs) keeps its
      // native action (activate/scroll); only bare-body Space toggles play.
      if (key === 'space' && isSpaceInteractive(e.target as HTMLElement)) return;
      if (e.shiftKey && key !== '?') {
        // other shift combos: still allow letters that don't need shift on most layouts
        // but skip if it produced a symbol we don't map
      }
      ref.current[key]?.();
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
