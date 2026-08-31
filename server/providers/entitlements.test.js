import { describe, expect, it } from 'vitest';
import { providerEntitlements } from './entitlements.js';

describe('provider entitlement selection', () => {
  it('selects explicitly labelled public alternatives when Velo is absent', () => {
    const crypto = providerEntitlements({}).crypto;
    expect(crypto).toEqual({
      mode: 'free-alternatives',
      fallbackProviders: ['Binance Futures', 'Bybit Linear'],
      normalization: 'provider-native-not-velo-normalized',
    });
    expect(crypto).not.toHaveProperty('veloCredentialPresent');
    expect(crypto).not.toHaveProperty('veloConfigured');
  });

  it('keeps the free fallback active when a partial Velo configuration is present', () => {
    const mode = providerEntitlements({ VELO_API_KEY: 'test-key' }).crypto;
    expect(mode.mode).toBe('velo-config-unverified');
    expect(mode.fallbackProviders).toEqual(['Binance Futures', 'Bybit Linear']);
    expect(mode.normalization).toMatch(/unverified/);
  });

  it('does not claim complete Velo configuration is active without a capability probe', () => {
    const mode = providerEntitlements({ VELO_API_TOKEN: 'test-token', VELO_API_BASE_URL: 'https://example.test' }).crypto;
    expect(mode.mode).toBe('velo-config-unverified');
    expect(mode.fallbackProviders).toEqual(['Binance Futures', 'Bybit Linear']);
  });
});
