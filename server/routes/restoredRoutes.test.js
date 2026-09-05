/**
 * Restored equity/desk/academy route tests — real Fastify injection (Phase 1).
 * Exercises the actual registered routes through buildServer(). The upstream
 * boundary is stubbed deterministically: fetch for HTTP providers, and the
 * route module's __testHooks.execFile for the yfinance python fetchers
 * (child process spawns cannot be intercepted in-band). Routing, validation,
 * caching and fail-closed semantics run for real.
 *
 * Note: app.inject() normalizes %2e%2e per WHATWG URL semantics before the
 * request reaches Fastify, so encoded-traversal is asserted over a real
 * listening socket with a verbatim request path (node:http).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { clearCacheForTests, TTL } from '../../api/upstreamCache.js';
import { resetDeribitClientState } from '../providers/deribit/client.js';
import { resetProviderCircuitsForTests } from '../../api/providerCircuitBreaker.js';

const REAL_FETCH = global.fetch;
let runtimeDesk;
let runtimeEquity;

/** Test-only execFile double for the yfinance python boundary (SPY fixture). */
const execFileDouble = vi.fn((_cmd, args, _opts, cb) => {
  const symbol = String(args?.[1] ?? '');
  const mode = String(args?.[2] ?? '');
  if (symbol === 'SPY') {
    if (mode === 'history') {
      const bars = Array.from({ length: 30 }, (_, i) => ({
        date: `2026-07-${String(30 - i).padStart(2, '0')}`,
        open: 500, high: 505, low: 495, close: 500 + i * 0.1, volume: 1_000,
      }));
      cb?.(null, JSON.stringify({ symbol, bars }), '');
      return;
    }
    const expiries = ['2026-09-18', '2026-12-18'];
    const strikes = [490, 500, 510];
    const quotes = [];
    for (const expiry of expiries) {
      for (const strike of strikes) {
        for (const type of ['call', 'put']) {
          quotes.push({
            contractSymbol: `SPY${expiry.replaceAll('-', '')}${type === 'call' ? 'C' : 'P'}${String(strike * 1000).padStart(8, '0')}`,
            strike, type, expiry,
            bid: 1.5, ask: 2.0, lastPrice: 1.75, volume: 100, openInterest: 50,
            impliedVolatility: 0.2, inTheMoney: type === 'call' ? strike < 500 : strike > 500,
          });
        }
      }
    }
    cb?.(null, JSON.stringify({ symbol, spot: 500.25, quotes }), '');
    return;
  }
  // Unknown symbol → provider error, never fabricated.
  cb?.(new Error('yfinance: no options for symbol'), '', 'err');
});

async function makeApp(envOverrides = {}) {
  vi.resetModules();
  const { __testHooks } = await import('./equityFeeds.js');
  __testHooks.execFile = execFileDouble;
  runtimeEquity = { __testHooks };
  for (const [k, v] of Object.entries(envOverrides)) process.env[k] = v;
  const { buildServer } = await import('../app.js');
  const server = buildServer();
  runtimeDesk = await import('./deskFeeds.js');
  return server;
}

