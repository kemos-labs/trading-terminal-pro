import { useMemo } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import { historyToSpotBars, syntheticSpotPath, type SpotBar } from '../../lib/options/greeksPnl';

export type SpotPathSource = 'fmp' | 'yfinance' | 'synth' | 'none';

/**
 * Spot path for desk PnL tools.
 * P0 fix: synthetic GBM is a user-controlled scenario model, never historical.
 * Prefer real FMP/yfinance history (observed). Fallback synthetic is explicitly
 * labelled 'synth' / scenario — consumers must render a Scenario badge and
 * must not label the chart Historical/Observed.
 */
export function useSpotPath(days = 40): { path: SpotBar[]; source: SpotPathSource; isScenario: boolean } {
  const fmpHistory = useTerminalStore((s) => s.fmpHistory);
  const historySource = useTerminalStore((s) => s.historySource);
  const spot = useTerminalStore((s) => s.snapshot?.spot ?? 0);
  const atmIV = useTerminalStore((s) => s.snapshot?.expiries?.[0]?.atmIV ?? 0.2);

  return useMemo(() => {
    const fromHist = historyToSpotBars(fmpHistory, days);
    if (fromHist.length >= 5 && historySource !== 'none') {
      return { path: fromHist, source: historySource as SpotPathSource, isScenario: false };
    }
    if (spot > 0) {
      const vol = atmIV > 0.01 && atmIV < 3 ? atmIV : 0.2;
      return {
        path: syntheticSpotPath(spot, days, vol, 17),
        source: 'synth',
        isScenario: true,
      };
    }
    return { path: [] as SpotBar[], source: 'none', isScenario: false };
  }, [fmpHistory, historySource, days, spot, atmIV]);
}
