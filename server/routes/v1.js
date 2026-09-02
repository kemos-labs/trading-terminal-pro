/**
 * Canonical versioned read API. Every response is sanitized into a strict
 * shared JSON Schema and validated immediately before Fastify serializes it.
 * Existing unversioned routes remain transitional provider-native adapters.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerEntitlements } from '../providers/entitlements.js';
import { getOptionChainSnapshot } from './equityFeeds.js';
import {
  getDeribitMarketSnapshotResult,
  getDeribitTradesSnapshotResult,
  getDeribitFundingSnapshotResult,
} from './deribitMarket.js';
import { registerV1AnalyticsRoutes } from './v1Analytics.js';
import { sanitizeProviderErrorCode } from '../../api/upstreamCache.js';
import {
  assertContract,
  createEnvelope,
  createErrorEnvelope,
  ContractValidationError,
} from '../../packages/contracts/src/runtime.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MONTHS = new Map([
  ['JAN', 0], ['FEB', 1], ['MAR', 2], ['APR', 3], ['MAY', 4], ['JUN', 5],
  ['JUL', 6], ['AUG', 7], ['SEP', 8], ['OCT', 9], ['NOV', 10], ['DEC', 11],
]);

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeOrNull(value) {
  const number = finiteOrNull(value);
  return number != null && number >= 0 ? number : null;
}

function positiveOrNull(value) {
  const number = finiteOrNull(value);
  return number != null && number > 0 ? number : null;
}

function integerOrNull(value) {
  const number = finiteOrNull(value);
  return number != null && number >= 0 ? Math.trunc(number) : null;
}

function ivOrNull(value) {
  let number = positiveOrNull(value);
  if (number != null && number > 10 && number <= 1_000) number /= 100;
  return number != null && number <= 10 ? number : null;
}

function isoDateOrNull(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function optionRight(value) {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === 'call' || normalized === 'c') return 'call';
  if (normalized === 'put' || normalized === 'p') return 'put';
  return null;
}

function parseDeribitOption(instrument) {
  const match = /^([A-Z]+)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:\.\d+)?)-([CP])$/i.exec(String(instrument));
  if (!match) return { right: null, expiry: null };
  const month = MONTHS.get(match[3].toUpperCase());
  if (month == null) return { right: null, expiry: null };
  const year = 2000 + Number(match[4]);
  const day = Number(match[2]);
  const date = new Date(Date.UTC(year, month, day));
  const expiry = Number.isFinite(date.getTime())
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month
    && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : null;
  return { right: match[6].toUpperCase() === 'C' ? 'call' : 'put', expiry };
}

function coverage(numerator, denominator, missing = []) {
  return {
    numerator,
    denominator,
    state: denominator > 0 && numerator === denominator
      ? 'complete'
      : numerator > 0 ? 'partial' : 'unavailable',
    missing: [...new Set(missing)],
  };
}

function freshnessFrom(fetchedAt, delayed = false) {
  const timestamp = new Date(fetchedAt).getTime();
  if (!Number.isFinite(timestamp)) return 'unavailable';
  const age = Date.now() - timestamp;
  if (age > 15 * 60_000) return 'stale';
  return delayed ? 'delayed' : 'live';
}

function sendError(request, reply, {
  statusCode = 502,
  code,
  message,
  retryable,
  provider,
}) {
  return reply.code(statusCode).send(createErrorEnvelope({
    requestId: request.id,
    code,
    message,
    retryable,
    provider,
  }));
}

function sendContract(request, reply, contractName, envelope) {
  try {
    assertContract(contractName, envelope);
    return reply.send(envelope);
  } catch (error) {
    request.log.error({
      contractName,
      validationErrors: error instanceof ContractValidationError ? error.validationErrors : undefined,
    }, 'v1 response contract validation failed');
    return sendError(request, reply, {
      statusCode: 500,
      code: 'INTERNAL_CONTRACT_ERROR',
      message: 'The server rejected an invalid response before serialization.',
      retryable: false,
    });
  }
}

function baseEnvelope(request, {
  asOf,
  fetchedAt,
  source,
  freshness,
  coverage: responseCoverage,
  cache = { state: 'unavailable', hit: false, ageMs: null, stale: false, coalesced: false, providerError: null },
  provenanceByField,
  unitsByField,
  assumptions,
  warnings,
  data,
}) {
  return createEnvelope({
    requestId: request.id,
    asOf,
    fetchedAt,
    source,
    freshness,
    coverage: responseCoverage,
    cache,
    provenanceByField,
    unitsByField,
    assumptions,
    warnings,
    data,
  });
}

function cacheEnvelope(result) {
  return {
    state: result.stale ? 'stale' : result.fromCache ? 'fresh' : 'miss',
    hit: Boolean(result.fromCache),
    ageMs: Number.isFinite(result.ageMs) ? Math.max(0, result.ageMs) : null,
    stale: Boolean(result.stale),
    coalesced: Boolean(result.coalesced),
    providerError: sanitizeProviderErrorCode(result.providerError),
  };
}

export function registerV1Routes(fastify) {
  registerV1AnalyticsRoutes(fastify, { sendContract, sendError, baseEnvelope, coverage });
  fastify.get('/api/v1/system/health', async (request, reply) => {
    const now = Date.now();
    const providerModes = providerEntitlements();
    const envelope = baseEnvelope(request, {
      asOf: now,
      fetchedAt: now,
      source: ['terminal-api'],
      freshness: 'live',
      coverage: coverage(1, 1),
      provenanceByField: { 'data.status': 'terminal-api', 'data.timestamp': 'terminal-api-clock' },
      unitsByField: { 'data.timestamp': 'unix-ms' },
      assumptions: [],
      warnings: ['VELO_UNVERIFIED: crypto multi-venue panels use labelled public exchange alternatives until a server-side capability and redistribution probe verifies Velo.'],
      data: { status: 'ok', timestamp: now, providerModes },
    });
    return sendContract(request, reply, 'healthResponse', envelope);
  });

  fastify.get('/api/v1/workflows', async (request, reply) => {
    const registry = JSON.parse(readFileSync(join(ROOT, 'packages/contracts/src/workflows.json'), 'utf8'));
    const now = Date.now();
    const envelope = baseEnvelope(request, {
      asOf: now,
      fetchedAt: now,
      source: ['workflow-registry'],
      freshness: 'live',
      coverage: coverage(registry.workflows.length, registry.workflows.length),
      provenanceByField: { data: 'packages/contracts/src/workflows.json' },
      unitsByField: {},
      assumptions: [],
      warnings: [],
      data: registry,
    });
    return sendContract(request, reply, 'workflowsResponse', envelope);
  });

  fastify.get('/api/v1/market/options/:symbol', async (request, reply) => {
    const symbol = String(request.params.symbol ?? '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,11}$/.test(symbol)) {
      return sendError(request, reply, {
        statusCode: 400,
        code: 'INVALID_SYMBOL',
        message: 'Symbol must contain 1–12 uppercase market-symbol characters.',
        retryable: false,
      });
    }
    let optionSnapshot;
    try {
      optionSnapshot = await getOptionChainSnapshot(symbol);
    } catch (error) {
      return sendError(request, reply, {
        statusCode: 502,
        code: error?.code === 'insufficient_coverage' ? 'INSUFFICIENT_COVERAGE' : 'PROVIDER_UNAVAILABLE',
        message: 'The delayed equity option chain is unavailable.',
        retryable: true,
        provider: 'yfinance',
      });
    }
    if (!optionSnapshot || !Array.isArray(optionSnapshot.quotes)) {
      return sendError(request, reply, {
        statusCode: 502,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'The delayed equity option chain is unavailable.',
        retryable: true,
        provider: 'yfinance',
      });
    }

    const legacy = { body: optionSnapshot };
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    let crossedMarkets = 0;
    const quotes = legacy.body.quotes.flatMap((quote) => {
      const strike = positiveOrNull(quote.strike);
      const expiry = isoDateOrNull(quote.expiry ?? quote.expiration);
      const right = optionRight(quote.type ?? quote.right ?? quote.optionType);
      if (strike == null || expiry == null || expiry < today || right == null) return [];
      const bid = nonNegativeOrNull(quote.bid);
      const ask = nonNegativeOrNull(quote.ask);
      if (bid != null && ask != null && bid > ask) crossedMarkets += 1;
      return [{
        strike,
        expiry,
        right,
        bid,
        ask,
        last: nonNegativeOrNull(quote.last ?? quote.lastPrice),
        markIv: ivOrNull(quote.impliedVolatility ?? quote.iv ?? quote.markIv),
        volume: nonNegativeOrNull(quote.volume),
        openInterest: nonNegativeOrNull(quote.openInterest ?? quote.open_interest),
      }];
    });
    if (quotes.length === 0) {
      return sendError(request, reply, {
        statusCode: 502,
        code: 'INSUFFICIENT_COVERAGE',
        message: 'The provider returned no valid, non-expired option contracts.',
        retryable: true,
        provider: 'yfinance',
      });
    }
    const expirations = [...new Set(quotes.map((quote) => quote.expiry))].sort();
    const fetchedAt = legacy.body.timestamp ?? now;
    const missing = [];
    if (quotes.length < legacy.body.quotes.length) missing.push('invalid-or-expired-contracts');
    const legacyCache = legacy.body._cache ?? {};
    const optionCache = {
      state: legacyCache.stale ? 'stale' : legacyCache.hit === true ? 'fresh' : 'miss',
      hit: legacyCache.hit === true,
      ageMs: Number.isFinite(legacyCache.ageMs) ? Math.max(0, legacyCache.ageMs) : null,
      stale: legacyCache.stale === true,
      coalesced: legacyCache.coalesced === true,
      providerError: sanitizeProviderErrorCode(legacyCache.providerError),
    };
    const envelope = baseEnvelope(request, {
      asOf: fetchedAt,
      fetchedAt,
      source: ['yfinance'],
      freshness: freshnessFrom(fetchedAt, true),
      coverage: coverage(quotes.length, legacy.body.quotes.length, missing),
      provenanceByField: {
        'data.spot': 'yfinance-underlying-print',
        'data.quotes': 'yfinance-option-chain',
      },
      unitsByField: {
        'data.spot': 'USD',
        'data.quotes[].strike': 'USD',
        'data.quotes[].bid': 'USD/share',
        'data.quotes[].ask': 'USD/share',
        'data.quotes[].markIv': 'decimal-volatility',
      },
      assumptions: ['Equity option data may be delayed; it is not executable OPRA data.'],
      warnings: crossedMarkets > 0 ? [`${crossedMarkets} crossed quote(s) preserved and flagged.`] : [],
      cache: optionCache,
      data: {
        symbol,
        spot: positiveOrNull(legacy.body.spot),
        expirations,
        quotes,
        count: quotes.length,
      },
    });
    return sendContract(request, reply, 'optionsResponse', envelope);
  });

  fastify.get('/api/v1/market/crypto/:currency', async (request, reply) => {
    const currency = String(request.params.currency ?? '').toUpperCase();
    if (currency !== 'BTC' && currency !== 'ETH') {
      return sendError(request, reply, {
        statusCode: 400,
        code: 'UNSUPPORTED_CURRENCY',
        message: 'Currency must be BTC or ETH.',
        retryable: false,
      });
    }
    let marketResult;
    try {
      marketResult = await getDeribitMarketSnapshotResult(currency);
    } catch {
      return sendError(request, reply, {
        statusCode: 502,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'The Deribit market snapshot is unavailable.',
        retryable: true,
        provider: 'deribit',
      });
    }
    const marketSnapshot = marketResult?.data;
    if (!marketSnapshot || !Array.isArray(marketSnapshot.instruments)) {
      return sendError(request, reply, {
        statusCode: 502,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'The Deribit market snapshot is unavailable.',
        retryable: true,
        provider: 'deribit',
      });
    }
    const legacy = { body: marketSnapshot };
    const now = Date.now();
    const instruments = legacy.body.instruments.flatMap((row) => {
      const kind = ['option', 'future', 'perp'].includes(row.kind) ? row.kind : null;
      const expiryMs = integerOrNull(row.expiryMs);
      if (!kind || ((kind === 'option' || kind === 'future') && (expiryMs == null || expiryMs <= now))) return [];
      const right = kind === 'option' ? optionRight(row.optionType) : null;
      if (kind === 'option' && right == null) return [];
      const bid = finiteOrNull(row.bidPrice);
      const ask = finiteOrNull(row.askPrice);
      const mark = finiteOrNull(row.markPrice);
      return [{
        instrument: String(row.instrument),
        baseCurrency: row.baseCurrency == null ? null : String(row.baseCurrency),
        quoteCurrency: row.quoteCurrency == null ? null : String(row.quoteCurrency),
        settlementCurrency: row.settlementCurrency == null ? null : String(row.settlementCurrency),
        contractSize: positiveOrNull(row.contractSize),
        settlementPeriod: row.settlementPeriod == null ? null : String(row.settlementPeriod),
        isInverse: Boolean(row.isInverse),
        kind,
        expiryMs,
        strike: kind === 'option' ? positiveOrNull(row.strike) : null,
        right,
        bid,
        ask,
        mark,
        last: finiteOrNull(row.lastPrice),
        bidIv: ivOrNull(row.bidIv),
        askIv: ivOrNull(row.askIv),
        markIv: ivOrNull(row.markIv),
        indexPrice: positiveOrNull(row.indexPrice ?? legacy.body.indexPrice),
        openInterest: nonNegativeOrNull(row.openInterest),
        volume: nonNegativeOrNull(row.volume),
        volumeUsd: nonNegativeOrNull(row.volumeUsd),
        funding8h: finiteOrNull(row.funding8h),
        timestamp: integerOrNull(row.timestamp),
        tradable: Boolean(row.hasQuote && (bid != null || ask != null || mark != null)),
      }];
    });
    if (instruments.length === 0) {
      return sendError(request, reply, {
        statusCode: 502,
        code: 'INSUFFICIENT_COVERAGE',
        message: 'Deribit returned no valid active instruments.',
        retryable: true,
        provider: 'deribit',
      });
    }
    const observed = instruments.filter((row) => row.tradable).length;
    const fetchedAt = legacy.body.fetchedAt ?? now;
    const missing = [];
    if (instruments.length < legacy.body.instruments.length) missing.push('invalid-or-expired-instruments');
    if (observed < instruments.length) missing.push('unquoted-instruments');
    const envelope = baseEnvelope(request, {
      asOf: fetchedAt,
      fetchedAt,
      source: ['deribit'],
      freshness: freshnessFrom(fetchedAt),
      coverage: coverage(observed, instruments.length, missing),
      cache: cacheEnvelope(marketResult),
      provenanceByField: {
        'data.indexPrice': 'deribit-get_index_price',
        'data.instruments': 'deribit-catalogue-joined-with-book-summary',
      },
      unitsByField: {
        'data.indexPrice': 'USD',
        'data.funding8h': 'decimal-per-8h',
        'data.instruments[].markIv': 'decimal-volatility',
        'data.instruments[].openInterest': 'venue-native-contracts',
      },
      assumptions: ['Deribit inverse-option premiums are venue-native BTC/ETH units.'],
      warnings: missing,
      data: {
        currency,
        indexPrice: positiveOrNull(legacy.body.indexPrice),
        funding8h: finiteOrNull(legacy.body.funding8h),
        instruments,
        count: instruments.length,
      },
    });
    return sendContract(request, reply, 'cryptoMarketResponse', envelope);
  });

  fastify.get('/api/v1/market/crypto/:currency/funding', {
    schema: {
      params: {
        type: 'object', additionalProperties: false, required: ['currency'],
        properties: { currency: { type: 'string', enum: ['BTC', 'ETH'] } },
      },
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          instrument_name: { type: 'string', pattern: '^(BTC|ETH)-PERPETUAL$' },
          days: { type: 'integer', enum: [1, 7, 30, 90] },
        },
      },
    },
  }, async (request, reply) => {
    const currency = String(request.params.currency ?? '').toUpperCase();
    if (currency !== 'BTC' && currency !== 'ETH') {
      return sendError(request, reply, {
        statusCode: 400,
        code: 'UNSUPPORTED_CURRENCY',
        message: 'Currency must be BTC or ETH.',
        retryable: false,
      });
    }
    const instrumentName = String(request.query?.instrument_name ?? `${currency}-PERPETUAL`).toUpperCase();
    if (instrumentName !== `${currency}-PERPETUAL`) {
      return sendError(request, reply, {
        statusCode: 400,
        code: 'INVALID_REQUEST',
        message: `instrument_name must be ${currency}-PERPETUAL.`,
        retryable: false,
      });
    }
    // Strict enum: an invalid days value is a typed 400 (schemas also reject at
    // the Fastify boundary), never a silent default.
    const requestedDays = Number(request.query?.days ?? 7);
    if (![1, 7, 30, 90].includes(requestedDays)) {
      return sendError(request, reply, {
        statusCode: 400,
        code: 'INVALID_REQUEST',
        message: 'days must be one of 1, 7, 30, 90.',
        retryable: false,
      });
    }
    const days = requestedDays;
    let fundingResult;
    try {
      fundingResult = await getDeribitFundingSnapshotResult(currency, instrumentName, days);
    } catch {
      return sendError(request, reply, {
        statusCode: 502,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Deribit funding history is unavailable.',
        retryable: true,
        provider: 'deribit',
      });
    }
    const fundingSnapshot = fundingResult?.data;
    if (!fundingSnapshot || !Array.isArray(fundingSnapshot.points)) {
      return sendError(request, reply, {
        statusCode: 502,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Deribit funding history is unavailable.',
        retryable: true,
        provider: 'deribit',
      });
    }
    const legacy = { body: fundingSnapshot };
    const points = legacy.body.points.flatMap((point) => {
      const timestamp = integerOrNull(point.t ?? point.timestamp);
      const rate8h = finiteOrNull(point.rate8h);
      if (timestamp == null || rate8h == null) return [];
      return [{
        timestamp,
        rate8h,
        annualizedPct: rate8h * 3 * 365 * 100,
        indexPrice: positiveOrNull(point.indexPrice),
      }];
    }).sort((left, right) => left.timestamp - right.timestamp);
    const fetchedAt = legacy.body.fetchedAt ?? Date.now();
    const missing = points.length < legacy.body.points.length ? ['invalid-funding-points'] : [];
    const envelope = baseEnvelope(request, {
      asOf: points.at(-1)?.timestamp ?? fetchedAt,
      fetchedAt,
      source: ['deribit'],
      freshness: freshnessFrom(fetchedAt),
      coverage: coverage(points.length, legacy.body.points.length, missing),
      cache: cacheEnvelope(fundingResult),
      provenanceByField: { 'data.points': 'deribit-get_funding_rate_history' },
      unitsByField: {
        'data.points[].rate8h': 'decimal-per-8h',
        'data.points[].annualizedPct': 'percent-simple-annualized-run-rate',
        'data.points[].indexPrice': 'USD',
      },
      assumptions: ['Annualized funding is rate8h × 3 × 365; it is a simple run-rate, not a yield.'],
      warnings: missing,
      data: {
        currency,
        instrumentName,
        days,
        points,
        latest: points.at(-1) ?? null,
        count: points.length,
      },
    });
    return sendContract(request, reply, 'cryptoFundingResponse', envelope);
  });

  fastify.get('/api/v1/market/crypto/:currency/trades', {
    schema: {
      params: {
        type: 'object', additionalProperties: false, required: ['currency'],
        properties: { currency: { type: 'string', enum: ['BTC', 'ETH'] } },
      },
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          hours: { type: 'integer', enum: [1, 4, 24] },
          count: { type: 'integer', minimum: 50, maximum: 1_000 },
        },
      },
    },
  }, async (request, reply) => {
    const currency = String(request.params.currency ?? '').toUpperCase();
    if (currency !== 'BTC' && currency !== 'ETH') {
      return sendError(request, reply, {
        statusCode: 400,
        code: 'UNSUPPORTED_CURRENCY',
        message: 'Currency must be BTC or ETH.',
        retryable: false,
      });
    }
    // Strict validation: invalid hours/count are typed 400s (schemas reject at
    // the Fastify boundary too), never silent clamping/defaulting.
    const requestedHours = Number(request.query?.hours ?? 24);
    if (![1, 4, 24].includes(requestedHours)) {
      return sendError(request, reply, {
        statusCode: 400,
        code: 'INVALID_REQUEST',
        message: 'hours must be one of 1, 4, 24.',
        retryable: false,
      });
    }
    const hours = requestedHours;
    const requestedCount = Number(request.query?.count ?? 500);
    if (!Number.isInteger(requestedCount) || requestedCount < 50 || requestedCount > 1_000) {
      return sendError(request, reply, {
        statusCode: 400,
        code: 'INVALID_REQUEST',
        message: 'count must be an integer in [50, 1000].',
        retryable: false,
      });
    }
    const count = requestedCount;
    let tradesResult;
    try {
      tradesResult = await getDeribitTradesSnapshotResult(currency, hours, count);
    } catch {
      return sendError(request, reply, {
        statusCode: 502,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'The Deribit option trade tape is unavailable.',
        retryable: true,
        provider: 'deribit',
      });
    }
    const tradesSnapshot = tradesResult?.data;
    if (!tradesSnapshot || !Array.isArray(tradesSnapshot.trades)) {
      return sendError(request, reply, {
        statusCode: 502,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'The Deribit option trade tape is unavailable.',
        retryable: true,
        provider: 'deribit',
      });
    }
    const legacy = { body: tradesSnapshot };
    const trades = legacy.body.trades.flatMap((trade) => {
      const instrument = String(trade.instrument ?? '');
      const parsed = parseDeribitOption(instrument);
      const timestamp = integerOrNull(trade.timestamp);
      const price = nonNegativeOrNull(trade.price);
      const quantity = positiveOrNull(trade.quantity);
      const side = trade.side === 'buy' || trade.side === 'sell' ? trade.side : null;
      if (!instrument || timestamp == null || price == null || quantity == null || side == null
        || parsed.right == null || parsed.expiry == null) return [];
      return [{
        instrument,
        timestamp,
        price,
        quantity,
        side,
        right: parsed.right,
        expiry: parsed.expiry,
        markIv: ivOrNull(trade.markIv),
        premiumNative: nonNegativeOrNull(trade.premiumNative),
        contractSize: positiveOrNull(trade.contractSize),
        nativeCurrency: currency,
        blockTrade: Boolean(trade.blockTrade),
        rfq: Boolean(trade.rfq),
      }];
    });
    const fetchedAt = legacy.body.fetchedAt ?? Date.now();
    const missing = trades.length < legacy.body.trades.length ? ['invalid-trades'] : [];
    const envelope = baseEnvelope(request, {
      asOf: fetchedAt,
      fetchedAt,
      source: ['deribit'],
      freshness: freshnessFrom(fetchedAt),
      coverage: coverage(trades.length, legacy.body.trades.length, missing),
      cache: cacheEnvelope(tradesResult),
      provenanceByField: { 'data.trades': 'deribit-get_last_trades_by_currency_and_time' },
      unitsByField: {
        'data.trades[].price': 'venue-native-premium-per-contract',
        'data.trades[].quantity': 'contracts',
        'data.trades[].markIv': 'decimal-volatility',
        'data.trades[].premiumNative': currency,
      },
      assumptions: ['Trade side is taker direction, not opening/closing or dealer identity.'],
      warnings: missing,
      data: {
        currency,
        trades,
        count: trades.length,
        hasMore: Boolean(legacy.body.hasMore),
      },
    });
    return sendContract(request, reply, 'cryptoTradesResponse', envelope);
  });
}
