/**
 * Thin same-origin browser client — knows only normalized schemas, never Deribit raw types.
 */

export interface NormalizedTicker {
  instrument: string;
  bidPrice: number | null;
  askPrice: number | null;
  markPrice: number | null;
  bidIv: number | null;
  askIv: number | null;
  markIv: number | null;
  openInterest: number | null;
  timestamp: number;
}

export async function fetchDeribitMarket(currency: string): Promise<{ currency: string; tickers: NormalizedTicker[]; asOf: number }> {
  const res = await fetch(`/api/deribit/market/${encodeURIComponent(currency)}`);
  if (!res.ok) throw new Error(`Deribit market ${res.status}`);
  return res.json();
}

export async function fetchDeribitInstruments(currency: string) {
  const res = await fetch(`/api/deribit/instruments?currency=${encodeURIComponent(currency)}`);
  if (!res.ok) throw new Error(`Instruments ${res.status}`);
  return res.json();
}
