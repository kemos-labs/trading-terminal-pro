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

  it('fail-closes when history is missing (no synthetic auto-substitution)', () => {
    const { result } = renderHook(() => useSpotPath(20));
    expect(result.current.source).toBe('none');
    expect(result.current.isScenario).toBe(false);
    expect(result.current.path.length).toBe(0);
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
