/**
 * Free crypto market adapter.
 *
 * Uses public Binance Futures and Bybit linear-perpetual endpoints. No API key,
 * account access, or trading permissions are involved. Keep this server-side
 * so the app owns caching, timeout, and rate discipline.
 */

const VENUES = {
  binance: 'https://fapi.binance.com',
  bybit: 'https://api.bybit.com',
};
const TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 15_000;
const cache = new Map();

function symbolFor(currency) {
  const c = String(currency || '').toUpperCase();
  return c === 'BTC' || c === 'ETH' ? `${c}USDT` : null;
}

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Free crypto upstream HTTP ${res.status}`);
    const json = await res.json();
    if (!json || typeof json !== 'object') throw new Error('Free crypto upstream returned invalid JSON');
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchBinance(symbol) {
  const [ticker, premium, oi] = await Promise.all([
    getJson(`${VENUES.binance}/fapi/v1/ticker/24hr?symbol=${symbol}`),
    getJson(`${VENUES.binance}/fapi/v1/premiumIndex?symbol=${symbol}`),
    getJson(`${VENUES.binance}/fapi/v1/openInterest?symbol=${symbol}`),
  ]);
  return {
    venue: 'Binance Futures',
    symbol,
    last: finite(ticker.lastPrice),
    mark: finite(premium.markPrice),
    index: finite(premium.indexPrice),
    funding8h: finite(premium.lastFundingRate),
    openInterest: finite(oi.openInterest),
    volume24hUsd: finite(ticker.quoteVolume),
    change24hPct: finite(ticker.priceChangePercent),
    fetchedAt: Date.now(),
  };
}

async function fetchBybit(symbol) {
  const url = `${VENUES.bybit}/v5/market/tickers?category=linear&symbol=${symbol}`;
  const json = await getJson(url);
  const row = Array.isArray(json.result?.list) ? json.result.list[0] : null;
  if (!row) throw new Error('Bybit returned no ticker');
  return {
    venue: 'Bybit Linear',
    symbol,
    last: finite(row.lastPrice),
    mark: finite(row.markPrice),
    index: finite(row.indexPrice),
    funding8h: finite(row.fundingRate),
    openInterest: finite(row.openInterest),
    volume24hUsd: finite(row.turnover24h),
    change24hPct: finite(row.price24hPcnt != null ? Number(row.price24hPcnt) * 100 : null),
    fetchedAt: Date.now(),
  };
}

export async function fetchFreeCryptoMarket(currency) {
  const c = String(currency || '').toUpperCase();
  const symbol = symbolFor(c);
  if (!symbol) throw Object.assign(new Error('currency must be BTC or ETH'), { status: 400 });
  const hit = cache.get(c);
  if (hit && Date.now() < hit.expiresAt) return hit.value;

  const results = await Promise.allSettled([fetchBinance(symbol), fetchBybit(symbol)]);
  const venues = results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);
  if (venues.length === 0) throw new Error('All free crypto venues unavailable');

  const validIndexes = venues.map((v) => v.index ?? v.mark ?? v.last).filter((v) => v != null);
  const index = validIndexes.length ? validIndexes.reduce((a, b) => a + b, 0) / validIndexes.length : null;
  const value = {
    currency: c,
    symbol,
    index,
    venues,
    fetchedAt: Date.now(),
    source: 'free-exchanges',
    note: 'Public Binance Futures and Bybit data; not Velo-normalized and not a trading feed.',
  };
  cache.set(c, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export function resetFreeCryptoMarketCache() {
  cache.clear();
}
