/**
 * Deribit provider client — single owner for HTTP/WS/cache/rate discipline.
 * Fixed origin, allowlisted paths, redirect:error, abort timeout, content-type check, size cap, shape validation.
 */

import {
  PROVIDER_CIRCUITS,
  withProviderCircuit,
} from '../../../api/providerCircuitBreaker.js';

const DERIBIT_ORIGIN = 'https://www.deribit.com';
const ALLOWED_PREFIX = '/api/v2/public/';
const TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const ALLOWED_METHODS = new Set([
  'get_instruments',
  'get_book_summary_by_currency',
  'ticker',
  'get_order_book',
  'get_last_trades_by_currency_and_time',
  'get_volatility_index_data',
  'get_funding_rate_history',
  'get_index_price',
]);

let lastRequestMs = 0;
let credits = 50000; // bucket simulation

export async function deribitFetch(method, params = {}) {
  const base = method.split('?')[0];
  if (!ALLOWED_METHODS.has(base)) {
    throw Object.assign(new Error('Deribit method is not available'), { code: 'not_allowlisted' });
  }
  return withProviderCircuit(PROVIDER_CIRCUITS.DERIBIT, () => deribitFetchUnprotected(method, params));
}

async function deribitFetchUnprotected(method, params = {}) {
  const base = method.split('?')[0];
  if (!ALLOWED_METHODS.has(base)) {
    throw Object.assign(new Error(`Deribit method not allowlisted: ${method}`), { code: 'not_allowlisted' });
  }
  // Rate discipline: credits
  const now = Date.now();
  const elapsedSec = (now - lastRequestMs) / 1000;
  credits = Math.min(50000, credits + elapsedSec * 10000);
  if (credits < 500) {
    throw Object.assign(new Error('Deribit rate limit: insufficient credits'), { code: 'rate_limited' });
  }
  credits -= 500;
  lastRequestMs = now;

  const url = new URL(`${DERIBIT_ORIGIN}${ALLOWED_PREFIX}${method}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: ctrl.signal,
    });
    if (!res.ok) {
      await res.text().catch(() => '');
      throw Object.assign(new Error(`Deribit upstream HTTP ${res.status}`), { status: res.status, code: 'http_error' });
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw Object.assign(new Error('Deribit returned an unexpected content type'), { code: 'invalid_payload' });
    const len = res.headers.get('content-length');
    if (len && Number(len) > MAX_BODY_BYTES) throw Object.assign(new Error('Deribit response exceeded the size limit'), { code: 'invalid_payload' });
    const json = await res.json();
    // Basic shape check
    if (!json || typeof json !== 'object') throw Object.assign(new Error('Deribit returned an invalid payload'), { code: 'invalid_payload' });
    return json.result ?? json;
  } finally {
    clearTimeout(t);
  }
}

export function resetDeribitClientState() {
  lastRequestMs = 0;
  credits = 50000;
}
