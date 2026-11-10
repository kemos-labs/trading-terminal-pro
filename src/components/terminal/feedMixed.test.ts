import { describe, it, expect } from 'vitest';
import { feedMixedLabel } from './feedMixed';

describe('feedMixedLabel', () => {
  it('returns Mixed when spot is live and chain is stale', () => {
    expect(feedMixedLabel('live', 'stale')).toBe('Mixed');
  });

  it('returns Mixed when spot is live and chain is expired', () => {
    expect(feedMixedLabel('live', 'expired')).toBe('Mixed');
  });

  it('returns Mixed for live vs unknown (partial truth, never silent live)', () => {
    expect(feedMixedLabel('live', 'unknown')).toBe('Mixed');
  });

  it('returns null when both agree (summary chip alone suffices)', () => {
    expect(feedMixedLabel('live', 'live')).toBeNull();
    expect(feedMixedLabel('stale', 'stale')).toBeNull();
    expect(feedMixedLabel('unknown', 'unknown')).toBeNull();
  });
});
