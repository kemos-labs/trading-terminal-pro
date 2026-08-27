/**
 * Explicit proxy trust — policy resolution tests (api/proxyTrust.js) and
 * end-to-end spoofing tests through a real Fastify instance.
 *
 * Threat: a client sending `X-Forwarded-For` must NEVER influence
 * request.ip unless the peer is an explicitly trusted ingress.
 */
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { parseCidrList, resolveProxyTrust, validateCidrEntry } from './proxyTrust.js';

describe('resolveProxyTrust policy', () => {
  it('trusts nobody by default (direct exposure / local dev)', () => {
    const p = resolveProxyTrust({});
    expect(p.trustProxy).toBe(false);
    expect(p.source).toBe('none');
  });

  it('resolves TRUST_PROXY_CIDRS to the exact allowlist', () => {
    const p = resolveProxyTrust({ TRUST_PROXY_CIDRS: '10.0.0.0/8, 172.16.5.4, fd00::/8' });
    expect(p.trustProxy).toEqual(['10.0.0.0/8', '172.16.5.4', 'fd00::/8']);
    expect(p.source).toBe('cidrs');
  });

  it('fails closed on malformed CIDRS entries (startup must abort)', () => {
    expect(() => resolveProxyTrust({ TRUST_PROXY_CIDRS: '10.0.0.0/8,not-an-ip' })).toThrowError(/not an IP or IP\/bits/i);
    expect(() => resolveProxyTrust({ TRUST_PROXY_CIDRS: '10.1.2.3/99' })).toThrowError(/0\.\.32/);
    expect(() => resolveProxyTrust({ TRUST_PROXY_CIDRS: 'fd00::/300' })).toThrowError(/0\.\.128/);
    expect(() => validateCidrEntry('10.1.2.3/x')).toThrowError(/non-integer prefix/i);
    expect(() => parseCidrList('   ')).toThrowError(/empty after parsing/i);
  });

  it('resolves TRUST_PROXY_HOPS as an integer in range', () => {
    expect(resolveProxyTrust({ TRUST_PROXY_HOPS: '2' }).trustProxy).toBe(2);
    expect(resolveProxyTrust({ TRUST_PROXY_HOPS: '8' }).source).toBe('hops');
  });

  it('out-of-range hops fail closed rather than degrade', () => {
    expect(() => resolveProxyTrust({ TRUST_PROXY_HOPS: '0' })).toThrowError(/between 1 and 8/);
    expect(() => resolveProxyTrust({ TRUST_PROXY_HOPS: '9' })).toThrowError(/between 1 and 8/);
    expect(() => resolveProxyTrust({ TRUST_PROXY_HOPS: 'many' })).toThrowError(/between 1 and 8/);
  });

  it('legacy TRUST_PROXY=1 maps to one hop with a deprecation warning; other values ignored', () => {
    const legacy = resolveProxyTrust({ TRUST_PROXY: '1' });
    expect(legacy.trustProxy).toBe(1);
    expect(legacy.source).toBe('legacy');
    expect(legacy.warnings.join('\n')).toMatch(/deprecated/i);

    const junk = resolveProxyTrust({ TRUST_PROXY: 'yes-please' });
    expect(junk.trustProxy).toBe(false);
    expect(junk.warnings.join('\n')).toMatch(/is ignored/u);
  });
});

/** Builds a minimal app that echoes request.ip using the given trustProxy. */
async function echoApp(trustProxy) {
  const app = Fastify({ logger: false, ...(trustProxy !== undefined ? { trustProxy } : {}) });
  app.get('/ip', async (request) => ({ ip: request.ip }));
  return app;
}

describe('spoofed X-Forwarded-For through Fastify (light-my-request remoteAddress)', () => {
  it('ignores client-supplied XFF when nothing is trusted', async () => {
    const app = await echoApp(false);
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '203.0.113.7',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ip).toBe('203.0.113.7');
    await app.close();
  });

  it('honors XFF only when the socket peer is in the trusted CIDR list', async () => {
    // Edge at 10.66.0.9 forwards visitor 198.51.100.23.
    const app = await echoApp(['10.66.0.0/24']);
    const viaEdge = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '10.66.0.9',
      headers: { 'x-forwarded-for': '198.51.100.23' },
    });
    expect(viaEdge.json().ip).toBe('198.51.100.23');

    // The same forged header from a NON-trusted peer changes nothing.
    const direct = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '203.0.113.7',
      headers: { 'x-forwarded-for': '198.51.100.23' },
    });
    expect(direct.json().ip).toBe('203.0.113.7');
    await app.close();
  });

  it('forged chained claims cannot deepen past an untrusted intermediary', async () => {
    // XFF="A, B" through trusted edge E: proxy-addr walks outward from the
    // socket (E trusted → considers only B). If B is not itself on the
    // trusted list, "A" is unreachable fiction injected behind B — request.ip
    // stays B. A caller cannot credit a phantom origin by chaining values.
    const app = await echoApp(['10.66.0.0/24']);
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '10.66.0.9',
      headers: { 'x-forwarded-for': '203.0.113.7, 44.44.44.44' },
    });
    expect(res.json().ip).toBe('44.44.44.44');
    await app.close();
  });

  it('an edge-appended client survives forged inner entries', async () => {
    // Realistic production path: attacker sends XFF:"6.6.6.6" pre-edge; the
    // edge APPENDS the true client. Walk from trusted socket reaches the
    // appended (untrusted) real client — forged 6.6.6.6 is ignored.
    const app = await echoApp(['10.66.0.0/24']);
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '10.66.0.9',
      headers: { 'x-forwarded-for': '6.6.6.6, 198.51.100.23' },
    });
    expect(res.json().ip).toBe('198.51.100.23');
    await app.close();
  });

  it('a direct IPv6 connection never collapses into an IPv4 XFF claim', async () => {
    const app = await echoApp(false);
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '2001:db8::7',
      headers: { 'x-forwarded-for': '8.8.8.8' },
    });
    expect(res.json().ip).toBe('2001:db8::7');
    await app.close();
  });
});
