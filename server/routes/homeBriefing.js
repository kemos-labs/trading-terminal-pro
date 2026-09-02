/**
 * Home briefing — one canonical composed snapshot for the Home desk (Phase 2).
 * One browser request → one canonical snapshot; every field is served from the
 * shared cache/warmers (finnhub quote, MacroVol rates pipe, Deribit BTC, free
 * Binance/Bybit snapshot, KSA board, cache/budget status). Never per-widget
 * upstream polling. Missing providers become typed unavailable entries — never
 * synthetic values, never zeros for missing data.
 */
import { getOrFetch, cacheStats, sanitizeProviderErrorCode } from '../../api/upstreamCache.js';
import { validateSymbol } from '../validation.js';

const BRIEFING_TTL_MS = 60_000;

function unavailable(provider, reason, detail) {
  return { available: false, provider, reason, detail: detail ?? null };
}

export function registerHomeBriefingRoutes(fastify, opts = {}) {
  const MACROVOL_BASE = (opts.macrovolBase ?? (process.env.MACROVOL_API_URL || 'http://127.0.0.1:8765')).replace(/\/$/, '');
  const selfBase = () => `http://127.0.0.1:${fastify.server?.address()?.port ?? (process.env.PORT || '3001')}`;

  fastify.get('/api/home/briefing', async (request, reply) => {
    const symbol = validateSymbol(String(request.query?.symbol || 'SPY')) || 'SPY';
    try {
      const {
        data,
        fromCache,
        ageMs,
        stale,
        coalesced,
        providerError,
      } = await getOrFetch(`home:briefing:${symbol}`, BRIEFING_TTL_MS, async () => {
        const base = selfBase();

        // Equity quote — shared finnhub route (typed fail-closed 503/502 bodies).
        const quote = await fetch(`${base}/api/finnhub/quote?symbol=${symbol}`)
          .then((r) => r.json())
          .catch((e) => unavailable('finnhub', 'upstream_error', e.message));
        const quoteOk = quote && quote.available !== false && quote.error == null && quote.price != null;

        // Rates — MacroVol private worker via local loopback (light path).
        const ratesRaw = await fetch(`${MACROVOL_BASE}/api/rates/summary`, { signal: AbortSignal.timeout(8_000) })
          .then((r) => (r.ok ? r.json() : unavailable('macrovol', r.status === 503 ? 'entitlement_missing' : 'upstream_error', `HTTP ${r.status}`)))
          .catch((e) => unavailable('macrovol', 'upstream_error', e.message));
        // Keyless fallback — OFR primary repo prints (SOFR/BGCR/TGCR) + ECB DFR (no key, 1h cache).
        const rates = ratesRaw && (ratesRaw.sofr != null || ratesRaw.usy10 != null)
          ? ratesRaw
          : await fetch(`${MACROVOL_BASE}/api/macro/primary`, { signal: AbortSignal.timeout(8_000) })
              .then((r) => (r.ok ? r.json() : ratesRaw))
              .then((p) => ({
                sofr: p?.sofr_ofr ?? null,
                bgcr: p?.bgcr ?? null,
                tgcr: p?.tgcr ?? null,
                ecb_dfr: p?.ecb_dfr ?? null,
                usy2: null,
                usy10: null,
                spread_2s10s: null,
                source: 'OFR via macrovol (keyless)',
                as_of: p?.as_of ?? null,
              }))
              .catch(() => ratesRaw);

        // Crypto — Deribit authoritative + independent free multi-venue snapshot.
        const [deribit, freeCrypto] = await Promise.all([
          fetch(`${base}/api/deribit/market/BTC`)
            .then((r) => (r.ok ? r.json() : unavailable('deribit', 'upstream_error', `HTTP ${r.status}`)))
            .catch((e) => unavailable('deribit', 'upstream_error', e.message)),
          fetch(`${base}/api/free-crypto/market/BTC`)
            .then((r) => (r.ok ? r.json() : unavailable('free-exchanges', 'upstream_error', `HTTP ${r.status}`)))
            .catch((e) => unavailable('free-exchanges', 'upstream_error', e.message)),
        ]);

        // KSA — shared warmer board only (no per-request upstream).
        const ksaLive = await fetch(`${base}/api/ksa/board`)
          .then((r) => (r.ok ? r.json() : { available: false, reason: r.status === 402 ? 'subscription_required' : 'upstream_error', detail: `HTTP ${r.status}` }))
          .catch((e) => unavailable('sahmk', 'upstream_error', e.message));

        const perp = deribit && deribit.available !== false
          ? (deribit.instruments ?? []).find((t) => t.kind === 'perp') ?? null
          : null;

        if (freeCrypto?.available === true && !Array.isArray(freeCrypto.venues)) {
          throw Object.assign(new Error('Malformed free-crypto venue payload'), { code: 'invalid_payload' });
        }

        const sources = [];
        if (quoteOk) sources.push('finnhub/quote');
        if (rates && rates.sofr != null) sources.push('macrovol/fred:rates-summary');
        if (deribit && deribit.available !== false) sources.push('deribit/market:BTC');
        if (freeCrypto && freeCrypto.available !== false) sources.push('binance+bybit/free-crypto:BTC');
        if (ksaLive?.configured) sources.push('sahmk/board');
        return {
          schemaVersion: 1,
          symbol,
          asOf: new Date().toISOString(),
          sources,
          desks: {
            equities: {
              available: quoteOk,
              provider: 'finnhub',
              symbol,
              price: quoteOk ? quote.price : null,
              changePct: quoteOk ? quote.change_pct : null,
              asOf: quoteOk ? quote.as_of : null,
              note: quote?.note ?? null,
            },
            rates: {
              available: !!(rates && rates.sofr != null),
              provider: rates?.source === 'OFR via macrovol (keyless)' ? 'OFR(fred-keyless)' : 'macrovol(fred)',
              sofr: rates?.sofr ?? null,
              effr: rates?.effr ?? null,
              bgcr: rates?.bgcr ?? null,
              tgcr: rates?.tgcr ?? null,
              ecbDfr: rates?.ecb_dfr ?? null,
              usy2: rates?.usy2 ?? null,
              usy10: rates?.usy10 ?? null,
              spread_2s10s_bps: rates?.spread_2s10s != null ? rates.spread_2s10s * 100 : null,
              asOf: rates?.as_of ?? null,
            },
            crypto: {
              available: deribit && deribit.available !== false,
              provider: 'deribit',
              indexPrice: deribit?.indexPrice ?? perp?.markPrice ?? null,
              funding8h: perp?.funding8h ?? deribit?.funding8h ?? null,
              optionCount: deribit && deribit.available !== false
                ? (deribit.instruments ?? []).filter((t) => t.kind === 'option').length
                : null,
              asOf: deribit?.fetchedAt ?? null,
              freeFallback: freeCrypto && freeCrypto.available !== false
                ? {
                    provider: 'binance+bybit (public, not Velo-normalized)',
                    venues: (freeCrypto.venues ?? []).map((v) => ({ venue: v.venue, mark: v.mark ?? null, index: v.index ?? null, last: v.last ?? null })),
                    asOf: freeCrypto.fetchedAt ?? null,
                  }
                : { available: false, reason: freeCrypto?.reason ?? 'unavailable', provider: 'binance+bybit' },
            },
            ksa: {
              available: !!(ksaLive && ksaLive.configured === true && ksaLive.tasi?.index_value != null),
              provider: 'sahmk',
              tasi: ksaLive?.tasi?.index_value ?? null,
              tasiChangePct: ksaLive?.tasi?.index_change_percent ?? null,
              delayed: ksaLive?.tasi?.is_delayed ?? null,
              asOf: ksaLive?.tasi?.timestamp ?? null,
            },
          },
          freshness: { live: true },
          warnings: [],
        };
      }, { allowStaleOnError: true });

      const cache = cacheStats();
      const cacheEnvelope = {
        state: stale ? 'stale' : fromCache ? 'fresh' : 'miss',
        hit: Boolean(fromCache),
        ageMs: Number.isFinite(ageMs) ? Math.max(0, ageMs) : null,
        stale: Boolean(stale),
        coalesced: Boolean(coalesced),
        providerError: sanitizeProviderErrorCode(providerError),
      };
      const availableDeskCount = Object.values(data.desks ?? {}).filter((desk) => desk?.available === true).length;
      const freshnessState = stale
        ? 'stale'
        : availableDeskCount === 0 || (data.sources ?? []).length === 0
          ? 'unavailable'
          : availableDeskCount < Object.keys(data.desks ?? {}).length
            ? 'partial'
            : 'live';
      return {
        ...data,
        fromCache,
        ageMs,
        stale: Boolean(stale),
        cache: cacheEnvelope,
        // Preserve legacy cacheStatus fields while exposing the complete
        // envelope above; stale snapshots are never labelled live.
        cacheStatus: { ...cacheEnvelope, entries: cache.entries ?? null, budgets: cache.budgets ?? null },
        freshness: { ...data.freshness, live: freshnessState === 'live', state: freshnessState },
      };
    } catch (err) {
      reply.code(502);
      return { error: 'home_briefing_failed', detail: err.message, symbol };
    }
  });
}
