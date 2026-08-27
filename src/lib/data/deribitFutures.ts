/**
 * Typed browser client for the Futures desk.
 * Requests go through the Node proxy (/api/deribit-market/*, see
 * api/deribitMarketRoutes.js) — the browser never calls Deribit directly.
 * All fetchers fail CLOSED: they return null on any error so views can show
 * an honest "—" instead of a fabricated number.
 */

export type DeribitCurrency = 'BTC' | 'ETH';

export interface DeribitFutureInstrument {
  instrument_name: string;
  /** 'perpetual' for the perp; 'day' | 'week' | 'month' … for dated futures. */
  settlement_period: string;
  /** ms epoch at 08:00 UTC; perp carries Deribit's year-3000 sentinel. */
  expiration_timestamp: number;
  is_active: boolean;
  tick_size: number;
  contract_size: number;
  /** 'reversed' (coin-margined) for BTC/ETH futures. */
  instrument_type: string;
  base_currency: string;
  quote_currency: string;
}

export interface DeribitInstrumentsBundle {
  currency: DeribitCurrency;
  instruments: DeribitFutureInstrument[];
  count: number;
  fetchedAt: number;
  source: 'deribit';
}

export interface DeribitFutureTicker {
  instrument_name: string;
  state: string;
  mark_price: number | null;
  index_price: number | null;
  last_price: number | null;
  best_bid_price: number | null;
  best_ask_price: number | null;
  /** USD notional — reversed (coin-margined) contracts report OI in USD. */
  open_interest: number | null;
  /** Rolling-24h traded volume in base currency (BTC / ETH). */
  volume: number | null;
  volume_usd: number | null;
  /** Deribit stats.price_change — already expressed in PERCENT units. */
  price_change_pct: number | null;
  /** 8h funding rate (decimal) — perpetuals only, else null. */
  funding_8h: number | null;
  current_funding: number | null;
}

export interface DeribitTickersBundle {
  currency: DeribitCurrency;
  tickers: Record<string, DeribitFutureTicker>;
  count: number;
  fetchedAt: number;
}

export interface DeribitIndexSnapshot {
  currency: DeribitCurrency;
  index_price: number;
  estimated_delivery_price: number | null;
  fetchedAt: number;
}

/** One hourly funding point, normalized server-side from get_funding_rate_history. */
export interface DeribitFundingHistoryPoint {
  t: number;
  /** Realized 8h funding rate (decimal, e.g. 0.0001 = 0.01% per 8h). */
  rate8h: number;
  /** Simple annualization: rate8h × 3 × 365 × 100. */
  annualizedPct: number;
  indexPrice: number | null;
}

export interface DeribitFundingHistoryBundle {
  currency: DeribitCurrency;
  instrument_name: string;
  days: number;
  points: DeribitFundingHistoryPoint[];
  latest: { t: number; rate8h: number; annualizedPct: number } | null;
  count: number;
  fetchedAt: number;
}

// ── Tiny client-side dedupe cache (same pattern as deribitClient.ts) ────────

interface CacheEntry {
  value: unknown;
  expiry: number;
}
const cache = new Map<string, CacheEntry>();

function getCached<T>(key: string): T | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiry) {
    cache.delete(key);
    return null;
  }
  return e.value as T;
}

function setCache(key: string, value: unknown, ttl: number) {
  cache.set(key, { value, expiry: Date.now() + ttl });
}

async function marketGet<T>(path: string, ttl: number): Promise<T | null> {
  const key = `deribit-market:${path}`;
  const hit = getCached<T>(key);
  if (hit) return hit;
  try {
    const res = await fetch(`/api/deribit-market/${path}`);
    if (!res.ok) return null;
    const json = (await res.json()) as T & { error?: string };
    if (json && typeof json === 'object' && 'error' in json && json.error) return null;
    setCache(key, json, ttl);
    return json;
  } catch {
    return null;
  }
}

export function currencyFromInstrument(instrumentName: string): DeribitCurrency | null {
  const m = /^(BTC|ETH)-[A-Z0-9]+$/.exec(instrumentName.toUpperCase());
  return m ? (m[1] as DeribitCurrency) : null;
}

/** Active dated futures + perpetual for the currency. Cached 60s client-side. */
export async function listFutures(
  currency: DeribitCurrency,
  ttl = 60_000,
): Promise<DeribitFutureInstrument[] | null> {
  const data = await marketGet<DeribitInstrumentsBundle>(`instruments?currency=${currency}`, ttl);
  if (!data || !Array.isArray(data.instruments)) return null;
  return data.instruments;
}

/**
 * Bulk tickers for every active future/perp of a currency (server caches 5s).
 * Returns a map keyed by instrument name.
 */
export async function fetchTickers(
  currency: DeribitCurrency,
  ttl = 5_000,
): Promise<Record<string, DeribitFutureTicker> | null> {
  const data = await marketGet<DeribitTickersBundle>(`tickers?currency=${currency}`, ttl);
  if (!data || typeof data.tickers !== 'object' || data.tickers === null) return null;
  return data.tickers;
}

/** Single-instrument convenience lookup (resolved through the bulk snapshot). */
export async function fetchTicker(
  instrumentName: string,
  ttl = 5_000,
): Promise<DeribitFutureTicker | null> {
  const currency = currencyFromInstrument(instrumentName);
  if (!currency) return null;
  const tickers = await fetchTickers(currency, ttl);
  if (!tickers) return null;
  return tickers[instrumentName] ?? null;
}

export async function fetchIndexPrice(
  currency: DeribitCurrency,
  ttl = 8_000,
): Promise<DeribitIndexSnapshot | null> {
  const data = await marketGet<DeribitIndexSnapshot>(`index-price?currency=${currency}`, ttl);
  if (!data || !(Number(data.index_price) > 0)) return null;
  return data;
}

export async function fetchFundingHistory(
  instrumentName: string,
  days: 1 | 7 | 30 | 90 = 7,
  ttl = 60_000,
): Promise<DeribitFundingHistoryBundle | null> {
  const currency = currencyFromInstrument(instrumentName);
  if (!currency) return null;
  const data = await marketGet<DeribitFundingHistoryBundle>(
    `funding-history?instrument_name=${instrumentName}&days=${days}`,
    ttl,
  );
  if (!data || !Array.isArray(data.points)) return null;
  return data;
}
