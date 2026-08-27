/**
 * Vol desk — Focus (full panel) default; Split = surface + smile/term.
 * Greeks 1.0 lives here (not Trade). Fit is focus-only.
 */
import { useEffect, lazy, Suspense, useState, useCallback } from 'react';
import { SmileView } from './SmileView';
import { TermView } from './TermView';
import { ArbitrageView } from './ArbitrageView';
import { useTerminalStore } from '../../store/terminalStore';
import { DeskLoading } from '../common/Skeleton';
import { EmptyState } from '../common/EmptyState';
import { SectionErrorBoundary } from '../common/SectionErrorBoundary';
import { UI_COPY } from '../../config/uiCopy';
import { GexLevelsStrip } from '../common/GexLevelsStrip';
import { consumeDeskJumpOnMount } from '../../lib/market/deskJump';
import { cn } from '../../lib/utils';

const SurfaceView = lazy(() =>
  import('./surface/SurfaceView').then((m) => ({ default: m.SurfaceView })),
);
const GreeksView = lazy(() =>
  import('./GreeksView').then((m) => ({ default: m.GreeksView })),
);

type Sub = 'surface' | 'smile' | 'term' | 'greeks' | 'quality';
type SidePanel = 'smile' | 'term';
type LayoutMode = 'split' | 'focus';

const SUBS: { id: Sub; label: string; blurb: string; domId: string }[] = [
  { id: 'surface', label: 'Surface', blurb: '3D IV mesh', domId: 'vol-sub-surface' },
  { id: 'smile', label: 'Smile / Skew', blurb: 'RR · fly · SVI', domId: 'vol-sub-smile' },
  { id: 'term', label: 'Term', blurb: 'ATM IV vs √DTE', domId: 'vol-sub-term' },
  { id: 'greeks', label: 'Greeks', blurb: 'Profiles · risk · BS-Merton', domId: 'vol-sub-greeks' },
  {
    id: 'quality',
    label: 'Surface Fit',
    blurb: 'Model convergence — validates SVI fit, not raw feed',
    domId: 'vol-sub-quality',
  },
];

const LAYOUT_KEY = 'ui.vol.layout';

/** Default Focus; only restore Split when user explicitly saved it. */
function loadLayout(): LayoutMode {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    if (v === 'split') return 'split';
    return 'focus';
  } catch {
    return 'focus';
  }
}

