/**
 * Deribit public market data client (no API key).
 * Requests go through the Node proxy (/api/deribit/*) to avoid CORS and cache.
 */

export interface DeribitBookRow {
  instrument_name: string;
  bid_price: number | null;
  ask_price: number | null;
  mid_price: number | null;
  mark_price: number | null;
  last: number | null;
  mark_iv: number | null;
  open_interest: number | null;
  volume: number | null;
  volume_usd: number | null;
  underlying_price: number | null;
  estimated_delivery_price: number | null;
  interest_rate: number | null;
  creation_timestamp: number | null;
}

export interface DeribitIndex {
  index_price: number;
  estimated_delivery_price?: number;
}

export interface DeribitPerpTicker {
  instrument_name: string;
  index_price: number;
  mark_price: number;
  last_price: number | null;
  /** Instantaneous funding (decimal per period) */
  current_funding: number;
  /** 8h funding rate (decimal) */
  funding_8h: number;
  open_interest: number;
  best_bid_price: number | null;
  best_ask_price: number | null;
}

export interface DeribitFutureRow {
  instrument_name: string;
  mark_price: number | null;
  mid_price: number | null;
  last: number | null;
  bid_price: number | null;
  ask_price: number | null;
  open_interest: number | null;
  volume: number | null;
  underlying_price: number | null;
  estimated_delivery_price: number | null;
  creation_timestamp: number | null;
}

export interface DeribitOptionTrade {
  trade_id: string;
  trade_seq?: number;
  timestamp: number;
  instrument_name: string;
  direction: 'buy' | 'sell';
  amount: number;
  price: number;
  mark_price?: number | null;
  iv?: number | null;
  index_price?: number | null;
  tick_direction?: number;
}

export interface DeribitTradesBundle {
  currency: 'BTC' | 'ETH';
  hours: number;
  trades: DeribitOptionTrade[];
  count: number;
  hasMore: boolean;
  fetchedAt: number;
  source: 'deribit';
}

export interface DeribitMarketBundle {
  currency: 'BTC' | 'ETH';
  indexPrice: number;
  options: DeribitBookRow[];
  /** Dated futures + perpetual book summaries (USD marks) */
  futures: DeribitFutureRow[];
  perp: DeribitPerpTicker | null;
  /** 8h funding as annualized approx: funding_8h * 3 * 365 */
  fundingAnn: number | null;
  fetchedAt: number;
  source: 'deribit';
}

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

export function invalidateDeribitCache() {
  for (const k of cache.keys()) {
    if (k.startsWith('deribit:')) cache.delete(k);
  }
}

async function deribitGet<T>(path: string, ttl: number): Promise<T | null> {
  const key = `deribit:${path}`;
  const hit = getCached<T>(key);
  if (hit) return hit;
  try {
    const res = await fetch(`/api/deribit/${path}`);
    if (!res.ok) return null;
    const json = (await res.json()) as T & { error?: string };
    if (json && typeof json === 'object' && 'error' in json && (json as { error?: string }).error) {
      return null;
    }
    setCache(key, json, ttl);
    return json;
  } catch {
    return null;
  }
}

export async function fetchDeribitIndex(currency: 'BTC' | 'ETH', ttl = 8_000): Promise<DeribitIndex | null> {
  const indexName = currency === 'BTC' ? 'btc_usd' : 'eth_usd';
  const data = await deribitGet<{ index_price: number; estimated_delivery_price?: number }>(
    `index/${indexName}`,
    ttl,
  );
  if (!data || !(data.index_price > 0)) return null;
  return data;
}

export async function fetchDeribitOptions(
  currency: 'BTC' | 'ETH',
  ttl = 20_000,
): Promise<DeribitBookRow[] | null> {
  const data = await deribitGet<{ options: DeribitBookRow[] }>(`options/${currency}`, ttl);
  if (!data || !Array.isArray(data.options) || data.options.length < 5) return null;
  return data.options;
}

export async function fetchDeribitPerp(
  currency: 'BTC' | 'ETH',
  ttl = 8_000,
): Promise<DeribitPerpTicker | null> {
  const inst = currency === 'BTC' ? 'BTC-PERPETUAL' : 'ETH-PERPETUAL';
  const data = await deribitGet<DeribitPerpTicker>(`ticker/${inst}`, ttl);
  if (!data || !(data.index_price > 0 || data.mark_price > 0)) return null;
  return data;
}

/**
 * Full market bundle for the BTC desk: index + options book + perp funding.
 * Prefers the server-side combined endpoint (one round-trip + shared cache).
 */
