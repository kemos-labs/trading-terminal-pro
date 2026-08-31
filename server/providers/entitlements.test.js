import { describe, expect, it } from 'vitest';
import { providerEntitlements } from './entitlements.js';

describe('provider entitlement selection', () => {
  it('selects explicitly labelled public alternatives when Velo is absent', () => {
    expect(providerEntitlements({}).crypto).toEqual({
      mode: 'free-alternatives',
      veloCredentialPresent: false,
      veloConfigured: false,
      fallbackProviders: ['Binance Futures', 'Bybit Linear'],
      normalization: 'provider-native-not-velo-normalized',
    });
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
    expect(mode.veloConfigured).toBe(true);
    expect(mode.fallbackProviders).toEqual(['Binance Futures', 'Bybit Linear']);
  });
});
