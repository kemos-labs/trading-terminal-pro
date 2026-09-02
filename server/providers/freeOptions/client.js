/** Provider-owned public options summaries for the bounded free venue strip. */
import { getOrFetch } from '../../../api/upstreamCache.js';
import { PROVIDER_CIRCUITS, withProviderCircuit } from '../../../api/providerCircuitBreaker.js';

const ORIGINS = Object.freeze({ okx: 'https://www.okx.com', bybit: 'https://api.bybit.com' });
const TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const CURRENCIES = new Set(['BTC', 'ETH']);

function assertCurrency(currency) {
  const value = String(currency || '').toUpperCase();
  if (!CURRENCIES.has(value)) throw Object.assign(new Error('currency must be BTC or ETH'), { status: 400, code: 'UNSUPPORTED_CURRENCY' });
  return value;
}

async function jsonGet(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, redirect: 'error', signal: controller.signal });
    if (!response.ok) throw Object.assign(new Error('options provider unavailable'), { status: response.status, code: 'http_error' });
    const length = response.headers.get('content-length');
    if (length && Number(length) > MAX_BODY_BYTES) throw Object.assign(new Error('options provider payload too large'), { code: 'invalid_payload' });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) throw Object.assign(new Error('options provider returned invalid content type'), { code: 'invalid_payload' });
    const bytes = await readBoundedBody(response);
    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw Object.assign(new Error('options provider returned invalid payload'), { code: 'invalid_payload' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('options provider returned invalid payload'), { code: 'invalid_payload' });
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedBody(response) {
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        total += chunk.byteLength;
        if (total > MAX_BODY_BYTES) {
          await reader.cancel('options provider payload too large').catch(() => {});
          throw Object.assign(new Error('options provider payload too large'), { code: 'invalid_payload' });
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock?.();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes.buffer;
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) throw Object.assign(new Error('options provider payload too large'), { code: 'invalid_payload' });
  return bytes;
}

const observedNonNegative = (value) => {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
const sumObserved = (rows, select) => {
  const values = rows.map(select).map(observedNonNegative).filter((value) => value != null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
};

export async function fetchOkxOptionsSummary(currency) {
  const ccy = assertCurrency(currency);
  return getOrFetch(`free-options:okx:${ccy}`, 30_000, () => withProviderCircuit(PROVIDER_CIRCUITS.OKX_OPTIONS, async () => {
    const body = await jsonGet(`${ORIGINS.okx}/api/v5/market/tickers?instType=OPTION&instFamily=${ccy}-USD`);
    if (String(body.code) !== '0') throw Object.assign(new Error('OKX provider rejected the request'), { code: 'provider_unavailable' });
    const rows = Array.isArray(body.data) ? body.data : [];
    if (!rows.length) throw Object.assign(new Error('options provider returned no rows'), { code: 'insufficient_coverage' });
    let openInterestBaseCcy = null;
    let openInterestNative = sumObserved(rows, (row) => row.openInt);
    try {
      const oi = await jsonGet(`${ORIGINS.okx}/api/v5/public/open-interest?instType=OPTION&instFamily=${ccy}-USD`);
      if (String(oi.code) === '0') {
        const oiRows = Array.isArray(oi.data) ? oi.data : [];
        const preferred = sumObserved(oiRows, (row) => row.oiCcy);
        if (preferred != null) {
          openInterestBaseCcy = preferred;
          openInterestNative = null;
        }
      }
    } catch { /* ticker open interest remains the bounded fallback */ }
    return { venue: 'OKX', source: 'okx-public', instruments: rows.length, volume24hBaseCcy: sumObserved(rows, (row) => row.volCcy24h), volume24hNative: null, volume24hUsd: sumObserved(rows, (row) => row.volUsd24h), openInterestBaseCcy, openInterestNative, units: { volume24hBaseCcy: 'base currency (OKX volCcy24h)', volume24hNative: null, volume24hUsd: 'USD (OKX volUsd24h)', openInterestBaseCcy: openInterestBaseCcy != null ? 'base currency (OKX oiCcy)' : null, openInterestNative: openInterestNative != null ? 'venue-native contracts (OKX ticker openInt)' : null }, fetchedAt: Date.now() };
  }), { allowStaleOnError: true, maxStaleMs: 120_000 });
}

export async function fetchBybitOptionsSummary(currency) {
  const ccy = assertCurrency(currency);
  return getOrFetch(`free-options:bybit:${ccy}`, 30_000, () => withProviderCircuit(PROVIDER_CIRCUITS.BYBIT_OPTIONS, async () => {
    const body = await jsonGet(`${ORIGINS.bybit}/v5/market/tickers?category=option&baseCoin=${ccy}`);
    if (body.retCode !== 0 && String(body.retCode) !== '0') throw Object.assign(new Error('Bybit provider rejected the request'), { code: 'provider_unavailable' });
    const rows = Array.isArray(body.result?.list) ? body.result.list : [];
    if (!rows.length) throw Object.assign(new Error('options provider returned no rows'), { code: 'insufficient_coverage' });
    return { venue: 'Bybit', source: 'bybit-public', instruments: rows.length, volume24hBaseCcy: null, volume24hNative: sumObserved(rows, (row) => row.volume24h), volume24hUsd: null, openInterestBaseCcy: null, openInterestNative: sumObserved(rows, (row) => row.openInterest), units: { volume24hBaseCcy: null, volume24hNative: 'venue-native (Bybit volume24h; unit not published by adapter)', volume24hUsd: null, openInterestBaseCcy: null, openInterestNative: 'venue-native (Bybit openInterest; unit not published by adapter)' }, fetchedAt: Date.now() };
  }), { allowStaleOnError: true, maxStaleMs: 120_000 });
}
