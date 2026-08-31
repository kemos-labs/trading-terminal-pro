const truthyCredential = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Detects provider configuration without claiming entitlement. Credential/base
 * URL presence is not a capability probe. Until an authenticated probe verifies
 * quota, resolution, history, and redistribution rights, public alternatives
 * remain active and Velo is warning-only.
 */
export function providerEntitlements(env = process.env) {
  const veloCredentialPresent = truthyCredential(env.VELO_API_KEY) || truthyCredential(env.VELO_API_TOKEN);
  const veloBaseUrlPresent = truthyCredential(env.VELO_API_BASE_URL);
  const mode = veloCredentialPresent || veloBaseUrlPresent
    ? 'velo-config-unverified'
    : 'free-alternatives';
  return {
    crypto: {
      mode,
      // Free alternatives never disappear merely because an unverified Velo
      // variable is present. They are independent and remain usable.
      fallbackProviders: ['Binance Futures', 'Bybit Linear'],
      normalization: mode === 'free-alternatives'
        ? 'provider-native-not-velo-normalized'
        : 'velo-configuration-present-but-unverified; free-alternatives-remain-active',
    },
  };
}
