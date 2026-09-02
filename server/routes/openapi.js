/**
 * OpenAPI 3.1 + workflow registry publication (Phase 11).
 * - GET /api/openapi.json — OpenAPI 3.1, JSON Schema 2020-12-compatible,
 *   additionalProperties:false, stable operationIds, typed errors.
 * - GET /api/workflows — canonical machine-readable desk/workflow registry.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

function loadRegistry() {
  const raw = readFileSync(join(ROOT, 'packages/contracts/src/workflows.json'), 'utf8');
  return JSON.parse(raw);
}

function loadV1Contracts() {
  const raw = readFileSync(join(ROOT, 'packages/contracts/src/v1-contracts.schema.json'), 'utf8');
  return JSON.parse(raw);
}

function openApiPath(runtimePath) {
  return runtimePath
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')
    .replace(/\*/g, '{wildcard}');
}

function generatedOperation(method, runtimePath) {
  const path = openApiPath(runtimePath);
  const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  const operationId = `legacy_${method.toLowerCase()}_${runtimePath}`
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return {
    operationId,
    tags: [runtimePath.startsWith('/docs') ? 'academy' : 'legacy'],
    summary: `Runtime-discovered legacy adapter: ${method} ${runtimePath}`,
    description: 'Deprecated provider-native or compatibility route. New consumers must use a validated /api/v1 operation where available.',
    deprecated: true,
    'x-legacy-adapter': true,
    ...(parameters.length > 0 ? { parameters } : {}),
    responses: {
      200: jsonOk({ type: 'object' }, 'Legacy adapter payload; shape is provider/route specific.'),
      default: { description: 'Legacy route error' },
    },
  };
}

function envelopeSchema(data) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'data'],
    properties: {
      schemaVersion: { type: 'integer', const: 1 },
      requestId: { type: 'string' },
      symbol: { type: 'string' },
      asOf: { type: 'string', format: 'date-time' },
      fetchedAt: { type: 'string', format: 'date-time' },
      source: { type: 'array', items: { type: 'string' } },
      provenanceByField: { type: 'object', additionalProperties: { type: 'string' } },
      unitsByField: { type: 'object', additionalProperties: { type: 'string' } },
      freshness: { type: 'string', enum: ['live', 'delayed', 'stale', 'unavailable'] },
      coverage: {
        type: 'object',
        additionalProperties: false,
        properties: {
          numerator: { type: 'integer' },
          denominator: { type: 'integer' },
          state: { type: 'string' },
          missing: { type: 'array', items: { type: 'string' } },
        },
      },
      assumptions: { type: 'array', items: { type: 'string' } },
      warnings: { type: 'array', items: { type: 'string' } },
      data,
    },
  };
}

const errorResponse = {
  description: 'Typed error envelope',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['error'],
        properties: {
          error: {
            type: 'string',
            enum: [
              'PROVIDER_UNAVAILABLE', 'ENTITLEMENT_MISSING', 'STALE_ONLY',
              'INSUFFICIENT_COVERAGE', 'INVALID_SYMBOL', 'UNSUPPORTED_CURRENCY', 'FREE_CRYPTO_UNAVAILABLE', 'RATE_LIMITED',
              'no_api_key', 'budget_exhausted',
            ],
          },
          detail: { type: 'string' },
          provider: { type: 'string' },
        },
      },
    },
  },
};

function jsonOk(schema, description) {
  return { description, content: { 'application/json': { schema } } };
}

function typedErrorResponse(code, description) {
  return { description, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['error'], properties: { error: { type: 'string', const: code }, detail: { type: 'string' } } } } } };
}

const finnhubCacheSchema = {
  type: 'object', additionalProperties: false,
  required: ['state', 'hit', 'ageMs', 'stale', 'coalesced', 'providerError'],
  properties: {
    state: { type: 'string', enum: ['miss', 'fresh', 'stale', 'unavailable'] },
    hit: { type: 'boolean' }, ageMs: { type: 'number', minimum: 0 }, stale: { type: 'boolean' },
    coalesced: { type: 'boolean' }, providerError: { type: ['string', 'null'] },
  },
};
const finnhubLegacySchema = (properties, required = []) => ({
  type: 'object', additionalProperties: false,
  required: [...required, 'cache'],
  properties: { ...properties, fromCache: { type: 'boolean' }, ageMs: { type: 'number', minimum: 0 }, cache: finnhubCacheSchema },
});

