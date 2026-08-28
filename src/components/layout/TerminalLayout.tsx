import { useEffect, useState, useCallback } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import {
  clearBoardFocus,
  copyFocusedCell,
  moveBoardFocus,
} from '../../hooks/useBoardFocus';
import { useSpotStream } from '../../hooks/useSpotStream';
import { toast } from 'sonner';
import { perfMark } from '../../config/perfBudget';
import { TerminalHeader } from '../terminal/TerminalHeader';
import { FunctionMenuBar } from '../terminal/FunctionMenuBar';
import { ShortcutsOverlay } from '../terminal/ShortcutsOverlay';
import { CommandPalette } from '../terminal/CommandPalette';
import { BootBriefing } from '../terminal/BootBriefing';
import { PlaybackBar } from '../terminal/PlaybackBar';
import { SymbolDialog } from '../terminal/SymbolDialog';
import { SidePanel } from './SidePanel';
import { WatchlistStrip } from '../common/WatchlistStrip';
import { ThreeVolStrip } from '../common/ThreeVolStrip';
import { sanitizeSymbol } from '../../lib/validation';
import { TABS } from '../terminal/tabs';
import { findSectionMeta, jumpDeskSection, sectionsForTab } from '../../config/deskNav';
import type { ActiveTab } from '../../lib/options/types';
import { cn } from '../../lib/utils';
import {
  isDisplayStripEnabled,
  isQuoteStripEnabled,
  setDisplayStripEnabled,
} from '../../lib/market/shellPrefs';
import { DeskViewGate } from './renderDeskView';
import { useAccountStore } from '../../store/accountStore';

/**
 * Space-efficient shell:
 * Top status header → Red bar (desks + babies + search far-right) → Function area
 * (footer StatusBar removed — feeds live in the top bar)
 */
