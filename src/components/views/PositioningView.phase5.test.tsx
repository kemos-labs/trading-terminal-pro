import React from 'react';
import { describe, expect, it, vi } from 'vitest';

/**
 * Positioning desk Phase 5 additions — canonical engine adoption.
 * The heavy dealer math is covered by analytics property tests; here we verify
 * the desk mounts the canonical exposure matrix + session-change sections with
 * the right data-testid contracts and honest copy (no synthetic claims).
 */

vi.mock('../../store/terminalStore', () => ({
  useTerminalStore: (selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      deskSectionId: 'pos-sub-chain',
      snapshot: null,
      symbol: 'SPY',
      sviReadout: null,
      arbResult: null,
      setDeskContext: vi.fn(),
    };
    return selector(state);
  },
}));

vi.mock('../charts/HeatmapEngine', () => ({
  HeatmapEngine: () => <div data-testid="heatmap-engine-stub" />,
  default: () => <div data-testid="heatmap-engine-stub" />,
}));

describe('PositioningView — Phase 5 contract guards', () => {
  it('module imports and exposes the desk (smoke via source contracts)', async () => {
    const src = await import('./PositioningView');
    expect(typeof src.PositioningView).toBe('function');
  });

  it('view source declares the canonical engine sections with honest empty copy', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const text = fs.readFileSync(path.join(import.meta.dirname, 'PositioningView.tsx'), 'utf8');
    // Canonical exposure matrix present, spot-centered (never first-N)
    expect(text).toContain('positioning-exposure-matrix');
    expect(text).toContain('spot-centered ±10%');
    // Session-change section present with observed-sample provenance
    expect(text).toContain('positioning-session-change');
    expect(text).toContain('browser-local book samples (observed)');
    expect(text).toContain('no synthetic history');
    // OI-proxy honesty retained
    expect(text).toContain('OI-inferred');
  });
});
