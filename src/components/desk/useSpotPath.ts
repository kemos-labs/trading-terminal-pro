import { useMemo } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import { historyToSpotBars, syntheticSpotPath, type SpotBar } from '../../lib/options/greeksPnl';

export type SpotPathSource = 'fmp' | 'yfinance' | 'synth' | 'none';

/**
 * Spot path for desk PnL tools — observed history only, fail-closed.
 * P0 fix: never auto-substitute synthetic for missing history. Historical replay
 * returns empty when no observed history. Scenario must be explicitly selected
 * by user via separate Scenario toggle (syntheticSpotPath). Consumers must pass
 * provenance into calculations and label charts accordingly.
 */
export function useSpotPath(days = 40): { path: SpotBar[]; source: SpotPathSource; isScenario: false } {
  const fmpHistory = useTerminalStore((s) => s.fmpHistory);
  const historySource = useTerminalStore((s) => s.historySource);
  return useMemo(() => {
    const fromHist = historyToSpotBars(fmpHistory, days);
    if (fromHist.length >= 5 && historySource !== 'none') {
      return { path: fromHist, source: historySource as SpotPathSource, isScenario: false as const };
    }
    return { path: [] as SpotBar[], source: 'none' as SpotPathSource, isScenario: false as const };
  }, [fmpHistory, historySource, days]);
}

/** Explicit user-controlled synthetic scenario path — call only when user toggles Scenario */
export function useScenarioSpotPath(days = 40, enabled = false): { path: SpotBar[]; source: SpotPathSource; isScenario: boolean } {
  const spot = useTerminalStore((s) => s.snapshot?.spot ?? 0);
  const atmIV = useTerminalStore((s) => s.snapshot?.expiries?.[0]?.atmIV ?? 0.2);
  return useMemo(() => {
    if (!enabled || !(spot > 0)) return { path: [] as SpotBar[], source: 'none' as SpotPathSource, isScenario: false };
    const vol = atmIV > 0.01 && atmIV < 3 ? atmIV : 0.2;
    return { path: syntheticSpotPath(spot, days, vol, 17), source: 'synth' as SpotPathSource, isScenario: true };
  }, [spot, atmIV, days, enabled]);
}
