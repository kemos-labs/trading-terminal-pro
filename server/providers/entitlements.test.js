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

  it('does not disclose partial Velo configuration through public mode fields', () => {
    const absent = providerEntitlements({}).crypto;
    const partial = providerEntitlements({ VELO_API_KEY: 'test-key' }).crypto;
    expect(partial).toEqual(absent);
  });

  it('does not disclose apparently complete configuration without a capability probe', () => {
    const absent = providerEntitlements({}).crypto;
    const configured = providerEntitlements({ VELO_API_TOKEN: 'test-token', VELO_API_BASE_URL: 'https://example.test' }).crypto;
    expect(configured).toEqual(absent);
  });
});
