/**
 * Canonical v1 analytical operations (C2).
 *
 * Every operation composes one domain service through the shared cache
 * (api/upstreamCache.getOrFetch) and validates its serialized response against
 * the shared JSON Schema authority (packages/contracts). No direct uncached
 * provider calls; no raw provider payloads leak into the contract.
 */
import { providerEntitlements } from '../providers/entitlements.js';
import { cacheStats, getOrFetch, sanitizeProviderErrorCode } from '../../api/upstreamCache.js';
import { providerCircuitStatuses } from '../../api/providerCircuitBreaker.js';
import { resolveRatesWorkerUrl } from '../ratesWorkerUrl.js';
import {
  getDeribitFundingSnapshotResult,
  getDeribitMarketSnapshotResult,
  getDeribitTradesSnapshotResult,
} from './deribitMarket.js';
import { fetchFreeCryptoMarketResult } from '../providers/freeCrypto/client.js';
import { buildAcademyIndex } from '../../api/academyCatalog.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateInfoForRequest } from '../../api/stripeBilling.js';
import {
  buildForwardVolMatrix,
  buildGreeks,
  buildPositioning,
  buildVolatilitySurface,
} from '../services/optionsAnalytics.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DOCS_ROOT = join(ROOT, 'docs');

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

// ── REF-08/N3c policy-scenario body validation (before any worker call) ──
const POLICY_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function policyDateOrNull(value) {
  if (typeof value !== 'string') return null;
  const match = POLICY_DATE_RE.exec(value);
  if (!match) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
function policyFinite(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
function validatePolicyScenarioBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Request body must be a JSON object.';
  const TOP_KEYS = new Set(['fixings', 'meetings', 'sr3', 'sr1', 'policySpreadBps', 'deriveStepFromMidpoint']);
  for (const key of Object.keys(body)) {
    if (!TOP_KEYS.has(key)) return `Unknown top-level property '${key}': request keys are fixings, meetings, sr3, sr1, policySpreadBps, deriveStepFromMidpoint.`;
  }
  const FIXING_KEYS = new Set(['date', 'value']);
  const MEETING_KEYS = new Set(['date', 'stepBps', 'targetLower', 'targetUpper']);
  const WINDOW_KEYS = new Set(['windowStart', 'windowEnd', 'currentRate', 'currentSource', 'currentDate']);
  const { fixings, meetings, sr3, sr1, policySpreadBps, deriveStepFromMidpoint } = body;
  if (!Array.isArray(fixings) || fixings.length < 1 || fixings.length > 500) {
    return 'fixings must be an array of 1 to 500 {date, value} rows.';
  }
  for (const row of fixings) {
    if (!row || typeof row !== 'object') return 'Each fixing must be an object with date and value.';
    for (const key of Object.keys(row)) {
      if (!FIXING_KEYS.has(key)) return `Unknown fixing property '${key}': fixing rows accept only date and value.`;
    }
    if (!policyDateOrNull(row.date)) return `Fixing date must be YYYY-MM-DD, got ${String(row.date)}.`;
    if (!policyFinite(row.value, -5, 30)) return 'Fixing value must be a finite percent in [-5, 30].';
  }
  if (meetings !== undefined) {
    if (!Array.isArray(meetings) || meetings.length > 50) return 'meetings must be an array of at most 50 rows.';
    for (const meeting of meetings) {
      if (!meeting || typeof meeting !== 'object') return 'Each meeting must be an object with date and stepBps.';
      for (const key of Object.keys(meeting)) {
        if (!MEETING_KEYS.has(key)) return `Unknown meeting property '${key}': meeting rows accept only date, stepBps, targetLower and targetUpper.`;
      }
      if (!policyDateOrNull(meeting.date)) return `Meeting date must be YYYY-MM-DD, got ${String(meeting.date)}.`;
      if ('stepBps' in meeting && meeting.stepBps !== undefined && meeting.stepBps !== null
        && !policyFinite(meeting.stepBps, -500, 500)) {
        return 'Meeting stepBps must be finite basis points in [-500, 500] when supplied.';
      }
      for (const bound of ['targetLower', 'targetUpper']) {
        if (bound in meeting && meeting[bound] !== undefined && meeting[bound] !== null
          && !policyFinite(meeting[bound], -5, 30)) {
          return `Meeting ${bound} must be a finite percent in [-5, 30] when supplied.`;
        }
      }
    }
  }
  for (const [name, window] of [['sr3', sr3], ['sr1', sr1]]) {
    if (window === undefined || window === null) continue;
    if (!window || typeof window !== 'object' || Array.isArray(window)) return `${name} must be an object with windowStart and windowEnd.`;
    for (const key of Object.keys(window)) {
      if (!WINDOW_KEYS.has(key)) return `Unknown ${name} property '${key}': ${name} accepts only windowStart, windowEnd, currentRate, currentSource and currentDate.`;
    }
    if (!policyDateOrNull(window.windowStart) || !policyDateOrNull(window.windowEnd)) {
      return `${name}.windowStart/windowEnd must be YYYY-MM-DD dates.`;
    }
    if (window.windowEnd <= window.windowStart) return `${name} window must satisfy windowEnd > windowStart.`;
    const spanDays = (new Date(`${window.windowEnd}T00:00:00.000Z`) - new Date(`${window.windowStart}T00:00:00.000Z`)) / 86_400_000;
    if (!(spanDays > 0 && spanDays <= 400)) return `${name} window longer than 400 days is rejected.`;
    if (window.currentRate !== undefined && window.currentRate !== null
      && !policyFinite(window.currentRate, -5, 30)) {
      return `${name}.currentRate must be a finite percent in [-5, 30] or null.`;
    }
  }
  if (policySpreadBps !== undefined && policySpreadBps !== null
    && !policyFinite(policySpreadBps, -2000, 2000)) {
    return 'policySpreadBps must be finite basis points in [-2000, 2000] or null.';
  }
  if (deriveStepFromMidpoint !== undefined && typeof deriveStepFromMidpoint !== 'boolean') {
    return 'deriveStepFromMidpoint must be a boolean.';
  }
  return null;
}
function projectPolicyRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    windowStart: typeof row.windowStart === 'string' ? row.windowStart : null,
    windowEnd: typeof row.windowEnd === 'string' ? row.windowEnd : null,
    currentRate: finiteOrNull(row.currentRate),
    currentSource: typeof row.currentSource === 'string' ? row.currentSource : null,
    currentDate: typeof row.currentDate === 'string' ? row.currentDate : null,
    currentProvenance: typeof row.currentProvenance === 'string' ? row.currentProvenance : 'unavailable-not-supplied',
    predictedRate: finiteOrNull(row.predictedRate),
    predictedProvenance: typeof row.predictedProvenance === 'string' ? row.predictedProvenance : 'unavailable',
    differenceBps: finiteOrNull(row.differenceBps),
    status: row.status === 'ok' ? 'ok' : 'unavailable',
    warnings: Array.isArray(row.warnings) ? row.warnings.filter((w) => typeof w === 'string').slice(0, 25) : [],
  };
}