export function TerminalLayout() {
  const {
    activeTab, setActiveTab, setSymbol, refresh, loading, source, symbol, uiDensity, setDeskContext,
    snapshot, chainAvailable, lastChainUpdate, historicalFrames,
  } = useTerminalStore();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [symbolDialogOpen, setSymbolDialogOpen] = useState(false);
  const [quoteStripOn] = useState(() => isQuoteStripEnabled());
  const [displayStripOn, setDisplayStripOn] = useState(() => isDisplayStripEnabled());
  const [cmdFocusToken, setCmdFocusToken] = useState(0);
  /** First-open rates/macro briefing while heavy chain loads in the background. */
  const [bootOpen, setBootOpen] = useState(true);
  const heavyReady = Boolean(snapshot && chainAvailable && lastChainUpdate > 0) || (!loading && lastChainUpdate > 0);

  const jumpSection = useCallback((dir: 1 | -1) => {
    const tab = useTerminalStore.getState().activeTab;
    const id = jumpDeskSection(tab, dir);
    if (!id) return;
    const meta = findSectionMeta(id, tab);
    setDeskContext({
      id,
      label: meta?.label ?? id,
      apis: meta?.apis,
    });
  }, [setDeskContext]);

  const toggleDisplayStrip = useCallback(() => {
    setDisplayStripOn((prev) => {
      const next = !prev;
      setDisplayStripEnabled(next);
      return next;
    });
  }, []);

  // Account + billing gate bootstrap (session cookie → /api/auth/me).
  useEffect(() => {
    void useAccountStore.getState().refresh();
  }, []);

  // Seed default baby section when a desk has none, or when switching into Academy
  // with a stale non-academy section (otherwise filters desync → wrong track).
  useEffect(() => {
    const s = useTerminalStore.getState();
    const first = sectionsForTab(activeTab)[0]?.id;
    if (!first) return;
    if (!s.deskSectionId) {
      s.setDeskSection(first);
      return;
    }
    if (activeTab === 'academy' && !s.deskSectionId.startsWith('academy-sub-')) {
      s.setDeskSection(first);
    }
  }, [activeTab]);

  // SSE spot ticks in live mode (Node/Docker server). No-ops if stream unavailable.
  useSpotStream(symbol, source === 'live');

  // Always boot into LIVE so desks never start on synthetic/demo market data.
  // Only kick chain load once — StrictMode remount must not abort an in-flight fetch.
  useEffect(() => {
    const s = useTerminalStore.getState();
    if (s.source !== 'live') {
      void s.setSource('live');
    }
    if (!s.snapshot && s.lastChainUpdate === 0) {
      void setSymbol(s.symbol || 'SPY');
    }
  }, [setSymbol]);

  // Preload heavy Vol chunks during boot so Greeks is not a cold lazy hit after Enter.
  useEffect(() => {
    void import('../views/GreeksView');
  }, []);

  // Sync ?desk= URL param to activeTab on mount (enables deep-linking / e2e)
  useEffect(() => {
    const desk = new URLSearchParams(window.location.search).get('desk') as string | null;
    if (desk && TABS.some((t) => t.id === desk)) {
      setActiveTab(desk as never);
    }
  }, [setActiveTab]);

  // Migrate stale tab ids (e.g. old "home"/"macro" → Vol, the default desk)
  useEffect(() => {
    const id = activeTab as string;
    if (id === 'home' || id === 'macro' || !TABS.some((t) => t.id === activeTab)) {
      setActiveTab('vol');
    }
  }, [activeTab, setActiveTab]);

  const handleSymbolSelect = useCallback((sym: string) => {
    const sanitized = sanitizeSymbol(sym);
    if (!sanitized) {
      toast.error('Invalid symbol', {
        description: 'Enter a ticker (e.g. SPY, AAPL, BTC, ETH)',
      });
      return;
    }
    setSymbol(sanitized);
    toast.success(`Switched to ${sanitized}`);
    setSymbolDialogOpen(false);
  }, [setSymbol]);

  const nextTab = useCallback(() => {
    const tabs = TABS.map((t) => t.id);
    const idx = tabs.indexOf(activeTab);
    setActiveTab(tabs[(idx + 1) % tabs.length] as ActiveTab);
  }, [activeTab, setActiveTab]);

  useKeyboardShortcuts({
    'mod+k': () => {
      // Focus always-on command line AND open the command palette overlay
      setCmdFocusToken((n) => n + 1);
      setPaletteOpen(true);
    },
    r: refresh,
    s: () => setSymbolDialogOpen(true),
    space: () => useTerminalStore.getState().togglePlay(),
    l: () => {
      void useTerminalStore.getState().setSource('live');
      toast.message('LIVE', { description: 'Refreshing market feeds' });
    },
    tab: nextTab,
    '?': () => setShortcutsOpen((o) => !o),
    tab1: () => setActiveTab('vol'),
    tab2: () => setActiveTab('positioning'),
    tab3: () => setActiveTab('desk'),
    tab4: () => setActiveTab('crypto'),
    tab5: () => setActiveTab('rates'),
    tab6: () => setActiveTab('academy'),
    tab7: () => setActiveTab('ksa'),
    b: () => setActiveTab('crypto'),
    m: () => setActiveTab('desk'),
    v: () => setActiveTab('vol'),
    '[': () => jumpSection(-1),
    ']': () => jumpSection(1),
    d: () => useTerminalStore.getState().toggleUiDensity(),
    j: () => { if (!moveBoardFocus(1)) { /* no board */ } },
    k: () => { if (!moveBoardFocus(-1)) { /* no board */ } },
    y: () => { copyFocusedCell(); },
    c: () => {
      const s = useTerminalStore.getState();
      if (s.activeTab === 'positioning' && s.keyboardBoardFocusEnabled) {
        s.setBoardFocus({ boardId: 'chain', rowIndex: 0, colKey: 'strike' });
      }
    },
    escape: () => {
      if (paletteOpen) {
        setPaletteOpen(false);
        return;
      }
      if (shortcutsOpen) {
        setShortcutsOpen(false);
        return;
      }
      clearBoardFocus();
    },
    arrowleft: () => {
      const s = useTerminalStore.getState();
      if (s.boardFocus.boardId) return;
      if (!s.isPlaying) s.setFrameIndex(Math.max(0, s.frameIndex - 1));
    },
    arrowright: () => {
      const s = useTerminalStore.getState();
      if (s.boardFocus.boardId) return;
      if (!s.isPlaying) s.setFrameIndex(Math.min(s.historicalFrames.length - 1, s.frameIndex + 1));
    },
    arrowup: () => { moveBoardFocus(-1); },
    arrowdown: () => { moveBoardFocus(1); },
  });

  useEffect(() => {
    perfMark(`desk.${activeTab}`);
  }, [activeTab]);

  return (
    <div
      className={cn(
        'flex h-screen flex-col overflow-hidden bg-background text-foreground density-terminal',
        uiDensity === 'readable' ? 'density-readable' : 'density-dense',
      )}
    >
      {activeTab !== 'crypto' && (
        <TerminalHeader onOpenShortcuts={() => setShortcutsOpen((o) => !o)} />
      )}
      {/* Optional watchlist strip — only when not inside the dedicated Crypto shell. */}
      {activeTab !== 'crypto' && quoteStripOn && (
        <div
          id="shell-quote-strip"
          className="shrink-0 border-b border-border bg-card/80 px-1"
        >
          <WatchlistStrip className="border-0 bg-transparent" recordMetrics compact />
        </div>
      )}
      {!quoteStripOn && <div id="shell-quote-strip" className="sr-only" aria-hidden />}

      {activeTab !== 'crypto' && (
        <FunctionMenuBar
          focusToken={cmdFocusToken}
          onHelp={() => setShortcutsOpen(true)}
          onWatchlistFocus={() => {
            document.getElementById('shell-quote-strip')?.scrollIntoView({ block: 'nearest' });
          }}
          onOpenDisplay={toggleDisplayStrip}
        />
      )}
      {/* Vol honesty strip only on option desks — not Rates/Crypto/Academy (VIX ≠ rates). */}
      {(activeTab === 'vol' || activeTab === 'positioning' || activeTab === 'desk') && (
        <div className="shrink-0 border-b border-border/60">
          <ThreeVolStrip />
        </div>
      )}
      {/* No Shared Desk / DES / HIVG under the red bar — those ate the function area.
          Free-board data stays on Home/Feeds and server warmer; Academy needs full height. */}
      <main
        className={cn(
          'min-h-0 flex-1 overflow-hidden p-0',
          activeTab === 'academy' && 'academy-shell',
        )}
        role="main"
        aria-label={activeTab === 'academy' ? 'Academy publication' : 'Function area'}
        id={`panel-${activeTab}`}
      >
        <DeskViewGate tab={activeTab} loading={loading} />
      </main>

      {displayStripOn && <SidePanel />}
      {activeTab === 'vol' && historicalFrames.length >= 2 && <PlaybackBar />}
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onHelp={() => {
            setPaletteOpen(false);
            setShortcutsOpen(true);
          }}
          onWatchlistFocus={() => {
            document.getElementById('shell-quote-strip')?.scrollIntoView({ block: 'nearest' });
          }}
        />
      )}
      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
      {symbolDialogOpen && (
        <SymbolDialog onSelect={handleSymbolSelect} onClose={() => setSymbolDialogOpen(false)} />
      )}
      {bootOpen && (
        <BootBriefing
          heavyReady={heavyReady}
          onEnter={() => {
            if (useTerminalStore.getState().activeTab !== 'vol') {
              setActiveTab('vol');
            }
            setBootOpen(false);
          }}
        />
      )}
    </div>
  );
}
