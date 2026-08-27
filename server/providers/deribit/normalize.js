/**
 * Deribit normalization — preserves native fields, separates bid/ask/mark/trade, OI units, contract metadata.
 */

export function normalizeTicker(raw, asOfMs = Date.now()) {
  const strike = raw.strike ?? null;
  const expiry = raw.expiry ?? raw.expiration_timestamp ?? null;
  return {
    instrument: raw.instrument_name,
    baseCurrency: raw.base_currency ?? raw.underlying_index ?? 'BTC',
    quoteCurrency: raw.quote_currency ?? 'USD',
    settlementCurrency: raw.settlement_currency ?? raw.base_currency ?? 'BTC',
    contractSize: raw.contract_size ?? 1,
    kind: raw.kind ?? (raw.instrument_name?.includes('-C') || raw.instrument_name?.includes('-P') ? 'option' : 'future'),
    expiryMs: expiry,
    strike,
    optionType: raw.option_type ?? (raw.instrument_name?.endsWith('-C') ? 'call' : raw.instrument_name?.endsWith('-P') ? 'put' : null),
    isInverse: (raw.settlement_currency ?? 'BTC') === (raw.base_currency ?? 'BTC'),
    // Price layers — never collapse
    bidPrice: raw.bid_price ?? raw.best_bid_price ?? null,
    askPrice: raw.ask_price ?? raw.best_ask_price ?? null,
    markPrice: raw.mark_price ?? null,
    lastPrice: raw.last_price ?? null,
    // IV layers
    bidIv: raw.bid_iv ?? null,
    askIv: raw.ask_iv ?? null,
    markIv: raw.mark_iv ?? null,
    indexPrice: raw.index_price ?? null,
    openInterest: raw.open_interest ?? null, // already underlying units for options
    volume: raw.volume ?? null,
    timestamp: raw.timestamp ?? asOfMs,
    isStale: false,
    raw,
  };
}

export function normalizeInstrument(raw) {
  return {
    instrumentName: raw.instrument_name,
    baseCurrency: raw.base_currency,
    quoteCurrency: raw.quote_currency,
    settlementCurrency: raw.settlement_currency,
    contractSize: raw.contract_size,
    kind: raw.kind,
    expiryMs: raw.expiration_timestamp ?? null,
    strike: raw.strike ?? null,
    optionType: raw.option_type ?? null,
    isInverse: raw.is_inverse ?? (raw.settlement_currency === raw.base_currency),
  };
}

export function normalizeOi(raw) {
  // Per docs: option OI in base units, perp/future OI in USD for inverse — preserve native
  return raw.open_interest ?? 0;
}
