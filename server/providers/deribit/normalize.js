/**
 * Deribit normalization — catalogue/quote join model.
 *
 * Data model:
 *   1. get_instruments → authoritative catalogue (strike, expiry, option_type,
 *      contract_size, currencies, is_inverse, kind). Never defaulted.
 *   2. book summaries / tickers → market values (bid/ask/mark/last, IV %, OI, volume).
 *   3. join by instrument_name → NormalizedTicker rows with real metadata + real quotes.
 *
 * Unit rules (converted exactly once, here):
 *   - bid_iv / ask_iv / mark_iv / trade mark_iv arrive as PERCENTAGE POINTS
 *     (55.0 = 55%). Normalized form is DECIMAL (0.55). Downstream renders ×100.
 *   - Option OI is base-currency units; perp/future OI is USD notional (inverse).
 *     Units are preserved as native + labelled via kind/isInverse.
 *   - Missing fields stay null — never replaced with plausible defaults.
 */

/** Catalogue kind from get_instruments row. PERPETUAL → 'perp', never 'future'. */
export function catalogueKind(raw) {
  if (raw.settlement_period === 'perpetual' || String(raw.instrument_name || '').endsWith('-PERPETUAL')) {
    return 'perp';
  }
  if (raw.kind === 'option') return 'option';
  if (raw.kind === 'future') return 'future';
  return null;
}

/**
 * Authoritative instrument metadata from get_instruments.
 * No defaults — absent fields are null.
 */
export function normalizeCatalogueEntry(raw) {
  const kind = catalogueKind(raw);
  if (!kind) return null;
  return {
    instrument: String(raw.instrument_name),
    baseCurrency: raw.base_currency ?? null,
    quoteCurrency: raw.quote_currency ?? null,
    settlementCurrency: raw.settlement_currency ?? null,
    contractSize: typeof raw.contract_size === 'number' ? raw.contract_size : null,
    kind,
    expiryMs: typeof raw.expiration_timestamp === 'number' && raw.expiration_timestamp > 0
      && raw.expiration_timestamp < 4102444800000 // year-2100 cutoff: perp sentinel (year 3000) → no expiry
      ? raw.expiration_timestamp
      : null, // perp has no expiry
    strike: typeof raw.strike === 'number' ? raw.strike : null,
    optionType: raw.option_type === 'call' || raw.option_type === 'put' ? raw.option_type : null,
    isInverse: Boolean(raw.is_inverse),
    tickSize: typeof raw.tick_size === 'number' ? raw.tick_size : null,
    isActive: Boolean(raw.is_active),
  };
}

/** Deribit IV arrives in percentage points; normalize to decimal exactly once. */
export function ivPctToDecimal(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Number(v) / 100;
}

/**
 * Quote layer from book summary or ticker rows.
 * Prices/IV/OI stay null when the venue reports nothing.
 */
export function normalizeQuote(raw, asOfMs = Date.now()) {
  return {
    bidPrice: raw.bid_price ?? raw.best_bid_price ?? null,
    askPrice: raw.ask_price ?? raw.best_ask_price ?? null,
    markPrice: raw.mark_price ?? null,
    lastPrice: raw.last_price ?? null,
    bidIv: ivPctToDecimal(raw.bid_iv),
    askIv: ivPctToDecimal(raw.ask_iv),
    markIv: ivPctToDecimal(raw.mark_iv),
    indexPrice: raw.index_price ?? null,
    openInterest: raw.open_interest ?? null,
    volume: raw.volume ?? null,
    funding8h: raw.funding_8h ?? null,
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : asOfMs,
  };
}

/**
 * Join catalogue metadata with quotes by instrument_name.
 * Returns rows that have metadata; quotes attach only when present.
 * Missing quote → market fields null (metadata row still listed).
 */
export function joinCatalogueWithQuotes(catalogue, quotes, asOfMs = Date.now()) {
  const byInstrument = new Map();
  for (const q of quotes) {
    if (q?.instrument_name) byInstrument.set(String(q.instrument_name), q);
  }
  const rows = [];
  let withQuotes = 0;
  for (const meta of catalogue) {
    if (!meta) continue;
    const q = byInstrument.get(meta.instrument);
    if (q) withQuotes += 1;
    const quote = q ? normalizeQuote(q, asOfMs) : null;
    rows.push({
      instrument: meta.instrument,
      baseCurrency: meta.baseCurrency,
      quoteCurrency: meta.quoteCurrency,
      settlementCurrency: meta.settlementCurrency,
      contractSize: meta.contractSize,
      kind: meta.kind,
      expiryMs: meta.expiryMs,
      strike: meta.strike,
      optionType: meta.optionType,
      isInverse: meta.isInverse,
      // Market layers — null when no quote for this instrument
      bidPrice: quote?.bidPrice ?? null,
      askPrice: quote?.askPrice ?? null,
      markPrice: quote?.markPrice ?? null,
      lastPrice: quote?.lastPrice ?? null,
      bidIv: quote?.bidIv ?? null,
      askIv: quote?.askIv ?? null,
      markIv: quote?.markIv ?? null,
      indexPrice: quote?.indexPrice ?? null,
      openInterest: quote?.openInterest ?? null,
      volume: quote?.volume ?? null,
      funding8h: quote?.funding8h ?? null,
      timestamp: quote?.timestamp ?? asOfMs,
      hasQuote: Boolean(q),
      isStale: false,
    });
  }
  return { rows, coverage: catalogue.length > 0 ? withQuotes / catalogue.length : null, catalogueCount: catalogue.length, withQuotes };
}

/**
 * Normalize a public trade row (get_last_trades_by_currency_and_time).
 * Trade mark_iv is also percentage points → decimal once.
 * Premium is in NATIVE settlement currency (BTC for inverse options):
 * price (BTC) × amount (base ccy contracts) × contract_size. NOT quote currency.
 */
export function normalizeTrade(raw, meta /* contract_size from catalogue */) {
  const parsedPrice = Number(raw.price);
  const parsedAmount = Number(raw.amount);
  const price = Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : null;
  const amount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : null;
  const contractSize = meta?.contractSize ?? null;
  return {
    instrument: String(raw.instrument_name ?? ''),
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : null,
    price,
    quantity: amount,
    side: raw.direction === 'buy' ? 'buy' : 'sell',
    markIv: ivPctToDecimal(raw.mark_iv),
    // Native settlement-currency premium (inverse options: BTC)
    premiumNative: contractSize != null && price != null && amount != null ? price * amount * contractSize : null,
    contractSize,
    nativeCurrency: meta?.settlementCurrency ?? null,
    blockTrade: Boolean(raw.block_trade),
    rfq: false,
  };
}
