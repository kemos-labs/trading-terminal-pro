import { describe, it, expect } from 'vitest';
import { normalizeKsaSymbol, riyadhSessionSnapshot } from './ksaSession';

describe('normalizeKsaSymbol', () => {
  it('accepts numeric Tadawul codes', () => {
    expect(normalizeKsaSymbol('2222')).toBe('2222');
    expect(normalizeKsaSymbol('1120')).toBe('1120');
  });

  it('strips Yahoo-style suffixes', () => {
    expect(normalizeKsaSymbol('2222.SR')).toBe('2222');
    expect(normalizeKsaSymbol('1120.sa')).toBe('1120');
  });

  it('rejects garbage', () => {
    expect(normalizeKsaSymbol('AAPL')).toBeNull();
    expect(normalizeKsaSymbol('')).toBeNull();
  });
});

describe('riyadhSessionSnapshot', () => {
  it('returns Asia/Riyadh metadata', () => {
    const s = riyadhSessionSnapshot(new Date('2026-07-15T12:00:00Z')); // Wed
    expect(s.timezone).toBe('Asia/Riyadh');
    expect(s.sessionNote).toMatch(/Sun–Thu/);
    expect(typeof s.open).toBe('boolean');
    expect(['closed', 'preopen', 'open', 'postclose']).toContain(s.phase);
  });

  it('marks Friday as non-trading day', () => {
    // 2026-07-17 is Friday
    const s = riyadhSessionSnapshot(new Date('2026-07-17T10:00:00+03:00'));
    expect(s.tradingDay).toBe(false);
    expect(s.open).toBe(false);
    expect(s.phase).toBe('closed');
  });

  it('marks Wednesday mid-session as open', () => {
    // 2026-07-15 is Wednesday; 11:00 Riyadh
    const s = riyadhSessionSnapshot(new Date('2026-07-15T11:00:00+03:00'));
    expect(s.tradingDay).toBe(true);
    expect(s.phase).toBe('open');
    expect(s.open).toBe(true);
  });

  it('marks preopen and postclose on a trading day', () => {
    const pre = riyadhSessionSnapshot(new Date('2026-07-15T09:45:00+03:00'));
    expect(pre.phase).toBe('preopen');
    expect(pre.open).toBe(false);

    const post = riyadhSessionSnapshot(new Date('2026-07-15T15:30:00+03:00'));
    expect(post.phase).toBe('postclose');
    expect(post.open).toBe(false);
  });
});
