/**
 * yfinance client — calls the local Python proxy (/api/yf/*) which runs in the
 * Node/Docker deployment. This is the SECOND data source: it backs the option
 * chain (via /api/options) and, here, the underlying price history + fundamentals
 * used by the Quote tab as a fallback when FMP is unavailable or rate-limited.
 *
 * Reads go through the same TTL cache pattern as fmpClient.
 */

import type { FmpPriceBar, FmpProfile } from './types';

const YF_PROXY = '/api/yf';

interface CacheEntry {
  value: unknown;
  expiry: number;
}

const cache = new Map<string, CacheEntry>();

function getCached(key: string): CacheEntry | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiry) {
    cache.delete(key);
    return null;
  }
  return e;
}

function finiteOrNull(value: unknown, min = -Infinity): number | null {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? n : null;
}

async function yfGet<T>(path: string, ttl: number): Promise<T | null> {
  const cached = getCached(path);
  if (cached) return cached.value as T;
  try {
    // route-parity: /api/yf/history/:symbol | /api/yf/info/:symbol
    const res = await fetch(`${YF_PROXY}/${path}`);
    if (!res.ok) return null;
    const json = (await res.json()) as T;
    cache.set(path, { value: json, expiry: Date.now() + ttl });
    return json;
  } catch {
    return null;
  }
}

/** Daily OHLCV from yfinance, normalised to the FmpPriceBar shape. */
export async function fetchYfHistory(symbol: string, ttl = 3_600_000): Promise<FmpPriceBar[] | null> {
  const data = await yfGet<{ symbol: string; bars: Record<string, number | string>[] }>(
    `history/${encodeURIComponent(symbol)}`,
    ttl,
  );
  if (!data || !Array.isArray(data.bars)) return null;
  const bars = data.bars
    .map((b) => ({
      date: String(b.date ?? ''),
      open: finiteOrNull(b.open, 0),
      high: finiteOrNull(b.high, 0),
      low: finiteOrNull(b.low, 0),
      close: finiteOrNull(b.close, 0),
      volume: finiteOrNull(b.volume, 0),
    }))
    .filter((b): b is { date: string; open: number; high: number; low: number; close: number; volume: number } => Boolean(b.date && b.open != null && b.high != null && b.low != null && b.close != null && b.volume != null && b.open > 0 && b.high > 0 && b.low > 0 && b.close > 0));
  return bars.length > 0 ? bars : null;
}

/** Raw yfinance info incl. observed last print (lastPrice) — used for spot fallback. */
export async function fetchYfInfoRaw(symbol: string, ttl = 60_000): Promise<Record<string, unknown> | null> {
  return yfGet<Record<string, unknown>>(`info/${encodeURIComponent(symbol)}`, ttl);
}

/** Fundamentals from yfinance, normalised to the FmpProfile shape. */
export async function fetchYfInfo(symbol: string, ttl = 86_400_000): Promise<FmpProfile | null> {
  const data = await yfGet<Record<string, unknown>>(`info/${encodeURIComponent(symbol)}`, ttl);
  if (!data) return null;
  return {
    symbol: String(data.symbol ?? symbol),
    companyName: data.companyName != null ? String(data.companyName) : symbol,
    marketCap: finiteOrNull(data.marketCap, 0) ?? undefined,
    sector: data.sector != null ? String(data.sector) : undefined,
    industry: data.industry != null ? String(data.industry) : undefined,
    website: data.website != null ? String(data.website) : undefined,
    description: data.description != null ? String(data.description) : undefined,
    ceo: data.ceo != null ? String(data.ceo) : undefined,
    exchange: data.exchange != null ? String(data.exchange) : undefined,
    beta: finiteOrNull(data.beta) ?? undefined,
    range: data.range != null ? String(data.range) : undefined,
  };
}

export function invalidateYfCache(symbol?: string) {
  if (!symbol) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.includes(`/${symbol}`)) cache.delete(key);
  }
}
