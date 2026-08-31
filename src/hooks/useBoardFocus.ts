/**
 * Board keyboard focus — store SoT + imperative registry (scroll/copy).
 * Escape priority is coordinated in TerminalLayout / ShortcutsOverlay / ImplyDrawer.
 */
import { useCallback, useEffect } from 'react';
import { useTerminalStore } from '../store/terminalStore';

export type BoardFocusId = 'chain' | 'stir-sr3' | 'serff' | 'serff-proxy' | 'calendar' | 'dealer-bars';

export type BoardFocusState = {
  boardId: BoardFocusId | null;
  rowIndex: number;
  colKey: string | null;
};

export type FocusableBoardApi = {
  scrollToRow: (index: number) => void;
  getCellText: (row: number, colKey: string | null) => string;
  rowCount: () => number;
  colKeys: () => string[];
};

const registry = new Map<BoardFocusId, FocusableBoardApi>();

export function registerBoard(id: BoardFocusId, api: FocusableBoardApi): () => void {
  registry.set(id, api);
  return () => {
    if (registry.get(id) === api) registry.delete(id);
  };
}

export function getBoardApi(id: BoardFocusId): FocusableBoardApi | undefined {
  return registry.get(id);
}

export function useBoardFocus(boardId: BoardFocusId) {
  const boardFocus = useTerminalStore((s) => s.boardFocus);
  const setBoardFocus = useTerminalStore((s) => s.setBoardFocus);
  const enabled = useTerminalStore((s) => s.keyboardBoardFocusEnabled);
  const focused = enabled && boardFocus.boardId === boardId;

  const focusRow = useCallback(
    (rowIndex: number, colKey?: string | null) => {
      if (!enabled) return;
      setBoardFocus({
        boardId,
        rowIndex: Math.max(0, rowIndex),
        colKey: colKey ?? boardFocus.colKey,
      });
    },
    [boardId, boardFocus.colKey, enabled, setBoardFocus],
  );

  const clearIfSelf = useCallback(() => {
    if (boardFocus.boardId === boardId) {
      setBoardFocus({ boardId: null, rowIndex: 0, colKey: null });
    }
  }, [boardFocus.boardId, boardId, setBoardFocus]);

  return {
    focused,
    rowIndex: focused ? boardFocus.rowIndex : -1,
    colKey: focused ? boardFocus.colKey : null,
    focusRow,
    clearIfSelf,
    enabled,
  };
}

/** Move focus within active board; no-op if none. */
export function moveBoardFocus(delta: number): boolean {
  const state = useTerminalStore.getState();
  if (!state.keyboardBoardFocusEnabled) return false;
  const { boardId, rowIndex, colKey } = state.boardFocus;
  if (!boardId) return false;
  const api = registry.get(boardId);
  if (!api) return false;
  const n = api.rowCount();
  if (n <= 0) return false;
  const next = Math.max(0, Math.min(n - 1, rowIndex + delta));
  state.setBoardFocus({ boardId, rowIndex: next, colKey });
  api.scrollToRow(next);
  return true;
}

export function copyFocusedCell(): boolean {
  const state = useTerminalStore.getState();
  if (!state.keyboardBoardFocusEnabled) return false;
  const { boardId, rowIndex, colKey } = state.boardFocus;
  if (!boardId) return false;
  const api = registry.get(boardId);
  if (!api) return false;
  const text = api.getCellText(rowIndex, colKey);
  if (!text) return false;
  void navigator.clipboard?.writeText(text);
  return true;
}

export function clearBoardFocus(): void {
  useTerminalStore.getState().setBoardFocus({ boardId: null, rowIndex: 0, colKey: null });
}

/** Register board api for the lifetime of a component. */
export function useRegisterBoard(id: BoardFocusId, api: FocusableBoardApi | null) {
  useEffect(() => {
    if (!api) return;
    return registerBoard(id, api);
  }, [id, api]);
}