const symbolParam = (summary = 'Observed equity chain (yfinance, delayed)') => ({
  name: 'symbol',
  in: 'path',
  required: true,
  schema: { type: 'string', pattern: '^[A-Z][A-Z0-9.-]{0,11}$' },
  description: summary,
});
const currencyParam = {
  name: 'currency',
  in: 'path',
  required: true,
  schema: { type: 'string', enum: ['BTC', 'ETH'] },
};

export function buildOpenApiDocument(registry, runtimeRoutes = []) {
  const r = registry || loadRegistry();
  const document = {
    openapi: '3.1.0',
    info: {
      title: 'Terminal REST API',
      version: '1.0.0',
      description: 'Read-only market analytics. Canonical /api/v1 responses use strict validated envelopes. Unversioned routes are documented as deprecated compatibility/provider-native adapters. Provider keys never leave the server.',
    },
    servers: [{ url: '/', description: 'This server' }],
    tags: [
      { name: 'v1', description: 'Canonical, strict, runtime-validated contracts' },
      { name: 'legacy', description: 'Deprecated compatibility and provider-native adapters' },
      { name: 'system', description: 'Health, cache, workflows' },
      { name: 'equities', description: 'Option chains, quotes, enrichment' },
      { name: 'crypto', description: 'Deribit authoritative + free multi-venue snapshot' },
      { name: 'ksa', description: 'Tadawul board' },
      { name: 'academy', description: 'Publication index' },
    ],
    'x-workflows': r.workflows,
    components: {
      schemas: {
        V1Contracts: loadV1Contracts(),
      },
    },
    paths: {
      '/api/v1/system/health': {
        get: {
          operationId: 'v1GetHealth', tags: ['v1', 'system'], summary: 'Canonical liveness envelope',
          responses: { 200: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/healthResponse' }, 'Validated health envelope') },
        },
      },
      '/api/v1/workflows': {
        get: {
          operationId: 'v1GetWorkflows', tags: ['v1', 'system'], summary: 'Canonical desk and workflow registry envelope',
          responses: { 200: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/workflowsResponse' }, 'Validated workflow envelope') },
        },
      },
      '/api/v1/market/options/{symbol}': {
        get: {
          operationId: 'v1GetOptionsChain', tags: ['v1', 'equities'], summary: 'Sanitized delayed equity option chain',
          parameters: [symbolParam()],
          responses: {
            200: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/optionsResponse' }, 'Validated option-chain envelope'),
            400: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/errorResponse' }, 'Typed request error'),
            502: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/errorResponse' }, 'Typed provider/coverage error'),
          },
        },
      },
      '/api/v1/market/crypto/{currency}': {
        get: {
          operationId: 'v1GetCryptoMarket', tags: ['v1', 'crypto'], summary: 'Sanitized active Deribit catalogue/quote snapshot',
          parameters: [currencyParam],
          responses: {
            200: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/cryptoMarketResponse' }, 'Validated crypto market envelope'),
            400: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/errorResponse' }, 'Typed request error'),
            502: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/errorResponse' }, 'Typed provider/coverage error'),
          },
        },
      },
      '/api/v1/market/crypto/{currency}/funding': {
        get: {
          operationId: 'v1GetCryptoFunding', tags: ['v1', 'crypto'], summary: 'Validated 8h funding history and labelled simple annualization',
          parameters: [currencyParam, { name: 'days', in: 'query', schema: { type: 'integer', enum: [1, 7, 30, 90] } }],
          responses: {
            200: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/cryptoFundingResponse' }, 'Validated funding envelope'),
            400: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/errorResponse' }, 'Typed request error'),
            502: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/errorResponse' }, 'Typed provider error'),
          },
        },
      },
      '/api/v1/market/crypto/{currency}/trades': {
        get: {
          operationId: 'v1GetCryptoTrades', tags: ['v1', 'crypto'], summary: 'Validated Deribit option tape with parsed right and expiry',
          parameters: [currencyParam, { name: 'hours', in: 'query', schema: { type: 'integer', enum: [1, 4, 24] } }, { name: 'count', in: 'query', schema: { type: 'integer', minimum: 50, maximum: 1000 } }],
          responses: {
            200: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/cryptoTradesResponse' }, 'Validated option-trade envelope'),
            400: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/errorResponse' }, 'Typed request error'),
            502: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/errorResponse' }, 'Typed provider error'),
          },
        },
      },
      '/api/v1/analytics/volatility-surface/{symbol}': {
        get: {
          operationId: 'v1GetVolatilitySurface', tags: ['v1', 'equities', 'crypto'], summary: 'Observed option IV nodes with explicit model-layer availability',
          parameters: [symbolParam(), { name: 'maxRows', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 5_000 } }],
          responses: {
            200: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/volatilitySurfaceResponse' }, 'Validated observed volatility surface envelope'),
            400: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/errorResponse' }, 'Typed request error'),
            502: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/errorResponse' }, 'Typed provider/coverage error'),
          },
        },
      },
      '/api/v1/analytics/greeks/{symbol}': {
        get: {
          operationId: 'v1GetGreeks', tags: ['v1', 'equities', 'crypto'], summary: 'BSM Greeks from observed venue mark IV and explicit rates',
          parameters: [
            symbolParam(),
            { name: 'riskFreeRate', in: 'query', description: 'Decimal annual rate; supply together with carryRate. No default.', schema: { type: 'number', minimum: -0.25, maximum: 1 } },
            { name: 'carryRate', in: 'query', description: 'Decimal annual dividend/carry rate; supply together with riskFreeRate. No default.', schema: { type: 'number', minimum: -0.25, maximum: 1 } },
            { name: 'maxRows', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 5_000 } },
          ],
          responses: {
            200: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/greeksResponse' }, 'Validated Greeks envelope'),
            400: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/errorResponse' }, 'Typed request error'),
            502: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/errorResponse' }, 'Typed provider/coverage error'),
          },
        },
      },
      '/api/v1/analytics/positioning/{symbol}': {
        get: {
          operationId: 'v1GetPositioning', tags: ['v1', 'equities', 'crypto'], summary: 'OI-weighted customer-long exposure proxy; never dealer inventory',
          parameters: [
            symbolParam(),
            { name: 'riskFreeRate', in: 'query', description: 'Decimal annual rate; supply together with carryRate. No default.', schema: { type: 'number', minimum: -0.25, maximum: 1 } },
            { name: 'carryRate', in: 'query', description: 'Decimal annual dividend/carry rate; supply together with riskFreeRate. No default.', schema: { type: 'number', minimum: -0.25, maximum: 1 } },
            { name: 'maxRows', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 5_000 } },
          ],
          responses: {
            200: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/positioningResponse' }, 'Validated positioning-proxy envelope'),
            400: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/errorResponse' }, 'Typed request error'),
            502: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/errorResponse' }, 'Typed provider/coverage error'),
          },
        },
      },
      '/api/v1/provider/status': { get: { operationId: 'v1GetProviderStatus', tags: ['v1', 'system'], summary: 'Provider entitlement and cache status', responses: { 200: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/providerStatusResponse' }, 'Validated provider status envelope') } } },
      '/api/v1/rates/stir': { get: { operationId: 'v1GetRatesStir', tags: ['v1', 'rates'], summary: 'STIR/SR3/SR1/ZQ strip and exact SERFF analytics', responses: { 200: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/ratesStirResponse' }, 'Validated STIR envelope') } } },
      '/api/v1/rates/term-structure': { get: { operationId: 'v1GetRatesTermStructure', tags: ['v1', 'rates'], summary: 'Nullable Treasury/SOFR term structure', parameters: [{ name: 'T', in: 'query', schema: { type: 'number', minimum: 0.01, maximum: 40 } }], responses: { 200: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/ratesTermStructureResponse' }, 'Validated term structure envelope') } } },
      '/api/v1/crypto/carry/{currency}': { get: { operationId: 'v1GetCryptoCarry', tags: ['v1', 'crypto'], summary: 'Funding, perpetual premium, and dated-future basis', parameters: [currencyParam], responses: { 200: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/cryptoCarryResponse' }, 'Validated carry envelope') } } },
      '/api/v1/crypto/flow/{currency}': { get: { operationId: 'v1GetCryptoFlow', tags: ['v1', 'crypto'], summary: 'Deribit option flow aggregates', parameters: [currencyParam], responses: { 200: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/cryptoFlowResponse' }, 'Validated flow envelope') } } },
      '/api/v1/academy/index': { get: { operationId: 'v1GetAcademyIndex', tags: ['v1', 'academy'], summary: 'Academy catalog index', responses: { 200: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/academyIndexResponse' }, 'Validated Academy index envelope') } } },
      '/api/v1/ksa/board': { get: { operationId: 'v1GetKsaBoard', tags: ['v1', 'ksa'], summary: 'Entitlement-gated KSA board', responses: { 200: jsonOk({ $ref: '#/components/schemas/V1Contracts/$defs/ksaBoardResponse' }, 'Validated KSA envelope') } } },
      '/api/health': {
        get: {
          operationId: 'getHealth', tags: ['system'], summary: 'Liveness',
          responses: { 200: jsonOk({ type: 'object', additionalProperties: false, required: ['status'], properties: { status: { const: 'ok' }, timestamp: { type: 'number' } } }, 'ok') },
        },
      },
      '/api/cache/status': {
        get: {
          operationId: 'getCacheStatus', tags: ['system'],
          summary: 'Provider budgets + cache stats (no credentials, no query history)',
          responses: { 200: jsonOk({ type: 'object' }, 'budgets/entries') },
        },
      },
      '/api/workflows': {
        get: {
          operationId: 'getWorkflows', tags: ['system'],
          summary: 'Machine-readable workflow registry (desks, deep links, related ops/tools)',
          responses: { 200: jsonOk({ type: 'object', additionalProperties: false, required: ['workflows'], properties: { workflows: { type: 'array', items: { type: 'object' } } } }, 'registry') },
        },
      },
      '/api/options/{symbol}': {
        get: {
          operationId: 'getOptionsChain', tags: ['equities'],
          summary: symbolParam().description,
          parameters: [symbolParam(), { name: 'probe', in: 'query', schema: { type: 'string', enum: ['1'] } }, { name: 'max', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 12 } }],
          responses: {
            200: jsonOk(envelopeSchema({ type: 'object', additionalProperties: false, required: ['symbol', 'spot', 'quotes'], properties: { symbol: { type: 'string' }, spot: { type: 'number' }, quotes: { type: 'array', items: { type: 'object' } }, _cache: { type: 'object' } } }), 'chain (observed; missing null)'),
            400: errorResponse, 502: errorResponse,
          },
        },
      },
      '/api/yf/history/{symbol}': {
        get: {
          operationId: 'getEquityHistory', tags: ['equities'], summary: 'Daily OHLCV (yfinance, delayed)',
          parameters: [symbolParam()], responses: { 200: jsonOk({ type: 'object' }, 'bars'), 502: errorResponse },
        },
      },
      '/api/yf/info/{symbol}': {
        get: {
          operationId: 'getEquityInfo', tags: ['equities'], summary: 'Profile + observed last print (yfinance)',
          parameters: [symbolParam()], responses: { 200: jsonOk({ type: 'object' }, 'info'), 502: errorResponse },
        },
      },
      '/api/finnhub/quote': {
        get: {
          operationId: 'getEquityQuote', tags: ['equities'], summary: 'Quote (Finnhub, shared budget)',
          parameters: [{ name: 'symbol', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { 200: jsonOk({ type: 'object' }, 'quote'), 429: errorResponse, 502: errorResponse, 503: errorResponse },
        },
      },
      '/api/finnhub/news': {
        get: {
          operationId: 'getEquityNews', tags: ['equities'], summary: 'Company + general headlines (Finnhub)',
          parameters: [{ name: 'symbol', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 30 } }],
          responses: { 200: jsonOk(finnhubLegacySchema({ symbol: { type: 'string' }, items: { type: 'array' }, count: { type: 'integer' }, as_of: { type: 'string' }, source: { type: 'string' }, note: { type: 'string' }, error: { type: ['string', 'null'] }, warnings: { type: 'array', items: { type: 'string' } }, coverage: { type: 'object', additionalProperties: false, required: ['company', 'general'], properties: { company: { type: 'string', enum: ['available', 'unavailable'] }, general: { type: 'string', enum: ['available', 'unavailable'] } } } }, ['symbol', 'items', 'count', 'cache']), 'headlines with cache metadata'), 429: errorResponse, 502: errorResponse, 503: errorResponse },
        },
      },
      '/api/finnhub/earnings': {
        get: {
          operationId: 'getFinnhubEarnings', tags: ['equities'], summary: 'Earnings calendar (Finnhub, shared cache)',
          parameters: [{ name: 'symbol', in: 'query', schema: { type: 'string', pattern: '^[A-Z][A-Z0-9.-]{0,11}$' } }],
          responses: {
            200: jsonOk(finnhubLegacySchema({ symbol: { type: 'string' }, next: { type: ['object', 'null'] }, upcoming: { type: 'array' }, recent: { type: 'array' }, as_of: { type: 'string' }, source: { type: 'string' }, error: { type: ['string', 'null'] }, note: { type: 'string' } }, ['symbol', 'next', 'upcoming', 'recent', 'cache']), 'Earnings with cache metadata'),
            429: errorResponse, 502: errorResponse, 503: errorResponse,
          },
        },
      },
      '/api/finnhub/economic-calendar': {
        get: {
          operationId: 'getFinnhubEconomicCalendar', tags: ['equities'], summary: 'Economic calendar (Finnhub, shared cache)',
          parameters: [{ name: 'from', in: 'query', schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }, { name: 'to', in: 'query', schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }],
          responses: { 200: jsonOk(finnhubLegacySchema({ from: { type: 'string' }, to: { type: 'string' }, events: { type: 'array' }, count: { type: 'integer' }, as_of: { type: 'string' }, source: { type: 'string' }, error: { type: ['string', 'null'] }, note: { type: 'string' } }, ['from', 'to', 'events', 'cache']), 'Economic calendar with cache metadata'), 400: errorResponse, 429: errorResponse, 502: errorResponse, 503: errorResponse },
        },
      },
      '/api/finnhub/recommendation': {
        get: {
          operationId: 'getFinnhubRecommendation', tags: ['equities'], summary: 'Analyst recommendation (Finnhub, shared cache)',
          parameters: [{ name: 'symbol', in: 'query', schema: { type: 'string', pattern: '^[A-Z][A-Z0-9.-]{0,11}$' } }],
          responses: { 200: jsonOk(finnhubLegacySchema({ symbol: { type: 'string' }, latest: { type: ['object', 'null'] }, history_count: { type: 'integer' }, as_of: { type: 'string' }, source: { type: 'string' }, error: { type: ['string', 'null'] } }, ['symbol', 'latest', 'cache']), 'Recommendation with cache metadata'), 429: errorResponse, 502: errorResponse, 503: errorResponse },
        },
      },
      '/api/finnhub/peers': {
        get: {
          operationId: 'getFinnhubPeers', tags: ['equities'], summary: 'Peer symbols (Finnhub, shared cache)',
          parameters: [{ name: 'symbol', in: 'query', schema: { type: 'string', pattern: '^[A-Z][A-Z0-9.-]{0,11}$' } }],
          responses: { 200: jsonOk(finnhubLegacySchema({ symbol: { type: 'string' }, peers: { type: 'array', items: { type: 'string' } }, count: { type: 'integer' }, as_of: { type: 'string' }, source: { type: 'string' }, error: { type: ['string', 'null'] } }, ['symbol', 'peers', 'cache']), 'Peers with cache metadata'), 429: errorResponse, 502: errorResponse, 503: errorResponse },
        },
      },
      '/api/desk/pack': {
        get: {
          operationId: 'getDeskPack', tags: ['equities'], summary: 'Shared desk pack (one canonical snapshot)',
          parameters: [{ name: 'symbol', in: 'query', schema: { type: 'string' } }],
          responses: { 200: jsonOk({ type: 'object' }, 'pack') },
        },
      },
      '/api/home/briefing': {
        get: {
          operationId: 'getHomeBriefing', tags: ['system'], summary: 'Home morning briefing — per-desk availability',
          parameters: [{ name: 'symbol', in: 'query', schema: { type: 'string' } }],
          responses: { 200: jsonOk({ type: 'object' }, 'briefing') },
        },
      },
      '/api/deribit/market/{currency}': {
        get: {
          operationId: 'getDeribitMarket', tags: ['crypto'], summary: 'Deribit catalogue/quote join',
          parameters: [currencyParam],
          responses: { 200: jsonOk({ type: 'object' }, 'bundle'), 400: errorResponse, 502: errorResponse },
        },
      },
      '/api/deribit/trades/{currency}': {
        get: {
          operationId: 'getDeribitTrades', tags: ['crypto'], summary: 'Recent public option trades (taker side)',
          parameters: [currencyParam, { name: 'hours', in: 'query', schema: { type: 'integer' } }, { name: 'count', in: 'query', schema: { type: 'integer' } }],
          responses: { 200: jsonOk({ type: 'object' }, 'trades'), 400: errorResponse },
        },
      },
      '/api/deribit/funding-history': {
        get: {
          operationId: 'getDeribitFundingHistory', tags: ['crypto'], summary: 'Perp funding history',
          parameters: [{ name: 'currency', in: 'query', schema: { type: 'string', enum: ['BTC', 'ETH'] } }, { name: 'days', in: 'query', schema: { type: 'integer', enum: [1, 7, 30, 90] } }],
          responses: { 200: jsonOk({ type: 'object' }, 'funding points'), 400: errorResponse },
        },
      },
      '/api/free-crypto/market/{currency}': {
        get: {
          operationId: 'getFreeCryptoSnapshot', tags: ['crypto'],
          summary: 'Free multi-venue snapshot — public exchange data; free alternative to Velo, not Velo-normalized',
          parameters: [{ ...currencyParam, schema: { type: 'string', enum: ['BTC', 'ETH'] } }],
          responses: {
            200: jsonOk({ type: 'object', additionalProperties: false, required: ['currency', 'symbol', 'venues', 'fetchedAt', 'source', 'note'], properties: {
              currency: { type: 'string', enum: ['BTC', 'ETH'] }, symbol: { type: 'string' },
              venues: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['venue', 'symbol', 'last', 'mark', 'index', 'funding8h', 'openInterest', 'volume24hUsd', 'change24hPct', 'fetchedAt'], properties: {
                venue: { type: 'string', enum: ['Binance Futures', 'Bybit Linear'] }, symbol: { type: 'string' },
                last: { type: ['number', 'null'], exclusiveMinimum: 0 }, mark: { type: ['number', 'null'], exclusiveMinimum: 0 }, index: { type: ['number', 'null'], exclusiveMinimum: 0 }, funding8h: { type: ['number', 'null'] }, openInterest: { type: ['number', 'null'], minimum: 0 }, volume24hUsd: { type: ['number', 'null'], minimum: 0 }, change24hPct: { type: ['number', 'null'] }, fetchedAt: { type: 'integer' },
              } } },
              fetchedAt: { type: 'integer' }, source: { type: 'string', const: 'free-exchanges' }, note: { type: 'string' },
            } }, 'snapshot'),
            400: typedErrorResponse('UNSUPPORTED_CURRENCY', 'Unsupported currency'),
            502: typedErrorResponse('FREE_CRYPTO_UNAVAILABLE', 'Free crypto providers unavailable'),
          },
        },
      },
      '/api/venues/options/{currency}': {
        get: {
          operationId: 'getVenueOptions', tags: ['crypto'], summary: 'Multi-venue options volume/OI (Deribit+OKX+Bybit, public)',
          parameters: [currencyParam],
          responses: {
            200: jsonOk({
              type: 'object', additionalProperties: false,
              required: ['currency', 'source', 'venues', 'fetchedAt', 'cache'],
              properties: {
                currency: { type: 'string', enum: ['BTC', 'ETH'] },
                source: { type: 'string', const: 'public-options-aggregates' },
                fetchedAt: { type: 'integer', minimum: 0 },
                cache: { $ref: '#/components/schemas/V1Contracts/$defs/cacheState' },
                venues: { type: 'array', minItems: 1, uniqueItems: true, items: {
                  type: 'object', additionalProperties: false,
                  required: ['venue', 'source', 'instruments', 'volume24hBaseCcy', 'volume24hNative', 'volume24hUsd', 'openInterestBaseCcy', 'openInterestNative', 'units', 'fetchedAt', 'cache'],
                  properties: {
                    venue: { type: 'string', enum: ['Deribit', 'OKX', 'Bybit'] },
                    source: { type: 'string', enum: ['deribit-public', 'okx-public', 'bybit-public'] },
                    instruments: { type: 'integer', minimum: 1 },
                    volume24hBaseCcy: { type: ['number', 'null'], minimum: 0 },
                    volume24hNative: { type: ['number', 'null'], minimum: 0 },
                    volume24hUsd: { type: ['number', 'null'], minimum: 0 },
                    openInterestBaseCcy: { type: ['number', 'null'], minimum: 0 },
                    openInterestNative: { type: ['number', 'null'], minimum: 0 },
                    units: { type: 'object', additionalProperties: false, required: ['volume24hBaseCcy', 'volume24hNative', 'volume24hUsd', 'openInterestBaseCcy', 'openInterestNative'], properties: {
                      volume24hBaseCcy: { type: ['string', 'null'] }, volume24hNative: { type: ['string', 'null'] }, volume24hUsd: { type: ['string', 'null'] },
                      openInterestBaseCcy: { type: ['string', 'null'] }, openInterestNative: { type: ['string', 'null'] },
                    } },
                    fetchedAt: { type: 'integer', minimum: 0 },
                    cache: { $ref: '#/components/schemas/V1Contracts/$defs/cacheState' },
                  },
                } },
              },
            }, 'venues'),
            400: jsonOk({ type: 'object', additionalProperties: false, required: ['error'], properties: { error: { type: 'string', enum: ['UNSUPPORTED_CURRENCY', 'UNSUPPORTED_QUERY'] }, detail: { type: 'string' } } }, 'Invalid currency or unsupported query parameters'),
            502: typedErrorResponse('OPTIONS_VENUES_UNAVAILABLE', 'Options venues unavailable'),
          },
        },
      },
      '/api/ksa/board': {
        get: {
          operationId: 'getKsaBoard', tags: ['ksa'], summary: 'Shared Tadawul board (SAHMK server-only; delayed on free tier)',
          responses: { 200: jsonOk({ type: 'object' }, 'board'), 402: errorResponse, 502: errorResponse, 503: errorResponse },
        },
      },
      '/api/ksa/session': {
        get: {
          operationId: 'getKsaSession', tags: ['ksa'], summary: 'Riyadh session snapshot',
          responses: { 200: jsonOk({ type: 'object' }, 'session') },
        },
      },
      '/docs/index.json': {
        get: {
          operationId: 'getAcademyIndex', tags: ['academy'], summary: 'Academy publication index',
          responses: { 200: jsonOk({ type: 'object' }, 'index') },
        },
      },
      '/api/openapi.json': {
        get: {
          operationId: 'getOpenApiDocument', tags: ['system'], summary: 'This document',
          responses: { 200: jsonOk({ type: 'object' }, 'openapi') },
        },
      },
    },
  };

  for (const pathItem of Object.values(document.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      if (!operation.tags?.includes('v1') && !operation['x-legacy-adapter']) {
        operation.deprecated = true;
        operation['x-legacy-adapter'] = true;
        operation.description = `${operation.description ? `${operation.description} ` : ''}Deprecated compatibility route; migrate to /api/v1 where available.`;
      }
    }
  }

  for (const route of runtimeRoutes) {
    if (!String(route.url).startsWith('/api') && !String(route.url).startsWith('/docs')) continue;
    const method = String(route.method).toLowerCase();
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    const path = openApiPath(String(route.url));
    document.paths[path] ??= {};
    document.paths[path][method] ??= generatedOperation(String(route.method), String(route.url));
  }

  return document;
}

export function registerOpenApiRoutes(fastify) {
  fastify.get('/api/workflows', async () => loadRegistry());
  fastify.get('/api/openapi.json', async (_req, reply) => {
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('cache-control', 'public, max-age=300');
    return buildOpenApiDocument(undefined, fastify.runtimeRouteManifest);
  });
}
