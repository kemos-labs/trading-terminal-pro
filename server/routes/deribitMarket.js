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
import { getOrFetch, sanitizeProviderErrorCode } from '../../api/upstreamCache.js';

const CATALOGUE_TTL_MS = 5 * 60_000; // listings change ~daily
const QUOTES_TTL_MS = 20_000;
const TRADES_TTL_MS = 5_000;
const FUNDING_TTL_MS = 60_000;
const MAX_DERIBIT_STALE_MS = 5 * 60_000;

function parseCurrency(currency) {
  const c = String(currency || '').trim().toUpperCase();
  return c === 'BTC' || c === 'ETH' ? c : null;
}

/** Full sanitized cache envelope; identical shape to the other repaired adapters
 *  (top-level fromCache/ageMs/stale plus a nested `cache` object). */
function cacheFields(result) {
  const stale = Boolean(result?.stale);
  const hit = Boolean(result?.fromCache);
  const providerError = sanitizeProviderErrorCode(result?.providerError);
  const ageMs = Number.isFinite(result?.ageMs) ? Math.max(0, result.ageMs) : 0;
  return {
    fromCache: hit,
    ageMs,
    stale,
    cache: {
      state: providerError && stale ? 'stale' : stale ? 'stale' : hit ? 'fresh' : 'miss',
      hit,
      ageMs,
      stale,
      coalesced: Boolean(result?.coalesced),
      providerError,
    },
  };
}

/** Fail-closed sanitized error code; internal messages never cross the boundary. */
function safeErrorCode(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timeout';
  return sanitizeProviderErrorCode(err?.code) || 'upstream-error';
}

/** Validate Deribit index payload before caching or returning.
 *  Type-strict: index_price must be a finite positive number (numeric
 *  strings are rejected, never coerced); optional estimated_delivery_price
 *  must be a finite positive number when present. Malformed payloads throw
 *  invalid_payload so they are never cached. */
export function isValidDeribitIndexPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  if (typeof body.index_price !== 'number' || !Number.isFinite(body.index_price) || body.index_price <= 0) return false;
  if (body.estimated_delivery_price != null) {
    if (typeof body.estimated_delivery_price !== 'number' || !Number.isFinite(body.estimated_delivery_price) || body.estimated_delivery_price <= 0) return false;
  }
  return true;
}

function loadValidatedDeribitIndex(name) {
  return (async () => {
    const body = await deribitFetch(`get_index_price?index_name=${name}`);
    if (!isValidDeribitIndexPayload(body)) {
      throw Object.assign(new Error('Deribit index payload invalid'), { code: 'invalid_payload' });
    }
    return body;
  })();
}

/** Active catalogue: options + dated futures + perpetual (authoritative metadata). */
async function loadCatalogueResult(currency) {
  return getOrFetch(`deribit:catalogue:${currency}`, CATALOGUE_TTL_MS, async () => {
    const raw = await deribitFetch(`get_instruments?currency=${currency}&expired=false`);
    if (!Array.isArray(raw)) throw new Error('Deribit get_instruments: unexpected shape');
    return raw
      .filter((r) => r && r.instrument_name && r.is_active)
      .map(normalizeCatalogueEntry)
      .filter(Boolean);
  }, { allowStaleOnError: true, maxStaleMs: 24 * 60 * 60_000 });
}

