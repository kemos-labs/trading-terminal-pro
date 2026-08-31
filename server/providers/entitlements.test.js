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

  it('fails configuration closed rather than silently falling back with a partial Velo setup', () => {
    const mode = providerEntitlements({ VELO_API_KEY: 'test-key' }).crypto;
    expect(mode.mode).toBe('configuration-error');
    expect(mode.fallbackProviders).toEqual([]);
  });

  it('detects complete Velo configuration without claiming the connector is active', () => {
    const mode = providerEntitlements({ VELO_API_TOKEN: 'test-token', VELO_API_BASE_URL: 'https://example.test' }).crypto;
    expect(mode.mode).toBe('velo-configuration-detected');
    expect(mode.veloConfigured).toBe(true);
    expect(mode.fallbackProviders).toEqual([]);
  });
});
