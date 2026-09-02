/**
 * Finnhub client — all calls go through Node proxy (/api/finnhub/*).
 * API key never leaves the server.
 */

async function fetchJson<T>(url: string): Promise<T> {
  // route-parity: GET /api/finnhub/news | GET /api/finnhub/earnings | GET /api/finnhub/economic-calendar | GET /api/finnhub/recommendation | GET /api/finnhub/peers
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok && !data) throw new Error(`HTTP ${res.status}`);
  return data as T;
}

export interface FinnhubNewsItem {
  id: string | number;
  datetime: number | null;
  headline: string;
  summary?: string;
  source?: string;
  url?: string | null;
  related?: string;
  category?: string;
}

export interface FinnhubCacheMetadata {
  state: 'miss' | 'fresh' | 'stale' | 'unavailable';
  hit: boolean;
  ageMs: number;
  stale: boolean;
  coalesced: boolean;
  providerError: string | null;
}

export interface FinnhubNewsData {
  symbol: string;
  items: FinnhubNewsItem[];
  count?: number;
  as_of?: string;
  source?: string;
  note?: string;
  error?: string | null;
}

export interface FinnhubEarningsRow {
  symbol?: string;
  date: string | null;
  hour?: string | null;
  eps_estimate?: number | null;
  eps_actual?: number | null;
  revenue_estimate?: number | null;
  revenue_actual?: number | null;
  quarter?: number | null;
  year?: number | null;
}

export interface FinnhubEarningsData {
  symbol: string;
  next: FinnhubEarningsRow | null;
  upcoming?: FinnhubEarningsRow[];
  recent?: FinnhubEarningsRow[];
  as_of?: string;
  source?: string;
  note?: string;
  error?: string | null;
  fromCache?: boolean;
  ageMs?: number;
  cache?: FinnhubCacheMetadata;
}

export function fetchFinnhubNews(symbol: string, limit = 12): Promise<FinnhubNewsData> {
  const q = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    limit: String(limit),
  });
  return fetchJson(`/api/finnhub/news?${q}`);
}

export function fetchFinnhubEarnings(symbol: string): Promise<FinnhubEarningsData> {
  const q = new URLSearchParams({ symbol: symbol.toUpperCase() });
  return fetchJson(`/api/finnhub/earnings?${q}`);
}

export interface FinnhubEcoEvent {
  id?: string;
  country?: string | null;
  event?: string | null;
  time?: string | null;
  impact?: string | null;
  actual?: string | number | null;
  estimate?: string | number | null;
  prev?: string | number | null;
}

export interface FinnhubEcoCalendar {
  from?: string;
  to?: string;
  events: FinnhubEcoEvent[];
  count?: number;
  as_of?: string;
  source?: string;
  note?: string;
  error?: string | null;
  fromCache?: boolean;
  ageMs?: number;
  cache?: FinnhubCacheMetadata;
}

export interface FinnhubRecommendation {
  symbol: string;
  latest: {
    period?: string | null;
    strongBuy?: number | null;
    buy?: number | null;
    hold?: number | null;
    sell?: number | null;
    strongSell?: number | null;
  } | null;
  as_of?: string;
  source?: string;
  note?: string;
  error?: string | null;
  fromCache?: boolean;
  ageMs?: number;
  cache?: FinnhubCacheMetadata;
}

export interface FinnhubPeers {
  symbol: string;
  peers: string[];
  count?: number;
  as_of?: string;
  source?: string;
  error?: string | null;
  fromCache?: boolean;
  ageMs?: number;
  cache?: FinnhubCacheMetadata;
}

/** Shared 6h economic calendar — server warmer owns refresh. */
export function fetchFinnhubEconomicCalendar(): Promise<FinnhubEcoCalendar> {
  return fetchJson('/api/finnhub/economic-calendar');
}

export function fetchFinnhubRecommendation(symbol: string): Promise<FinnhubRecommendation> {
  const q = new URLSearchParams({ symbol: symbol.toUpperCase() });
  return fetchJson(`/api/finnhub/recommendation?${q}`);
}

export function fetchFinnhubPeers(symbol: string): Promise<FinnhubPeers> {
  const q = new URLSearchParams({ symbol: symbol.toUpperCase() });
  return fetchJson(`/api/finnhub/peers?${q}`);
}