/** Raw-socket GET with a verbatim (non-normalized) request path. */
function rawGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, contentType: res.headers['content-type'] || '', body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('restored routes (Phase 1 parity)', () => {
  let app;

  beforeEach(async () => {
    clearCacheForTests();
    resetDeribitClientState();
    resetProviderCircuitsForTests();
    app = await makeApp();
  });

  afterEach(async () => {
    runtimeDesk?.__testHooks.clearBudgetsForTests();
    delete process.env.ALPHA_VANTAGE_API_KEY;
    delete process.env.ALPHAVANTAGE_API_KEY;
    delete process.env.RAPIDAPI_KEY;
    delete process.env.X_RAPIDAPI_KEY;
    global.fetch = REAL_FETCH;
    resetProviderCircuitsForTests();
    if (app) await app.close();
  });

  it('option chain: validates symbol, serves fixture chain, probe flags availability', async () => {
    const bad = await app.inject('/api/options/AA++');
    expect(bad.statusCode).toBe(400);

    const probe = await app.inject('/api/options/SPY?probe=1');
    expect(probe.statusCode).toBe(200);
    expect(probe.json().available).toBe(true);
    expect(probe.json().contracts).toBeGreaterThanOrEqual(10);

    const full = await app.inject('/api/options/SPY');
    expect(full.statusCode).toBe(200);
    const body = full.json();
    expect(Array.isArray(body.quotes)).toBe(true);
    expect(body.quotes.length).toBeGreaterThan(0);
    expect(body.spot).toBe(500.25);
    expect(body._cache).toMatchObject({ hit: true, stale: false, coalesced: false, providerError: null });
  }, 30_000);

  it('option chain fails closed 502 when the provider errors (never fabricates)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app.inject('/api/options/ZZZZZZ');
      expect(res.statusCode).toBe(502);
      expect(res.json().error).toBe('Failed to fetch data');
      expect(errorSpy).toHaveBeenCalledWith('API endpoint error:', expect.objectContaining({ message: 'err' }));
    } finally {
      errorSpy.mockRestore();
    }
  }, 30_000);

  it('yf history serves real-shaped bars through the shared cache', async () => {
    const res = await app.inject('/api/yf/history/SPY');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.bars)).toBe(true);
    expect(body.bars.length).toBe(30);
    expect(typeof body.bars[0].close).toBe('number');
  }, 30_000);

  it('yfinance history exposes cache state, coalesces joins, and fails closed on stale expiry/malformed data', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-02T00:00:00Z') });
    let calls = 0;
    let mode = 'ok';
    runtimeEquity.__testHooks.execFile = (_cmd, _args, _opts, cb) => {
      calls += 1;
      if (mode === 'fail') return cb(new Error('provider secret body'), '', 'sensitive');
      if (mode === 'malformed') return cb(null, JSON.stringify({ symbol: 'BAD', bars: [{ date: '2026-01-01', open: null, high: '', low: false, close: 'NaN', volume: 0 }] }), '');
      return cb(null, JSON.stringify({ symbol: 'JOIN', bars: [{ date: '2026-01-01', open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 }] }), '');
    };
    try {
      const [first, joined] = await Promise.all([
        app.inject('/api/yf/history/JOIN'),
        app.inject('/api/yf/history/JOIN'),
      ]);
      expect(first.statusCode).toBe(200);
      expect(joined.statusCode).toBe(200);
      expect(calls).toBe(1);
      expect(joined.json().cache.coalesced).toBe(true);
      vi.advanceTimersByTime(TTL.YF_ENRICH_MS + 1);
      mode = 'fail';
      const stale = await app.inject('/api/yf/history/JOIN');
      expect(stale.statusCode).toBe(200);
      expect(stale.json().cache).toMatchObject({ state: 'stale', stale: true, providerError: 'upstream-error' });
      vi.advanceTimersByTime(TTL.YF_ENRICH_MS * 10);
      const expired = await app.inject('/api/yf/history/JOIN');
      expect(expired.statusCode).toBe(502);
      expect(expired.json().bars).toBeUndefined();
      mode = 'malformed';
      const malformed = await app.inject('/api/yf/history/BAD');
      expect(malformed.statusCode).toBe(502);
      expect(JSON.stringify(malformed.json())).not.toContain('sensitive');
    } finally {
      vi.useRealTimers();
    }
  });

  it('yfinance info preserves cache metadata and nulls non-finite numeric fields', async () => {
    runtimeEquity.__testHooks.execFile = (_cmd, _args, _opts, cb) => cb(null, JSON.stringify({ symbol: 'INFO', marketCap: null, beta: false, lastPrice: '', volume: 0 }), '');
    const res = await app.inject('/api/yf/info/INFO');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ symbol: 'INFO', marketCap: null, beta: null, lastPrice: null, volume: 0, cache: { state: 'miss', stale: false, providerError: null } });
  });

  it('serves /docs/index.json as JSON (not SPA HTML)', async () => {
    const res = await app.inject('/docs/index.json');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json();
    expect(body).toHaveProperty('categories');
    expect(Array.isArray(body.categories)).toBe(true);
  });

  it('legacy boot briefing validates independent sources, preserves cache metadata, and fails closed', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-02T00:00:00Z') });
    let mode = 'ok';
    let release;
    let gate = Promise.resolve();
    const bootTextSpy = vi.fn(async () => '{"sofr":5}');
    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (mode === 'join') await gate;
      if (mode === 'down') return new Response('{"secret":"worker body"}', { status: 503, headers: { 'content-type': 'application/json' } });
      if (mode === 'partial' && url.includes('/api/macro/summary')) return new Response('{"secret":"worker body"}', { status: 503, headers: { 'content-type': 'application/json' } });
      if (mode === 'invalid') return new Response('<html>not json</html>', { status: 200, headers: { 'content-type': 'text/html' } });
      if (mode === 'oversize') return new Response('x'.repeat(500_001), { status: 200, headers: { 'content-type': 'application/json', 'content-length': '500001' } });
      if (mode === 'noreader') return {
        ok: true,
        status: 200,
        headers: { get: (name) => (String(name).toLowerCase() === 'content-length' ? '100' : 'application/json') },
        body: {}, // no streaming reader: must fail closed without text()
        text: bootTextSpy,
      };
      const body = url.includes('/rates/summary') ? { sofr: 5 } : url.includes('/macro/summary') ? { vix: 18 } : { stress: 'low' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    try {
      const complete = await app.inject('/api/boot/briefing');
      expect(complete.statusCode).toBe(200);
      expect(complete.json().cache).toMatchObject({ state: 'miss', hit: false, stale: false, providerError: null });
      expect(complete.json().coverage).toEqual({ rates: 'available', macro: 'available', stress: 'available' });

      await app.close();
      app = await makeApp();
      mode = 'join';
      gate = new Promise((resolve) => { release = resolve; });
      const joinedA = app.inject('/api/boot/briefing');
      const joinedB = app.inject('/api/boot/briefing');
      await Promise.resolve();
      release();
      const [joinA, joinB] = await Promise.all([joinedA, joinedB]);
      expect(joinA.statusCode).toBe(200);
      expect(joinA.json().cache.coalesced || joinB.json().cache.coalesced).toBe(true);

      await app.close();
      app = await makeApp();
      mode = 'partial';
      const partial = await app.inject('/api/boot/briefing');
      expect(partial.statusCode).toBe(200);
      expect(partial.json()).toMatchObject({ coverage: { rates: 'available', macro: 'unavailable', stress: 'available' }, warnings: ['source-unavailable:macro'] });
      expect(partial.body).not.toContain('worker body');

      await app.close();
      app = await makeApp();
      mode = 'invalid';
      const malformed = await app.inject('/api/boot/briefing');
      expect(malformed.statusCode).toBe(502);
      expect(JSON.stringify(malformed.json())).not.toContain('not json');

      await app.close();
      app = await makeApp();
      mode = 'oversize';
      const oversize = await app.inject('/api/boot/briefing');
      expect(oversize.statusCode).toBe(502);
      expect(JSON.stringify(oversize.json())).not.toContain('x'.repeat(20));

      await app.close();
      app = await makeApp();
      mode = 'noreader';
      bootTextSpy.mockClear();
      const noReader = await app.inject('/api/boot/briefing');
      expect(noReader.statusCode).toBe(502);
      expect(bootTextSpy).not.toHaveBeenCalled();

      await app.close();
      app = await makeApp();
      mode = 'ok';
      await app.inject('/api/boot/briefing');
      vi.advanceTimersByTime(TTL.BRIEFING_MS + 1);
      mode = 'down';
      const stale = await app.inject('/api/boot/briefing');
      expect(stale.statusCode).toBe(200);
      expect(stale.json().cache).toMatchObject({ state: 'stale', stale: true, providerError: 'http-503' });
      vi.advanceTimersByTime(TTL.BRIEFING_MS * 10 + 1);
      const expired = await app.inject('/api/boot/briefing');
      expect(expired.statusCode).toBe(502);
      expect(JSON.stringify(expired.json())).not.toContain('worker body');
    } finally {
      vi.useRealTimers();
    }
  });

  it('serves allowlisted academy markdown and blocks non-academy scope', async () => {
    const ok = await app.inject('/docs/academy/00-curriculum-overview.md');
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toContain('text/markdown');

    const denied = await app.inject('/docs/research/DOMAIN_AND_BENCHMARKS.md');
    expect(denied.statusCode).toBe(404);
  });

  it('blocks encoded path traversal over a real socket (verbatim request path)', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = app.server.address().port;
    for (const p of ['/docs/%2e%2e/server/app.js', '/docs/%2e%2e%2fetc/passwd', '/docs/academy/..%2f..%2fserver/app.js']) {
      const r = await rawGet(port, p);
      expect([400, 404], p).toContain(r.status);
      expect(r.contentType.startsWith('text/html'), p).toBe(false);
    }
    await app.close();
    // Rebuild so afterEach's close and subsequent tests have a live app.
    app = await makeApp();
  });

  it('finnhub routes return normalized upstream data through the shared cache', async () => {
    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('/quote?')) {
        return new Response(JSON.stringify({ c: 500.25, d: 1.2, dp: 0.24, h: 501, l: 499, o: 500, pc: 499.05 }), { status: 200 });
      }
      if (url.includes('/company-news')) return new Response(JSON.stringify([{ id: 1, datetime: 1, headline: 'H', source: 'S', url: 'u' }]), { status: 200 });
      if (url.includes('/news?')) return new Response(JSON.stringify([{ id: 2, datetime: 2, headline: 'M', source: 'S', url: 'u' }]), { status: 200 });
      if (url.includes('/calendar/earnings')) return new Response(JSON.stringify({ earningsCalendar: [{ symbol: 'SPY', date: '2026-12-01', epsEstimate: 2.5 }] }), { status: 200 });
      if (url.includes('/calendar/economic')) return new Response(JSON.stringify({ economicCalendar: [{ event: 'CPI', time: '2026-09-01T12:30:00Z', country: 'US' }] }), { status: 200 });
      if (url.includes('/stock/recommendation')) return new Response(JSON.stringify([{ period: '2026-08-01', buy: 10, hold: 2 }]), { status: 200 });
      if (url.includes('/stock/peers')) return new Response(JSON.stringify(['SPY', 'IVV', 'VOO']), { status: 200 });
      return new Response('{"error":"unexpected"}', { status: 404 });
    });
    const q = await app.inject('/api/finnhub/quote?symbol=SPY');
    expect(q.statusCode).toBe(200);
    expect(q.json().price).toBe(500.25);
    expect(q.json().cache).toMatchObject({ state: 'miss', hit: false, stale: false, coalesced: false, providerError: null });
    const qCached = await app.inject('/api/finnhub/quote?symbol=SPY');
    expect(qCached.json().cache).toMatchObject({ state: 'fresh', hit: true, stale: false, coalesced: false });
    const n = await app.inject('/api/finnhub/news?symbol=SPY&limit=2');
    expect(n.statusCode).toBe(200);
    expect(n.json().count).toBeGreaterThan(0);
    expect(n.json().cache).toMatchObject({ state: 'miss', hit: false, stale: false, coalesced: false, providerError: null });
    const earnings = await app.inject('/api/finnhub/earnings?symbol=SPY');
    expect(earnings.statusCode).toBe(200);
    expect(earnings.json().next.date).toBe('2026-12-01');
    expect(earnings.json().cache).toMatchObject({ state: 'miss', hit: false, stale: false, coalesced: false, providerError: null });
    const economic = await app.inject('/api/finnhub/economic-calendar');
    expect(economic.statusCode).toBe(200);
    expect(economic.json().events[0].event).toBe('CPI');
    expect(economic.json().cache).toMatchObject({ state: 'miss', hit: false, stale: false, coalesced: false, providerError: null });
    runtimeDesk.__testHooks.recordBudget('finnhub', 4_500);
    const economicCached = await app.inject('/api/finnhub/economic-calendar');
    expect(economicCached.statusCode).toBe(200);
    expect(economicCached.json().cache).toMatchObject({ state: 'fresh', hit: true, stale: false, providerError: null });
    runtimeDesk.__testHooks.clearBudgetsForTests();
    const recommendation = await app.inject('/api/finnhub/recommendation?symbol=SPY');
    expect(recommendation.statusCode).toBe(200);
    expect(recommendation.json().latest.buy).toBe(10);
    expect(recommendation.json().cache).toMatchObject({ state: 'miss', hit: false, stale: false, coalesced: false, providerError: null });
    const peers = await app.inject('/api/finnhub/peers?symbol=SPY');
    expect(peers.statusCode).toBe(200);
    expect(peers.json().peers).toEqual(['IVV', 'VOO']);
    expect(peers.json().cache).toMatchObject({ state: 'miss', hit: false, stale: false, coalesced: false, providerError: null });
  });

  it('Finnhub recommendation serves stale metadata on provider failure and rejects malformed payloads', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-02T00:00:00Z') });
    let fail = false;
    global.fetch = vi.fn(async (input) => {
      if (!String(input).includes('/stock/recommendation')) return new Response('{}', { status: 404 });
      if (fail) return new Response('{"error":"down"}', { status: 503 });
      return new Response(JSON.stringify([{ period: '2026-08-01', buy: 10 }]), { status: 200 });
    });
    try {
      const warm = await app.inject('/api/finnhub/recommendation?symbol=STALE');
      expect(warm.statusCode).toBe(200);
      expect(warm.json().cache.state).toBe('miss');
      vi.advanceTimersByTime(TTL.FINNHUB_META_MS + 1);
      fail = true;
      const budgetBeforeFailure = runtimeDesk.__testHooks.getBudgetUsed('finnhub');
      const stale = await app.inject('/api/finnhub/recommendation?symbol=STALE');
      expect(stale.statusCode).toBe(200);
      expect(stale.json().cache).toMatchObject({ state: 'stale', stale: true, providerError: 'http-503' });
      expect(runtimeDesk.__testHooks.getBudgetUsed('finnhub') - budgetBeforeFailure).toBe(1);
      vi.advanceTimersByTime(TTL.FINNHUB_META_MS * 10);
      const expired = await app.inject('/api/finnhub/recommendation?symbol=STALE');
      expect(expired.statusCode).toBe(502);
      expect(expired.json().latest).toBeNull();
      clearCacheForTests();
      fail = false;
      global.fetch = vi.fn(async () => new Response('{}', { status: 200 }));
      const malformed = await app.inject('/api/finnhub/recommendation?symbol=MALFORMED');
      expect(malformed.statusCode).toBe(502);
      expect(malformed.json().error).toBe('invalid_payload');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Finnhub news preserves partial coverage and fails closed for exhausted or totally failed providers', async () => {
    let mode = 'success';
    let calls = 0;
    global.fetch = vi.fn(async (input) => {
      calls += 1;
      const url = String(input);
      if (mode === 'partial' && url.includes('/news?')) return new Response('{"error":"general down"}', { status: 503 });
      if (mode === 'down') throw new Error('provider body must not leak');
      if (url.includes('/company-news')) return new Response(JSON.stringify([{ id: 1, datetime: 1, headline: 'Company', source: 'S' }]), { status: 200 });
      return new Response(JSON.stringify([{ id: 2, datetime: 2, headline: 'Market', source: 'S' }]), { status: 200 });
    });
    const warm = await app.inject('/api/finnhub/news?symbol=NEWSHOT&limit=2');
    expect(warm.statusCode).toBe(200);
    const callsAfterWarm = calls;
    runtimeDesk.__testHooks.recordBudget('finnhub', 5_000);
    const cached = await app.inject('/api/finnhub/news?symbol=NEWSHOT&limit=2');
    expect(cached.statusCode).toBe(200);
    expect(cached.json().cache).toMatchObject({ state: 'fresh', hit: true });
    const exhausted = await app.inject('/api/finnhub/news?symbol=NEWSCOLD&limit=2');
    expect(exhausted.statusCode).toBe(429);
    expect(calls).toBe(callsAfterWarm);

    clearCacheForTests();
    runtimeDesk.__testHooks.clearBudgetsForTests();
    mode = 'partial';
    const partial = await app.inject('/api/finnhub/news?symbol=PARTIAL&limit=2');
    expect(partial.statusCode).toBe(200);
    expect(partial.json()).toMatchObject({ count: 1, warnings: ['partial-provider-failure'], coverage: { company: 'available', general: 'unavailable' } });

    clearCacheForTests();
    runtimeDesk.__testHooks.clearBudgetsForTests();
    mode = 'down';
    const failed = await app.inject('/api/finnhub/news?symbol=DOWN&limit=2');
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toMatchObject({ error: 'Finnhub news failed', count: 0 });
    expect(failed.json().detail).toBeUndefined();
  });

  it('Finnhub exhaustion is typed, makes no call, and redacts HTTP bodies', async () => {
    clearCacheForTests();
    runtimeDesk.__testHooks.clearBudgetsForTests();
    const fetchSpy = vi.fn(async () => new Response('{"secret":"provider payload"}', { status: 503 }));
    global.fetch = fetchSpy;
    runtimeDesk.__testHooks.recordBudget('finnhub', 5_000);
    const exhausted = await app.inject('/api/finnhub/quote?symbol=EXHAUST');
    expect(exhausted.statusCode).toBe(429);
    expect(exhausted.json()).toMatchObject({ price: null, error: 'budget_exhausted' });
    expect(fetchSpy).not.toHaveBeenCalled();
    runtimeDesk.__testHooks.clearBudgetsForTests();
    const failed = await app.inject('/api/finnhub/recommendation?symbol=HTTPFAIL');
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toMatchObject({ error: 'unavailable', detail: 'unavailable' });
    expect(JSON.stringify(failed.json())).not.toContain('provider payload');
  });

  it('finnhub news fails closed 503 with typed error when key absent', async () => {
    await app.close();
    const saved = process.env.FINNHUB_API_KEY;
    process.env.FINNHUB_API_KEY = '';
    try {
      app = await makeApp();
      const res = await app.inject('/api/finnhub/news?symbol=SPY&limit=3');
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('no_api_key');
    } finally {
      process.env.FINNHUB_API_KEY = saved;
    }
  });

  it('finnhub quote joins concurrent clients and serves bounded stale data before expiry', async () => {
    let release;
    let gate = new Promise((resolve) => { release = resolve; });
    let fail = false;
    global.fetch = vi.fn(async () => {
      await gate;
      if (fail) throw new Error('Finnhub network unavailable');
      return new Response(JSON.stringify({ c: 500.25, d: 1.2, dp: 0.24, h: 501, l: 499, o: 500, pc: 499.05 }), { status: 200 });
    });
    const first = app.inject('/api/finnhub/quote?symbol=JOINQ');
    await Promise.resolve();
    const second = app.inject('/api/finnhub/quote?symbol=JOINQ');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.statusCode).toBe(200);
    expect(b.json().cache).toMatchObject({ hit: false, stale: false, coalesced: true });

    fail = true;
    gate = Promise.resolve();
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(TTL.FINNHUB_QUOTE_MS + 1);
      const stale = await app.inject('/api/finnhub/quote?symbol=JOINQ');
      expect(stale.statusCode).toBe(200);
      expect(stale.json().cache).toMatchObject({ state: 'stale', hit: true, stale: true, providerError: 'upstream-error' });
      vi.advanceTimersByTime(TTL.FINNHUB_QUOTE_MS * 10 + 1);
      const expired = await app.inject('/api/finnhub/quote?symbol=JOINQ');
      expect(expired.statusCode).toBe(502);
      expect(expired.json().error).toBe('Finnhub quote failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('AlphaVantage budget fallback is bounded, metered, and typed', async () => {
    process.env.ALPHA_VANTAGE_API_KEY = 'test-av-key';
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ 'Global Quote': { '05. price': '123.45' } }), { status: 200 }));
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-02T00:05:00.000Z'));
      const warm = await app.inject('/api/alphavantage/quote?symbol=AVTEST');
      expect(warm.statusCode).toBe(200);
      expect(warm.json().cache).toMatchObject({ state: 'miss', hit: false, stale: false });
      expect(runtimeDesk.__testHooks.getBudgetUsed('alphavantage')).toBe(1);
      runtimeDesk.__testHooks.recordBudget('alphavantage', 25);
      vi.advanceTimersByTime(TTL.ALPHA_VANTAGE_MS * 10 - 1);
      const stale = await app.inject('/api/alphavantage/quote?symbol=AVTEST');
      expect(stale.statusCode).toBe(200);
      expect(stale.json()).toMatchObject({ price: 123.45, cache: { state: 'stale', hit: true, stale: true, providerError: 'budget_exhausted' } });
      vi.advanceTimersByTime(2);
      const expired = await app.inject('/api/alphavantage/quote?symbol=AVTEST');
      expect(expired.statusCode).toBe(429);
      expect(expired.json().price).toBeNull();
      expect(expired.json().cache).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });

  it('AlphaVantage charges failed upstream attempts before fetch completion', async () => {
    process.env.ALPHA_VANTAGE_API_KEY = 'test-av-key';
    global.fetch = vi.fn(async () => new Response('down', { status: 503 }));
    const before = runtimeDesk.__testHooks.getBudgetUsed('alphavantage');
    const response = await app.inject('/api/alphavantage/quote?symbol=AVFAIL');
    expect(response.statusCode).toBe(502);
    expect(runtimeDesk.__testHooks.getBudgetUsed('alphavantage')).toBe(before + 1);
  });

  it('TradingView budget fallback is bounded, monthly-metered, and typed', async () => {
    process.env.RAPIDAPI_KEY = 'test-tv-key';
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ close: 321.5 }), { status: 200 }));
    const warm = await app.inject('/api/tradingview/snapshot?symbol=TVTEST');
    expect(warm.statusCode).toBe(200);
    expect(warm.json().cache).toMatchObject({ state: 'miss', hit: false, stale: false });
    expect(runtimeDesk.__testHooks.getMonthBudgetUsed('tradingview')).toBe(1);
    expect(runtimeDesk.__testHooks.getBudgetUsed('tradingview')).toBe(0);
    runtimeDesk.__testHooks.recordMonthBudget('tradingview', 150);
    // Anchor the fake clock exactly at the warm-request time so the cache age
    // is deterministic (no real->fake clock skew; previously advanced a knife-
    // edge 1ms and raced under load).
    vi.useFakeTimers({ now: Date.now() });
    try {
      vi.advanceTimersByTime(TTL.TRADINGVIEW_MS * 10 - 60_000);
      const stale = await app.inject('/api/tradingview/snapshot?symbol=TVTEST');
      expect(stale.statusCode).toBe(200);
      expect(stale.json()).toMatchObject({ price: 321.5, cache: { state: 'stale', hit: true, stale: true, providerError: 'budget_exhausted' } });
      vi.advanceTimersByTime(60_001); // cross the bounded stale ceiling
      const expired = await app.inject('/api/tradingview/snapshot?symbol=TVTEST');
      expect(expired.statusCode).toBe(429);
      expect(expired.json().price).toBeNull();
      expect(expired.json().cache).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });

  it('TradingView charges failed upstream attempts in the monthly ledger', async () => {
    process.env.RAPIDAPI_KEY = 'test-tv-key';
    global.fetch = vi.fn(async () => new Response('down', { status: 503 }));
    const beforeMonth = runtimeDesk.__testHooks.getMonthBudgetUsed('tradingview');
    const beforeDay = runtimeDesk.__testHooks.getBudgetUsed('tradingview');
    const response = await app.inject('/api/tradingview/snapshot?symbol=TVFAIL');
    expect(response.statusCode).toBe(502);
    expect(runtimeDesk.__testHooks.getMonthBudgetUsed('tradingview')).toBe(beforeMonth + 1);
    expect(runtimeDesk.__testHooks.getBudgetUsed('tradingview')).toBe(beforeDay);
  });

  it('home briefing exposes truthful cache state and explicit provider-down desks', async () => {
    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('/api/finnhub/quote')) return new Response(JSON.stringify({ available: false, provider: 'finnhub', reason: 'upstream_error', price: null }), { status: 200 });
      if (url.includes('/api/rates/summary')) return new Response(JSON.stringify({ sofr: null, usy10: null }), { status: 200 });
      if (url.includes('/api/macro/primary')) return new Response('{}', { status: 503 });
      return new Response(JSON.stringify({ available: false, reason: 'upstream_error' }), { status: 502 });
    });
    const first = await app.inject('/api/home/briefing');
    expect(first.statusCode).toBe(200);
    expect(first.json().cache).toMatchObject({ state: 'miss', hit: false, stale: false, coalesced: false, providerError: null });
    expect(first.json().desks.equities.available).toBe(false);
    expect(first.json().freshness).toMatchObject({ live: false, state: 'unavailable' });
    const second = await app.inject('/api/home/briefing');
    expect(second.statusCode).toBe(200);
    expect(second.json().cache).toMatchObject({ state: 'fresh', hit: true, stale: false, coalesced: false });
  });

  it('home briefing freshnessState is live only when all desks are up, partial on any outage', async () => {
    const healthyFetch = async (input) => {
      const url = String(input);
      if (url.includes('/api/finnhub/quote')) return new Response(JSON.stringify({ price: 500, change_pct: 0.5, as_of: new Date().toISOString() }), { status: 200 });
      if (url.includes('/api/rates/summary')) return new Response(JSON.stringify({ sofr: 4.5, effr: 4.3, usy2: 4.2, usy10: 4.5, spread_2s10s: 0.3, as_of: new Date().toISOString() }), { status: 200 });
      if (url.includes('/api/deribit/market/BTC')) return new Response(JSON.stringify({ instruments: [{ kind: 'perp', markPrice: 60010, funding8h: 0.00005 }], fetchedAt: Date.now() }), { status: 200 });
      if (url.includes('/api/free-crypto/market/BTC')) return new Response(JSON.stringify({ venues: [{ venue: 'Binance Futures', mark: 60010 }] }), { status: 200 });
      if (url.includes('/api/ksa/board')) return new Response(JSON.stringify({ configured: true, tasi: { index_value: 12150 } }), { status: 200 });
      return new Response(JSON.stringify({ available: false, reason: 'upstream_error' }), { status: 502 });
    };
    global.fetch = vi.fn(healthyFetch);
    const healthy = await app.inject('/api/home/briefing?symbol=HEALTHY');
    expect(healthy.statusCode).toBe(200);
    expect(healthy.json().desks.equities.available).toBe(true);
    expect(healthy.json().desks.rates.available).toBe(true);
    expect(healthy.json().desks.crypto.available).toBe(true);
    expect(healthy.json().desks.ksa.available).toBe(true);
    expect(healthy.json().freshness).toMatchObject({ live: true, state: 'live' });

    // One desk down (KSA board unconfigured) -> partial, never live.
    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('/api/ksa/board')) return new Response(JSON.stringify({ configured: false }), { status: 200 });
      return healthyFetch(input);
    });
    const partial = await app.inject('/api/home/briefing?symbol=PARTIAL');
    expect(partial.statusCode).toBe(200);
    expect(partial.json().desks.ksa.available).toBe(false);
    expect(partial.json().desks.equities.available).toBe(true);
    expect(partial.json().freshness).toMatchObject({ live: false, state: 'partial' });
  });

  it('home briefing freeFallback carries an explicit available flag (ledger contract)', async () => {
    const healthyFetch = async (input) => {
      const url = String(input);
      if (url.includes('/api/finnhub/quote')) return new Response(JSON.stringify({ price: 500, change_pct: 0.5, as_of: new Date().toISOString() }), { status: 200 });
      if (url.includes('/api/rates/summary')) return new Response(JSON.stringify({ sofr: 4.5, effr: 4.3, usy2: 4.2, usy10: 4.5, spread_2s10s: 0.3, as_of: new Date().toISOString() }), { status: 200 });
      if (url.includes('/api/deribit/market/BTC')) return new Response(JSON.stringify({ instruments: [{ kind: 'perp', markPrice: 60010, funding8h: 0.00005 }], fetchedAt: Date.now() }), { status: 200 });
      if (url.includes('/api/free-crypto/market/BTC')) return new Response(JSON.stringify({ venues: [{ venue: 'Binance Futures', mark: 60010 }], fetchedAt: Date.now() }), { status: 200 });
      if (url.includes('/api/ksa/board')) return new Response(JSON.stringify({ configured: true, tasi: { index_value: 12150 } }), { status: 200 });
      return new Response(JSON.stringify({ available: false, reason: 'upstream_error' }), { status: 502 });
    };
    global.fetch = vi.fn(healthyFetch);
    const healthy = await app.inject('/api/home/briefing?symbol=FREEUP');
    expect(healthy.statusCode).toBe(200);
    // Success branch must state available:true — the Home ledger and crypto
    // cell read this flag, and its absence mislabelled live free data.
    expect(healthy.json().desks.crypto.freeFallback).toMatchObject({ available: true });
    expect(healthy.json().desks.crypto.freeFallback.asOf).not.toBeNull();

    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('/api/free-crypto/market/BTC')) return new Response(JSON.stringify({ available: false, reason: 'upstream_error' }), { status: 502 });
      return healthyFetch(input);
    });
    const down = await app.inject('/api/home/briefing?symbol=FREEDOWN');
    expect(down.statusCode).toBe(200);
    expect(down.json().desks.crypto.freeFallback).toMatchObject({ available: false });
  });

  it('home briefing coalesces joined requests and expires malformed stale snapshots', async () => {
    let malformed = false;
    let gate = null;
    let release = null;
    global.fetch = vi.fn(async (input) => {
      if (gate) await gate;
      const url = String(input);
      if (url.includes('/api/finnhub/quote')) return new Response(JSON.stringify({ available: true, provider: 'finnhub', price: 500, change_pct: 0, as_of: new Date().toISOString() }), { status: 200 });
      if (url.includes('/api/free-crypto/market/BTC') && malformed) return new Response(JSON.stringify({ available: true, venues: 'malformed' }), { status: 200 });
      if (url.includes('/api/free-crypto/market/BTC')) return new Response(JSON.stringify({ available: false, reason: 'unavailable' }), { status: 200 });
      if (url.includes('/api/rates/summary')) return new Response(JSON.stringify({ sofr: null, usy10: null }), { status: 200 });
      if (url.includes('/api/macro/primary')) return new Response('{}', { status: 503 });
      return new Response(JSON.stringify({ available: false, reason: 'upstream_error' }), { status: 502 });
    });
    gate = new Promise((resolve) => { release = resolve; });
    const joinedA = app.inject('/api/home/briefing?symbol=JOIN');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const joinedB = app.inject('/api/home/briefing?symbol=JOIN');
    release();
    gate = null;
    const [a, b] = await Promise.all([joinedA, joinedB]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.json().cache).toMatchObject({ coalesced: true, hit: false, stale: false });

    const warm = await app.inject('/api/home/briefing?symbol=STALE');
    expect(warm.statusCode).toBe(200);
    malformed = true;
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(60_001);
      const stale = await app.inject('/api/home/briefing?symbol=STALE');
      expect(stale.statusCode).toBe(200);
      expect(stale.json().cache).toMatchObject({ state: 'stale', hit: true, stale: true, providerError: 'invalid_payload' });
      expect(stale.json().freshness).toMatchObject({ live: false, state: 'stale' });
      vi.advanceTimersByTime(600_001);
      const expired = await app.inject('/api/home/briefing?symbol=STALE');
      expect(expired.statusCode).toBe(502);
      expect(expired.json().error).toBe('home_briefing_failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('venues/options validates currency; success shape is a typed bundle', async () => {
    const bad = await app.inject('/api/venues/options/DOGE');
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'UNSUPPORTED_CURRENCY', detail: expect.any(String) });
    const lowercase = await app.inject('/api/venues/options/btc');
    expect(lowercase.statusCode).toBe(400);
    expect(lowercase.json()).toMatchObject({ error: 'UNSUPPORTED_CURRENCY', detail: expect.any(String) });
    const res = await app.inject('/api/venues/options/BTC');
    if (res.statusCode === 200) {
      const body = res.json();
      expect(body.currency).toBe('BTC');
      expect(Array.isArray(body.venues)).toBe(true);
      for (const v of body.venues) {
        expect(v.venue).toMatch(/Deribit|OKX|Bybit/);
        expect(typeof v.instruments).toBe('number');
      }
    } else {
      expect(res.statusCode).toBe(502);
      expect(res.json()).toMatchObject({ error: 'OPTIONS_VENUES_UNAVAILABLE', detail: expect.any(String) });
    }
  });

  it('venues/options preserves missing volume and open interest as null, not fabricated zero', async () => {
    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('deribit')) {
        if (url.includes('get_instruments')) return new Response(JSON.stringify({ jsonrpc: '2.0', result: [{ instrument_name: 'BTC-30DEC26-50000-C', kind: 'option', is_active: true, base_currency: 'BTC', strike: 50000, option_type: 'call', expiration_timestamp: 1798243200000, contract_size: 1 }] }), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.includes('get_book_summary_by_currency')) return new Response(JSON.stringify({ jsonrpc: '2.0', result: [{ instrument_name: 'BTC-30DEC26-50000-C', volume: null, volume_usd: '', open_interest: null }] }), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.includes('get_index_price')) return new Response(JSON.stringify({ jsonrpc: '2.0', result: { index_price: null } }), { status: 200, headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify({ jsonrpc: '2.0', result: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/api/v5/market/tickers')) {
        return new Response(JSON.stringify({ code: '0', data: [{ volCcy24h: null, volUsd24h: '', openInt: false }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/api/v5/public/open-interest')) {
        return new Response(JSON.stringify({ code: '0', data: [{ oiCcy: null }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('bybit')) {
        return new Response(JSON.stringify({ retCode: 0, result: { list: [{ volume24h: '', openInterest: null }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    });
    const response = await app.inject('/api/venues/options/BTC');
    expect(response.statusCode).toBe(200);
    const venues = response.json().venues;
    expect(venues.length).toBeGreaterThanOrEqual(2);
    for (const venue of venues) {
      expect(venue.volume24hBaseCcy === undefined ? venue.volume24hNative : venue.volume24hBaseCcy).toBeNull();
      expect(venue.openInterestBaseCcy).toBeNull();
      expect(venue.openInterestNative).toBeNull();
      expect(venue).not.toHaveProperty('openIntContracts');
    }
  });

  it('venues/options shares one cold fill per provider endpoint across concurrent route clients', async () => {
    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('deribit.com')) {
        if (url.includes('get_instruments')) return new Response(JSON.stringify({ jsonrpc: '2.0', result: [{ instrument_name: 'BTC-30DEC26-50000-C', kind: 'option', is_active: true, base_currency: 'BTC', strike: 50000, option_type: 'call', expiration_timestamp: 1798243200000, contract_size: 1 }] }), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.includes('get_book_summary_by_currency')) return new Response(JSON.stringify({ jsonrpc: '2.0', result: [{ instrument_name: 'BTC-30DEC26-50000-C', volume: '2', volume_usd: '100000', open_interest: '3' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.includes('get_index_price')) return new Response(JSON.stringify({ jsonrpc: '2.0', result: { index_price: 60000 } }), { status: 200, headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify({ jsonrpc: '2.0', result: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('okx.com')) {
        if (url.includes('/public/open-interest')) return new Response(JSON.stringify({ code: '0', data: [{ oiCcy: '2' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify({ code: '0', data: [{ volCcy24h: '1', volUsd24h: '2', openInt: '3' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('bybit.com')) return new Response(JSON.stringify({ retCode: 0, result: { list: [{ volume24h: '4', openInterest: '5' }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ jsonrpc: '2.0', result: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const responses = await Promise.all([
      app.inject('/api/venues/options/BTC'),
      app.inject('/api/venues/options/%20BTC%20'),
      app.inject('/api/venues/options/BTC'),
      app.inject('/api/venues/options/%20BTC%20'),
      app.inject('/api/venues/options/BTC'),
    ]);
    expect(responses.every((res) => res.statusCode === 200)).toBe(true);
    expect(global.fetch.mock.calls.filter(([input]) => String(input).includes('okx.com/api/v5/market/tickers'))).toHaveLength(1);
    expect(global.fetch.mock.calls.filter(([input]) => String(input).includes('okx.com/api/v5/public/open-interest'))).toHaveLength(1);
    expect(global.fetch.mock.calls.filter(([input]) => String(input).includes('bybit.com/v5/market/tickers'))).toHaveLength(1);
    expect(global.fetch.mock.calls.filter(([input]) => String(input).includes('deribit.com/api/v2/public/get_instruments'))).toHaveLength(1);
    expect(global.fetch.mock.calls.filter(([input]) => String(input).includes('get_book_summary_by_currency?currency=BTC&kind=option'))).toHaveLength(1);
    expect(global.fetch.mock.calls.filter(([input]) => String(input).includes('get_book_summary_by_currency?currency=BTC&kind=future'))).toHaveLength(1);
    expect(global.fetch.mock.calls.filter(([input]) => String(input).includes('ticker?instrument_name=BTC-PERPETUAL'))).toHaveLength(1);
    expect(global.fetch.mock.calls.filter(([input]) => String(input).includes('get_index_price?index_name=btc_usd'))).toHaveLength(1);
    expect(responses[0].json().venues.map((venue) => venue.venue)).toContain('Deribit');
    expect(responses[0].json().venues.find((venue) => venue.venue === 'Deribit').volume24hUsd).toBe(100000);
    expect(responses[0].json().cache).toMatchObject({ hit: false, stale: false, coalesced: false, providerError: null });
    expect(responses[1].json().cache).toMatchObject({ hit: false, stale: false, coalesced: true });
    expect(responses[1].json().venues[0].cache).toHaveProperty('providerError');
    const uncontrolled = await app.inject('/api/venues/options/BTC?limit=999999');
    expect(uncontrolled.statusCode).toBe(400);
  });

  it('venues/options keeps a valid peer and fails 502 when every venue is unavailable', async () => {
    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('bybit.com')) return new Response(JSON.stringify({ retCode: 0, result: { list: [{ volume24h: '4', openInterest: '5' }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response('down', { status: 502, headers: { 'content-type': 'text/plain' } });
    });
    const partial = await app.inject('/api/venues/options/ETH');
    expect(partial.statusCode).toBe(200);
    expect(partial.json().venues.map((venue) => venue.venue)).toEqual(['Bybit']);

    clearCacheForTests();
    global.fetch = vi.fn(async () => new Response('down', { status: 502, headers: { 'content-type': 'text/plain' } }));
    const failed = await app.inject('/api/venues/options/BTC');
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toMatchObject({ error: 'OPTIONS_VENUES_UNAVAILABLE', detail: expect.any(String) });
  });

  it('rejects uncontrolled FlashAlpha dimensions before any provider/cache work', async () => {
    const badType = await app.inject('/api/flashalpha/exposure/arbitrary/AAPL');
    expect(badType.statusCode).toBe(400);
    const badSymbol = await app.inject('/api/flashalpha/exposure/gex/AAPL%2F..%2Fsecret');
    expect(badSymbol.statusCode).toBe(400);
  });

  it('desk pack returns the shared-pack contract even when optional feeds fail', async () => {
    const res = await app.inject('/api/desk/pack?symbol=SPY');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.symbol).toBe('SPY');
    expect(body).toHaveProperty('finnhub_quote');
    expect(body).toHaveProperty('finnhub_news');
    expect(body).toHaveProperty('as_of');
  });
});
