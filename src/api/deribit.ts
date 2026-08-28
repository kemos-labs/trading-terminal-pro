/**
 * Thin same-origin browser client — knows only normalized schemas, never Deribit raw types.
 *
 * Contract: GET /api/deribit/market/:currency returns DeribitMarketBundle.
 * Server and browser share this shape (server/routes/deribitMarket.js).
 *
 * Units:
 *   - IVs (bidIv/askIv/markIv, trade markIv) are DECIMAL (0.55 = 55%). Server converts
 *     from Deribit percentage points exactly once. Views render ×100 only.
 *   - openInterest units are native per kind: base currency for options,
 *     USD notional for inverse perp/futures.
 *   - funding8h is the native 8h rate (decimal); annualization (×3×365) is done
 *     via src/lib/math/carry/funding.ts, never inline.
 *   - Trade premium is premiumNative in the NATIVE settlement currency
 *     (BTC for inverse options), price × amount × contract_size. NOT quote currency.
 * Missing fields are null — never plausible defaults.
 */

export type InstrumentKind = 'option' | 'future' | 'perp';

export interface NormalizedTicker {
  instrument: string;
  baseCurrency: string | null;
  quoteCurrency: string | null;
  settlementCurrency: string | null;
  contractSize: number | null;
  kind: InstrumentKind;
  /** ms epoch; null for perp (no expiry) */
  expiryMs: number | null;
  strike: number | null;
  optionType: 'call' | 'put' | null;
  isInverse: boolean;
  bidPrice: number | null;
  askPrice: number | null;
  markPrice: number | null;
  lastPrice: number | null;
  /** decimal IVs — 0.55 renders as 55% */
  bidIv: number | null;
  askIv: number | null;
  markIv: number | null;
  indexPrice: number | null;
  openInterest: number | null;
  volume: number | null;
  /** native 8h funding rate (decimal) — perp only */
  funding8h: number | null;
  timestamp: number;
  /** true when a quote was joined for this catalogue row */
  hasQuote: boolean;
  isStale: boolean;
}

export interface DeribitMarketBundle {
  currency: string;
  indexPrice: number | null;
  instruments: NormalizedTicker[];
  /** joined-with-quote fraction of the ACTIVE catalogue (0..1), null when catalogue empty */
  coverage: number | null;
  /** native 8h perp funding (decimal), null when perp quote missing */
  funding8h: number | null;
  fetchedAt: number;
  source: 'deribit';
}

export async function fetchDeribitMarket(currency: string): Promise<DeribitMarketBundle> {
  const res = await fetch(`/api/deribit/market/${encodeURIComponent(currency)}`);
  if (!res.ok) throw new Error(`Deribit market ${res.status}`);
  return res.json();
}

export interface DeribitTrade {
  instrument: string;
  timestamp: number | null;
  price: number;
  quantity: number;
  /** taker side */
  side: 'buy' | 'sell';
  /** decimal mark IV at trade time */
  markIv: number | null;
  /** premium in NATIVE settlement currency (price × amount × contract_size) */
  premiumNative: number | null;
  contractSize: number | null;
  nativeCurrency: string | null;
  blockTrade: boolean;
  rfq: boolean;
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
