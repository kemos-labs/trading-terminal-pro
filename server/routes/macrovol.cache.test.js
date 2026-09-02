/**
 * MacroVol proxy route behavior tests — real Fastify injection via buildServer().
 * The loopback rates-worker boundary is stubbed deterministically at global
 * fetch. Routing, canonicalization, caching, single-flight, stale bounds,
 * streaming size caps, and fail-closed redaction run for real through the
 * actual registered /api/macrovol/* handler.
 *
 * These are deterministic state tests at the adapter boundary, not live-worker
 * success evidence.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { clearCacheForTests, TTL } from '../../api/upstreamCache.js';

const REAL_FETCH = global.fetch;

const jsonRes = (body, init = {}) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json', ...init.headers },
});

async function makeApp() {
  vi.resetModules();
  const { buildServer } = await import('../app.js');
  return buildServer();
}

describe('MacroVol proxy: cache metadata, stale bounds, and fail-closed behavior', () => {
  let app;
  let fetchCalls;

  beforeEach(async () => {
    clearCacheForTests();
    fetchCalls = [];
    global.fetch = vi.fn(async (input, init) => {
      fetchCalls.push({ url: String(input), init });
      return jsonRes({ sofr: 4.3, effr: 4.33, as_of: '2026-09-02T00:00:00Z' });
    });
    app = await makeApp();
  });

  afterEach(() => {
    global.fetch = REAL_FETCH;
    vi.useRealTimers();
    return app?.close();
  });

  it('cold miss then fresh hit expose the full sanitized cache envelope and deprecation headers', async () => {
    const cold = await app.inject('/api/macrovol/rates/summary');
    expect(cold.statusCode).toBe(200);
    expect(cold.headers['x-cache']).toBe('MISS');
    expect(cold.headers.deprecation).toBe('true');
    expect(cold.json().cache).toEqual({
      state: 'miss', hit: false, ageMs: expect.any(Number),
      stale: false, coalesced: false, providerError: null,
    });
    expect(cold.json().sofr).toBe(4.3);

    const fresh = await app.inject('/api/macrovol/rates/summary');
    expect(fresh.statusCode).toBe(200);
    expect(fresh.headers['x-cache']).toBe('HIT');
    expect(fresh.json().cache).toMatchObject({ state: 'fresh', hit: true });
    expect(fresh.json().sofr).toBe(4.3);
    // Exactly one upstream worker fill for two client requests.
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url.startsWith('http://127.0.0.1')).toBe(true);
  });

  it('N concurrent clients join one cold fill (single flight, coalesced marked)', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    global.fetch = vi.fn(async (input) => {
      fetchCalls.push({ url: String(input) });
      await gate;
      return jsonRes({ sofr: 4.3 });
    });
    const p1 = app.inject('/api/macrovol/rates/summary');
    const p2 = app.inject('/api/macrovol/rates/summary');
    const p3 = app.inject('/api/macrovol/rates/summary');
    await Promise.resolve();
    release();
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect([r1.statusCode, r2.statusCode, r3.statusCode]).toEqual([200, 200, 200]);
    expect(fetchCalls).toHaveLength(1);
    const coalesced = [r1, r2, r3].filter((r) => r.json().cache.coalesced === true);
    expect(coalesced.length).toBeGreaterThanOrEqual(1);
    expect([r1, r2, r3].every((r) => r.headers['x-cache'] === 'MISS' || r.headers['x-cache'] === 'HIT')).toBe(true);
  });

  it('serves labelled stale data within the explicit ceiling and never leaks worker error bodies', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-02T00:00:00Z') });
    await app.inject('/api/macrovol/rates/summary');
    vi.advanceTimersByTime(TTL.BRIEFING_MS + 1);
    global.fetch = vi.fn(async () => new Response('{"secret":"WORKER-DIAGNOSTIC-TOKEN"}', {
      status: 503, headers: { 'content-type': 'application/json' },
    }));
    const stale = await app.inject('/api/macrovol/rates/summary');
    expect(stale.statusCode).toBe(200);
    expect(stale.headers['x-cache-stale']).toBe('1');
    expect(stale.headers['x-provider-error']).toBe('http-503');
    expect(stale.json().cache).toMatchObject({ state: 'stale', stale: true, providerError: 'http-503' });
    expect(stale.json().sofr).toBe(4.3); // last-good data, clearly labelled stale
    expect(stale.body).not.toContain('WORKER-DIAGNOSTIC-TOKEN');
  });

  it('fails closed with a sanitized typed error after the stale ceiling expires', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-02T00:00:00Z') });
    await app.inject('/api/macrovol/rates/summary');
    vi.advanceTimersByTime(TTL.BRIEFING_MS * 10 + 5_000);
    global.fetch = vi.fn(async () => new Response('{"secret":"WORKER-DIAGNOSTIC-TOKEN"}', {
      status: 503, headers: { 'content-type': 'application/json' },
    }));
    const expired = await app.inject('/api/macrovol/rates/summary');
    expect(expired.statusCode).toBe(503);
    expect(expired.json()).toEqual({ error: 'Rates worker request failed', detail: 'http-503' });
    expect(expired.body).not.toContain('WORKER-DIAGNOSTIC-TOKEN');
  });

  it('rejects malformed JSON with invalid_payload and does not cache the failure', async () => {
    global.fetch = vi.fn(async (input) => {
      fetchCalls.push({ url: String(input) });
      return new Response('{"sofr": 4.3 oops', {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    const first = await app.inject('/api/macrovol/rates/summary');
    expect(first.statusCode).toBe(502);
    expect(first.json().detail).toBe('invalid_payload');
    const second = await app.inject('/api/macrovol/rates/summary');
    expect(second.statusCode).toBe(502);
    expect(fetchCalls).toHaveLength(2); // malformed payload never cached
  });

  it('rejects wrong content type without reading or leaking the body', async () => {
    global.fetch = vi.fn(async () => new Response('<html>WORKER-HTML-ERROR-PAGE</html>', {
      status: 200, headers: { 'content-type': 'text/html' },
    }));
    const res = await app.inject('/api/macrovol/rates/summary');
    expect(res.statusCode).toBe(502);
    expect(res.json().detail).toBe('invalid_payload');
    expect(res.body).not.toContain('WORKER-HTML-ERROR-PAGE');
  });

  it('aborts oversized streams via Content-Length precheck and mid-stream cap', async () => {
    // Precheck path: declared Content-Length over the cap, nothing read.
    global.fetch = vi.fn(async () => new Response('x'.repeat(500_001), {
      status: 200, headers: { 'content-type': 'application/json', 'content-length': '500001' },
    }));
    const precheck = await app.inject('/api/macrovol/rates/summary');
    expect(precheck.statusCode).toBe(502);
    expect(precheck.json().detail).toBe('invalid_payload');

    // Streaming path: no Content-Length; the reader cancels after the cap.
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        const chunk = new TextEncoder().encode('x'.repeat(100_000));
        const push = () => {
          for (let i = 0; i < 7; i += 1) controller.enqueue(chunk); // 700 kB total
          controller.close();
        };
        push();
      },
      cancel() { cancelled = true; },
    });
    global.fetch = vi.fn(async () => new Response(stream, {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const streamed = await app.inject('/api/macrovol/rates/summary');
    expect(streamed.statusCode).toBe(502);
    expect(streamed.json().detail).toBe('invalid_payload');
    expect(cancelled).toBe(true);
  });

  it('maps worker timeout to a bounded typed 502', async () => {
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    global.fetch = vi.fn(async () => { throw timeoutError; });
    const res = await app.inject('/api/macrovol/rates/summary');
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'Rates worker request failed', detail: 'timeout' });
  });

  it('uncached routes forward worker status semantics with sanitized bodies', async () => {
    global.fetch = vi.fn(async () => new Response('{"detail":"worker internal traceback SECRET"}', {
      status: 404, headers: { 'content-type': 'application/json' },
    }));
    const res = await app.inject('/api/macrovol/macro/series/UNKNOWN?limit=10');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Rates worker request failed', detail: 'http-404' });
    expect(res.body).not.toContain('SECRET');
    expect(res.body).not.toContain('traceback');
  });

  it('canonicalizes equivalent numeric query forms onto one shared cache key', async () => {
    await app.inject('/api/macrovol/rates/shape?history=60');
    const second = await app.inject('/api/macrovol/rates/shape?history=060');
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-cache']).toBe('HIT');
    expect(fetchCalls).toHaveLength(1);
  });

  it('rejects forbidden queries and paths before any worker call', async () => {
    const badQuery = await app.inject('/api/macrovol/rates/summary?foo=1');
    expect(badQuery.statusCode).toBe(400);

    const badLimit = await app.inject('/api/macrovol/sec/context/AAPL?limit=999');
    expect(badLimit.statusCode).toBe(400);

    const unknownPath = await app.inject('/api/macrovol/admin/secret');
    expect(unknownPath.statusCode).toBe(404);

    const debugPath = await app.inject('/api/macrovol/debug/x');
    expect(debugPath.statusCode).toBe(404);

    const postPath = await app.inject({ method: 'POST', url: '/api/macrovol/rates/summary' });
    expect(postPath.statusCode).toBe(404);

    expect(fetchCalls).toHaveLength(0);
  });
});
