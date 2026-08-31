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
import { clearCacheForTests } from '../../api/upstreamCache.js';
import { resetDeribitClientState } from '../providers/deribit/client.js';

const REAL_FETCH = global.fetch;

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
  for (const [k, v] of Object.entries(envOverrides)) process.env[k] = v;
  const { buildServer } = await import('../app.js');
  return buildServer();
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
    app = await makeApp();
  });

  afterEach(async () => {
    global.fetch = REAL_FETCH;
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
  }, 30_000);

  it('option chain fails closed 502 when the provider errors (never fabricates)', async () => {
    const res = await app.inject('/api/options/ZZZZZZ');
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('Failed to fetch data');
  }, 30_000);

  it('yf history serves real-shaped bars through the shared cache', async () => {
    const res = await app.inject('/api/yf/history/SPY');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.bars)).toBe(true);
    expect(body.bars.length).toBe(30);
    expect(typeof body.bars[0].close).toBe('number');
  }, 30_000);

  it('serves /docs/index.json as JSON (not SPA HTML)', async () => {
    const res = await app.inject('/docs/index.json');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json();
    expect(body).toHaveProperty('categories');
    expect(Array.isArray(body.categories)).toBe(true);
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
    const n = await app.inject('/api/finnhub/news?symbol=SPY&limit=2');
    expect(n.statusCode).toBe(200);
    expect(n.json().count).toBeGreaterThan(0);
    const earnings = await app.inject('/api/finnhub/earnings?symbol=SPY');
    expect(earnings.statusCode).toBe(200);
    expect(earnings.json().next.date).toBe('2026-12-01');
    const economic = await app.inject('/api/finnhub/economic-calendar');
    expect(economic.statusCode).toBe(200);
    expect(economic.json().events[0].event).toBe('CPI');
    const recommendation = await app.inject('/api/finnhub/recommendation?symbol=SPY');
    expect(recommendation.statusCode).toBe(200);
    expect(recommendation.json().latest.buy).toBe(10);
    const peers = await app.inject('/api/finnhub/peers?symbol=SPY');
    expect(peers.statusCode).toBe(200);
    expect(peers.json().peers).toEqual(['IVV', 'VOO']);
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

  it('venues/options validates currency; success shape is a typed bundle', async () => {
    const bad = await app.inject('/api/venues/options/DOGE');
    expect(bad.statusCode).toBe(400);
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
    }
  });

  it('venues/options preserves missing volume and open interest as null, not fabricated zero', async () => {
    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('deribit')) {
        return new Response(JSON.stringify({ jsonrpc: '2.0', result: [{ instrument_name: 'BTC-X', volume: null, volume_usd: '', open_interest: undefined }] }), { status: 200 });
      }
      if (url.includes('/api/v5/market/tickers')) {
        return new Response(JSON.stringify({ data: [{ volCcy24h: null, volUsd24h: '', openInt: false }] }), { status: 200 });
      }
      if (url.includes('/api/v5/public/open-interest')) {
        return new Response(JSON.stringify({ data: [{ oiCcy: null }] }), { status: 200 });
      }
      if (url.includes('bybit')) {
        return new Response(JSON.stringify({ result: { list: [{ volume24h: '', openInterest: null }] } }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    const response = await app.inject('/api/venues/options/BTC');
    expect(response.statusCode).toBe(200);
    const venues = response.json().venues;
    expect(venues.length).toBeGreaterThanOrEqual(2);
    for (const venue of venues) {
      expect(venue.volCcy24h).toBeNull();
      expect(venue.openIntContracts).toBeNull();
      expect(venue).not.toHaveProperty('openIntCcy');
    }
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
