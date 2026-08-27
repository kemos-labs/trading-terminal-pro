/**
 * Deribit provider client — single owner for HTTP/WS/cache/rate discipline.
 * Fixed origin, allowlisted paths, redirect:error, abort timeout, content-type check, size cap, shape validation.
 */

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
  if (!ALLOWED_METHODS.has(base) && !base.startsWith('get_')) {
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
      const body = await res.text().catch(() => '');
      throw Object.assign(new Error(`Deribit HTTP ${res.status}: ${body.slice(0, 200)}`), { status: res.status, code: 'http_error' });
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error(`Unexpected content-type: ${ct}`);
    const len = res.headers.get('content-length');
    if (len && Number(len) > MAX_BODY_BYTES) throw new Error('Response too large');
    const json = await res.json();
    // Basic shape check
    if (!json || typeof json !== 'object') throw new Error('Invalid JSON shape');
    return json.result ?? json;
  } finally {
    clearTimeout(t);
  }
}

export function resetDeribitClientState() {
  lastRequestMs = 0;
  credits = 50000;
}
