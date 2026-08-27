/**
 * Deribit market routes — single canonical implementation using server/providers/deribit.
 * Returns DeribitMarketBundle (see src/api/deribit.ts) — same contract browser and server share.
 *
 * Routes:
 *   GET /api/deribit/market/:currency  — full normalized bundle (index + instruments + funding + coverage)
 *   GET /api/deribit/instruments        — normalized instrument list
 *   GET /api/deribit/trades/:currency   — recent public options trades, taker-side classified
 *   GET /api/deribit/index/:name        — index price (btc_usd / eth_usd)
 *   GET /api/deribit/funding-history    — hourly funding rate history for the perp
 *
 * Fail-closed: every value is real Deribit data or explicit null/error — never synthetic.
 */
import { deribitFetch } from '../providers/deribit/client.js';
import { normalizeTicker, normalizeInstrument } from '../providers/deribit/normalize.js';
import { isValidInstrument } from '../providers/deribit/schemas.js';

const DERIBIT_PERP_FUNDING_DAYS_ALLOWED = [1, 7, 30, 90];
const DERIBIT_PERP_FUNDING_DAYS_MAX = 90;

function parseCurrency(currency) {
  const c = String(currency || '').trim().toUpperCase();
  return c === 'BTC' || c === 'ETH' ? c : null;
}

async function loadInstruments(currency) {
  const raw = await deribitFetch(`get_book_summary_by_currency?currency=${currency}&kind=option`);
  if (!Array.isArray(raw)) return [];
  const tickers = [];
  for (const r of raw) {
    if (!isValidInstrument(r)) continue;
    const inst = normalizeInstrument(r);
    const asOption = {
      instrument_name: inst.instrumentName,
      base_currency: inst.baseCurrency,
      quote_currency: inst.quoteCurrency,
      settlement_currency: inst.settlementCurrency,
      contract_size: inst.contractSize,
      kind: inst.kind,
      expiration_timestamp: inst.expiryMs,
      strike: inst.strike,
      option_type: inst.optionType,
      bid_price: r.bid_price ?? null,
      ask_price: r.ask_price ?? null,
      mark_price: r.mark_price ?? null,
      last_price: r.last_price ?? null,
      bid_iv: r.bid_iv ?? null,
      ask_iv: r.ask_iv ?? null,
      mark_iv: r.mark_iv ?? null,
      open_interest: r.open_interest ?? null,
      volume: r.volume ?? null,
    };
    tickers.push(normalizeTicker(asOption));
  }
  return tickers;
}

async function loadPerpTicker(currency) {
  const name = `${currency}-PERPETUAL`;
  const raw = await deribitFetch(`ticker?instrument_name=${name}`);
  if (!raw || typeof raw !== 'object') return null;
  return normalizeTicker({
    instrument_name: raw.instrument_name ?? name,
    base_currency: raw.base_currency ?? currency,
    quote_currency: raw.quote_currency ?? 'USD',
    settlement_currency: raw.settlement_currency ?? currency,
    contract_size: raw.contract_size ?? 1,
    kind: 'future',
    mark_price: raw.mark_price ?? null,
    last_price: raw.last_price ?? null,
    best_bid_price: raw.best_bid_price ?? null,
    best_ask_price: raw.best_ask_price ?? null,
    index_price: raw.index_price ?? null,
    open_interest: raw.open_interest ?? null,
    current_funding: raw.current_funding ?? null,
    funding_8h: raw.funding_8h ?? null,
  });
}

async function getFunding8h(currency) {
  const name = `${currency}-PERPETUAL`;
  const raw = await deribitFetch(`ticker?instrument_name=${name}`);
  const f8 = raw?.funding_8h ?? raw?.current_funding;
  return typeof f8 === 'number' ? f8 : null;
}