async function loadCatalogue(currency) {
  return (await loadCatalogueResult(currency)).data;
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

async function loadDeribitMarketSnapshot(currency) {
  const catalogue = await loadCatalogue(currency);
  const quotes = await loadQuotes(currency);
  const { rows, coverage } = joinCatalogueWithQuotes(catalogue, quotes, Date.now());
  // A zero-coverage snapshot is not a valid snapshot: it must never be served
  // as success or cached. Throw so last-good stale / fail-closed semantics apply
  // and the current upstream failure state stays separate from last-good data.
  if (!(coverage > 0)) {
    throw Object.assign(new Error('no priced instruments'), { code: 'insufficient_coverage' });
  }
  const indexName = currency === 'BTC' ? 'btc_usd' : 'eth_usd';
  const index = await deribitFetch(`get_index_price?index_name=${indexName}`).catch(() => null);
  const perp = rows.find((row) => row.kind === 'perp');
  return {
    currency,
    indexPrice: index?.index_price ?? perp?.indexPrice ?? null,
    instruments: rows,
    coverage,
    funding8h: perp?.funding8h ?? null,
    fetchedAt: Date.now(),
    source: 'deribit',
  };
}

export async function getDeribitMarketSnapshotResult(currency) {
  return getOrFetch(
    `deribit:market:${currency}`,
    QUOTES_TTL_MS,
    () => loadDeribitMarketSnapshot(currency),
    {
      allowStaleOnError: true,
      maxStaleMs: MAX_DERIBIT_STALE_MS,
      cacheIf: (snapshot) => Number(snapshot?.coverage) > 0,
    },
  );
}

export async function getDeribitMarketSnapshot(currency) {
  return (await getDeribitMarketSnapshotResult(currency)).data;
}

async function loadDeribitTradesSnapshot(currency, hours = 24, count = 500) {
  const start = Date.now() - hours * 3_600_000;
  const result = await deribitFetch(
    `get_last_trades_by_currency_and_time?currency=${currency}&kind=option&start_timestamp=${start}&count=${count}&sorting=desc`,
  );
  const rawTrades = Array.isArray(result?.trades) ? result.trades : [];
  const catalogue = await loadCatalogue(currency);
  const sizeByInstrument = new Map(catalogue.map((contract) => [contract.instrument, contract]));
  const trades = rawTrades.map((trade) => normalizeTrade(trade, sizeByInstrument.get(String(trade.instrument_name))));
  return {
    currency,
    trades,
    count: trades.length,
    hasMore: Boolean(result?.has_more),
    fetchedAt: Date.now(),
    source: 'deribit',
  };
}

export async function getDeribitTradesSnapshotResult(currency, hours = 24, count = 500) {
  const normalizedCount = count <= 100 ? 100 : count <= 500 ? 500 : 1000;
  return getOrFetch(
    `deribit:trades:${currency}:${hours}:${normalizedCount}`,
    TRADES_TTL_MS,
    () => loadDeribitTradesSnapshot(currency, hours, normalizedCount),
    { allowStaleOnError: true, maxStaleMs: 60_000 },
  );
}

export async function getDeribitTradesSnapshot(currency, hours = 24, count = 500) {
  return (await getDeribitTradesSnapshotResult(currency, hours, count)).data;
}

async function loadDeribitFundingSnapshot(currency, instrumentName, days) {
  const end = Date.now();
  const start = end - days * 86_400_000;
  const result = await deribitFetch(
    `get_funding_rate_history?instrument_name=${instrumentName}&start_timestamp=${start}&end_timestamp=${end}`,
  );
  const rows = Array.isArray(result) ? result : [];
  const points = rows
    .map((row) => {
      const rate8h = Number(row?.interest_8h);
      if (!Number.isFinite(rate8h)) return null;
      const indexPrice = Number(row?.index_price);
      return {
        t: Number(row?.timestamp),
        rate8h,
        annualizedPct: rate8h * 3 * 365 * 100,
        indexPrice: Number.isFinite(indexPrice) ? indexPrice : null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.t - right.t);
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
}

export async function getDeribitFundingSnapshotResult(currency, instrumentName, days) {
  return getOrFetch(
    `deribit:funding:${currency}:${days}`,
    FUNDING_TTL_MS,
    () => loadDeribitFundingSnapshot(currency, instrumentName, days),
    { allowStaleOnError: true, maxStaleMs: MAX_DERIBIT_STALE_MS },
  );
}

export async function getDeribitFundingSnapshot(currency, instrumentName, days) {
  return (await getDeribitFundingSnapshotResult(currency, instrumentName, days)).data;
}

export async function registerDeribitMarketRoutes(fastify) {
  const markDeprecated = (reply, successor) => {
    reply.header('Deprecation', 'true');
    if (successor) reply.header('Link', `<${successor}>; rel="successor-version"`);
  };
  // Full normalized bundle — the single contract browser and server share.
  fastify.get('/api/deribit/market/:currency', async (request, reply) => {
    markDeprecated(reply, '/api/v1/market/crypto/{currency}');
    const currency = parseCurrency(request.params.currency);
    if (!currency) {
      reply.code(400);
      return { error: 'currency must be BTC or ETH' };
    }
    try {
      const result = await getDeribitMarketSnapshotResult(currency);
      return { ...result.data, ...cacheFields(result) };
    } catch (err) {
      reply.code(502);
      return { error: 'Deribit market bundle failed', detail: safeErrorCode(err) };
    }
  });

  fastify.get('/api/deribit/instruments', async (request, reply) => {
    markDeprecated(reply, '/api/v1/market/crypto/{currency}');
    const currency = parseCurrency(request.query.currency);
    if (!currency) {
      reply.code(400);
      return { error: 'currency must be BTC or ETH' };
    }
    try {
      const result = await loadCatalogueResult(currency);
      return { currency, instruments: result.data, fetchedAt: Date.now(), source: 'deribit', ...cacheFields(result) };
    } catch (err) {
      reply.code(502);
      return { error: 'Deribit instruments failed', detail: safeErrorCode(err) };
    }
  });

  fastify.get('/api/deribit/trades/:currency', async (request, reply) => {
    markDeprecated(reply, '/api/v1/market/crypto/{currency}/trades');
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
      const result = await getDeribitTradesSnapshotResult(currency, hours, count);
      return { ...result.data, ...cacheFields(result) };
    } catch (err) {
      reply.code(502);
      return { error: 'Deribit trades failed', detail: safeErrorCode(err) };
    }
  });

  fastify.get('/api/deribit/index/:name', async (request, reply) => {
    markDeprecated(reply);
    const name = String(request.params.name || '').toLowerCase();
    if (!/^(btc|eth)_usd$/.test(name)) {
      reply.code(400);
      return { error: 'Invalid index (use btc_usd or eth_usd)' };
    }
    try {
      const result = await getOrFetch(
        `deribit:index:${name}`,
        QUOTES_TTL_MS,
        () => loadValidatedDeribitIndex(name),
        {
          allowStaleOnError: true,
          maxStaleMs: MAX_DERIBIT_STALE_MS,
          cacheIf: (body) => isValidDeribitIndexPayload(body),
        },
      );
      return {
        index_price: result.data.index_price,
        estimated_delivery_price: result.data.estimated_delivery_price,
        timestamp: Date.now(),
        ...cacheFields(result),
      };
    } catch (err) {
      reply.code(502);
      return { error: 'Deribit index failed', detail: safeErrorCode(err) };
    }
  });

  fastify.get('/api/deribit/funding-history', async (request, reply) => {
    markDeprecated(reply, '/api/v1/market/crypto/{currency}/funding');
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
      const result = await getDeribitFundingSnapshotResult(currency, instrumentName, days);
      return { ...result.data, ...cacheFields(result) };
    } catch (err) {
      reply.code(502);
      return { error: 'Deribit funding history failed', detail: safeErrorCode(err) };
    }
  });
}
