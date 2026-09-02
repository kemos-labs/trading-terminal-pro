/**
 * Desk feed routes — restored (Phase 1).
 * Recovers /api/finnhub/quote|news, /api/alphavantage/quote, /api/tradingview/snapshot,
 * /api/desk/pack and /api/venues/options/:currency — all registered routes that
 * Home/Feeds, Academy news and the crypto venue strip call. Implementations
 * recovered from 64c90fa/166dd08/656b9c9 (deleted during decomposition).
 *
 * Rules: all upstream calls server-side, budgeted, cached, single-flight.
 * Keys never leave the server. Fail-closed typed errors — never synthetic prices.
 */
import { getOrFetch, peek, TTL, budgetAllows, monthBudgetAllows, recordBudget, recordMonthBudget, clearBudgetsForTests, ALPHA_VANTAGE_FREE_DAILY, FINNHUB_SOFT_DAILY, getBudgetUsed, getMonthBudgetUsed, sanitizeProviderErrorCode } from '../../api/upstreamCache.js';
import { validateSymbol } from '../validation.js';
import { getDeribitMarketSnapshotResult } from './deribitMarket.js';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const AV_BASE = 'https://www.alphavantage.co/query';
const MAX_BUDGET_STALE_MULTIPLIER = 10;
export const __testHooks = { clearBudgetsForTests, getBudgetUsed, getMonthBudgetUsed, recordBudget, recordMonthBudget };
import { fetchBybitOptionsSummary, fetchOkxOptionsSummary } from '../providers/freeOptions/client.js';

function finnhubKey() { return process.env.FINNHUB_API_KEY || null; }

function finnhubDate(d = new Date()) { return d.toISOString().slice(0, 10); }

