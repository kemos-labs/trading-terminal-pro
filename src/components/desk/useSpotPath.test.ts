import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSpotPath } from './useSpotPath';
import { useTerminalStore } from '../../store/terminalStore';
import { buildSnapshot } from '../../lib/options/synthetic';

describe('useSpotPath', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      snapshot: buildSnapshot('SPY', Date.now(), 500, 0, 0),
      fmpHistory: null,
      historySource: 'none',
    });
  });

  it('falls back to synthetic scenario path when history is missing (labelled Scenario)', () => {
    const { result } = renderHook(() => useSpotPath(20));
    expect(result.current.source).toBe('synth');
    expect(result.current.isScenario).toBe(true);
    expect(result.current.path.length).toBeGreaterThanOrEqual(5);
    expect(result.current.path.every((b) => b.close > 0)).toBe(true);
  });

  it('prefers real history when available', () => {
    const hist = Array.from({ length: 30 }, (_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      close: 100 + i,
    }));
    useTerminalStore.setState({ fmpHistory: hist, historySource: 'yfinance' });
    const { result } = renderHook(() => useSpotPath(20));
    expect(result.current.source).toBe('yfinance');
    expect(result.current.isScenario).toBe(false);
    expect(result.current.path.length).toBeGreaterThanOrEqual(5);
    expect(result.current.path[result.current.path.length - 1]!.close).toBe(129);
  });
});
