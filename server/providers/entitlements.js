const truthyCredential = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Detects provider capability without returning any credential material.
 * A Velo entitlement is considered usable only when both a credential and an
 * explicit API base URL are configured; this prevents a key from silently
 * falling through to a differently-normalized free feed.
 */
export function providerEntitlements(env = process.env) {
  const veloCredentialPresent = truthyCredential(env.VELO_API_KEY) || truthyCredential(env.VELO_API_TOKEN);
  const veloBaseUrlPresent = truthyCredential(env.VELO_API_BASE_URL);
  const veloConfigured = veloCredentialPresent && veloBaseUrlPresent;
  const mode = veloConfigured
    ? 'velo-configuration-detected'
    : veloCredentialPresent
      ? 'configuration-error'
      : 'free-alternatives';
  return {
    crypto: {
      mode,
      veloCredentialPresent,
      veloConfigured,
      fallbackProviders: mode === 'free-alternatives' ? ['Binance Futures', 'Bybit Linear'] : [],
      normalization: mode === 'free-alternatives'
        ? 'provider-native-not-velo-normalized'
        : mode === 'velo-configuration-detected'
          ? 'unavailable-pending-verified-velo-connector'
          : 'unavailable-incomplete-velo-configuration',
    },
  };
}