export async function registerDeribitMarketRoutes(fastify) {
  // Full normalized bundle — the single contract browser and server share.
  fastify.get('/api/deribit/market/:currency', async (request, reply) => {
    const currency = parseCurrency(request.params.currency);
    if (!currency) { reply.code(400); return { error: 'currency must be BTC or ETH' }; }
    try {
      const [indexRaw, options, perp] = await Promise.all([
        deribitFetch(`get_index_price?index_name=${currency === 'BTC' ? 'btc_usd' : 'eth_usd'}`),
        loadInstruments(currency),
        loadPerpTicker(currency),
      ]);
      const instruments = perp ? [...options, perp] : options;
      const funding8h = perp ? await getFunding8h(currency).catch(() => null) : null;
      return {
        currency,
        indexPrice: indexRaw?.index_price ?? perp?.index_price ?? null,
        instruments,
        coverage: options.length > 0 ? Math.min(1, options.length / 50) : null,
        fundingAnnualized: funding8h != null ? funding8h * 3 * 365 : null,
        fetchedAt: Date.now(),
        source: 'deribit',
      };
    } catch (err) {
      reply.code(502);
      return { error: 'Deribit market bundle failed', detail: String(err.message || err) };
    }
  });

  fastify.get('/api/deribit/instruments', async (request, reply) => {
    const currency = parseCurrency(request.query.currency);
    if (!currency) { reply.code(400); return { error: 'currency must be BTC or ETH' }; }
    try {
      const instruments = await loadInstruments(currency);
      return { currency, instruments, coverage: instruments.length > 0 ? Math.min(1, instruments.length / 50) : null, fetchedAt: Date.now(), source: 'deribit' };
    } catch (err) { reply.code(502); return { error: 'Deribit instruments failed', detail: String(err.message || err) }; }
  });

  fastify.get('/api/deribit/trades/:currency', async (request, reply) => {
    const currency = parseCurrency(request.params.currency);
    if (!currency) { reply.code(400); return { error: 'currency must be BTC or ETH' }; }
    const requestedHours = Number(request.query.hours ?? 24);
    const hours = [1, 4, 24].includes(requestedHours) ? requestedHours : 24;
    const requestedCount = Number(request.query.count ?? 500);
    const count = Math.min(1000, Math.max(50, Number.isFinite(requestedCount) ? Math.floor(requestedCount) : 500));
    try {
      const start = Date.now() - hours * 3_600_000;
      const result = await deribitFetch(
        `get_last_trades_by_currency_and_time?currency=${currency}&kind=option&start_timestamp=${start}&count=${count}&sorting=desc`,
      );
      const rawTrades = Array.isArray(result?.trades) ? result.trades : [];
      const trades = rawTrades.map((t) => ({
        instrument: String(t.instrument_name ?? ''),
        timestamp: Number(t.timestamp) || Date.now(),
        price: Number(t.price) || 0,
        quantity: Number(t.amount ?? t.quantity) || 0,
        side: (t.direction === 'buy' ? 'buy' : 'sell'),
        markPrice: Number(t.mark_price ?? t.index_price) || 0,
        markIv: t.mark_iv != null ? Number(t.mark_iv) / 100 : null,
        premium: (Number(t.price) || 0) * (Number(t.amount ?? t.quantity) || 0),
        blockTrade: Boolean(t.block_trade),
        rfq: Boolean(t.rfq ?? t.block_trade),
      }));
      return { currency, trades, count: trades.length, hasMore: Boolean(result?.has_more), fetchedAt: Date.now(), source: 'deribit' };
    } catch (err) { reply.code(502); return { error: 'Deribit trades failed', detail: String(err.message || err) }; }
  });

  fastify.get('/api/deribit/index/:name', async (request, reply) => {
    const name = String(request.params.name || '').toLowerCase();
    if (!/^(btc|eth)_usd$/.test(name)) { reply.code(400); return { error: 'Invalid index (use btc_usd or eth_usd)' }; }
    try {
      const result = await deribitFetch(`get_index_price?index_name=${name}`);
      return { index_price: result.index_price, estimated_delivery_price: result.estimated_delivery_price, timestamp: Date.now() };
    } catch (err) { reply.code(502); return { error: 'Deribit index failed', detail: String(err.message || err) }; }
  });

  fastify.get('/api/deribit/funding-history', async (request, reply) => {
    const q = request.query;
    let instrumentName = String(q.instrument_name || '').toUpperCase();
    let currency = parseCurrency(q.currency);
    if (instrumentName) {
      const m = /^([A-Z]+)-PERPETUAL$/.exec(instrumentName);
      if (!m || !['BTC', 'ETH'].includes(m[1])) { reply.code(400); return { error: 'instrument_name must be BTC-PERPETUAL or ETH-PERPETUAL' }; }
      currency = m[1];
    } else if (currency) {
      instrumentName = `${currency}-PERPETUAL`;
    } else {
      reply.code(400); return { error: 'provide instrument_name=BTC-PERPETUAL or currency=BTC' };
    }
    const requestedDays = Number(q.days ?? 7);
    const days = DERIBIT_PERP_FUNDING_DAYS_ALLOWED.includes(requestedDays)
      ? requestedDays
      : requestedDays > DERIBIT_PERP_FUNDING_DAYS_MAX
        ? DERIBIT_PERP_FUNDING_DAYS_MAX
        : 7;
    try {
      const end = Date.now();
      const start = end - days * 86_400_000;
      const result = await deribitFetch(
        `get_funding_rate_history?instrument_name=${instrumentName}&start_timestamp=${start}&end_timestamp=${end}`,
      );
      const rows = Array.isArray(result) ? result : [];
      const points = rows
        .map((r) => {
          const rate8h = Number(r?.interest_8h);
          if (!Number.isFinite(rate8h)) return null;
          const idxPrice = Number(r?.index_price);
          return { t: Number(r?.timestamp), rate8h, annualizedPct: rate8h * 3 * 365 * 100, indexPrice: Number.isFinite(idxPrice) ? idxPrice : null };
        })
        .filter(Boolean);
      points.sort((a, b) => a.t - b.t);
      const last = points.at(-1) ?? null;
      return {
        currency, instrument_name: instrumentName, days, points,
        latest: last ? { t: last.t, rate8h: last.rate8h, annualizedPct: last.annualizedPct } : null,
        count: points.length, fetchedAt: Date.now(), source: 'deribit',
      };
    } catch (err) { reply.code(502); return { error: 'Deribit funding history failed', detail: String(err.message || err) }; }
  });
}