function observedNonNegative(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function sumObserved(rows, select) {
  const values = rows.map(select).map(observedNonNegative).filter((value) => value != null);
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
}

async function finnhubGet(path, params = {}) {
  const key = finnhubKey();
  if (!key) {
    const err = new Error('FINNHUB_API_KEY not configured');
    err.code = 'no_api_key';
    throw err;
  }
  const u = new URL(`${FINNHUB_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') u.searchParams.set(k, String(v));
  }
  u.searchParams.set('token', key);
  const res = await fetch(u.toString(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  recordBudget('finnhub', 1);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Finnhub HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function cacheMetadata(result) {
  const stale = Boolean(result?.stale);
  const hit = Boolean(result?.fromCache);
  const providerError = sanitizeProviderErrorCode(result?.providerError);
  return {
    state: providerError && stale ? 'stale' : providerError ? 'unavailable' : stale ? 'stale' : hit ? 'fresh' : 'miss',
    hit,
    ageMs: Number.isFinite(result?.ageMs) ? Math.max(0, result.ageMs) : 0,
    stale,
    coalesced: Boolean(result?.coalesced),
    providerError,
  };
}

function budgetStaleMetadata(ageMs) {
  return { state: 'stale', hit: true, ageMs: Math.max(0, ageMs), stale: true, coalesced: false, providerError: sanitizeProviderErrorCode('budget_exhausted') };
}

/** Deribit totals from the canonical cached market snapshot (public, keyless). */
async function deribitOptionsSummary(ccy) {
  try {
    const result = await getDeribitMarketSnapshotResult(ccy);
    const list = Array.isArray(result?.data?.instruments)
      ? result.data.instruments.filter((row) => row?.kind === 'option')
      : [];
    if (!list.length) return null;
    return { data: {
      venue: 'Deribit',
      source: 'deribit-public',
      instruments: list.length,
      volume24hBaseCcy: sumObserved(list, (row) => row.volume),
      volume24hUsd: sumObserved(list, (row) => row.volumeUsd),
      openInterestBaseCcy: sumObserved(list, (row) => row.openInterest),
      openInterestNative: null,
      units: { volume24hBaseCcy: 'base currency (Deribit volume)', volume24hNative: null, volume24hUsd: 'USD (Deribit volume_usd)', openInterestBaseCcy: 'base currency (Deribit open_interest)', openInterestNative: null },
      fetchedAt: result.data.fetchedAt ?? Date.now(),
    }, ...cacheMetadata(result) };
  } catch { return null; }
}

export function registerDeskFeedRoutes(fastify) {
  fastify.get('/api/finnhub/quote', async (request, reply) => {
    const raw = String(request.query?.symbol || 'SPY').toUpperCase();
    const symbol = validateSymbol(raw) || 'SPY';
    try {
      const result = await getOrFetch(`finnhub:quote:${symbol}`, TTL.FINNHUB_QUOTE_MS, async () => {
        const q = await finnhubGet('/quote', { symbol });
        const price = Number(q?.c);
        return {
          symbol,
          price: price > 0 ? price : null,
          change: q?.d != null ? Number(q.d) : null,
          change_pct: q?.dp != null ? Number(q.dp) : null,
          high: q?.h != null ? Number(q.h) : null,
          low: q?.l != null ? Number(q.l) : null,
          open: q?.o != null ? Number(q.o) : null,
          previous_close: q?.pc != null ? Number(q.pc) : null,
          as_of: new Date().toISOString(),
          source: 'Finnhub',
          error: price > 0 ? null : 'empty',
          note: 'Shared desk quote · server budget · not per-visitor.',
        };
      }, { allowStaleOnError: true });
      return { ...result.data, fromCache: result.fromCache, ageMs: result.ageMs, cache: cacheMetadata(result) };
    } catch (err) {
      if (err?.code === 'no_api_key' || String(err?.message || '').includes('not configured')) {
        reply.code(503);
        return { symbol, price: null, error: 'no_api_key', source: 'Finnhub', note: 'Set FINNHUB_API_KEY. Fail-closed.' };
      }
      reply.code(502);
      return { symbol, price: null, error: err.message, source: 'Finnhub', note: 'Finnhub quote failed. No synthetic price.' };
    }
  });

  fastify.get('/api/finnhub/news', async (request, reply) => {
    const raw = String(request.query?.symbol || 'SPY').toUpperCase();
    const symbol = validateSymbol(raw) || 'SPY';
    const limit = Math.min(30, Math.max(1, parseInt(String(request.query?.limit || '12'), 10) || 12));
    // Fail closed when unconfigured — an empty 200 would misread as "no news today".
    if (!finnhubKey()) {
      reply.code(503);
      return { symbol, items: [], count: 0, error: 'no_api_key', source: 'Finnhub', note: 'Headlines unavailable without FINNHUB_API_KEY. Fail-closed.' };
    }
    const cacheKey = `finnhub:news:${symbol}:${limit}`;
    try {
      const result = await getOrFetch(cacheKey, TTL.FINNHUB_NEWS_MS, async () => {
        const to = new Date();
        const from = new Date(to.getTime() - 14 * 24 * 3600 * 1000);
        let company = [];
        try {
          const rows = await finnhubGet('/company-news', { symbol, from: finnhubDate(from), to: finnhubDate(to) });
          company = Array.isArray(rows) ? rows : [];
        } catch { company = []; }
        let general = [];
        try {
          const rows = await finnhubGet('/news', { category: 'general' });
          general = Array.isArray(rows) ? rows : [];
        } catch { general = []; }
        const mapItem = (n, related) => ({
          id: n.id ?? `${n.datetime}-${n.headline}`,
          datetime: n.datetime ?? null,
          headline: n.headline || '',
          summary: n.summary || '',
          source: n.source || '',
          url: n.url || null,
          related: related || n.related || '',
          category: n.category || '',
        });
        const items = [
          ...company.slice(0, limit).map((n) => mapItem(n, symbol)),
          ...general.slice(0, Math.max(0, limit - Math.min(company.length, limit))).map((n) => mapItem(n, 'MARKET')),
        ]
          .filter((n) => n.headline)
          .slice(0, limit);
        return {
          symbol,
          items,
          count: items.length,
          as_of: new Date().toISOString(),
          source: 'Finnhub',
          note: items.length ? 'Company + general headlines. Not trade advice.' : 'No headlines returned (rate limit or empty).',
          error: items.length ? null : 'empty',
        };
      }, { allowStaleOnError: true });
      return { ...result.data, fromCache: result.fromCache, ageMs: result.ageMs, cache: cacheMetadata(result) };
    } catch (err) {
      if (err?.code === 'no_api_key') {
        reply.code(503);
        return { symbol, items: [], count: 0, error: 'no_api_key', source: 'Finnhub', note: 'Headlines unavailable without FINNHUB_API_KEY. Fail-closed.' };
      }
      reply.code(502);
      return { symbol, items: [], count: 0, error: 'Finnhub news failed', detail: err.message, source: 'Finnhub' };
    }
  });

  fastify.get('/api/finnhub/earnings', async (request, reply) => {
    const raw = String(request.query?.symbol || 'SPY').toUpperCase();
    const symbol = validateSymbol(raw) || 'SPY';
    try {
      const { data, fromCache, ageMs } = await getOrFetch(
        `finnhub:earnings:${symbol}`,
        TTL.FINNHUB_EARNINGS_MS,
        async () => {
          const from = new Date();
          const to = new Date(from.getTime() + 120 * 86_400_000);
          let rows = [];
          try {
            const payload = await finnhubGet('/calendar/earnings', {
              symbol,
              from: finnhubDate(from),
              to: finnhubDate(to),
            });
            rows = Array.isArray(payload?.earningsCalendar) ? payload.earningsCalendar : [];
          } catch {
            const history = await finnhubGet('/stock/earnings', { symbol, limit: 4 });
            rows = Array.isArray(history) ? history.map((row) => ({
              symbol,
              date: row.period ?? null,
              epsActual: row.actual,
              epsEstimate: row.estimate,
              hour: null,
              quarter: row.quarter,
              year: row.year,
            })) : [];
          }
          const normalized = rows.map((row) => ({
            symbol: row.symbol || symbol,
            date: row.date || null,
            hour: row.hour || null,
            eps_estimate: row.epsEstimate ?? row.eps_estimate ?? null,
            eps_actual: row.epsActual ?? row.eps_actual ?? null,
            revenue_estimate: row.revenueEstimate ?? null,
            revenue_actual: row.revenueActual ?? null,
            quarter: row.quarter ?? null,
            year: row.year ?? null,
          }));
          const today = finnhubDate();
          const upcoming = normalized
            .filter((row) => row.date && row.date >= today)
            .sort((a, b) => String(a.date).localeCompare(String(b.date)));
          const next = upcoming[0] || normalized[0] || null;
          return {
            symbol,
            next,
            upcoming: upcoming.slice(0, 6),
            recent: normalized.slice(0, 6),
            as_of: new Date().toISOString(),
            source: 'Finnhub',
            error: next ? null : 'empty',
            note: next ? 'Finnhub earnings calendar.' : 'No earnings date returned.',
          };
        },
        { allowStaleOnError: true },
      );
      return { ...data, fromCache, ageMs };
    } catch (err) {
      const noKey = err?.code === 'no_api_key' || String(err?.message || '').includes('not configured');
      reply.code(noKey ? 503 : 502);
      return {
        symbol,
        next: null,
        upcoming: [],
        recent: [],
        error: noKey ? 'no_api_key' : 'Finnhub earnings failed',
        detail: noKey ? undefined : err.message,
        source: 'Finnhub',
        note: 'No synthetic earnings date.',
      };
    }
  });

  fastify.get('/api/finnhub/economic-calendar', async (request, reply) => {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const fromRaw = String(request.query?.from || '');
    const toRaw = String(request.query?.to || '');
    if ((fromRaw && !datePattern.test(fromRaw)) || (toRaw && !datePattern.test(toRaw))) {
      reply.code(400);
      return { error: 'from/to must be YYYY-MM-DD' };
    }
    const from = fromRaw || finnhubDate();
    const toDate = new Date();
    toDate.setUTCDate(toDate.getUTCDate() + 14);
    const to = toRaw || finnhubDate(toDate);
    if (!budgetAllows('finnhub', FINNHUB_SOFT_DAILY, 0.9)) {
      reply.code(429);
      return { from, to, events: [], error: 'budget_exhausted', source: 'Finnhub' };
    }
    try {
      const { data, fromCache, ageMs } = await getOrFetch(
        `finnhub:eco:${from}:${to}`,
        TTL.FINNHUB_ECO_MS,
        async () => {
          const payload = await finnhubGet('/calendar/economic', { from, to });
          const rows = Array.isArray(payload?.economicCalendar)
            ? payload.economicCalendar
            : Array.isArray(payload) ? payload : [];
          const events = rows.slice(0, 40).map((row, index) => ({
            id: row?.event ? `${row.event}-${row.time || row.date || index}` : `eco-${index}`,
            country: row?.country || null,
            event: row?.event || row?.name || null,
            time: row?.time || row?.date || null,
            impact: row?.impact || row?.importance || null,
            actual: row?.actual ?? null,
            estimate: row?.estimate ?? row?.consensus ?? null,
            prev: row?.prev ?? row?.previous ?? null,
          })).filter((event) => event.event);
          return {
            from,
            to,
            events,
            count: events.length,
            as_of: new Date().toISOString(),
            source: 'Finnhub',
            error: events.length ? null : 'empty',
            note: 'Shared economic calendar · 6h TTL.',
          };
        },
        { allowStaleOnError: true },
      );
      return { ...data, fromCache, ageMs };
    } catch (err) {
      const noKey = err?.code === 'no_api_key' || String(err?.message || '').includes('not configured');
      reply.code(noKey ? 503 : 502);
      return { from, to, events: [], error: noKey ? 'no_api_key' : 'unavailable', detail: noKey ? undefined : err.message, source: 'Finnhub' };
    }
  });

  fastify.get('/api/finnhub/recommendation', async (request, reply) => {
    const symbol = validateSymbol(String(request.query?.symbol || 'SPY')) || 'SPY';
    try {
      const { data, fromCache, ageMs } = await getOrFetch(
        `finnhub:rec:${symbol}`,
        TTL.FINNHUB_META_MS,
        async () => {
          const rows = await finnhubGet('/stock/recommendation', { symbol });
          const latest = Array.isArray(rows) ? rows[0] ?? null : null;
          return {
            symbol,
            latest: latest ? {
              period: latest.period || null,
              strongBuy: latest.strongBuy ?? null,
              buy: latest.buy ?? null,
              hold: latest.hold ?? null,
              sell: latest.sell ?? null,
              strongSell: latest.strongSell ?? null,
            } : null,
            history_count: Array.isArray(rows) ? rows.length : 0,
            as_of: new Date().toISOString(),
            source: 'Finnhub',
            error: latest ? null : 'empty',
          };
        },
        { allowStaleOnError: true },
      );
      return { ...data, fromCache, ageMs };
    } catch (err) {
      const noKey = err?.code === 'no_api_key' || String(err?.message || '').includes('not configured');
      reply.code(noKey ? 503 : 502);
      return { symbol, latest: null, error: noKey ? 'no_api_key' : 'unavailable', detail: noKey ? undefined : err.message, source: 'Finnhub' };
    }
  });

  fastify.get('/api/finnhub/peers', async (request, reply) => {
    const symbol = validateSymbol(String(request.query?.symbol || 'SPY')) || 'SPY';
    try {
      const { data, fromCache, ageMs } = await getOrFetch(
        `finnhub:peers:${symbol}`,
        TTL.FINNHUB_META_MS,
        async () => {
          const rows = await finnhubGet('/stock/peers', { symbol });
          const peers = (Array.isArray(rows) ? rows : [])
            .map((peer) => String(peer || '').toUpperCase())
            .filter((peer) => peer && peer !== symbol)
            .slice(0, 12);
          return {
            symbol,
            peers,
            count: peers.length,
            as_of: new Date().toISOString(),
            source: 'Finnhub',
            error: peers.length ? null : 'empty',
          };
        },
        { allowStaleOnError: true },
      );
      return { ...data, fromCache, ageMs };
    } catch (err) {
      const noKey = err?.code === 'no_api_key' || String(err?.message || '').includes('not configured');
      reply.code(noKey ? 503 : 502);
      return { symbol, peers: [], error: noKey ? 'no_api_key' : 'unavailable', detail: noKey ? undefined : err.message, source: 'Finnhub' };
    }
  });

  fastify.get('/api/alphavantage/quote', async (request, reply) => {
    const raw = String(request.query?.symbol || 'SPY').toUpperCase();
    const symbol = validateSymbol(raw) || 'SPY';
    const key = process.env.ALPHA_VANTAGE_API_KEY || process.env.ALPHAVANTAGE_API_KEY || null;
    if (!key) {
      reply.code(503);
      return { symbol, price: null, error: 'no_api_key', source: 'Alpha Vantage', note: 'Set ALPHA_VANTAGE_API_KEY. Fail-closed.' };
    }
    if (!budgetAllows('alphavantage', ALPHA_VANTAGE_FREE_DAILY, 0.85)) {
      const stale = peek(`av:quote:${symbol}`);
      const ageMs = stale ? Date.now() - stale.timestamp : Infinity;
      if (stale && ageMs <= TTL.ALPHA_VANTAGE_MS * MAX_BUDGET_STALE_MULTIPLIER) {
        reply.header('X-Cache', 'STALE-BUDGET');
        return { ...stale.data, fromCache: true, ageMs, cache: budgetStaleMetadata(ageMs) };
      }
      reply.code(429);
      return { symbol, price: null, error: 'budget_exhausted', cap: ALPHA_VANTAGE_FREE_DAILY, used: getBudgetUsed('alphavantage'), source: 'Alpha Vantage' };
    }
    try {
      const result = await getOrFetch(`av:quote:${symbol}`, TTL.ALPHA_VANTAGE_MS, async () => {
        const u = new URL(AV_BASE);
        u.searchParams.set('function', 'GLOBAL_QUOTE');
        u.searchParams.set('symbol', symbol);
        u.searchParams.set('apikey', key);
        recordBudget('alphavantage', 1);
        const res = await fetch(u.toString(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
        const json = await res.json();
        if (json?.Note || json?.Information) throw new Error(String(json.Note || json.Information));
        const g = json?.['Global Quote'] ?? {};
        const price = Number(g['05. price']);
        return {
          symbol,
          price: price > 0 ? price : null,
          change: g['09. change'] != null ? Number(g['09. change']) : null,
          change_pct: g['10. change percent'] != null ? parseFloat(g['10. change percent']) : null,
          as_of: new Date().toISOString(),
          source: 'Alpha Vantage',
          error: price > 0 ? null : 'empty',
        };
      }, { allowStaleOnError: true });
      return { ...result.data, fromCache: result.fromCache, ageMs: result.ageMs, cache: cacheMetadata(result) };
    } catch (err) {
      reply.code(502);
      return { symbol, price: null, error: 'Alpha Vantage quote failed', detail: err.message, source: 'Alpha Vantage' };
    }
  });

  fastify.get('/api/tradingview/snapshot', async (request, reply) => {
    const raw = String(request.query?.symbol || 'SPY').toUpperCase();
    const symbol = validateSymbol(raw) || 'SPY';
    const key = process.env.RAPIDAPI_KEY || process.env.X_RAPIDAPI_KEY || null;
    if (!key) {
      reply.code(503);
      return { symbol, price: null, error: 'no_api_key', source: 'TradingView RapidAPI', note: 'Set RAPIDAPI_KEY. Fail-closed.' };
    }
    const host = process.env.RAPIDAPI_TV_HOST || 'tradingview-data1.p.rapidapi.com';
    if (!monthBudgetAllows('tradingview', 150, 0.9)) {
      const stale = peek(`tv:snap:${symbol}`);
      const ageMs = stale ? Date.now() - stale.timestamp : Infinity;
      if (stale && ageMs <= TTL.TRADINGVIEW_MS * MAX_BUDGET_STALE_MULTIPLIER) {
        reply.header('X-Cache', 'STALE-BUDGET');
        return { ...stale.data, fromCache: true, ageMs, cache: budgetStaleMetadata(ageMs) };
      }
      reply.code(429);
      return { symbol, price: null, error: 'budget_exhausted', cap: 150, used: getMonthBudgetUsed('tradingview'), source: 'TradingView RapidAPI' };
    }
    try {
      const result = await getOrFetch(`tv:snap:${symbol}`, TTL.TRADINGVIEW_MS, async () => {
        const u = `https://${host}/symbols/get-tick-raw?symbol=${encodeURIComponent(symbol)}`;
        recordMonthBudget('tradingview', 1);
        const res = await fetch(u, {
          headers: { 'x-rapidapi-host': host, 'x-rapidapi-key': key, Accept: 'application/json' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`TradingView HTTP ${res.status}`);
        const json = await res.json();
        const price = Number(json?.close ?? json?.last_price ?? json?.lp);
        return {
          symbol,
          price: Number.isFinite(price) && price > 0 ? price : null,
          as_of: new Date().toISOString(),
          source: 'TradingView RapidAPI',
          error: null,
        };
      }, { allowStaleOnError: true });
      return { ...result.data, fromCache: result.fromCache, ageMs: result.ageMs, cache: cacheMetadata(result) };
    } catch (err) {
      reply.code(502);
      return { symbol, price: null, error: 'TradingView snapshot failed', detail: err.message, source: 'TradingView RapidAPI' };
    }
  });

  // Shared desk pack — one call per client refresh; every field from shared cache.
  fastify.get('/api/desk/pack', async (request, reply) => {
    const symbol = validateSymbol(String(request.query?.symbol || 'SPY')) || 'SPY';
    try {
      const base = `http://127.0.0.1:${fastify.server?.address()?.port ?? (process.env.PORT || '3001')}`;
      const avQuotePeek = peek(`av:quote:${symbol}`);
      const avDailyPeek = peek(`av:daily:${symbol}:40`) || peek(`av:daily:${symbol}:60`);
      const tvPeek = peek(`tv:snap:${symbol}`) || peek('tv:snap:SPY');

      const [fhQuote, fhNews, cache] = await Promise.all([
        fetch(`${base}/api/finnhub/quote?symbol=${symbol}`).then((r) => r.json()).catch((e) => ({ error: e.message })),
        fetch(`${base}/api/finnhub/news?symbol=${symbol}&limit=6`).then((r) => r.json()).catch((e) => ({ error: e.message })),
        fetch(`${base}/api/cache/status`).then((r) => r.json()).catch(() => null),
      ]);

      let avQuote = avQuotePeek ? { ...avQuotePeek.data, fromCache: true, ageMs: Date.now() - avQuotePeek.timestamp } : null;
      let avDaily = avDailyPeek ? { ...avDailyPeek.data, fromCache: true, ageMs: Date.now() - avDailyPeek.timestamp } : null;
      let tv = tvPeek ? { ...tvPeek.data, fromCache: true, ageMs: Date.now() - tvPeek.timestamp } : null;

      // Optional fill only if warmer has not yet run and budget remains (1 AV call max here).
      if (!avQuote && budgetAllows('alphavantage', ALPHA_VANTAGE_FREE_DAILY, 0.85)) {
        avQuote = await fetch(`${base}/api/alphavantage/quote?symbol=${symbol}`).then((r) => r.json()).catch((e) => ({ error: e.message, source: 'Alpha Vantage' }));
      }
      if (!tv && process.env.RAPIDAPI_KEY) {
        tv = { price: null, error: 'awaiting_warmer', note: 'TradingView fills on server warmer (~few times/day). Not used for rates.', source: 'TradingView RapidAPI' };
      }

      return {
        symbol,
        finnhub_quote: fhQuote,
        alphavantage_quote: avQuote,
        alphavantage_daily: avDaily,
        finnhub_news: fhNews,
        tradingview: tv,
        budgets: cache?.budgets || null,
        keys: cache?.keys || null,
        as_of: new Date().toISOString(),
        note: 'Shared desk pack · Finnhub live-cached · AV/TV from server board (warmer-owned).',
      };
    } catch (err) {
      reply.code(502);
      return { error: err.message, note: 'Desk pack failed.' };
    }
  });

  // Multi-venue options aggregation (public endpoints, no keys).
  fastify.get('/api/venues/options/:currency', async (request, reply) => {
    if (String(request.raw?.url || request.url || '').includes('?')) {
      reply.code(400);
      return { error: 'UNSUPPORTED_QUERY', detail: 'options aggregation does not accept query parameters' };
    }
    const currency = String(request.params.currency || '').trim();
    if (currency !== 'BTC' && currency !== 'ETH') {
      reply.code(400);
      return { error: 'UNSUPPORTED_CURRENCY', detail: 'currency must be BTC or ETH' };
    }
    try {
      const aggregate = await getOrFetch(`venues:options:${currency}`, 30_000, async () => {
        const results = await Promise.allSettled([deribitOptionsSummary(currency), fetchOkxOptionsSummary(currency), fetchBybitOptionsSummary(currency)]);
        const venues = results.filter((result) => result.status === 'fulfilled').map((result) => {
          const value = result.value;
          if (!value?.data) return null;
          return { ...value.data, cache: cacheMetadata(value) };
        }).filter(Boolean);
        if (!venues.length) throw Object.assign(new Error('All venue summaries unavailable'), { code: 'OPTIONS_VENUES_UNAVAILABLE' });
        return { currency, source: 'public-options-aggregates', venues, fetchedAt: Date.now() };
      }, { allowStaleOnError: true });
      return { ...aggregate.data, cache: cacheMetadata(aggregate) };
    } catch (err) {
      reply.code(502);
      return { error: err?.code === 'OPTIONS_VENUES_UNAVAILABLE' ? err.code : 'OPTIONS_VENUES_UNAVAILABLE', detail: err.message };
    }
  });
}
