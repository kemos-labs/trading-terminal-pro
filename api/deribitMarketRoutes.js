/**
 * Derivatives "Futures" desk market routes — Deribit PUBLIC API only (no keys).
 *
 * Plugin: `registerDeribitMarketRoutes(fastify)` — mirrors the /api/deribit/*
 * route style in server.js (getOrFetch cache + allowStaleOnError + fail-closed
 * 400/502 error envelopes). The browser never talks to Deribit directly.
 *
 * Routes:
 *   GET /api/deribit-market/instruments?currency=BTC|ETH
 *       Deribit public/get_instruments?kind=future — dated futures AND the
 *       perpetual in one list (Deribit reports the perp under kind=future).
 *   GET /api/deribit-market/tickers?currency=BTC|ETH
 *       Bulk public/ticker loop (Promise.all) over the active instrument list,
 *       cached 5s. One shared snapshot for every visitor.
 *   GET /api/deribit-market/index-price?currency=BTC|ETH
 *       public/get_index_price for btc_usd / eth_usd.
 *   GET /api/deribit-market/funding-history?instrument_name=BTC-PERPETUAL&days=7
 *       public/get_funding_rate_history — hourly funding points; normalized to
 *       the raw 8h rate plus its simple annualization (×3×365).
 *
 * Fail-closed rule: every value is real Deribit data or an explicit error —
 * no synthetic numbers, ever.
 */
import { getOrFetch } from './upstreamCache.js';

const DERIBIT_BASE = 'https://www.deribit.com/api/v2/public';

// TTLs aligned with server.js deribit routes (public market data cadence).
const INSTRUMENTS_TTL_MS = 5 * 60_000; // listings change ~daily, not per-minute
const TICKERS_TTL_MS = 5_000;
const INDEX_TTL_MS = 8_000;
const FUNDING_HISTORY_TTL_MS = 60_000;

const FUNDING_DAYS_ALLOWED = [1, 7, 30, 90];
/** Deribit caps lookback windows on funding history — keep requests modest. */
const FUNDING_DAYS_MAX = 90;

