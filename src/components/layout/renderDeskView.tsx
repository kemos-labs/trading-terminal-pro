/**
 * Shared desk view switch — classic shell and future tiles call the same path.
 * `DeskViewGate` adds the billing paywall check (hooks-safe wrapper).
 */
import { Suspense, lazy, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { useAccountStore } from '../../store/accountStore';
import { DeskView } from '../views/DeskView';
import { AcademyView } from '../views/AcademyView';

const KsaMarketView = lazy(() => import('../views/KsaMarketView').then(m => ({ default: m.KsaMarketView })));
const RatesView = lazy(() => import('../views/RatesView').then(m => ({ default: m.RatesView })));
const HomeBriefing = lazy(() => import('../home/HomeBriefing').then(m => ({ default: m.HomeBriefing })));
import { DeskLoading } from '../common/Skeleton';
import type { ActiveTab } from '../../lib/options/types';

const VolStructureView = lazy(() => import('../views/VolStructureView').then(m => ({ default: m.VolStructureView })));
const PositioningView = lazy(() => import('../views/PositioningView').then(m => ({ default: m.PositioningView })));
const BtcView = lazy(() => import('../views/BtcView').then(m => ({ default: m.BtcView })));

/** Desks that paint without waiting on equity chain load. */
export const INDEPENDENT_TABS: ReadonlySet<ActiveTab> = new Set([
  'rates',
  'crypto',
  'academy',
  'ksa',
  'home',
]);

export function renderDeskView(tab: ActiveTab, loading: boolean): ReactNode {
  if (loading && !INDEPENDENT_TABS.has(tab)) {
    const testId = tab === 'vol' ? 'vol-structure-view' : tab === 'positioning' ? 'positioning-view' : tab === 'desk' ? 'trade-structure-workflow' : tab === 'rates' ? 'rates-view' : undefined;
    return <div data-testid={testId} className="h-full"><DeskLoading message="Building chain surface…" /></div>;
  }

  const view = (() => {
    switch (tab) {
      case 'home':
        return <HomeBriefing />;
      case 'vol':
        return <VolStructureView />;
      case 'positioning':
        return <PositioningView />;
      case 'desk':
        return <DeskView />;
      case 'crypto':
        return <BtcView />;
      case 'rates':
        return <RatesView />;
      case 'academy':
        return <AcademyView />;
      case 'ksa':
        return <KsaMarketView />;
      default:
        return <VolStructureView />;
    }
  })();

  return (
    <div key={tab} className="h-full term-crossfade" data-testid={tab === 'vol' ? 'vol-structure-view' : tab === 'positioning' ? 'positioning-view' : tab === 'rates' ? 'rates-view' : undefined}>
      <Suspense fallback={<DeskLoading message="Loading view…" />}>{view}</Suspense>
    </div>
  );
}

/** Paywall shown in place of a gated desk when no active subscription. */
function DeskPaywall({ tab }: { tab: ActiveTab }) {
  const setBillingOpen = useAccountStore((s) => s.setBillingOpen);
  const user = useAccountStore((s) => s.user);
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-5 text-center shadow-xl">
        <Lock className="mx-auto mb-2 size-5 text-primary" />
        <h2 className="font-mono text-sm font-semibold uppercase tracking-[0.16em] text-foreground">
          {tab} desk — subscribers
        </h2>
        <p className="mt-1.5 font-mono text-xs leading-relaxed text-muted-foreground">
          This desk is part of a paid plan.
          {user ? '' : ' Sign in with your billing email to link an existing subscription.'}
        </p>
        <button
          onClick={() => setBillingOpen(true)}
          className="mt-3 rounded border border-primary/40 bg-secondary px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors hover:border-primary hover:bg-accent"
        >
          Unlock this desk
        </button>
      </div>
    </div>
  );
}

/** Hooks-safe gate: renders the paywall or hands off to renderDeskView. */
export function DeskViewGate({ tab, loading }: { tab: ActiveTab; loading: boolean }) {
  const allowed = useAccountStore((s) => s.deskAllowed(tab));
  if (!allowed) return <DeskPaywall tab={tab} />;
  return <>{renderDeskView(tab, loading)}</>;
}
