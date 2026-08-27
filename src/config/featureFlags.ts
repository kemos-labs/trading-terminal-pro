/**
 * Feature flags — V2 shell and adapter migrations.
 * All flags default OFF to preserve legacy behavior until replacements pass gates.
 */

// Crypto V2 shell: when true, exposes six-workflow navigation; when false, legacy 15+14 routes
export const CRYPTO_V2 = import.meta.env.VITE_CRYPTO_V2 === '1' || import.meta.env.VITE_CRYPTO_V2 === 'true';

// Deribit adapter V2: when true, server uses new provider/client/normalize/stream; old remains read-only
export const DERIBIT_ADAPTER_V2 = import.meta.env.VITE_DERIBIT_ADAPTER_V2 === '1';

// Per-workflow flags (Phase 5-7 rollbacks)
export const VOLATILITY_V2 = import.meta.env.VITE_VOLATILITY_V2 === '1';
export const POSITIONING_V2 = import.meta.env.VITE_POSITIONING_V2 === '1';
export const FLOW_V2 = import.meta.env.VITE_FLOW_V2 === '1';
export const CARRY_V2 = import.meta.env.VITE_CARRY_V2 === '1';