export function VolStructureView() {
  const deskSectionId = useTerminalStore((s) => s.deskSectionId);
  const setDeskContext = useTerminalStore((s) => s.setDeskContext);
  const snapshot = useTerminalStore((s) => s.snapshot);
  const loading = useTerminalStore((s) => s.loading);
  const chainUsed = useTerminalStore((s) => s.chainUsed);

  const sub: Sub = (SUBS.find((s) => s.domId === deskSectionId)?.id ?? 'surface') as Sub;
  const [layout, setLayout] = useState<LayoutMode>(loadLayout);
  const [side, setSide] = useState<SidePanel>(() =>
    sub === 'term' ? 'term' : 'smile',
  );

  useEffect(() => consumeDeskJumpOnMount(), []);

  // Deep-link: smile/term select side panel; greeks/quality force focus.
  useEffect(() => {
    if (sub === 'smile') setSide('smile');
    if (sub === 'term') setSide('term');
    if (sub === 'quality' || sub === 'greeks') setLayout('focus');
  }, [sub]);

  const persistLayout = useCallback((m: LayoutMode) => {
    setLayout(m);
    try {
      localStorage.setItem(LAYOUT_KEY, m);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const meta = SUBS.find((s) => s.id === sub);
    setDeskContext({
      id: meta?.domId ?? null,
      label: meta?.label ?? 'Surface',
      apis:
        sub === 'greeks'
          ? ['yfinance', 'FRED']
          : chainUsed === 'deribit'
            ? ['Deribit']
            : ['yfinance', 'FMP'],
    });
    return () => setDeskContext({ id: null, label: null, apis: [] });
  }, [sub, setDeskContext, chainUsed]);

  if (loading && !snapshot) {
    return <DeskLoading message={UI_COPY.load.chain} />;
  }
  if (!snapshot) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <EmptyState
          kind="no-data"
          title="No live surface"
          body={UI_COPY.empty.chain}
        />
      </div>
    );
  }

  const useSplit = layout === 'split' && sub !== 'quality' && sub !== 'greeks';
  const focusSub: Sub =
    sub === 'quality' || sub === 'greeks' || sub === 'smile' || sub === 'term' || sub === 'surface'
      ? sub
      : 'surface';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* GEX strip + Split/Focus only — Surface/Smile/Term/Greeks/Fit on red bar. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-card/30">
        <GexLevelsStrip compact showSpark className="min-w-0 flex-1 border-0 bg-transparent" />
        <div className="flex shrink-0 gap-0.5 px-1">
          {useSplit && (
            <>
              {(['smile', 'term'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setSide(p);
                    useTerminalStore.getState().setDeskSection(p === 'smile' ? 'vol-sub-smile' : 'vol-sub-term');
                  }}
                  className={cn(
                    'rounded border px-1 py-0.5 font-mono text-type-2xs',
                    side === p
                      ? 'border-primary bg-secondary text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {p === 'smile' ? 'Sm' : 'Tm'}
                </button>
              ))}
            </>
          )}
          <button
            type="button"
            title="Split surface + smile/term"
            onClick={() => {
              persistLayout('split');
              if (sub === 'quality' || sub === 'greeks') {
                useTerminalStore.getState().setDeskSection('vol-sub-surface');
              }
            }}
            className={cn(
              'rounded border px-1 py-0.5 font-mono text-type-2xs',
              useSplit
                ? 'border-primary bg-secondary text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            Split
          </button>
          <button
            type="button"
            title="Full-screen active panel (default)"
            onClick={() => persistLayout('focus')}
            className={cn(
              'rounded border px-1 py-0.5 font-mono text-type-2xs',
              !useSplit
                ? 'border-primary bg-secondary text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            Focus
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {useSplit ? (
          <div className="flex h-full min-h-0 flex-col lg:flex-row">
            <div className="min-h-0 min-w-0 flex-[1.4] border-b border-border lg:border-b-0 lg:border-r">
              <SectionErrorBoundary name="Surface">
                <Suspense fallback={<DeskLoading message={UI_COPY.load.surface} />}>
                  <SurfaceView />
                </Suspense>
              </SectionErrorBoundary>
            </div>
            <div className="min-h-0 min-w-0 flex-1" key={side}>
              {side === 'smile' ? (
                <SectionErrorBoundary name="Smile">
                  <SmileView />
                </SectionErrorBoundary>
              ) : (
                <SectionErrorBoundary name="Term">
                  <TermView />
                </SectionErrorBoundary>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full min-h-0 term-crossfade" key={focusSub}>
            {focusSub === 'surface' && (
              <SectionErrorBoundary name="Surface">
                <Suspense fallback={<DeskLoading message={UI_COPY.load.surface} />}>
                  <SurfaceView />
                </Suspense>
              </SectionErrorBoundary>
            )}
            {focusSub === 'smile' && (
              <SectionErrorBoundary name="Smile">
                <SmileView />
              </SectionErrorBoundary>
            )}
            {focusSub === 'term' && (
              <SectionErrorBoundary name="Term">
                <TermView />
              </SectionErrorBoundary>
            )}
            {focusSub === 'greeks' && (
              <SectionErrorBoundary name="Greeks">
                <Suspense fallback={<DeskLoading message={UI_COPY.load.greeks} />}>
                  <GreeksView />
                </Suspense>
              </SectionErrorBoundary>
            )}
            {focusSub === 'quality' && (
              <SectionErrorBoundary name="Quality">
                <div className="flex h-full flex-col">
                  <p className="shrink-0 border-b border-border px-3 py-1.5 font-mono text-type-2xs text-muted-foreground">
                    Surface Fit / Model Convergence — validates SVI fit, not raw feed
                  </p>
                  <div className="border-b border-border px-3 py-1.5 font-mono text-type-xs text-muted-foreground">
                    Calendar: total variance w=σ²T non-decreasing in T · Butterfly: discrete convexity of w in log-moneyness.
                    Red cells = model inconsistency / noisy grid — not a free lunch without bid/ask and transaction costs.
                  </div>
                  <div className="min-h-0 flex-1">
                    <ArbitrageView />
                  </div>
                </div>
              </SectionErrorBoundary>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
