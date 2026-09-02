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
    expect(item.get.responses[502].content['application/json'].schema.properties.error.const).toBe('UPSTREAM_ERROR');
    expect(item.get.responses[200].content['application/json'].schema.properties.cache).toBeDefined();
  });

  it('validates actual runtime 200/400/404/502 responses against the documented schemas', async () => {
    const app = Fastify();
    await registerMacrovolRoutes(app);
    const doc = buildOpenApiDocument().paths['/api/macrovol/{wildcard}'].get;
    const ajv = new Ajv({ strict: false });
    const ok = ajv.compile(doc.responses[200].content['application/json'].schema);
    const bad = ajv.compile(doc.responses[400].content['application/json'].schema);
    const notAllowed = ajv.compile(doc.responses[404].content['application/json'].schema);
    const upstream = ajv.compile(doc.responses[502].content['application/json'].schema);

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
    expect(upstream(down.json())).toBe(true);
    expect(down.body).not.toContain('WORKER-DIAGNOSTIC');

    await app.close();
  });
});