const MONTHS = new Map([
  ['JAN', 0], ['FEB', 1], ['MAR', 2], ['APR', 3], ['MAY', 4], ['JUN', 5],
  ['JUL', 6], ['AUG', 7], ['SEP', 8], ['OCT', 9], ['NOV', 10], ['DEC', 11],
]);

function parseDeribitOption(instrument) {
  const match = /^([A-Z]+)-(\d{1,2})([A-Z]{3})(\d{2})-(?:\d+(?:\.\d+)?)-([CP])$/i.exec(String(instrument));
  if (!match) return { right: null, expiry: null };
  const month = MONTHS.get(match[3].toUpperCase());
  if (month == null) return { right: null, expiry: null };
  const year = 2000 + Number(match[4]);
  const day = Number(match[2]);
  const date = new Date(Date.UTC(year, month, day));
  return Number.isFinite(date.getTime())
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month
    && date.getUTCDate() === day
    ? { right: match[5].toUpperCase() === 'C' ? 'call' : 'put', expiry: date.toISOString().slice(0, 10) }
    : { right: null, expiry: null };
}

async function workerJson(suffix, query = '', ttlMs = 60_000) {
  const base = resolveRatesWorkerUrl();
  const url = `${base}${suffix}${query}`;
  return getOrFetch(`v1:worker:${suffix}:${query}`, ttlMs, async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`worker ${res.status}`);
    return res.json();
  }, { allowStaleOnError: true, maxStaleMs: 10 * ttlMs });
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

function combinedCacheEnvelope(settledResults) {
  const results = settledResults
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  if (results.length === 0) {
    return { state: 'unavailable', hit: false, ageMs: null, stale: false, coalesced: false, providerError: null };
  }
  const stale = results.some((result) => result.stale);
  const allHits = results.every((result) => result.fromCache);
  return {
    state: stale ? 'stale' : allHits ? 'fresh' : 'miss',
    hit: allHits,
    ageMs: Math.max(...results.map((result) => Number.isFinite(result.ageMs) ? Math.max(0, result.ageMs) : 0)),
    stale,
    coalesced: results.some((result) => result.coalesced),
    providerError: results.map((result) => sanitizeProviderErrorCode(result.providerError)).find(Boolean) ?? null,
  };
}

const ANALYTICS_PARAMS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['symbol'],
  properties: { symbol: { type: 'string', pattern: '^[A-Z][A-Z0-9.-]{0,11}$' } },
};

const MODEL_QUERY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    riskFreeRate: { type: 'number', minimum: -0.25, maximum: 1 },
    carryRate: { type: 'number', minimum: -0.25, maximum: 1 },
    maxRows: { type: 'integer', minimum: 1, maximum: 5_000 },
  },
};

async function loadCanonicalOptions(fastify, symbol) {
  const path = symbol === 'BTC' || symbol === 'ETH'
    ? `/api/v1/market/crypto/${symbol}`
    : `/api/v1/market/options/${encodeURIComponent(symbol)}`;
  const response = await fastify.inject({ method: 'GET', url: path });
  return { statusCode: response.statusCode, body: response.json() };
}

function derivedCoverage(coverageFn, result) {
  return coverageFn(result.coverage.numerator, result.coverage.denominator, result.coverage.missing);
}

function modelInputsFrom(request) {
  const riskFreeRate = request.query?.riskFreeRate;
  const carryRate = request.query?.carryRate;
  if ((riskFreeRate == null) !== (carryRate == null)) return null;
  return {
    riskFreeRate: riskFreeRate == null ? null : Number(riskFreeRate),
    carryRate: carryRate == null ? null : Number(carryRate),
    maxRows: request.query?.maxRows == null ? undefined : Number(request.query.maxRows),
  };
}

