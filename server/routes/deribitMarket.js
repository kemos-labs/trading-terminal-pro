/**
 * Deribit market routes — canonical catalogue/quote join via server/providers/deribit.
 * Returns DeribitMarketBundle (see src/api/deribit.ts) — the one contract browser and server share.
 *
 * Data flow:
 *   get_instruments (catalogue: options + futures + perp, authoritative metadata)
 *   + get_book_summary_by_currency kind=option (quotes)
 *   + get_book_summary_by_currency kind=future (quotes)
 *   + ticker BTC-PERPETUAL (quotes)
 *   → join by instrument_name → { currency, indexPrice, instruments, coverage, funding8h, fetchedAt, source }
 *
 * kind is 'option' | 'future' | 'perp' (PERPETUAL is never 'future').
 * IVs are decimal (converted exactly once in normalize). OI units are native per kind.
 * Fail-closed: every value is real Deribit data or explicit null/error — never synthetic.
 */
import { deribitFetch } from '../providers/deribit/client.js';
import {
  normalizeCatalogueEntry,
  joinCatalogueWithQuotes,
  normalizeTrade,
} from '../providers/deribit/normalize.js';
import { getOrFetch } from '../../api/upstreamCache.js';

const CATALOGUE_TTL_MS = 5 * 60_000; // listings change ~daily
const _QUOTES_TTL_MS = 20_000;
const _TRADES_TTL_MS = 5_000;

function parseCurrency(currency) {
  const c = String(currency || '').trim().toUpperCase();
  return c === 'BTC' || c === 'ETH' ? c : null;
}

/** Active catalogue: options + dated futures + perpetual (authoritative metadata). */
async function loadCatalogue(currency) {
  return getOrFetch(`deribit:catalogue:${currency}`, CATALOGUE_TTL_MS, async () => {
    const raw = await deribitFetch(`get_instruments?currency=${currency}&expired=false`);
    if (!Array.isArray(raw)) throw new Error('Deribit get_instruments: unexpected shape');
    return raw
      .filter((r) => r && r.instrument_name && r.is_active)
      .map(normalizeCatalogueEntry)
      .filter(Boolean);
  }, { allowStaleOnError: true }).then((r) => r.data);
}

/** Quotes for options and futures from book summaries; perp from ticker. */
async function loadQuotes(currency) {
  const [optionSummary, futureSummary, perpTicker] = await Promise.all([
    deribitFetch(`get_book_summary_by_currency?currency=${currency}&kind=option`).catch(() => null),
    deribitFetch(`get_book_summary_by_currency?currency=${currency}&kind=future`).catch(() => null),
    deribitFetch(`ticker?instrument_name=${currency}-PERPETUAL`).catch(() => null),
  ]);
  const quotes = [];
  if (Array.isArray(optionSummary)) quotes.push(...optionSummary);
  if (Array.isArray(futureSummary)) quotes.push(...futureSummary);
  if (perpTicker && typeof perpTicker === 'object') {
    quotes.push({
      instrument_name: perpTicker.instrument_name ?? `${currency}-PERPETUAL`,
      mark_price: perpTicker.mark_price ?? null,
      last_price: perpTicker.last_price ?? null,
      best_bid_price: perpTicker.best_bid_price ?? null,
      best_ask_price: perpTicker.best_ask_price ?? null,
      index_price: perpTicker.index_price ?? null,
      open_interest: perpTicker.open_interest ?? null,
      funding_8h: perpTicker.funding_8h ?? null,
      timestamp: perpTicker.timestamp ?? Date.now(),
    });
  }
  return quotes;
}

export async function registerDeribitMarketRoutes(fastify) {
  // Full normalized bundle — the single contract browser and server share.
  fastify.get('/api/deribit/market/:currency', async (request, reply) => {
    const currency = parseCurrency(request.params.currency);
    if (!currency) {
      reply.code(400);
      return { error: 'currency must be BTC or ETH' };
    }
    try {
      const catalogue = await loadCatalogue(currency);
      const quotes = await loadQuotes(currency);
      const { rows, coverage } = joinCatalogueWithQuotes(catalogue, quotes, Date.now());
      const indexName = currency === 'BTC' ? 'btc_usd' : 'eth_usd';
      const index = await deribitFetch(`get_index_price?index_name=${indexName}`).catch(() => null);
      const perp = rows.find((r) => r.kind === 'perp');
      const funding8h = perp?.funding8h ?? null;
      return {
        currency,
        indexPrice: index?.index_price ?? perp?.indexPrice ?? null,
        instruments: rows,
        coverage,
        funding8h,
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
    if (!currency) {
      reply.code(400);
      return { error: 'currency must be BTC or ETH' };
    }
    try {
      const catalogue = await loadCatalogue(currency);
      return { currency, instruments: catalogue, fetchedAt: Date.now(), source: 'deribit' };
    } catch (err) {
      reply.code(502);
      return { error: 'Deribit instruments failed', detail: String(err.message || err) };
    }
  });

  fastify.get('/api/deribit/trades/:currency', async (request, reply) => {
    const currency = parseCurrency(request.params.currency);
    if (!currency) {
      reply.code(400);
      return { error: 'currency must be BTC or ETH' };
    }
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
      // Join trades with catalogue contract_size for native-currency premium.
      const catalogue = await loadCatalogue(currency);
      const sizeByInstrument = new Map(catalogue.map((c) => [c.instrument, c]));
      const trades = rawTrades.map((t) => normalizeTrade(t, sizeByInstrument.get(String(t.instrument_name))));
      return { currency, trades, count: trades.length, hasMore: Boolean(result?.has_more), fetchedAt: Date.now(), source: 'deribit' };
    } catch (err) {
      reply.code(502);
      return { error: 'Deribit trades failed', detail: String(err.message || err) };
    }
  });

  fastify.get('/api/deribit/index/:name', async (request, reply) => {
    const name = String(request.params.name || '').toLowerCase();
    if (!/^(btc|eth)_usd$/.test(name)) {
      reply.code(400);
      return { error: 'Invalid index (use btc_usd or eth_usd)' };
    }
    try {
      const result = await deribitFetch(`get_index_price?index_name=${name}`);
      return { index_price: result.index_price, estimated_delivery_price: result.estimated_delivery_price, timestamp: Date.now() };
    } catch (err) {
      reply.code(502);
      return { error: 'Deribit index failed', detail: String(err.message || err) };
    }
  });

  fastify.get('/api/deribit/funding-history', async (request, reply) => {
    const q = request.query;
    let instrumentName = String(q.instrument_name || '').toUpperCase();
    let currency = parseCurrency(q.currency);
    if (instrumentName) {
      const m = /^([A-Z]+)-PERPETUAL$/.exec(instrumentName);
      if (!m || !['BTC', 'ETH'].includes(m[1])) {
        reply.code(400);
        return { error: 'instrument_name must be BTC-PERPETUAL or ETH-PERPETUAL' };
      }
      currency = m[1];
    } else if (currency) {
      instrumentName = `${currency}-PERPETUAL`;
    } else {
      reply.code(400);
      return { error: 'provide instrument_name=BTC-PERPETUAL or currency=BTC' };
    }
    const requestedDays = Number(q.days ?? 7);
    const days = [1, 7, 30, 90].includes(requestedDays) ? requestedDays : requestedDays > 90 ? 90 : 7;
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
    } catch (err) {
      reply.code(502);
      return { error: 'Deribit funding history failed', detail: String(err.message || err) };
    }
  });
}
