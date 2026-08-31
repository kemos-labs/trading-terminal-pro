/**
 * Free crypto market adapter.
 *
 * Uses public Binance Futures and Bybit linear-perpetual endpoints. No API key,
 * account access, or trading permissions are involved. Keep this server-side
 * so the app owns caching, timeout, and rate discipline.
 */

import { deleteCache, getOrFetch } from '../../../api/upstreamCache.js';

const VENUES = {
  binance: 'https://fapi.binance.com',
  bybit: 'https://api.bybit.com',
};
const TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 15_000;
const MAX_STALE_MS = 2 * 60_000;

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
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('Free crypto upstream returned invalid JSON');
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export function finite(value, predicate = () => true) {
  if (typeof value === 'number') return Number.isFinite(value) && predicate(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value.trim());
  return Number.isFinite(n) && predicate(n) ? n : null;
}

const positive = (value) => finite(value, (n) => n > 0);
const nonNegative = (value) => finite(value, (n) => n >= 0);

function validVenue(venue) {
  return venue && [venue.mark, venue.index, venue.last].some((value) => value !== null && value > 0)
    ? venue
    : null;
}

function assertMatchingSymbol(payload, requested) {
  if (payload?.symbol != null && String(payload.symbol).toUpperCase() !== requested) throw new Error('Upstream symbol mismatch');
}

async function fetchBinance(symbol) {
  const [ticker, premium, oi] = await Promise.all([
    getJson(`${VENUES.binance}/fapi/v1/ticker/24hr?symbol=${symbol}`),
    getJson(`${VENUES.binance}/fapi/v1/premiumIndex?symbol=${symbol}`),
    getJson(`${VENUES.binance}/fapi/v1/openInterest?symbol=${symbol}`),
  ]);
  [ticker, premium, oi].forEach((payload) => assertMatchingSymbol(payload, symbol));
  const venue = {
    venue: 'Binance Futures', symbol,
    last: positive(ticker.lastPrice), mark: positive(premium.markPrice), index: positive(premium.indexPrice),
    funding8h: finite(premium.lastFundingRate), openInterest: nonNegative(oi.openInterest),
    volume24hUsd: nonNegative(ticker.quoteVolume), change24hPct: finite(ticker.priceChangePercent), fetchedAt: Date.now(),
  };
  if (!validVenue(venue)) throw new Error('Binance returned unusable price data');
  return venue;
}

async function fetchBybit(symbol) {
  const url = `${VENUES.bybit}/v5/market/tickers?category=linear&symbol=${symbol}`;
  const json = await getJson(url);
  if (json.retCode !== 0) throw new Error(`Bybit returned error ${json.retCode}`);
  const row = Array.isArray(json.result?.list) ? json.result.list[0] : null;
  if (!row) throw new Error('Bybit returned no ticker');
  assertMatchingSymbol(json.result, symbol);
  assertMatchingSymbol(row, symbol);
  const price24h = finite(row.price24hPcnt);
  const change24hPct = price24h === null ? null : finite(price24h * 100);
  const venue = {
    venue: 'Bybit Linear', symbol,
    last: positive(row.lastPrice), mark: positive(row.markPrice), index: positive(row.indexPrice),
    funding8h: finite(row.fundingRate), openInterest: nonNegative(row.openInterest),
    volume24hUsd: nonNegative(row.turnover24h), change24hPct, fetchedAt: Date.now(),
  };
  if (!validVenue(venue)) throw new Error('Bybit returned unusable price data');
  return venue;
}

export async function fetchFreeCryptoMarket(currency) {
  const c = String(currency || '').toUpperCase();
  const symbol = symbolFor(c);
  if (!symbol) throw Object.assign(new Error('currency must be BTC or ETH'), { status: 400 });
  const { data } = await getOrFetch(
    `free-crypto:${c}`,
    CACHE_TTL_MS,
    async () => {
      const results = await Promise.allSettled([fetchBinance(symbol), fetchBybit(symbol)]);
      const venues = results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value);
      if (venues.length === 0) throw Object.assign(new Error('All free crypto venues unavailable'), { status: 502 });
      return {
        currency: c,
        symbol,
        venues,
        fetchedAt: Date.now(),
        source: 'free-exchanges',
        note: 'Public Binance Futures and Bybit data; not Velo-normalized and not a trading feed.',
      };
    },
    {
      allowStaleOnError: true,
      maxStaleMs: MAX_STALE_MS,
      cacheIf: (snapshot) => Array.isArray(snapshot?.venues) && snapshot.venues.length > 0,
    },
  );
  return data;
}

export function resetFreeCryptoMarketCache() {
  deleteCache('free-crypto:BTC');
  deleteCache('free-crypto:ETH');
}