export function registerV1AnalyticsRoutes(fastify, { sendContract, sendError, baseEnvelope, coverage } = {}) {
  fastify.get('/api/v1/analytics/volatility-surface/:symbol', {
    schema: {
      params: ANALYTICS_PARAMS_SCHEMA,
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { maxRows: { type: 'integer', minimum: 1, maximum: 5_000 } },
      },
    },
  }, async (request, reply) => {
    const symbol = String(request.params.symbol).toUpperCase();
    const upstream = await loadCanonicalOptions(fastify, symbol);
    if (upstream.statusCode !== 200) {
      return sendError(request, reply, {
        statusCode: upstream.statusCode >= 400 && upstream.statusCode < 500 ? upstream.statusCode : 502,
        code: upstream.body?.error?.code ?? 'PROVIDER_UNAVAILABLE',
        message: 'The canonical option snapshot required for surface analytics is unavailable.',
        retryable: upstream.statusCode >= 500,
      });
    }
    const result = buildVolatilitySurface(upstream.body, symbol, { maxRows: request.query?.maxRows });
    const envelope = baseEnvelope(request, {
      asOf: upstream.body.asOf,
      fetchedAt: upstream.body.fetchedAt,
      source: [...new Set([...upstream.body.source, 'terminal-options-analytics'])],
      freshness: upstream.body.freshness,
      coverage: derivedCoverage(coverage, result),
      cache: upstream.body.cache,
      provenanceByField: {
        'data.observedNodes[].bidIv': 'observed-provider-bid-iv',
        'data.observedNodes[].askIv': 'observed-provider-ask-iv',
        'data.observedNodes[].venueMarkIv': 'observed-provider-mark-iv',
        'data.modelLayer': 'unavailable-no-calibration',
      },
      unitsByField: {
        'data.spot': 'USD',
        'data.observedNodes[].strike': 'USD',
        'data.observedNodes[].bidIv': 'decimal-volatility',
        'data.observedNodes[].askIv': 'decimal-volatility',
        'data.observedNodes[].venueMarkIv': 'decimal-volatility',
      },
      assumptions: [],
      warnings: [...upstream.body.warnings, ...result.warnings],
      data: result.data,
    });
    return sendContract(request, reply, 'volatilitySurfaceResponse', envelope);
  });

  for (const [path, contractName, builder] of [
    ['/api/v1/analytics/greeks/:symbol', 'greeksResponse', buildGreeks],
    ['/api/v1/analytics/positioning/:symbol', 'positioningResponse', buildPositioning],
  ]) {
    fastify.get(path, {
      schema: { params: ANALYTICS_PARAMS_SCHEMA, querystring: MODEL_QUERY_SCHEMA },
    }, async (request, reply) => {
      const symbol = String(request.params.symbol).toUpperCase();
      const modelInputs = modelInputsFrom(request);
      if (modelInputs == null) {
        return sendError(request, reply, {
          statusCode: 400,
          code: 'INVALID_REQUEST',
          message: 'riskFreeRate and carryRate must be supplied together; neither is silently defaulted.',
          retryable: false,
        });
      }
      const upstream = await loadCanonicalOptions(fastify, symbol);
      if (upstream.statusCode !== 200) {
        return sendError(request, reply, {
          statusCode: upstream.statusCode >= 400 && upstream.statusCode < 500 ? upstream.statusCode : 502,
          code: upstream.body?.error?.code ?? 'PROVIDER_UNAVAILABLE',
          message: 'The canonical option snapshot required for analytics is unavailable.',
          retryable: upstream.statusCode >= 500,
        });
      }
      const result = builder(upstream.body, symbol, modelInputs);
      const positioning = contractName === 'positioningResponse';
      const envelope = baseEnvelope(request, {
        asOf: upstream.body.asOf,
        fetchedAt: upstream.body.fetchedAt,
        source: [...new Set([...upstream.body.source, 'terminal-options-analytics'])],
        freshness: upstream.body.freshness,
        coverage: derivedCoverage(coverage, result),
        cache: upstream.body.cache,
        provenanceByField: positioning ? {
          'data.points[].openInterest': 'observed-provider-open-interest',
          'data.points[].gex1PctUsd': 'derived-bsm-signed-greek-oi-proxy',
          'data.points[].dexUsd': 'derived-bsm-signed-greek-oi-proxy',
          'data.points[].vannaUsdPerUnitVol': 'derived-bsm-signed-greek-oi-proxy',
          'data.points[].charmUsdPerDay': 'derived-bsm-signed-greek-oi-proxy',
        } : {
          'data.points[].iv': 'observed-provider-mark-iv',
          'data.points[].delta': 'derived-black-scholes-merton',
          'data.points[].gamma': 'derived-black-scholes-merton',
          'data.points[].vega': 'derived-black-scholes-merton',
          'data.points[].theta': 'derived-black-scholes-merton-finite-difference',
          'data.points[].vanna': 'derived-black-scholes-merton',
          'data.points[].charm': 'derived-black-scholes-merton-finite-difference',
        },
        unitsByField: positioning ? {
          'data.spot': 'USD',
          'data.points[].openInterest': 'listed-contracts',
          'data.points[].gex1PctUsd': 'USD-per-1-percent-spot-move',
          'data.points[].dexUsd': 'USD-delta-notional',
          'data.points[].vannaUsdPerUnitVol': 'USD-delta-notional-per-unit-volatility',
          'data.points[].charmUsdPerDay': 'USD-delta-notional-per-calendar-day',
        } : {
          'data.spot': 'USD',
          'data.points[].iv': 'decimal-volatility',
          'data.points[].delta': 'option-delta',
          'data.points[].gamma': 'option-delta-per-USD',
          'data.points[].vega': 'USD-per-share-per-1-vol-point',
          'data.points[].theta': 'USD-per-share-per-calendar-day',
          'data.points[].vanna': 'option-delta-per-unit-volatility',
          'data.points[].charm': 'option-delta-per-calendar-day',
        },
        assumptions: positioning
          ? [
            'Mixed per-metric signed-Greek OI convention: GEX uses +gamma for calls and -gamma for puts; DEX, Vanna, and Charm use the signed model Greek with no right multiplier. Not customer-long across all metrics; not observed dealer inventory.',
            'Equity contract multiplier 100; missing or non-finite OI stays unavailable (null); zero OI is valid zero; non-finite exposure outputs are null with incomplete coverage.',
            'Equity expiry dates use 20:00 UTC as a labelled model-time approximation; crypto uses the provider expiry timestamp.',
          ]
          : [
            'Black-Scholes-Merton with explicit riskFreeRate and carryRate inputs; no rate is defaulted.',
            'Equity expiry dates use 20:00 UTC as a labelled model-time approximation; crypto uses the provider expiry timestamp.',
          ],
        warnings: [...upstream.body.warnings, ...result.warnings],
        data: result.data,
      });
      return sendContract(request, reply, contractName, envelope);
    });
  }

  // ── REF-06 forward-volatility matrix (pairwise upper triangle, DTE/365) ──
  fastify.get('/api/v1/analytics/forward-vol-matrix/:symbol', {
    schema: {
      params: ANALYTICS_PARAMS_SCHEMA,
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { maxRows: { type: 'integer', minimum: 1, maximum: 5_000 } },
      },
    },
  }, async (request, reply) => {
    const symbol = String(request.params.symbol).toUpperCase();
    const upstream = await loadCanonicalOptions(fastify, symbol);
    if (upstream.statusCode !== 200) {
      return sendError(request, reply, {
        statusCode: upstream.statusCode >= 400 && upstream.statusCode < 500 ? upstream.statusCode : 502,
        code: upstream.body?.error?.code ?? 'PROVIDER_UNAVAILABLE',
        message: 'The canonical option snapshot required for forward-vol analytics is unavailable.',
        retryable: upstream.statusCode >= 500,
      });
    }
    const result = buildForwardVolMatrix(upstream.body, symbol, { maxRows: request.query?.maxRows });
    const isCryptoFwd = result.data.ivBasis === 'observed-mark';
    const fwdExpiryLabelProvenance = isCryptoFwd
      ? 'utc-date-label-derived-from-provider-expiryMs'
      : 'upstream-expiry-date-label-not-observed-instant';
    const fwdDteProvenance = isCryptoFwd
      ? 'derived-elapsed-calendar-days-from-envelope-asOf-and-provider-expiryMs-v1'
      : 'derived-elapsed-calendar-days-from-envelope-asOf-and-model-expiry-20utc-v1';
    const fwdValueProvenance = isCryptoFwd
      ? 'derived-total-variance-forward-vol-using-provider-expiryMs-v1'
      : 'derived-total-variance-forward-vol-conditional-on-model-expiry-20utc-v1';
    const envelope = baseEnvelope(request, {
      asOf: upstream.body.asOf,
      fetchedAt: upstream.body.fetchedAt,
      source: [...new Set([...upstream.body.source, 'terminal-options-analytics'])],
      freshness: upstream.body.freshness,
      coverage: derivedCoverage(coverage, result),
      cache: upstream.body.cache,
      provenanceByField: {
        'data.expiries[].atmIv': result.data.ivBasis === 'observed-mark'
          ? 'observed-provider-mark-iv-nearest-to-spot'
          : 'derived-solved-mid-nearest-to-spot',
        'data.expiries[].expiry': fwdExpiryLabelProvenance,
        'data.cells[].startExpiry': fwdExpiryLabelProvenance,
        'data.cells[].endExpiry': fwdExpiryLabelProvenance,
        'data.expiries[].dte': fwdDteProvenance,
        'data.cells[].startDte': fwdDteProvenance,
        'data.cells[].endDte': fwdDteProvenance,
        'data.expiries[].T': 'derived-dte-divided-by-365',
        'data.cells[].startT': 'derived-dte-divided-by-365',
        'data.cells[].endT': 'derived-dte-divided-by-365',
        'data.cells[].value': fwdValueProvenance,
        'data.origin': 'current-quote-instant-not-an-expiry',
      },
      unitsByField: {
        'data.spot': 'USD',
        'data.expiries[].dte': 'calendar-days',
        'data.expiries[].T': 'years-DTE-over-365',
        'data.expiries[].atmIv': 'decimal-volatility',
        'data.cells[].startDte': 'calendar-days',
        'data.cells[].endDte': 'calendar-days',
        'data.cells[].startT': 'years-DTE-over-365',
        'data.cells[].endT': 'years-DTE-over-365',
        'data.cells[].startAtmIv': 'decimal-volatility',
        'data.cells[].endAtmIv': 'decimal-volatility',
        'data.cells[].value': 'decimal-volatility-annualized',
      },
      assumptions: [
        'Year fraction is DTE/365 calendar days; T=0 (SPOT) is the current quote instant, never an expiry column.',
        'Any negative implied forward variance — including tiny negatives — is unavailable, never a clamped zero; exact zero with distinct increasing DTE may be 0.',
        'Diagonal and lower-triangle cells are structurally blank, not data.',
        'REF06 expiry-time policy ref06-equity-date-20utc-v1: date-only equity expiries are mapped to 20:00:00.000 UTC on the supplied date solely as a model-time approximation. This is not an observed expiry instant or a verified venue settlement or trading-cutoff rule. No venue, daylight-saving, holiday or early-close adjustment is applied.',
        'REF06 expiry-time policy ref06-crypto-provider-instant-v1: time to expiry uses the canonical provider-supplied expiryMs instant without replacing its clock. The displayed expiry date is a UTC date label, not the expiry instant.',
        'DTE is fractional elapsed time from the canonical envelope asOf to the applicable expiry instant, divided by 86,400,000 milliseconds; T = DTE/365. The calculation does not round DTE or substitute fetch time or the current wall clock.',
        'asOf retains its upstream snapshot meaning; it is not an independently verified exchange quote timestamp.',
      ],
      warnings: [...upstream.body.warnings, ...result.warnings],
      data: result.data,
    });
    return sendContract(request, reply, 'forwardVolMatrixResponse', envelope);
  });

  // ── Provider / cache status ────────────────────────────────────────────
  fastify.get('/api/v1/provider/status', async (request, reply) => {
    const now = Date.now();
    const modes = providerEntitlements();
    const stats = cacheStats();
    const quotaStatus = stats.budgets?.ledger ?? { scope: 'process-local', persistent: false, healthy: false };
    const quotaRows = [
      { provider: 'fmp', period: 'day', used: stats.budgets?.fmp?.used ?? 0, cap: stats.budgets?.fmp?.capDaily ?? 250 },
      { provider: 'alphavantage', period: 'day', used: stats.budgets?.alphavantage?.used ?? 0, cap: stats.budgets?.alphavantage?.capDaily ?? 25 },
      { provider: 'finnhub', period: 'day', used: stats.budgets?.finnhub?.used ?? 0, cap: stats.budgets?.finnhub?.capDailySoft ?? 5_000 },
      { provider: 'tradingview', period: 'month', used: stats.budgets?.tradingview?.usedMonth ?? 0, cap: stats.budgets?.tradingview?.capMonthly ?? 150 },
    ].map((row) => ({ ...row, remaining: Math.max(0, row.cap - row.used) }));
    const envelope = baseEnvelope(request, {
      asOf: now,
      fetchedAt: now,
      source: ['terminal-api'],
      freshness: 'live',
      coverage: coverage(1, 1),
      provenanceByField: {
        'data.providerModes': 'public-provider-policy',
        'data.cache': 'api/upstreamCache',
        'data.circuits': 'api/providerCircuitBreaker',
      },
      unitsByField: {
        'data.cache.entries': 'count',
        'data.cache.hits': 'count',
        'data.cache.misses': 'count',
        'data.quota.providers[].used': 'upstream-calls',
        'data.quota.providers[].remaining': 'upstream-calls',
        'data.circuits[].failures': 'provider-circuit-failure-count',
        'data.circuits[].cooldownRemainingMs': 'milliseconds',
      },
      assumptions: ['Velo remains unverified until a server-side capability and redistribution probe succeeds; configuration presence is not exposed.'],
      warnings: [],
      data: {
        providerModes: modes,
        cache: {
          entries: stats.entries ?? 0,
          hits: stats.metrics?.freshHits ?? 0,
          misses: stats.metrics?.misses ?? 0,
          inflight: stats.inFlight ?? 0,
        },
        circuits: providerCircuitStatuses(),
        quota: {
          scope: quotaStatus.scope,
          persistent: Boolean(quotaStatus.persistent),
          healthy: Boolean(quotaStatus.healthy),
          providers: quotaRows,
        },
      },
    });
    return sendContract(request, reply, 'providerStatusResponse', envelope);
  });

  // ── Rates: STIR / SR3 / SERFF strip (real worker analytics) ────────────
  fastify.get('/api/v1/rates/stir', async (request, reply) => {
    let worker;
    let strip;
    try {
      worker = await workerJson('/api/stir/strip');
      strip = worker.data;
    } catch {
      return sendError(request, reply, {
        statusCode: 502,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'The rates worker STIR strip is unavailable.',
        retryable: true,
        provider: 'rates-worker',
      });
    }
    const now = Date.now();
    const projectContract = (row) => {
      const out = {};
      for (const key of ['contract', 'label', 'ticker', 'month', 'ref_start', 'ref_end', 'settlement', 'chg', 'last_price', 'implied_rate', 'source', 'symbol']) {
        if (row[key] !== undefined) out[key] = row[key];
      }
      return out;
    };
    const sr3 = (strip.sr3 ?? []).map(projectContract);
    const sr1 = (strip.sr1 ?? []).map(projectContract);
    const zq = (strip.zq ?? []).map(projectContract);
    const serff = (strip.spreads?.by_kind?.serff ?? [])
      .filter((s) => s && s.name && s.kind === 'serff')
      .map((s) => ({
        name: s.name,
        legs: s.legs ?? [],
        ratio: s.ratio ?? '1:1',
        rate_bps: finiteOrNull(s.rate_bps),
        price_spread: finiteOrNull(s.price_spread),
        note: s.note ?? '',
      }));
    const proxies = (strip.spreads?.by_kind?.['derived-proxy'] ?? []).map((s) => ({
      name: s.name,
      legs: s.legs ?? [],
      ratio: s.ratio ?? '',
      rate_bps: finiteOrNull(s.rate_bps),
      note: s.note ?? '',
    }));
    const envelope = baseEnvelope(request, {
      asOf: strip.as_of ?? now,
      fetchedAt: now,
      source: ['rates-worker', 'yfinance-delayed', 'ny-fed', 'fred'],
      freshness: 'delayed',
      coverage: coverage(sr3.length, (strip.sr3 ?? []).length,
        sr3.length < (strip.sr3 ?? []).length ? ['dropped-invalid-sr3-rows'] : []),
      provenanceByField: {
        'data.sr3': 'yfinance-final-settlement-or-last-print',
        'data.serff': 'rates-worker-cme-ics-sr1-minus-zq-same-month',
        'data.derived-proxies': 'rates-worker-implied-minus-cash-effr',
      },
      unitsByField: {
        'data.sr3[].implied_rate': 'percent-100-minus-price',
        'data.serff[].rate_bps': 'basis-points',
        'data.serff[].ratio': 'leg-ratio',
      },
      assumptions: ['Forex/yfinance futures prints are delayed; settlement where final, else last print.'],
      warnings: serff.filter((s) => s.rate_bps == null).map((s) => `${s.name}: SERFF Unavailable — missing exact SR1 or ZQ leg.`),
      cache: {
        state: worker.stale ? 'stale' : worker.fromCache ? 'fresh' : 'miss',
        hit: worker.fromCache,
        ageMs: worker.ageMs,
        stale: Boolean(worker.stale),
        coalesced: Boolean(worker.coalesced),
        providerError: sanitizeProviderErrorCode(worker.providerError),
      },
      data: {
        sr3,
        sr1,
        zq,
        serff,
        derivedProxies: proxies,
        effr: finiteOrNull(strip.effr),
        iorb: finiteOrNull(strip.iorb),
        asOf: strip.as_of ?? null,
        count: sr3.length,
      },
    });
    return sendContract(request, reply, 'ratesStirResponse', envelope);
  });

  // ── Rates: term structure (worker, C0-nullable r) ─────────────────────
  fastify.get('/api/v1/rates/term-structure', {
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { T: { type: 'number', minimum: 0.01, maximum: 40 } },
      },
    },
  }, async (request, reply) => {
    const T = finiteOrNull(request.query?.T) ?? 0.25;
    let worker;
    let data;
    try {
      worker = await workerJson('/api/rates/term-structure', `?T=${T}`);
      data = worker.data;
    } catch {
      return sendError(request, reply, {
        statusCode: 502,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'The rates worker term structure is unavailable.',
        retryable: true,
        provider: 'rates-worker',
      });
    }
    const now = Date.now();
    const envelope = baseEnvelope(request, {
      asOf: data.as_of ?? now,
      fetchedAt: now,
      source: ['rates-worker', 'fred-treasury-cmts', 'fred-sofr'],
      freshness: 'delayed',
      coverage: coverage(data.available ? 1 : 0, 1, data.available ? [] : ['rate-unavailable']),
      provenanceByField: {
        'data.r': data.r_source === 'sofr_only_no_curve' ? 'observed-sofr-fail-closed' : data.r_source ?? 'unavailable',
      },
      unitsByField: { 'data.r': 'decimal-rate', 'data.r_pct': 'percent' },
      assumptions: data.warnings ?? [],
      warnings: data.warnings ?? [],
      cache: {
        state: worker.stale ? 'stale' : worker.fromCache ? 'fresh' : 'miss',
        hit: worker.fromCache,
        ageMs: worker.ageMs,
        stale: Boolean(worker.stale),
        coalesced: Boolean(worker.coalesced),
        providerError: sanitizeProviderErrorCode(worker.providerError),
      },
      data: {
        T,
        r: finiteOrNull(data.r),
        r_pct: finiteOrNull(data.r_pct),
        available: Boolean(data.available),
        r_source: data.r_source ?? 'unavailable',
        curvePoints: (data.curve_points ?? []).slice(0, 40).map((p) => ({
          T: finiteOrNull(p.T),
          r: finiteOrNull(p.r),
          r_pct: finiteOrNull(p.r_pct),
        })),
        curveCoverage: data.curve_coverage ?? { points: 0, state: 'unavailable' },
        sofr: finiteOrNull(data.sofr),
      },
    });
    return sendContract(request, reply, 'ratesTermStructureResponse', envelope);
  });

  // ── Rates: policy scenario calculator (REF-08/N3c math + contract only) ──
  // Single allowlisted proxy: exact path, POST-only, validated body, no wildcard.
  fastify.post('/api/v1/rates/policy-scenario', async (request, reply) => {
    const validationError = validatePolicyScenarioBody(request.body);
    if (validationError) {
      return sendError(request, reply, {
        statusCode: 400,
        code: 'INVALID_REQUEST',
        message: validationError,
        retryable: false,
      });
    }
    let worker;
    try {
      const base = resolveRatesWorkerUrl();
      const res = await fetch(`${base}/api/rates/policy-scenario`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(25_000),
      });
      worker = await res.json().catch(() => null);
      if (!res.ok || !worker || typeof worker !== 'object') {
        const workerMessage = worker && typeof worker.error === 'string' ? worker.error : null;
        if (res.status === 400) {
          return sendError(request, reply, {
            statusCode: 400,
            code: 'INVALID_REQUEST',
            message: workerMessage ?? 'The policy scenario request was invalid.',
            retryable: false,
          });
        }
        throw new Error(`worker ${res.status}`);
      }
    } catch {
      return sendError(request, reply, {
        statusCode: 502,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'The rates worker policy scenario calculator is unavailable.',
        retryable: true,
        provider: 'rates-worker',
      });
    }
    const now = Date.now();
    const sr3 = projectPolicyRow(worker.sr3);
    const sr1 = projectPolicyRow(worker.sr1);
    const requested = (worker.sr3 ? 1 : 0) + (worker.sr1 ? 1 : 0);
    const fulfilled = (sr3?.predictedRate ?? null) != null ? 1 : 0;
    const fulfilledSr1 = (sr1?.predictedRate ?? null) != null ? 1 : 0;
    const missing = [];
    if (worker.sr3 && (sr3?.predictedRate ?? null) == null) missing.push('sr3-predicted-unavailable');
    if (worker.sr1 && (sr1?.predictedRate ?? null) == null) missing.push('sr1-predicted-unavailable');
    const envelope = baseEnvelope(request, {
      asOf: worker.as_of ?? new Date(now).toISOString(),
      fetchedAt: now,
      source: ['terminal-api', 'rates-worker', 'caller-supplied-fixings'],
      freshness: 'live',
      coverage: requested > 0
        ? coverage(fulfilled + fulfilledSr1, requested, missing)
        : coverage(1, 1),
      provenanceByField: {
        'data.fixingLine[].observedValue': 'observed-caller-supplied-sofr-fixing',
        'data.fixingLine[].scenarioValue': 'scenario-explicit-steps-after-last-observed',
        'data.sr3.predictedRate': 'scenario-compound-sofr-rate-over-explicit-window',
        'data.sr1.predictedRate': 'scenario-compound-sofr-rate-over-explicit-window',
        'data.sr3.currentRate': 'observed-only-with-explicit-source-date',
        'data.sr1.currentRate': 'observed-only-with-explicit-source-date',
        'data.policySpreadBps': 'scenario-explicit-override-or-unavailable',
      },
      unitsByField: {
        'data.fixingLine[].observedValue': 'percent-100',
        'data.fixingLine[].scenarioValue': 'percent-100',
        'data.fixingLine[].cumulativeStepBps': 'basis-points',
        'data.sr3.currentRate': 'percent-100',
        'data.sr3.predictedRate': 'percent-100',
        'data.sr3.differenceBps': 'basis-points',
        'data.sr1.currentRate': 'percent-100',
        'data.sr1.predictedRate': 'percent-100',
        'data.sr1.differenceBps': 'basis-points',
        'data.policySpreadBps': 'basis-points',
      },
      assumptions: [
        'Computed at fetchedAt from caller-supplied inputs only; no provider was read and no historical-data entitlement is implied.',
        'Scenario rows are hypothetical and must not be read as observed market data or a policy-rate forecast.',
        ...(Array.isArray(worker.assumptions) ? worker.assumptions : []),
      ],
      warnings: [...new Set([...(Array.isArray(worker.warnings) ? worker.warnings : [])])],
      cache: { state: 'miss', hit: false, ageMs: null, stale: false, coalesced: false, providerError: null },
      data: {
        fixingLine: (Array.isArray(worker.fixingLine) ? worker.fixingLine : []).slice(0, 560).map((row) => ({
          date: typeof row.date === 'string' ? row.date : null,
          observedValue: finiteOrNull(row.observedValue),
          scenarioValue: finiteOrNull(row.scenarioValue),
          cumulativeStepBps: finiteOrNull(row.cumulativeStepBps),
          provenance: row.provenance === 'observed' ? 'observed' : 'scenario',
        })),
        sr3,
        sr1,
        policySpreadBps: finiteOrNull(worker.policySpreadBps),
        policySpreadProvenance: typeof worker.policySpreadProvenance === 'string'
          ? worker.policySpreadProvenance
          : 'unavailable-not-supplied',
        lastObservedDate: typeof worker.lastObservedDate === 'string' ? worker.lastObservedDate : null,
      },
    });
    return sendContract(request, reply, 'policyScenarioResponse', envelope);
  });

  // ── Crypto carry: funding + perp premium + dated-future basis ──────────
  fastify.get('/api/v1/crypto/carry/:currency', {
    schema: {
      params: {
        type: 'object', additionalProperties: false, required: ['currency'],
        properties: { currency: { type: 'string', enum: ['BTC', 'ETH'] } },
      },
    },
  }, async (request, reply) => {
    const currency = request.params.currency.toUpperCase();
    const [funding, market, free] = await Promise.allSettled([
      getDeribitFundingSnapshotResult(currency, `${currency}-PERPETUAL`, 7),
      getDeribitMarketSnapshotResult(currency),
      fetchFreeCryptoMarketResult(currency),
    ]);
    if (funding.status === 'rejected' && market.status === 'rejected' && free.status === 'rejected') {
      return sendError(request, reply, {
        statusCode: 502,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'All crypto carry sources are unavailable.',
        retryable: true,
        provider: 'deribit+free-exchanges',
      });
    }
    const now = Date.now();
    const fundingBody = funding.status === 'fulfilled' ? funding.value.data : null;
    const marketSnapshot = market.status === 'fulfilled' ? market.value.data : null;
    const fundingPoints = (fundingBody?.points ?? []).slice(-7).map((p) => ({
      timestamp: finiteOrNull(p.t ?? p.timestamp),
      rate8h: finiteOrNull(p.rate8h),
      annualizedPct: finiteOrNull(p.rate8h) == null ? null : finiteOrNull(p.rate8h) * 3 * 365 * 100,
    })).filter((p) => p.timestamp != null);
    const perp = (marketSnapshot?.instruments ?? []).filter((r) => r.kind === 'perp')[0] ?? null;
    const indexPrice = finiteOrNull(marketSnapshot?.indexPrice);
    const perpMark = finiteOrNull(perp?.markPrice);
    const perpPremiumPct = perpMark != null && indexPrice != null && indexPrice > 0
      ? ((perpMark / indexPrice) - 1) * 100
      : null;
    const dated = (marketSnapshot?.instruments ?? [])
      .filter((r) => r.kind === 'future' && finiteOrNull(r.expiryMs) != null && finiteOrNull(r.expiryMs) > now)
      .slice(0, 8)
      .map((r) => {
        const mark = finiteOrNull(r.markPrice);
        return {
          instrument: r.instrument,
          expiryMs: finiteOrNull(r.expiryMs),
          mark,
          basisPct: mark != null && indexPrice != null && indexPrice > 0 ? ((mark / indexPrice) - 1) * 100 : null,
        };
      });
    const freeBody = free.status === 'fulfilled' ? free.value.data : null;
    const cache = combinedCacheEnvelope([funding, market, free]);
    const envelope = baseEnvelope(request, {
      asOf: fundingBody?.fetchedAt ?? marketSnapshot?.fetchedAt ?? now,
      fetchedAt: now,
      source: ['deribit', 'free-exchanges'],
      freshness: cache.stale ? 'stale' : 'live',
      coverage: coverage(
        [funding.status === 'fulfilled', market.status === 'fulfilled', free.status === 'fulfilled'].filter(Boolean).length,
        3,
        [
          funding.status === 'rejected' ? 'deribit-funding' : null,
          market.status === 'rejected' ? 'deribit-market' : null,
          free.status === 'rejected' ? 'free-exchanges' : null,
        ].filter(Boolean),
      ),
      cache,
      provenanceByField: {
        'data.fundingPoints': 'deribit-get_funding_rate_history',
        'data.perpPremiumPct': 'deribit-mark-vs-index',
        'data.datedFutureBasisPct': 'deribit-mark-vs-index',
        'data.freeFunding8h': 'binance-futures-premium-index (free alternative)',
      },
      unitsByField: {
        'data.fundingPoints[].rate8h': 'decimal-per-8h',
        'data.fundingPoints[].annualizedPct': 'percent-simple-annualized-run-rate',
        'data.perpPremiumPct': 'percent',
        'data.datedFutureBasisPct': 'percent',
        'data.freeFunding8h': 'decimal-per-8h',
      },
      assumptions: ['Annualized funding is rate8h × 3 × 365 (simple run-rate, not yield).'],
      warnings: [
        funding.status === 'rejected' ? 'deribit-funding-source-down' : null,
        free.status === 'rejected' ? 'free-exchanges-source-down' : null,
      ].filter(Boolean),
      data: {
        currency,
        indexPrice,
        perpMark,
        perpPremiumPct,
        fundingPoints,
        datedFutureBasis: dated,
        freeFunding8h: finiteOrNull((freeBody?.venues ?? []).map((v) => v?.funding8h).find((x) => x != null)) ?? null,
        freeIndexPrice: finiteOrNull((freeBody?.venues ?? []).map((v) => v?.index).find((x) => x != null)) ?? null,
        sources: {
          deribitFunding: funding.status === 'fulfilled',
          deribitMarket: market.status === 'fulfilled',
          freeExchanges: free.status === 'fulfilled',
        },
      },
    });
    return sendContract(request, reply, 'cryptoCarryResponse', envelope);
  });

  // ── Crypto flow: Deribit trades aggregated by side/right/expiry ────────
  fastify.get('/api/v1/crypto/flow/:currency', {
    schema: {
      params: {
        type: 'object', additionalProperties: false, required: ['currency'],
        properties: { currency: { type: 'string', enum: ['BTC', 'ETH'] } },
      },
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { hours: { type: 'integer', enum: [1, 4, 24] }, count: { type: 'integer', minimum: 50, maximum: 1000 } },
      },
    },
  }, async (request, reply) => {
    const currency = request.params.currency.toUpperCase();
    const hours = Number(request.query?.hours ?? 24);
    const count = Number(request.query?.count ?? 500);
    let result;
    try {
      result = await getDeribitTradesSnapshotResult(currency, hours, count);
    } catch {
      return sendError(request, reply, {
        statusCode: 502,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'The Deribit option trade tape is unavailable.',
        retryable: true,
        provider: 'deribit',
      });
    }
    const body = result.data;
    const trades = (body.trades ?? [])
      .map((t) => {
        const instrument = String(t.instrument ?? '');
        const parsed = parseDeribitOption(instrument);
        return {
          instrument,
          timestamp: finiteOrNull(t.timestamp),
          price: finiteOrNull(t.price),
          quantity: finiteOrNull(t.quantity),
          side: t.side === 'buy' || t.side === 'sell' ? t.side : null,
          right: parsed.right,
          expiry: parsed.expiry,
          blockTrade: Boolean(t.blockTrade),
          rfq: Boolean(t.rfq),
        };
      })
      .filter((t) => t.timestamp != null && t.side != null && t.right != null && t.expiry != null);
    const agg = {
      calls: { buy: { notional: null, count: 0 }, sell: { notional: null, count: 0 } },
      puts: { buy: { notional: null, count: 0 }, sell: { notional: null, count: 0 } },
    };
    const byExpiry = new Map();
    const warnings = [];
    for (const t of trades) {
      const bucket = agg[t.right === 'put' ? 'puts' : 'calls'];
      const sideBucket = bucket[t.side];
      sideBucket.count += 1;
      if (t.price != null && t.quantity != null && t.price >= 0 && t.quantity >= 0) {
        sideBucket.notional = (sideBucket.notional ?? 0) + t.price * t.quantity;
      } else {
        warnings.push(`${t.instrument}: premium notional unavailable (missing price or quantity)`);
      }
      const cur = byExpiry.get(t.expiry) ?? { expiry: t.expiry, calls: 0, puts: 0, buy: 0, sell: 0, block: 0, rfq: 0 };
      if (t.blockTrade) cur.block += 1;
      if (t.rfq) cur.rfq += 1;
      if (t.right === 'put') cur.puts += 1; else cur.calls += 1;
      if (t.side === 'buy') cur.buy += 1; else cur.sell += 1;
      byExpiry.set(t.expiry, cur);
    }
    const now = Date.now();
    const envelope = baseEnvelope(request, {
      asOf: trades[0]?.timestamp ?? now,
      fetchedAt: body.fetchedAt ?? now,
      source: ['deribit'],
      freshness: result.stale ? 'stale' : 'live',
      coverage: coverage(trades.length, (body.trades ?? []).length, trades.length < (body.trades ?? []).length ? ['invalid-trades-dropped'] : []),
      cache: cacheEnvelope(result),
      provenanceByField: { 'data.trades': 'deribit-get_last_trades_by_currency_and_time' },
      unitsByField: {
        'data.aggregates.*.notional': 'venue-native-premium-notional',
        'data.aggregates.*.count': 'trades',
      },
      assumptions: ['Side is taker direction; notional is premium (price × qty), not underlying notional.'],
      warnings: [...new Set(warnings)],
      data: {
        currency,
        hours,
        aggregates: agg,
        expiryDistribution: [...byExpiry.values()].sort((a, b) => a.expiry.localeCompare(b.expiry)),
        count: trades.length,
        hasMore: Boolean(body.hasMore),
      },
    });
    return sendContract(request, reply, 'cryptoFlowResponse', envelope);
  });

  // ── Academy index (real docs catalog) ──────────────────────────────────
  fastify.get('/api/v1/academy/index', async (request, reply) => {
    let index;
    try {
      index = buildAcademyIndex(DOCS_ROOT);
    } catch {
      return sendError(request, reply, {
        statusCode: 502,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'The Academy index could not be read.',
        retryable: false,
        provider: 'static-docs',
      });
    }
    const now = Date.now();
    const categories = Array.isArray(index.categories) ? index.categories : [];
    const children = categories.flatMap((category) => (Array.isArray(category.files) ? category.files : [])
      .map((item) => ({
        ...item,
        categoryId: String(category.id ?? ''),
        categoryLabel: String(category.label ?? category.id ?? ''),
      })));
    const envelope = baseEnvelope(request, {
      asOf: now,
      fetchedAt: now,
      source: ['docs/index.json'],
      freshness: 'live',
      coverage: coverage(children.length, children.length),
      provenanceByField: { 'data.children': 'docs/index.json-static' },
      unitsByField: {},
      assumptions: ['Academy content is server-authored markdown; article bodies are untrusted display content.'],
      warnings: [],
      data: { title: index.title ?? 'Academy', children: children.slice(0, 500) },
    });
    return sendContract(request, reply, 'academyIndexResponse', envelope);
  });

  // ── KSA board (entitlement-gated; server-only key) ─────────────────────
  fastify.get('/api/v1/ksa/board', async (request, reply) => {
    const gate = gateInfoForRequest(request);
    if (gate.enabled && !gate.entitled) {
      return sendError(request, reply, {
        statusCode: 402,
        code: 'ENTITLEMENT_MISSING',
        message: 'KSA board requires an entitled session.',
        retryable: false,
        provider: 'billing',
      });
    }
    if (!process.env.SAHMK_API_KEY) {
      return sendError(request, reply, {
        statusCode: 403,
        code: 'ENTITLEMENT_MISSING',
        message: 'KSA board requires a server-side SAHMK entitlement.',
        retryable: false,
        provider: 'sahmk',
      });
    }
    let board;
    try {
      const { fetchKsaBoard } = await import('../../api/ksaFeeds.js');
      board = await fetchKsaBoard();
    } catch {
      return sendError(request, reply, {
        statusCode: 502,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'The KSA board source is unavailable.',
        retryable: true,
        provider: 'sahmk',
      });
    }
    const now = Date.now();
    const envelope = baseEnvelope(request, {
      asOf: board?.asOf ?? board?.as_of ?? now,
      fetchedAt: now,
      source: ['sahmk'],
      freshness: 'delayed',
      coverage: coverage(board ? 1 : 0, 1, board ? [] : ['board-unavailable']),
      provenanceByField: { data: 'sahmk-session-and-depth' },
      unitsByField: { 'data.index': 'points', 'data.marketCap': 'SAR' },
      assumptions: ['KSA data is delayed exchange data, not live; breadth/value proxies never synthesized.'],
      warnings: [],
      data: board ?? null,
    });
    return sendContract(request, reply, 'ksaBoardResponse', envelope);
  });
}
