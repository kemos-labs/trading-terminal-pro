/**
 * Canonical same-origin Deribit client.
 *
 * Both market and tape requests use validated `/api/v1` envelopes. IVs are
 * decimal, funding is the native decimal 8h print, missing fields remain null,
 * and option-trade right/expiry are parsed at the server contract boundary.
 */
import type { MarketEnvelope } from '../../packages/contracts/src';

export type InstrumentKind = 'option' | 'future' | 'perp';

export interface NormalizedTicker {
  instrument: string;
  baseCurrency: string | null;
  quoteCurrency: string | null;
  settlementCurrency: string | null;
  contractSize: number | null;
  kind: InstrumentKind;
  expiryMs: number | null;
  strike: number | null;
  optionType: 'call' | 'put' | null;
  isInverse: boolean;
  bidPrice: number | null;
  askPrice: number | null;
  markPrice: number | null;
  lastPrice: number | null;
  bidIv: number | null;
  askIv: number | null;
  markIv: number | null;
  feedIv: number | null;
  midIv: number | null;
  bidIvDerived: number | null;
  askIvDerived: number | null;
  modelIv: number | null;
  indexPrice: number | null;
  openInterest: number | null;
  volume: number | null;
  volumeUsd: number | null;
  funding8h: number | null;
  timestamp: number;
  hasQuote: boolean;
  isStale: boolean;
}

export interface DeribitMarketBundle {
  currency: string;
  indexPrice: number | null;
  instruments: NormalizedTicker[];
  coverage: number | null;
  funding8h: number | null;
  fetchedAt: number;
  source: 'deribit';
}

interface V1Instrument {
  instrument: string;
  baseCurrency: string | null;
  quoteCurrency: string | null;
  settlementCurrency: string | null;
  contractSize: number | null;
  settlementPeriod: string | null;
  isInverse: boolean;
  kind: InstrumentKind;
  expiryMs: number | null;
  strike: number | null;
  right: 'call' | 'put' | null;
  bid: number | null;
  ask: number | null;
  mark: number | null;
  last: number | null;
  bidIv: number | null;
  askIv: number | null;
  markIv: number | null;
  indexPrice: number | null;
  openInterest: number | null;
  volume: number | null;
  volumeUsd: number | null;
  funding8h: number | null;
  timestamp: number | null;
  tradable: boolean;
}

interface V1MarketData {
  currency: 'BTC' | 'ETH';
  indexPrice: number | null;
  funding8h: number | null;
  instruments: V1Instrument[];
  count: number;
}

async function v1Json<T>(response: Response, label: string): Promise<MarketEnvelope<T>> {
  const body = await response.json().catch(() => null) as (MarketEnvelope<T> & {
    error?: { message?: string };
  }) | null;
  if (!response.ok || !body || body.schemaVersion !== 1 || !('data' in body)) {
    throw new Error(body?.error?.message ?? `${label} ${response.status}`);
  }
  return body;
}

export async function fetchDeribitMarket(currency: string): Promise<DeribitMarketBundle> {
  const response = await fetch(`/api/v1/market/crypto/${encodeURIComponent(currency)}`);
  const envelope = await v1Json<V1MarketData>(response, 'Deribit market');
  const fetchedAt = new Date(envelope.fetchedAt).getTime();
  const stale = envelope.freshness === 'stale' || envelope.freshness === 'unavailable';
  return {
    currency: envelope.data.currency,
    indexPrice: envelope.data.indexPrice,
    instruments: envelope.data.instruments.map((row) => ({
      instrument: row.instrument,
      baseCurrency: row.baseCurrency,
      quoteCurrency: row.quoteCurrency,
      settlementCurrency: row.settlementCurrency,
      contractSize: row.contractSize,
      kind: row.kind,
      expiryMs: row.expiryMs,
      strike: row.strike,
      optionType: row.right,
      isInverse: row.isInverse,
      bidPrice: row.bid,
      askPrice: row.ask,
      markPrice: row.mark,
      lastPrice: row.last,
      bidIv: row.bidIv,
      askIv: row.askIv,
      markIv: row.markIv,
      feedIv: row.markIv,
      midIv: null,
      bidIvDerived: null,
      askIvDerived: null,
      modelIv: null,
      indexPrice: row.indexPrice,
      openInterest: row.openInterest,
      volume: row.volume,
      volumeUsd: row.volumeUsd,
      funding8h: row.funding8h,
      timestamp: row.timestamp ?? fetchedAt,
      hasQuote: row.tradable,
      isStale: stale,
    })),
    coverage: envelope.coverage.denominator > 0
      ? envelope.coverage.numerator / envelope.coverage.denominator
      : null,
    funding8h: envelope.data.funding8h,
    fetchedAt,
    source: 'deribit',
  };
}

export interface DeribitTrade {
  instrument: string;
  timestamp: number | null;
  price: number;
  quantity: number;
  side: 'buy' | 'sell';
  right: 'call' | 'put' | null;
  expiry: string | null;
  markIv: number | null;
  premiumNative: number | null;
  contractSize: number | null;
  nativeCurrency: string | null;
  blockTrade: boolean;
  rfq: boolean;
}

interface V1TradesData {
  currency: 'BTC' | 'ETH';
  trades: DeribitTrade[];
  count: number;
  hasMore: boolean;
}

export async function fetchDeribitTrades(currency: string, hours = 24, count = 500): Promise<{
  currency: string;
  trades: DeribitTrade[];
  count: number;
  hasMore: boolean;
  fetchedAt: number;
  source: 'deribit';
}> {
  const response = await fetch(
    `/api/v1/market/crypto/${encodeURIComponent(currency)}/trades?hours=${hours}&count=${count}`,
  );
  const envelope = await v1Json<V1TradesData>(response, 'Deribit trades');
  return {
    ...envelope.data,
    fetchedAt: new Date(envelope.fetchedAt).getTime(),
    source: 'deribit',
  };
}
