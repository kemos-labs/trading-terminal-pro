/**
 * Thin same-origin browser client — knows only normalized schemas, never Deribit raw types.
 *
 * Contract: GET /api/deribit/market/:currency returns DeribitMarketBundle (see server/routes/deribitMarket.ts).
 * Every value is real Deribit data or an explicit null/unavailable — never synthetic.
 */

export interface NormalizedTicker {
  instrument: string;
  baseCurrency: string;
  quoteCurrency: string;
  settlementCurrency: string;
  contractSize: number;
  kind: 'option' | 'future' | 'perp';
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
  indexPrice: number | null;
  openInterest: number | null;
  volume: number | null;
  /** 8h funding rate (decimal) for perps, null for dated */
  funding8h: number | null;
  timestamp: number;
  isStale: boolean;
}

export interface DeribitMarketBundle {
  currency: string;
  indexPrice: number | null;
  /** All normalized instruments (options + futures + perp) in one list */
  instruments: NormalizedTicker[];
  /** Count of instruments present vs expected (0..1) — null when unknown */
  coverage: number | null;
  /** Deribit reported funding for the perp (annualized simple ×3×365), null when unavailable */
  fundingAnnualized: number | null;
  fetchedAt: number;
  source: 'deribit';
}

export async function fetchDeribitMarket(currency: string): Promise<DeribitMarketBundle> {
  const res = await fetch(`/api/deribit/market/${encodeURIComponent(currency)}`);
  if (!res.ok) throw new Error(`Deribit market ${res.status}`);
  return res.json();
}

export async function fetchDeribitInstruments(currency: string): Promise<{
  currency: string;
  instruments: NormalizedTicker[];
  coverage: number | null;
  fetchedAt: number;
  source: 'deribit';
}> {
  const res = await fetch(`/api/deribit/instruments?currency=${encodeURIComponent(currency)}`);
  if (!res.ok) throw new Error(`Instruments ${res.status}`);
  return res.json();
}

export async function fetchDeribitTrades(currency: string, hours = 24, count = 500): Promise<{
  currency: string;
  trades: DeribitTrade[];
  count: number;
  hasMore: boolean;
  fetchedAt: number;
  source: 'deribit';
}> {
  const res = await fetch(
    `/api/deribit/trades/${encodeURIComponent(currency)}?hours=${hours}&count=${count}`,
  );
  if (!res.ok) throw new Error(`Deribit trades ${res.status}`);
  return res.json();
}

export interface DeribitTrade {
  instrument: string;
  timestamp: number;
  price: number;
  quantity: number;
  /** Taker side: 'buy' = taker bought, 'sell' = taker sold */
  side: 'buy' | 'sell';
  /** Mark price at trade time */
  markPrice: number;
  /** Mark IV at trade time (decimal), null when unavailable */
  markIv: number | null;
  /** Premium in quote currency (price × quantity × contractSize) */
  premium: number;
  /** Block trade / RFQ flag when reported by Deribit */
  blockTrade: boolean;
  rfq: boolean;
}
