import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import rateLimit, { normalizeIP } from '@fastify/rate-limit';

function rateLimitClassForUrl(url) {
  const u = url || '';
  if (u.startsWith('/api/alphavantage') || u.startsWith('/api/tradingview')) return 'scarce';
  if (
    u.startsWith('/api/fmp') ||
    u.startsWith('/api/finnhub') ||
    u.startsWith('/api/massive') ||
    u.startsWith('/api/flashalpha') ||
    u.startsWith('/api/desk') ||
    u.startsWith('/api/macrovol') ||
    u.startsWith('/api/options') ||
    u.startsWith('/api/yf') ||
    u.startsWith('/api/deribit') ||
    u.startsWith('/api/ksa') ||
    u.startsWith('/api/history')
  )
    return 'upstream';
  return 'global';
}

async function buildApp(opts = {}) {
  const app = Fastify({ logger: false, trustProxy: false });
  await app.register(rateLimit, {
    max: 2,
    timeWindow: 60_000,
    ipv6Subnet: 64,
    keyGenerator: (request) => `${rateLimitClassForUrl(request.url)}:${normalizeIP(request.ip, 64)}`,
    addHeaders: false,
    ...opts,
  });
  app.get('/api/fmp/quote', async () => ({ ok: true }));
  app.get('/api/health', async () => ({ ok: true }));
  return app;
}

describe('rate-limit IPv6 bucket canonicalization (GHSA-grpc-p53c-r64v)', () => {
  it('normalizeIP collapses IPv4-mapped IPv6 to same bucket', () => {
    expect(normalizeIP('::ffff:1.2.3.4', 64)).toBe(normalizeIP('1.2.3.4', 64));
    expect(normalizeIP('::ffff:127.0.0.1', 64)).toBe(normalizeIP('127.0.0.1', 64));
  });

  it('distinct IPv4 and IPv6 clients get distinct buckets', async () => {
    const app = await buildApp();
    // Exhaust bucket for 10.0.0.1
    await app.inject({ method: 'GET', url: '/api/fmp/quote', remoteAddress: '10.0.0.1' });
    await app.inject({ method: 'GET', url: '/api/fmp/quote', remoteAddress: '10.0.0.1' });
    const blocked = await app.inject({ method: 'GET', url: '/api/fmp/quote', remoteAddress: '10.0.0.1' });
    expect(blocked.statusCode).toBe(429);
    // Different IP still allowed
    const other = await app.inject({ method: 'GET', url: '/api/fmp/quote', remoteAddress: '10.0.0.2' });
    expect(other.statusCode).toBe(200);
    await app.close();
  });

  it('IPv4-mapped IPv6 shares bucket with plain IPv4 (no bypass)', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/api/fmp/quote', remoteAddress: '1.2.3.4' });
    await app.inject({ method: 'GET', url: '/api/fmp/quote', remoteAddress: '1.2.3.4' });
    const viaMapped = await app.inject({
      method: 'GET',
      url: '/api/fmp/quote',
      remoteAddress: '::ffff:1.2.3.4',
    });
    expect(viaMapped.statusCode).toBe(429);
    await app.close();
  });

  it('client cannot bypass by forging X-Forwarded-For when trustProxy is false', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/api/fmp/quote', remoteAddress: '203.0.113.7' });
    await app.inject({ method: 'GET', url: '/api/fmp/quote', remoteAddress: '203.0.113.7' });
    const forged = await app.inject({
      method: 'GET',
      url: '/api/fmp/quote',
      remoteAddress: '203.0.113.7',
      headers: { 'x-forwarded-for': '198.51.100.99' },
    });
    expect(forged.statusCode).toBe(429);
    await app.close();
  });

  it('rate-limit class prefix isolates scarce vs upstream budgets (cheap health cannot exhaust scarce)', async () => {
    const app = await buildApp();
    // Exhaust upstream bucket
    await app.inject({ method: 'GET', url: '/api/fmp/quote', remoteAddress: '10.0.0.5' });
    await app.inject({ method: 'GET', url: '/api/fmp/quote', remoteAddress: '10.0.0.5' });
    const upstreamBlocked = await app.inject({
      method: 'GET',
      url: '/api/fmp/quote',
      remoteAddress: '10.0.0.5',
    });
    expect(upstreamBlocked.statusCode).toBe(429);
    // Same IP but different class (health is global) should still be allowed (2 per class)
    const health = await app.inject({ method: 'GET', url: '/api/health', remoteAddress: '10.0.0.5' });
    expect(health.statusCode).toBe(200);
    await app.close();
  });
});
