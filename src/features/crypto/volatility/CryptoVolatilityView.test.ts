import { describe, expect, it } from 'vitest';
import { activeExpiryMs } from './CryptoVolatilityView';

describe('crypto volatility expiry scope', () => {
  it('excludes expired and exactly-expiring contracts from active analytics', () => {
    const now = Date.UTC(2026, 8, 1);
    expect(activeExpiryMs(now - 1, now)).toBe(false);
    expect(activeExpiryMs(now, now)).toBe(false);
    expect(activeExpiryMs(now + 1, now)).toBe(true);
  });
});
