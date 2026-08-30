import { describe, expect, it } from 'vitest';

/** KSA Phase 9 — event time vs fetch time separation in the session strip. */
describe('KsaMarketView — Phase 9 contract guards', () => {
  it('source: obs timestamp and fetch-time labels present, distinct titles', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const text = fs.readFileSync(path.join(import.meta.dirname, 'KsaMarketView.tsx'), 'utf8');
    expect(text).toContain('obs {new Date(board.tasi.timestamp)');
    expect(text).toContain('fetched {new Date(board.as_of)');
    expect(text).toContain('Event time (observation) — separate from fetch time');
  });
});
