/**
 * Public provider mode. Server configuration presence is deliberately excluded:
 * it is neither entitlement nor a capability probe, and exposing a different
 * public enum/string for it creates a credential-configuration oracle. Until a
 * server-side probe verifies endpoint access, quota, resolution, history, and
 * redistribution rights, the only honest public mode is the free fallback.
 */
export function providerEntitlements() {
  return {
    crypto: {
      mode: 'free-alternatives',
      fallbackProviders: ['Binance Futures', 'Bybit Linear'],
      normalization: 'provider-native-not-velo-normalized',
    },
  };
}
