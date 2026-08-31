/**
 * Futures-view adapter over the same canonical Deribit market snapshot used by
 * options. The browser never calls a second `/api/deribit-market/*` route family.
 */

export type DeribitCurrency = 'BTC' | 'ETH';

export interface DeribitFutureInstrument {
  instrument_name: string;
  settlement_period: string;
  expiration_timestamp: number | null;
  is_active: boolean;
  tick_size: number | null;
  contract_size: number | null;
  instrument_type: string;
  base_currency: string;
  quote_currency: string;
}

export interface DeribitFutureTicker {
  instrument_name: string;
  state: string;
  mark_price: number | null;
  index_price: number | null;
  last_price: number | null;
  best_bid_price: number | null;
  best_ask_price: number | null;
  open_interest: number | null;
  volume: number | null;
  volume_usd: number | null;
  price_change_pct: number | null;
  funding_8h: number | null;
  current_funding: number | null;
}

export interface DeribitIndexSnapshot {
  currency: DeribitCurrency;
  index_price: number;
  estimated_delivery_price: number | null;
  fetchedAt: number;
}

export interface DeribitFundingHistoryPoint {
  t: number;
  rate8h: number;
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

interface CanonicalInstrument {
  instrument: string;
  baseCurrency: string;
  quoteCurrency: string;
  contractSize: number | null;
  settlementPeriod: string | null;
  kind: 'option' | 'future' | 'perp';
  expiryMs: number | null;
  tickSize: number | null;
  isInverse: boolean;
  bidPrice: number | null;
  askPrice: number | null;
  markPrice: number | null;
  lastPrice: number | null;
  indexPrice: number | null;
  openInterest: number | null;
  volume: number | null;
  funding8h: number | null;
}

interface CanonicalMarket {
  currency: DeribitCurrency;
  indexPrice: number | null;
  instruments: CanonicalInstrument[];
  funding8h: number | null;
  fetchedAt: number;
  source: 'deribit';
  error?: string;
}

interface CacheEntry {
  value: CanonicalMarket;
  expiry: number;
}
const cache = new Map<string, CacheEntry>();

function finiteOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

async function marketSnapshot(
  currency: DeribitCurrency,
  ttl: number,
): Promise<CanonicalMarket | null> {
  const key = `deribit:market:${currency}`;
  const cached = cache.get(key);
  if (cached && cached.expiry > Date.now()) return cached.value;
  try {
    const response = await fetch(`/api/v1/market/crypto/${currency}`, {
      headers: { Accept: 'application/json' },
    });
    const payload = (await response.json()) as {
      schemaVersion?: number;
      fetchedAt?: string;
      data?: {
        currency?: DeribitCurrency;
        indexPrice?: number | null;
        funding8h?: number | null;
        instruments?: Array<Record<string, unknown>>;
      };
    };
    if (!response.ok || payload.schemaVersion !== 1 || !Array.isArray(payload.data?.instruments)) return null;
    const data: CanonicalMarket = {
      currency,
      indexPrice: finiteOrNull(payload.data.indexPrice),
      funding8h: finiteOrNull(payload.data.funding8h),
      fetchedAt: payload.fetchedAt ? new Date(payload.fetchedAt).getTime() : Date.now(),
      source: 'deribit',
      instruments: payload.data.instruments.map((row) => ({
        instrument: String(row.instrument ?? ''),
        baseCurrency: String(row.baseCurrency ?? currency),
        quoteCurrency: String(row.quoteCurrency ?? ''),
        contractSize: finiteOrNull(row.contractSize),
        settlementPeriod: row.settlementPeriod == null ? null : String(row.settlementPeriod),
        kind: row.kind as CanonicalInstrument['kind'],
        expiryMs: finiteOrNull(row.expiryMs),
        tickSize: null,
        isInverse: Boolean(row.isInverse),
        bidPrice: finiteOrNull(row.bid),
        askPrice: finiteOrNull(row.ask),
        markPrice: finiteOrNull(row.mark),
        lastPrice: finiteOrNull(row.last),
        indexPrice: finiteOrNull(row.indexPrice),
        openInterest: finiteOrNull(row.openInterest),
        volume: finiteOrNull(row.volume),
        funding8h: finiteOrNull(row.funding8h),
      })).filter((row) => row.instrument && ['option', 'future', 'perp'].includes(row.kind)),
    };
    cache.set(key, { value: data, expiry: Date.now() + ttl });
    return data;
  } catch {
    return null;
  }
}

export function currencyFromInstrument(instrumentName: string): DeribitCurrency | null {
  const match = /^(BTC|ETH)-[A-Z0-9]+$/.exec(instrumentName.toUpperCase());
  return match ? (match[1] as DeribitCurrency) : null;
}

function futuresRows(data: CanonicalMarket): CanonicalInstrument[] {
  return data.instruments.filter((row) => row.kind === 'future' || row.kind === 'perp');
}

export async function listFutures(
  currency: DeribitCurrency,
  ttl = 60_000,
): Promise<DeribitFutureInstrument[] | null> {
  const data = await marketSnapshot(currency, ttl);
  if (!data) return null;
  return futuresRows(data).map((row) => ({
    instrument_name: row.instrument,
    settlement_period: row.kind === 'perp' ? 'perpetual' : row.settlementPeriod ?? 'dated',
    expiration_timestamp: finiteOrNull(row.expiryMs),
    is_active: row.kind === 'perp' || (row.expiryMs != null && row.expiryMs > Date.now()),
    tick_size: finiteOrNull(row.tickSize),
    contract_size: finiteOrNull(row.contractSize),
    instrument_type: row.isInverse ? 'reversed' : 'linear',
    base_currency: row.baseCurrency,
    quote_currency: row.quoteCurrency,
  }));
}

export async function fetchTickers(
  currency: DeribitCurrency,
  ttl = 5_000,
): Promise<Record<string, DeribitFutureTicker> | null> {
  const data = await marketSnapshot(currency, ttl);
  if (!data) return null;
  return Object.fromEntries(futuresRows(data).map((row) => [
    row.instrument,
    {
      instrument_name: row.instrument,
      state: row.kind === 'perp' || (row.expiryMs != null && row.expiryMs > Date.now()) ? 'open' : 'closed',
      mark_price: finiteOrNull(row.markPrice),
      index_price: finiteOrNull(row.indexPrice) ?? finiteOrNull(data.indexPrice),
      last_price: finiteOrNull(row.lastPrice),
      best_bid_price: finiteOrNull(row.bidPrice),
      best_ask_price: finiteOrNull(row.askPrice),
      open_interest: finiteOrNull(row.openInterest),
      volume: finiteOrNull(row.volume),
      volume_usd: null,
      price_change_pct: null,
      funding_8h: finiteOrNull(row.funding8h),
      current_funding: finiteOrNull(row.funding8h),
    } satisfies DeribitFutureTicker,
  ]));
}

export async function fetchTicker(
  instrumentName: string,
  ttl = 5_000,
): Promise<DeribitFutureTicker | null> {
  const currency = currencyFromInstrument(instrumentName);
  if (!currency) return null;
  const tickers = await fetchTickers(currency, ttl);
  return tickers?.[instrumentName] ?? null;
}

export async function fetchIndexPrice(
  currency: DeribitCurrency,
  ttl = 8_000,
): Promise<DeribitIndexSnapshot | null> {
  const data = await marketSnapshot(currency, ttl);
  const indexPrice = finiteOrNull(data?.indexPrice);
  if (!data || indexPrice == null || indexPrice <= 0) return null;
  return {
    currency,
    index_price: indexPrice,
    estimated_delivery_price: null,
    fetchedAt: data.fetchedAt,
  };
}

export async function fetchFundingHistory(
  instrumentName: string,
  days: 1 | 7 | 30 | 90 = 7,
  ttl = 60_000,
): Promise<DeribitFundingHistoryBundle | null> {
  const currency = currencyFromInstrument(instrumentName);
  if (!currency) return null;
  const key = `deribit:funding:${instrumentName}:${days}`;
  const existing = fundingCache.get(key);
  if (existing && existing.expiry > Date.now()) return existing.value;
  try {
    const response = await fetch(
      `/api/v1/market/crypto/${currency}/funding?instrument_name=${encodeURIComponent(instrumentName)}&days=${days}`,
      { headers: { Accept: 'application/json' } },
    );
    const payload = (await response.json()) as {
      schemaVersion?: number;
      fetchedAt?: string;
      data?: {
        currency?: DeribitCurrency;
        instrumentName?: string;
        days?: number;
        points?: Array<{ timestamp: number; rate8h: number; annualizedPct: number; indexPrice: number | null }>;
        latest?: { timestamp: number; rate8h: number; annualizedPct: number; indexPrice: number | null } | null;
        count?: number;
      };
    };
    if (!response.ok || payload.schemaVersion !== 1 || !Array.isArray(payload.data?.points)) return null;
    const data: DeribitFundingHistoryBundle = {
      currency,
      instrument_name: payload.data.instrumentName ?? instrumentName,
      days: payload.data.days ?? days,
      points: payload.data.points.map((point) => ({
        t: point.timestamp,
        rate8h: point.rate8h,
        annualizedPct: point.annualizedPct,
        indexPrice: point.indexPrice,
      })),
      latest: payload.data.latest ? {
        t: payload.data.latest.timestamp,
        rate8h: payload.data.latest.rate8h,
        annualizedPct: payload.data.latest.annualizedPct,
      } : null,
      count: payload.data.count ?? payload.data.points.length,
      fetchedAt: payload.fetchedAt ? new Date(payload.fetchedAt).getTime() : Date.now(),
    };
    fundingCache.set(key, { value: data, expiry: Date.now() + ttl });
    return data;
  } catch {
    return null;
  }
}

const fundingCache = new Map<string, { value: DeribitFundingHistoryBundle; expiry: number }>();