async function deribitFetch(pathWithQuery) {
  const url = `${DERIBIT_BASE}/${pathWithQuery}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Deribit ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error.message || JSON.stringify(json.error));
  }
  return json.result;
}

/** Validate ?currency= → 'BTC' | 'ETH' | null (caller replies 400). */
function parseCurrency(request) {
  const currency = String(request.query.currency || request.params.currency || '')
    .trim()
    .toUpperCase();
  return currency === 'BTC' || currency === 'ETH' ? currency : null;
}

/**
 * Active dated futures + perpetual for a currency. Cached 5 min.
 * @returns {Promise<Array<{instrument_name:string,settlement_period:string,expiration_timestamp:number,is_active:boolean,tick_size:number,contract_size:number,instrument_type:string,base_currency:string,quote_currency:string}>>}
 */
function loadInstruments(currency) {
  return getOrFetch(
    `deribit-market:instruments:${currency}`,
    INSTRUMENTS_TTL_MS,
    async () => {
      const result = await deribitFetch(
        `get_instruments?currency=${currency}&kind=future`,
      );
      if (!Array.isArray(result)) throw new Error('Deribit instruments: unexpected shape');
      return result
        .filter((i) => i && i.instrument_name && i.is_active)
        .map((i) => ({
          instrument_name: String(i.instrument_name),
          // 'perpetual' | 'day' | 'week' | 'month' … (perp carries a year-3000 sentinel expiry)
          settlement_period: String(i.settlement_period ?? ''),
          expiration_timestamp: Number(i.expiration_timestamp) || 0,
          is_active: Boolean(i.is_active),
          tick_size: Number(i.tick_size) || 0,
          contract_size: Number(i.contract_size) || 0,
          instrument_type: String(i.instrument_type ?? ''), // reversed (coin-margined) for BTC/ETH
          base_currency: String(i.base_currency ?? currency),
          quote_currency: String(i.quote_currency ?? 'USD'),
        }));
    },
    { allowStaleOnError: true },
  );
}

export async function registerDeribitMarketRoutes(fastify) {
  fastify.get('/api/deribit-market/instruments', async (request, reply) => {
    const currency = parseCurrency(request);
    if (!currency) {
      reply.code(400);
      return { error: 'currency must be BTC or ETH' };
    }
    try {
      const { data } = await loadInstruments(currency);
      return {
        currency,
        instruments: data,
        count: data.length,
        fetchedAt: Date.now(),
        source: 'deribit',
      };
    } catch (err) {
      reply.code(502);
      return { error: 'Deribit instruments failed', detail: err.message };
    }
  });

  fastify.get('/api/deribit-market/tickers', async (request, reply) => {
    const currency = parseCurrency(request);
    if (!currency) {
      reply.code(400);
      return { error: 'currency must be BTC or ETH' };
    }
    try {
      const { data } = await getOrFetch(
        `deribit-market:tickers:${currency}`,
        TICKERS_TTL_MS,
        async () => {
          const { data: instruments } = await loadInstruments(currency);
          const names = instruments.map((i) => i.instrument_name);
          const results = await Promise.all(
            names.map(async (name) => {
              try {
                return { name, ticker: await deribitFetch(`ticker?instrument_name=${name}`) };
              } catch {
                // A single dead instrument fails alone — the rest stay live.
                return { name, ticker: null };
              }
            }),
          );
          /** @type {Record<string, unknown>} */
          const tickers = {};
          for (const { name, ticker } of results) {
            if (!ticker) continue;
            const stats = ticker.stats ?? {};
            tickers[name] = {
              instrument_name: ticker.instrument_name ?? name,
              state: String(ticker.state ?? ''),
              mark_price: ticker.mark_price ?? null,
              index_price: ticker.index_price ?? null,
              last_price: ticker.last_price ?? null,
              best_bid_price: ticker.best_bid_price ?? null,
              best_ask_price: ticker.best_ask_price ?? null,
              // Reversed (coin-margined) contracts: OI is USD notional.
              open_interest: ticker.open_interest ?? null,
              volume: stats.volume ?? null, // base ccy (BTC/ETH), rolling 24h
              volume_usd: stats.volume_usd ?? null,
              // Deribit stats.price_change arrives already in PERCENT units.
              price_change_pct: stats.price_change ?? null,
              // Perpetuals only; undefined → null on dated futures.
              funding_8h: ticker.funding_8h ?? null,
              current_funding: ticker.current_funding ?? null,
            };
          }
          return { currency, tickers, count: Object.keys(tickers).length, fetchedAt: Date.now() };
        },
        { allowStaleOnError: true },
      );
      return data;
    } catch (err) {
      reply.code(502);
      return { error: 'Deribit tickers failed', detail: err.message };
    }
  });

  fastify.get('/api/deribit-market/index-price', async (request, reply) => {
    const currency = parseCurrency(request);
    if (!currency) {
      reply.code(400);
      return { error: 'currency must be BTC or ETH' };
    }
    try {
      const { data } = await getOrFetch(
        `deribit-market:index:${currency}`,
        INDEX_TTL_MS,
        async () => {
          const indexName = currency === 'BTC' ? 'btc_usd' : 'eth_usd';
          const result = await deribitFetch(`get_index_price?index_name=${indexName}`);
          return {
            currency,
            index_price: result.index_price,
            estimated_delivery_price: result.estimated_delivery_price,
            fetchedAt: Date.now(),
          };
        },
        { allowStaleOnError: true },
      );
      return data;
    } catch (err) {
      reply.code(502);
      return { error: 'Deribit index price failed', detail: err.message };
    }
  });

  fastify.get('/api/deribit-market/funding-history', async (request, reply) => {
    // Accept either ?instrument_name=BTC-PERPETUAL or ?currency=BTC (perp implied).
    let instrumentName = String(request.query.instrument_name || '').toUpperCase();
    let currency = parseCurrency(request);
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

    const requestedDays = Number(request.query.days ?? 7);
    const days = FUNDING_DAYS_ALLOWED.includes(requestedDays)
      ? requestedDays
      : requestedDays > FUNDING_DAYS_MAX
        ? FUNDING_DAYS_MAX
        : 7;

    try {
      const { data } = await getOrFetch(
        `deribit-market:funding-history:${instrumentName}:${days}`,
        FUNDING_HISTORY_TTL_MS,
        async () => {
          const end = Date.now();
          const start = end - days * 86_400_000;
          const result = await deribitFetch(
            `get_funding_rate_history?instrument_name=${instrumentName}&start_timestamp=${start}&end_timestamp=${end}`,
          );
          const rows = Array.isArray(result) ? result : [];
          // Live shape: hourly { timestamp, index_price, interest_8h, interest_1h, prev_index_price }.
          // interest_8h IS the realized 8h funding rate (decimal). Normalize + annualize (×3×365).
          const points = rows
            .map((r) => {
              const rate8h = Number(r?.interest_8h);
              if (!Number.isFinite(rate8h)) return null;
              const idxPrice = Number(r?.index_price);
              return {
                t: Number(r?.timestamp),
                rate8h,
                annualizedPct: rate8h * 3 * 365 * 100,
                indexPrice: Number.isFinite(idxPrice) ? idxPrice : null,
              };
            })
            .filter(Boolean)
            .sort((a, b) => a.t - b.t);
          const last = points.at(-1) ?? null;
          return {
            currency,
            instrument_name: instrumentName,
            days,
            points,
            latest: last ? { t: last.t, rate8h: last.rate8h, annualizedPct: last.annualizedPct } : null,
            count: points.length,
            fetchedAt: Date.now(),
            source: 'deribit',
          };
        },
        { allowStaleOnError: true },
      );
      return data;
    } catch (err) {
      reply.code(502);
      return { error: 'Deribit funding history failed', detail: err.message };
    }
  });
}
