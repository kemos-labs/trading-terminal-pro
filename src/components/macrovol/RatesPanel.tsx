import { useCallback, useState } from 'react';
import { ImplyDrawer } from '../common/ImplyDrawer';
import { EmptyState, SectionSkeleton } from '../common/EmptyState';
import { SectionErrorBoundary } from '../common/SectionErrorBoundary';
import type { ImplyRead } from '../../lib/macrovol/api';
import { useRatesData } from './rates/useRatesData';
import { MoneyMarketStrip } from './rates/MoneyMarketStrip';
import { SnapshotCards } from './rates/SnapshotCards';
import { ShapeSection } from './rates/ShapeSection';
import { NyFedBoard } from './rates/NyFedBoard';
import { StirSection } from './rates/StirSection';
import { BasisSection } from './rates/BasisSection';
import { CashFuturesMonitor } from './rates/CashFuturesMonitor';
import { PlumbingSection } from './rates/PlumbingSection';
import { PlumbingBarometer } from './rates/PlumbingBarometer';
import { CorrSection } from './rates/CorrSection';
import { PremiumSection } from './rates/PremiumSection';
import { JapanCarryPanel } from './rates/JapanCarryPanel';
import { CurvesBoard } from './rates/CurvesBoard';
import { FxBoard } from './rates/FxBoard';
import { GlobalYieldsBoard } from './rates/GlobalYieldsBoard';
import { UstDataStrip } from './rates/UstDataStrip';
import { AuctionCard } from './rates/AuctionCard';

/**
 * US rates desk — information hierarchy:
 *   money markets (data → chart) → UST (data → chart) → STIR → plumbing
 * Global/FX/Japan are rendered by RatesView after this panel (relevance order).
 *
 * Rule: every block is *data first, then meaning (chart)* for the same series.
 */
