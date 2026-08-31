import { describe, it, expect } from 'vitest';
import {
  compileRuntimeRoutes,
  parsePattern,
  resolves,
  routeRegex,
} from './route-parity-lib.mjs';

const runtime = [
  { method: 'GET', url: '/api/rates/term-structure' },
  { method: 'POST', url: '/api/billing/webhook' },
  { method: ['GET', 'POST', 'OPTIONS'], url: '/api/macrovol/*' },
  { method: 'GET', url: '/api/deribit/market/:currency' },
];

const compiled = compileRuntimeRoutes(runtime);

describe('route parity: method-aware resolution (C2)', () => {
  it('matches method + path (GET call → GET route)', () => {
    expect(resolves(compiled, '/api/rates/term-structure')).toBe(true);
    expect(resolves(compiled, 'GET /api/rates/term-structure')).toBe(true);
    expect(resolves(compiled, '/api/deribit/market/BTC')).toBe(true);
  });

  it('resolves annotated dynamic calls with an explicit method prefix', () => {
    expect(resolves(compiled, 'POST /api/billing/webhook')).toBe(true);
    expect(resolves(compiled, 'GET /api/macrovol/whatever')).toBe(true); // GET on multi-method
    expect(resolves(compiled, 'POST /api/macrovol/whatever')).toBe(true);
  });

  it('NEGATIVE: wrong method fails even when the path exists', () => {
    // Path exists as GET but the frontend POSTs → must NOT resolve.
    expect(resolves(compiled, 'POST /api/rates/term-structure')).toBe(false);
    // Path exists as POST but the frontend GETs → must NOT resolve.
    expect(resolves(compiled, 'GET /api/billing/webhook')).toBe(false);
    // DELETE to any existing path → fails.
    expect(resolves(compiled, 'DELETE /api/deribit/market/BTC')).toBe(false);
  });

  it('unresolved paths fail regardless of method', () => {
    expect(resolves(compiled, 'GET /api/does-not-exist')).toBe(false);
    expect(resolves(compiled, 'POST /api/does-not-exist')).toBe(false);
  });

  it('parsePattern defaults to GET and trims method prefixes', () => {
    expect(parsePattern('/api/foo')).toEqual({ method: 'GET', path: '/api/foo' });
    expect(parsePattern('POST /api/foo')).toEqual({ method: 'POST', path: '/api/foo' });
    expect(parsePattern('  patch   /api/foo  ')).toEqual({ method: 'PATCH', path: '/api/foo' });
  });

  it('route regex handles dynamic segments and trailing slashes', () => {
    const re = routeRegex('/api/deribit/:currency');
    expect(re.test('/api/deribit/BTC')).toBe(true);
    expect(re.test('/api/deribit/BTC/')).toBe(true);
    expect(re.test('/api/deribit/BTC/extra')).toBe(false);
  });
});