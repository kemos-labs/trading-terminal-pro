import React from 'react';
import { describe, expect, it, vi } from 'vitest';

/**
 * Crypto Positioning — canonical engine adoption contract guards.
 * Exposure math is property-tested in lib/math/positioning; here we verify the
 * rebuilt view wires the canonical HeatmapEngine with metric switching,
 * spot-centered windows and honest provenance labels.
 */

vi.mock('../../../api/deribit', () => ({
  fetchDeribitMarket: vi.fn(async () => ({
    currency: 'BTC',
    indexPrice: 77000,
    instruments: [],
    coverage: 0,
    fetchedAt: Date.now(),
    source: 'deribit',
  })),
}));

describe('CryptoPositioningView — Phase 7 contract guards', () => {
  it('view source: canonical HeatmapEngine + 4 metrics + spot-centered window + sign-model labels', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const text = fs.readFileSync(path.join(import.meta.dirname, 'CryptoPositioningView.tsx'), 'utf8');
    expect(text).toContain('crypto-exposure-matrix');
    expect(text).toContain("HeatmapEngine");
    // Metric switcher covers GEX/DEX/Vanna/Charm
    for (const m of ['gex', 'dex', 'vanna', 'charm']) {
      expect(text).toContain(`'${m}'`);
    }
    // Spot-centered window, never first-N
    expect(text).toContain('Math.abs(k - spot) / spot <= 0.15');
    // Sign-model + OI-proxy honesty
    expect(text).toContain('calls +1 / puts −1');
    expect(text).toContain('not dealer inventory');
  });
});
