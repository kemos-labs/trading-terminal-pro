import { describe, expect, it } from 'vitest';

/** Contract guards: carry term structure + funding history visuals, honest unavailability. */
describe('CryptoCarryView — Phase 7 contract guards', () => {
  it('source declares basis term structure + funding history with fail-closed copy', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const text = fs.readFileSync(path.join(import.meta.dirname, 'CryptoCarryView.tsx'), 'utf8');
    expect(text).toContain('carry-basis-term');
    expect(text).toContain('carry-funding-history');
    expect(text).toContain('basis-term-unavailable');
    expect(text).toContain('funding-history-unavailable');
    expect(text).toContain('/api/v1/market/crypto/');
    // Strict v1 points preserve missing rates instead of coercing them to zero.
    expect(text).toContain('Number.isFinite(row.rate8h)');
    expect(text).not.toContain('current_funding_8h ?? 0');
    // Current-funding reference line on the history chart
    expect(text).toContain('current 8h');
    // Robust percentile-clamped basis domain
    expect(text).toContain('vals.length * 0.1');
    expect(text).toContain('no synthetic missing expiry');
    // Straight segments for discrete futures
    expect(text).toContain('type="linear"');
  });
});
