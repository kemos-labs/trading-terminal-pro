/**
 * Shared desk view switch — classic shell and future tiles call the same path.
 * `DeskViewGate` adds the billing paywall check (hooks-safe wrapper).
 */
import { Suspense, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { useAccountStore } from '../../store/accountStore';
import { VolStructureView } from '../views/VolStructureView';
import { PositioningView } from '../views/PositioningView';
import { DeskView } from '../views/DeskView';
import { BtcView } from '../views/BtcView';
import { RatesView } from '../views/RatesView';
import { AcademyView } from '../views/AcademyView';
import { KsaMarketView } from '../views/KsaMarketView';
import { DeskLoading } from '../common/Skeleton';
import type { ActiveTab } from '../../lib/options/types';

/** Desks that paint without waiting on equity chain load. */
export const INDEPENDENT_TABS: ReadonlySet<ActiveTab> = new Set([
  'rates',
  'crypto',
  'desk',
  'academy',
  'ksa',
]);

export function renderDeskView(tab: ActiveTab, loading: boolean): ReactNode {
  if (loading && !INDEPENDENT_TABS.has(tab)) {
    return <DeskLoading message="Building chain surface…" />;
  }

  const view = (() => {
    switch (tab) {
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
    <div key={tab} className="h-full term-crossfade">
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
          This desk is part of the paid VOLATERM plan.
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
