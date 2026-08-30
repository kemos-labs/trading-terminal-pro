/**
 * Legacy option-engine adapter over the canonical Deribit market endpoint.
 *
 * The browser makes one request to /api/deribit/market/:currency. This module
 * translates that canonical catalogue/quote join into the older VolSnapshot
 * input shape; it never fans out to duplicate browser routes.
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

export interface DeribitPerpTicker {
  instrument_name: string;
  index_price: number;
  mark_price: number;
  last_price: number | null;
  current_funding: number | null;
  funding_8h: number | null;
  open_interest: number | null;
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

export interface DeribitMarketBundle {
  currency: 'BTC' | 'ETH';
  indexPrice: number;
  options: DeribitBookRow[];
  futures: DeribitFutureRow[];
  perp: DeribitPerpTicker | null;
  /** Simple annualized run-rate from the observed 8h funding print. */
  fundingAnn: number | null;
  fetchedAt: number;
  source: 'deribit';
}

interface CanonicalInstrument {
  instrument: string;
  kind: 'option' | 'future' | 'perp';
  bidPrice: number | null;
  askPrice: number | null;
  markPrice: number | null;
  lastPrice: number | null;
  bidIv: number | null;
  askIv: number | null;
  markIv: number | null;
  indexPrice: number | null;
  openInterest: number | null;
  volume: number | null;
  funding8h: number | null;
  timestamp: number | null;
}

interface CanonicalMarketResponse {
  currency: string;
  indexPrice: number | null;
  instruments: CanonicalInstrument[];
  funding8h: number | null;
  fetchedAt: number;
  source: string;
  error?: string;
}

interface CacheEntry {
  value: DeribitMarketBundle;
  expiry: number;
}

const cache = new Map<string, CacheEntry>();

export function invalidateDeribitCache() {
  cache.clear();
}

function finiteOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function toLegacyRow(row: CanonicalInstrument, indexPrice: number): DeribitBookRow {
  const bid = finiteOrNull(row.bidPrice);
  const ask = finiteOrNull(row.askPrice);
  return {
    instrument_name: row.instrument,
    bid_price: bid,
    ask_price: ask,
    mid_price: bid != null && ask != null && ask >= bid ? (bid + ask) / 2 : null,
    mark_price: finiteOrNull(row.markPrice),
    last: finiteOrNull(row.lastPrice),
    mark_iv: finiteOrNull(row.markIv),
    open_interest: finiteOrNull(row.openInterest),
    volume: finiteOrNull(row.volume),
    volume_usd: null,
    underlying_price: finiteOrNull(row.indexPrice) ?? indexPrice,
    estimated_delivery_price: finiteOrNull(row.indexPrice) ?? indexPrice,
    interest_rate: null,
    creation_timestamp: finiteOrNull(row.timestamp),
  };
}

function toFutureRow(row: CanonicalInstrument, indexPrice: number): DeribitFutureRow {
  const legacy = toLegacyRow(row, indexPrice);
  return {
    instrument_name: legacy.instrument_name,
    mark_price: legacy.mark_price,
    mid_price: legacy.mid_price,
    last: legacy.last,
    bid_price: legacy.bid_price,
    ask_price: legacy.ask_price,
    open_interest: legacy.open_interest,
    volume: legacy.volume,
    underlying_price: legacy.underlying_price,
    estimated_delivery_price: legacy.estimated_delivery_price,
    creation_timestamp: legacy.creation_timestamp,
  };
}

/** One canonical server snapshot, adapted for the existing option engine. */
export async function fetchDeribitMarket(
  currency: 'BTC' | 'ETH' = 'BTC',
): Promise<DeribitMarketBundle | null> {
  const key = `deribit:${currency}`;
  const cached = cache.get(key);
  if (cached && cached.expiry > Date.now()) return cached.value;

  try {
    const response = await fetch(`/api/deribit/market/${currency}`, {
      headers: { Accept: 'application/json' },
    });
    const data = (await response.json()) as CanonicalMarketResponse;
    const indexPrice = finiteOrNull(data.indexPrice);
    if (
      !response.ok
      || data.error
      || data.source !== 'deribit'
      || !Array.isArray(data.instruments)
      || indexPrice == null
      || indexPrice <= 0
    ) {
      return null;
    }

    const options = data.instruments
      .filter((row) => row.kind === 'option')
      .map((row) => toLegacyRow(row, indexPrice));
    if (options.length === 0) return null;

    const futures = data.instruments
      .filter((row) => row.kind === 'future')
      .map((row) => toFutureRow(row, indexPrice));
    const perpetual = data.instruments.find((row) => row.kind === 'perp') ?? null;
    const funding8h = finiteOrNull(data.funding8h ?? perpetual?.funding8h);
    const perpMark = finiteOrNull(perpetual?.markPrice);
    const perpIndex = finiteOrNull(perpetual?.indexPrice) ?? indexPrice;
    const perp: DeribitPerpTicker | null = perpetual && perpMark != null
      ? {
          instrument_name: perpetual.instrument,
          index_price: perpIndex,
          mark_price: perpMark,
          last_price: finiteOrNull(perpetual.lastPrice),
          current_funding: funding8h,
          funding_8h: funding8h,
          open_interest: finiteOrNull(perpetual.openInterest),
          best_bid_price: finiteOrNull(perpetual.bidPrice),
          best_ask_price: finiteOrNull(perpetual.askPrice),
        }
      : null;

    const bundle: DeribitMarketBundle = {
      currency,
      indexPrice,
      options,
      futures,
      perp,
      fundingAnn: funding8h == null ? null : funding8h * 3 * 365,
      fetchedAt: finiteOrNull(data.fetchedAt) ?? Date.now(),
      source: 'deribit',
    };
    cache.set(key, { value: bundle, expiry: Date.now() + 15_000 });
    return bundle;
  } catch {
    return null;
  }
}

export function deribitCurrencyFromSymbol(symbol: string): 'BTC' | 'ETH' | null {
  const normalized = symbol.toUpperCase().replace(/[-/]/g, '');
  if (normalized === 'BTC' || normalized === 'BTCUSD' || normalized === 'XBT') return 'BTC';
  if (normalized === 'ETH' || normalized === 'ETHUSD') return 'ETH';
  return null;
}
