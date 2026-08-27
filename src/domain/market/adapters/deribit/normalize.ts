export interface RawDeribit {
  instrument_name: string;
  strike: number;
  expiry: number;
  mark_price: number;
  mark_iv?: number;
  open_interest: number;
  base_currency: string;
  quote_currency: string;
  settlement_currency: string;
  contract_size: number;
  bid_price?: number;
  ask_price?: number;
  last?: number;
}

export interface NormalizedOption {
  instrument: string;
  strike: number;
  expiryMs: number;
  nativeCurrency: string;
  contractSize: number;
  openInterest: number;
  markPrice: number;
  markIv?: number;
  bidPrice?: number;
  askPrice?: number;
}

export function normalizeDeribitOption(raw: RawDeribit, _indexPrice: number, _asOfMs: number): NormalizedOption {
  return {
    instrument: raw.instrument_name,
    strike: raw.strike,
    expiryMs: raw.expiry,
    nativeCurrency: raw.settlement_currency ?? raw.base_currency,
    contractSize: raw.contract_size,
    openInterest: raw.open_interest,
    markPrice: raw.mark_price,
    markIv: raw.mark_iv,
    bidPrice: raw.bid_price,
    askPrice: raw.ask_price,
  };
}

export function normalizeDeribitOi(raw: RawDeribit): number {
  // Deribit option OI already in underlying base units — no *100
  return raw.open_interest;
}
