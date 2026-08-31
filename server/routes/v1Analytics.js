/**
 * Canonical v1 analytical operations (C2).
 *
 * Every operation composes one domain service through the shared cache
 * (api/upstreamCache.getOrFetch) and validates its serialized response against
 * the shared JSON Schema authority (packages/contracts). No direct uncached
 * provider calls; no raw provider payloads leak into the contract.
 */
import { providerEntitlements } from '../providers/entitlements.js';
import { cacheStats, getOrFetch } from '../../api/upstreamCache.js';
import { resolveRatesWorkerUrl } from '../ratesWorkerUrl.js';
import {
  getDeribitFundingSnapshotResult,
  getDeribitMarketSnapshotResult,
  getDeribitTradesSnapshotResult,
} from './deribitMarket.js';
import { fetchFreeCryptoMarketResult } from '../providers/freeCrypto/client.js';
import { academyIndexJson } from '../../api/academyCatalog.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateInfoForRequest } from '../../api/stripeBilling.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DOCS_ROOT = join(ROOT, 'docs');

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
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
  };
}

function combinedCacheEnvelope(settledResults) {
  const results = settledResults
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  if (results.length === 0) {
    return { state: 'unavailable', hit: false, ageMs: null, stale: false, coalesced: false };
  }
  const stale = results.some((result) => result.stale);
  const allHits = results.every((result) => result.fromCache);
  return {
    state: stale ? 'stale' : allHits ? 'fresh' : 'miss',
    hit: allHits,
    ageMs: Math.max(...results.map((result) => Number.isFinite(result.ageMs) ? Math.max(0, result.ageMs) : 0)),
    stale,
    coalesced: results.some((result) => result.coalesced),
  };
}

export function registerV1AnalyticsRoutes(fastify, { sendContract, sendError, baseEnvelope, coverage } = {}) {
  // ── Provider / cache status ────────────────────────────────────────────
  fastify.get('/api/v1/provider/status', async (request, reply) => {
    const now = Date.now();
    const modes = providerEntitlements();
    const stats = cacheStats();
    const envelope = baseEnvelope(request, {
      asOf: now,
      fetchedAt: now,
      source: ['terminal-api'],
      freshness: 'live',
      coverage: coverage(1, 1),
      provenanceByField: {
        'data.providerModes': 'public-provider-policy',
        'data.cache': 'api/upstreamCache',
      },
      unitsByField: { 'data.cache.entries': 'count', 'data.cache.hits': 'count', 'data.cache.misses': 'count' },
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
      index = academyIndexJson(DOCS_ROOT);
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
    const children = Array.isArray(index.children) ? index.children : [];
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
