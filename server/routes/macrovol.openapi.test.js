/**
 * MacroVol legacy-adapter OpenAPI contract tests: the explicit
 * /api/macrovol/{wildcard} document entry must describe what the runtime
 * actually does — GET-only, typed 400/404/502 error envelopes, optional
 * `cache` envelope on cached paths. Real responses are validated against the
 * published schemas with Ajv.
 */
import Fastify from 'fastify';
import Ajv from 'ajv';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { registerMacrovolRoutes } from './macrovol.js';
import { buildOpenApiDocument } from './openapi.js';
import { clearCacheForTests } from '../../api/upstreamCache.js';

const realFetch = global.fetch;
const jsonRes = (body, init = {}) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json', ...init.headers },
});

afterEach(() => { global.fetch = realFetch; });

describe('macrovol legacy OpenAPI contract', () => {
  it('publishes a GET-only deprecated operation with typed error schemas', () => {
    const item = buildOpenApiDocument().paths['/api/macrovol/{wildcard}'];
    expect(Object.keys(item).sort()).toEqual(['get']);
    expect(item.get.deprecated).toBe(true);
    expect(item.get['x-legacy-adapter']).toBe(true);
    expect(item.get.responses[400].content['application/json'].schema.properties.error.const).toBe('BAD_QUERY');
    expect(item.get.responses[404].content['application/json'].schema.properties.error.const).toBe('ENDPOINT_NOT_ALLOWED');
    expect(item.get.responses[500].content['application/json'].schema.properties.error.const).toBe('UPSTREAM_ERROR');
    expect(item.get.responses[502].content['application/json'].schema.properties.error.const).toBe('UPSTREAM_ERROR');
    expect(item.get.responses[503].content['application/json'].schema.properties.error.const).toBe('UPSTREAM_ERROR');
    expect(item.get.responses[504].content['application/json'].schema.properties.error.const).toBe('UPSTREAM_ERROR');
    expect(item.get.responses[200].content['application/json'].schema.properties.cache).toBeDefined();
    // Time-bounded migration exception for the generic wildcard success shape.
    expect(item.get['x-migration-exception'].deadline).toBe('2026-12-31');
  });

  it('validates actual runtime 200/400/404/502/503 responses against their own documented schemas', async () => {
    const app = Fastify();
    await registerMacrovolRoutes(app);
    const doc = buildOpenApiDocument().paths['/api/macrovol/{wildcard}'].get;
    const ajv = new Ajv({ strict: false });
    const ok = ajv.compile(doc.responses[200].content['application/json'].schema);
    const bad = ajv.compile(doc.responses[400].content['application/json'].schema);
    const notAllowed = ajv.compile(doc.responses[404].content['application/json'].schema);
    const upstream502 = ajv.compile(doc.responses[502].content['application/json'].schema);
    const upstream503 = ajv.compile(doc.responses[503].content['application/json'].schema);
    const upstream500 = ajv.compile(doc.responses[500].content['application/json'].schema);

    global.fetch = vi.fn(async () => jsonRes({ sofr: 4.3, effr: 4.33 }));
    const good = await app.inject('/api/macrovol/rates/summary');
    expect(good.statusCode).toBe(200);
    expect(ok(good.json())).toBe(true);
    expect(good.json().cache).toMatchObject({ state: 'miss' });

    const badQuery = await app.inject('/api/macrovol/rates/summary?foo=1');
    expect(badQuery.statusCode).toBe(400);
    expect(bad(badQuery.json())).toBe(true);

    const forbidden = await app.inject('/api/macrovol/admin/secret');
    expect(forbidden.statusCode).toBe(404);
    expect(notAllowed(forbidden.json())).toBe(true);

    global.fetch = vi.fn(async () => new Response('{"secret":"WORKER-DIAGNOSTIC"}', {
      status: 503, headers: { 'content-type': 'application/json' },
    }));
    clearCacheForTests(); // cold-miss failure path: no last-good data to serve stale
    const down = await app.inject('/api/macrovol/rates/summary');
    expect(down.statusCode).toBe(503);
    // Each status validates against its own schema — never one status via another's.
    expect(upstream503(down.json())).toBe(true);
    expect(down.body).not.toContain('WORKER-DIAGNOSTIC');

    // Undocumented worker statuses collapse to documented 502 (runtime/OpenAPI parity).
    global.fetch = vi.fn(async () => new Response('{"oops":1}', {
      status: 418, headers: { 'content-type': 'application/json' },
    }));
    clearCacheForTests();
    const teapot = await app.inject('/api/macrovol/rates/summary');
    expect(teapot.statusCode).toBe(502);
    expect(upstream502(teapot.json())).toBe(true);

    // Worker 500 is preserved and validates against the 500 schema.
    global.fetch = vi.fn(async () => new Response('{"oops":1}', {
      status: 500, headers: { 'content-type': 'application/json' },
    }));
    clearCacheForTests();
    const fiveHundred = await app.inject('/api/macrovol/rates/summary');
    expect(fiveHundred.statusCode).toBe(500);
    expect(upstream500(fiveHundred.json())).toBe(true);

    await app.close();
  });
});
