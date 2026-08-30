import type { FALevels, FAGexProfile } from '../options/types';

const FA_BASE = '/api/flashalpha';

const levelsCache = new Map<string, { data: FALevels; ts: number }>();
const gexCache = new Map<string, { data: FAGexProfile; ts: number }>();
const FA_CACHE_TTL = 6 * 60 * 60 * 1000; // 6h — matches server cache

async function faFetch<T>(path: string, symbol: string, cache: Map<string, { data: T; ts: number }>): Promise<T | null> {
  const key = `${path}:${symbol.toUpperCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < FA_CACHE_TTL) return hit.data;

  try {
    // route-parity: /api/flashalpha/exposure/:type/:symbol
    const res = await fetch(`${FA_BASE}${path}/${symbol.toUpperCase()}`);
    if (res.status === 429 || res.status === 503) return null;
    if (!res.ok) return null;
    const data = await res.json();
    cache.set(key, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

export async function fetchFALevels(symbol: string): Promise<FALevels | null> {
  return faFetch('/exposure/levels', symbol, levelsCache);
}

export async function fetchFAGEX(symbol: string, expiration?: string): Promise<FAGexProfile | null> {
  const suffix = expiration ? `?expiration=${expiration}` : '';
  return faFetch(`/exposure/gex`, `${symbol}${suffix}`, gexCache);
}
