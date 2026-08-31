/**
 * Canonical rates-worker base URL resolution (Node → private Python worker).
 *
 * RATES_WORKER_URL is the supported variable. MACROVOL_API_URL is kept only as
 * a deprecated compatibility alias and may be removed after consumers migrate.
 *
 * The worker is a private loopback-only service: non-loopback targets are
 * rejected and fall back to the loopback default, regardless of configuration.
 */

const LOOPBACK_DEFAULT = 'http://127.0.0.1:8765';

function isLoopback(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]';
}

export function resolveRatesWorkerUrl() {
  const raw = (process.env.RATES_WORKER_URL || process.env.MACROVOL_API_URL || LOOPBACK_DEFAULT).replace(/\/$/, '');
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' && isLoopback(u.hostname)) return raw;
  } catch {
    /* fall through to default */
  }
  return LOOPBACK_DEFAULT;
}
