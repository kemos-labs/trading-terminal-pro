import { describe, expect, it } from 'vitest';

/** Contract guards: flow visuals precede the tape; aggregates + timeline + expiry dist present. */
describe('CryptoFlowView — Phase 7 contract guards', () => {
  it('source declares primary visuals before tape with honest provenance', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const text = fs.readFileSync(path.join(import.meta.dirname, 'CryptoFlowView.tsx'), 'utf8');
    expect(text).toContain('flow-aggregates');
    expect(text).toContain('flow-timeline');
    expect(text).toContain('flow-expiry-dist');
    expect(text).toContain('Taker side only — not opening/closing, not dealer identity');
    // Tape is labelled and comes after the visuals in render order
    expect(text.indexOf('flow-aggregates')).toBeLessThan(text.indexOf('Recent Deribit options trades'));
  });
});