export async function fetchDeribitMarket(
  currency: 'BTC' | 'ETH' = 'BTC',
): Promise<DeribitMarketBundle | null> {
  const key = `deribit:market:${currency}`;
  const hit = getCached<DeribitMarketBundle>(key);
  if (hit) return hit;

  try {
    const res = await fetch(`/api/deribit/market/${currency}`);
    if (res.ok) {
      const data = (await res.json()) as DeribitMarketBundle & { error?: string; count?: number };
      if (!data.error && Array.isArray(data.options) && data.options.length >= 5 && data.indexPrice > 0) {
        const bundle: DeribitMarketBundle = {
          currency,
          indexPrice: data.indexPrice,
          options: data.options,
          futures: Array.isArray(data.futures) ? data.futures : [],
          perp: data.perp ?? null,
          fundingAnn: data.fundingAnn ?? null,
          fetchedAt: data.fetchedAt ?? Date.now(),
          source: 'deribit',
        };
        setCache(key, bundle, 15_000);
        return bundle;
      }
    }
  } catch {
    // fall through to piecewise fetch
  }

  const [index, options, perp, futures] = await Promise.all([
    fetchDeribitIndex(currency),
    fetchDeribitOptions(currency),
    fetchDeribitPerp(currency),
    fetchDeribitFutures(currency),
  ]);
  if (!options) return null;
  let indexPrice: number | null = null;
  if (index && index.index_price > 0) indexPrice = index.index_price;
  else if (perp && perp.index_price > 0) indexPrice = perp.index_price;
  else {
    const fromEst = options.find(o => (o.estimated_delivery_price ?? 0) > 0)?.estimated_delivery_price;
    const fromUnd = options.find(o => (o.underlying_price ?? 0) > 0)?.underlying_price;
    indexPrice = fromEst ?? fromUnd ?? null;
  }

  if (!(indexPrice && indexPrice > 0)) return null;

  // funding_8h is the 8-hour rate; annualize ≈ * 3 * 365
  const f8 = perp?.funding_8h;
  const fundingAnn = f8 != null && isFinite(f8) ? f8 * 3 * 365 : null;

  // If futures book empty, synthesize a perp row from ticker for basis tools.
  let futRows = futures ?? [];
  if (futRows.length === 0 && perp && (perp.mark_price > 0 || perp.index_price > 0)) {
    futRows = [{
      instrument_name: perp.instrument_name,
      mark_price: perp.mark_price,
      mid_price: null,
      last: perp.last_price,
      bid_price: perp.best_bid_price,
      ask_price: perp.best_ask_price,
      open_interest: perp.open_interest,
      volume: null,
      underlying_price: perp.index_price,
      estimated_delivery_price: perp.index_price,
      creation_timestamp: null,
    }];
  }

  const bundle: DeribitMarketBundle = {
    currency,
    indexPrice,
    options,
    futures: futRows,
    perp,
    fundingAnn,
    fetchedAt: Date.now(),
    source: 'deribit',
  };
  setCache(key, bundle, 15_000);
  return bundle;
}

export async function fetchDeribitTrades(
  currency: 'BTC' | 'ETH',
  hours: 1 | 4 | 24 = 24,
  count = 500,
): Promise<DeribitTradesBundle | null> {
  const data = await deribitGet<DeribitTradesBundle>(
    `trades/${currency}?hours=${hours}&count=${Math.min(1000, Math.max(50, count))}`,
    5_000,
  );
  if (!data || !Array.isArray(data.trades)) return null;
  return data;
}

export async function fetchDeribitFutures(
  currency: 'BTC' | 'ETH',
  ttl = 15_000,
): Promise<DeribitFutureRow[] | null> {
  const data = await deribitGet<{ futures: DeribitFutureRow[] }>(`futures/${currency}`, ttl);
  if (!data || !Array.isArray(data.futures)) return null;
  return data.futures;
}

/** DVOL + realized-vol index history from Deribit public endpoints. */
export interface DeribitVolHistory {
  currency: 'BTC' | 'ETH';
  days: number;
  dvol: { t: number; close: number }[];
  realized: { t: number; vol: number }[];
  fetchedAt: number;
}

export async function fetchDeribitVolHistory(
  currency: 'BTC' | 'ETH',
  days: 7 | 30 | 90 | 180 | 365 = 90,
): Promise<DeribitVolHistory | null> {
  const data = await deribitGet<DeribitVolHistory>(`volhistory/${currency}?days=${days}`, 60_000);
  if (!data || !Array.isArray(data.dvol)) return null;
  return data;
}

/** Aggregated options volume/OI across venues (Deribit + OKX + Bybit, public). */
export interface VenueOptionsSummary {
  venue: string;
  instruments: number;
  volCcy24h?: number;
  volUsd24h?: number;
  openIntContracts?: number;
  openIntCcy?: number;
}

export interface VenueOptionsBundle {
  currency: 'BTC' | 'ETH';
  venues: VenueOptionsSummary[];
  fetchedAt: number;
}

async function venuesGet<T>(currency: 'BTC' | 'ETH'): Promise<T | null> {
  try {
    const res = await fetch(`/api/venues/options/${currency}`);
    if (!res.ok) return null;
    const json = (await res.json()) as T & { error?: string };
    if (json && typeof json === 'object' && 'error' in json) return null;
    return json;
  } catch {
    return null;
  }
}

export async function fetchVenueOptions(currency: 'BTC' | 'ETH'): Promise<VenueOptionsBundle | null> {
  return venuesGet<VenueOptionsBundle>(currency);
}

export function deribitCurrencyFromSymbol(symbol: string): 'BTC' | 'ETH' | null {
  const s = symbol.toUpperCase().replace(/[-/]/g, '');
  if (s === 'BTC' || s === 'BTCUSD' || s === 'XBT') return 'BTC';
  if (s === 'ETH' || s === 'ETHUSD') return 'ETH';
  return null;
}
