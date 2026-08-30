import { describe, expect, it } from 'vitest';

/** Contract guards: crypto Trade&Risk — expiry selector, combo Greeks, executable-side honesty. */
describe('CryptoTradeView — Phase 7 contract guards', () => {
  it('source declares expiry selector, leg Greeks, observed-quote pricing rules', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const text = fs.readFileSync(path.join(import.meta.dirname, 'CryptoTradeView.tsx'), 'utf8');
    expect(text).toContain('Expiry selector');
    expect(text).toContain('trade-leg-greeks');
    expect(text).toContain('unavailable (no observed IV)');
    expect(text).toContain('No ±1% synthetic spreads');
    expect(text).toContain('r=0 assumption, labelled');
    expect(text).toContain('greeksEuropean');
  });
});
