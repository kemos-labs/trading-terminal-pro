export interface FreeCryptoVenue {
  venue: string;
  symbol: string;
  last: number | null;
  mark: number | null;
  index: number | null;
  funding8h: number | null;
  openInterest: number | null;
  volume24hUsd: number | null;
  change24hPct: number | null;
  fetchedAt: number;
}

export interface FreeCryptoMarket {
  currency: 'BTC' | 'ETH';
  symbol: string;
  venues: FreeCryptoVenue[];
  fetchedAt: number;
  source: 'free-exchanges';
  note: string;
}

export async function fetchFreeCryptoMarket(currency: 'BTC' | 'ETH' = 'BTC'): Promise<FreeCryptoMarket> {
  const res = await fetch(`/api/free-crypto/market/${currency}`);
  if (!res.ok) throw new Error(`Free crypto market ${res.status}`);
  return res.json() as Promise<FreeCryptoMarket>;
}
