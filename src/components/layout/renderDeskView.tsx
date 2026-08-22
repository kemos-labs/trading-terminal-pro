/**
 * Shared desk view switch — classic shell and future tiles call the same path.
 */
import { Suspense, type ReactNode } from 'react';
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