export function RatesPanel({
  includeGlobalBlocks = false,
  mode,
}: {
  /** When true, also render Global 10Y / FX / Japan (standalone use). RatesView sets false. */
  includeGlobalBlocks?: boolean;
  /** When set, only render the blocks for that Rates desk mode (4-mode IA). */
  mode?: 'funding' | 'ust' | 'stir' | 'world';
}) {
  const {
    summary, plumbing, basis, basisHist, stir, shape, curve, curveMeta,
    curveCompare, curveComparePoints, corr,
    error, loading, stirLoading,
    stirChart, shapeHistoryCharts, basisChart,
    compareWindow, setCompareWindow, customDays, setCustomDays, compareLoading,
  } = useRatesData();
  const [implyDrawer, setImplyDrawer] = useState<{ imply: ImplyRead; context?: string } | null>(null);
  const openImply = useCallback((i: ImplyRead) => setImplyDrawer({ imply: i }), []);

  // Core FRED pack only — STIR never blocks Funding/UST first paint.
  if (loading) {
    return (
      <div className="p-1">
        <EmptyState kind="loading" title="Loading rates…" body="FRED · NYFed (shared cache)" compact />
        <SectionSkeleton rows={2} className="mt-1" />
      </div>
    );
  }
  if (error && !summary) {
    return (
      <EmptyState
        kind="api-down"
        title="Rates API unavailable"
        body={error}
        action={
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-type-xs hover:border-primary"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        }
      />
    );
  }

  const funding = (
    <>
      <PlumbingBarometer plumbing={plumbing} basis={basis} summary={summary} />
      <div id="sec-mm-strip">
        <MoneyMarketStrip
          summary={summary}
          basis={basis}
          plumbing={plumbing}
          basisHist={basisHist}
          stir={stir}
        />
      </div>
      {basis && (
        <div id="sec-basis">
          <BasisSection
            basis={basis}
            basisHist={basisHist}
            plumbing={plumbing}
            basisChart={basisChart}
            compactData
          />
        </div>
      )}
      <div id="sec-cash-futures">
        <CashFuturesMonitor
          treasuryFutures={stir?.treasury_futures}
          curve={curve}
          sofr={summary?.sofr ?? stir?.sofr ?? plumbing?.sofr}
          effr={summary?.effr ?? plumbing?.effr}
        />
      </div>
      <div id="sec-plumbing">
        <PlumbingSection plumbing={plumbing} />
      </div>
    </>
  );

  // P0 Fix: removed duplicate UST curve panels (YieldCurveCompare early + CurveSection duplicate). Single CurvesBoard is canonical; stale/error provenance preserved via DataBadge/freshness.
  const ust = (
    <>
      <div id="sec-ust-data">
        <UstDataStrip
          summary={summary}
          curve={curve}
          curveMeta={curveMeta}
          shape={shape}
        />
      </div>
      <CurvesBoard
        curve={curve}
        curveMeta={curveMeta}
        curveComparePoints={curveComparePoints}
        curveCompare={curveCompare}
        stirChart={stirChart}
        sofr={summary?.sofr ?? stir?.sofr}
        shape={shape}
        spreadHistory={shapeHistoryCharts}
        onOpenImply={openImply}
        compareWindow={compareWindow}
        onCompareWindow={setCompareWindow}
        customDays={customDays}
        onCustomDays={setCustomDays}
        compareLoading={compareLoading}
      />
      {shape && (
        <div id="sec-shape">
          <ShapeSection
            shape={shape}
            shapeHistoryCharts={shapeHistoryCharts}
            onOpenImply={openImply}
          />
        </div>
      )}
      <div id="sec-auctions">
        <AuctionCard />
      </div>
    </>
  );

  const stirMode = (
    <>
      {stirLoading && !stir ? (
        <div className="p-1">
          <EmptyState
            kind="loading"
            title="Loading STIR strip…"
            body="yfinance SR3/SR1 · first load can take ~10s, then shared cache"
            compact
          />
          <SectionSkeleton rows={2} className="mt-1" />
        </div>
      ) : (
        <>
          <div id="sec-stir">
            <StirSection stir={stir} stirChart={stirChart} onOpenImply={openImply} />
          </div>
          {stir?.nyfed?.ref_print && stir.nyfed.ref_print.length > 0 && (
            <div id="sec-nyfed">
              <NyFedBoard nyfed={stir.nyfed} />
            </div>
          )}
        </>
      )}
    </>
  );

  const world = (
    <>
      <div id="sec-global">
        <GlobalYieldsBoard />
      </div>
      <div id="sec-fx">
        <FxBoard />
      </div>
      <div id="sec-japan">
        <JapanCarryPanel />
      </div>
      <div id="sec-premium">
        <PremiumSection basis={basis} plumbing={plumbing} stir={stir} shape={shape} />
      </div>
      {corr && corr.matrix?.length > 0 && (
        <div id="sec-asset-corr">
          <CorrSection corr={corr} />
        </div>
      )}
    </>
  );

  const renderMode = (m: NonNullable<typeof mode>) => {
    switch (m) {
      case 'funding': return funding;
      case 'ust': return ust;
      case 'stir': return stirMode;
      case 'world': return world;
    }
  };

  return (
    <SectionErrorBoundary name="Rates panel">
      <div className="flex flex-col gap-1.5 p-1 font-mono [&>*]:min-w-0">
        <ImplyDrawer
          open={!!implyDrawer}
          imply={implyDrawer?.imply ?? null}
          context={implyDrawer?.context}
          onClose={() => setImplyDrawer(null)}
        />

        {mode ? renderMode(mode) : (
          <>
            {funding}
            {ust}
            {stir}
            {includeGlobalBlocks ? world : null}
          </>
        )}

        {/* Snapshot only on Funding (or full panel) — avoid repeating on every mode */}
        {(!mode || mode === 'funding') && <SnapshotCards summary={summary} />}
      </div>
    </SectionErrorBoundary>
  );
}
