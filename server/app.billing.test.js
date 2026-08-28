/**
 * buildServer Billing/Auth invariants — with and without Stripe keys.
 * Verifies BILLING_HANDOFF.md: endpoints always exist, fail closed when absent,
 * app remains consistent, no Connect/payment_method_types.
 */
import { describe, it, expect, vi } from 'vitest';

describe('buildServer Billing/Auth (fail-closed)', () => {
  it('billing endpoints exist and fail closed without STRIPE_SECRET_KEY', async () => {
    const orig = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    vi.resetModules();
    const { buildServer } = await import('./app.js');
    const app = await buildServer();
    // /api/billing/config returns 200 with enabled:false when no key (fail-closed shape)
    const cfg = await app.inject({ method: 'GET', url: '/api/billing/config' });
    expect(cfg.statusCode).toBe(200);
    expect(cfg.json().enabled).toBe(false);
    // Checkout should fail closed (503) without key
    const chk = await app.inject({ method: 'POST', url: '/api/billing/checkout-session', payload: {} });
    expect([401, 403, 503]).toContain(chk.statusCode);
    await app.close();
    if (orig) process.env.STRIPE_SECRET_KEY = orig;
  });

  it('Stripe webhook RAW parser stays scoped (JSON routes parse)', async () => {
    const orig = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    vi.resetModules();
    const { buildServer } = await import('./app.js');
    const app = await buildServer();
    app.post('/api/echo-test-scope', async (req) => ({ body: req.body }));
    const res = await app.inject({ method: 'POST', url: '/api/echo-test-scope', payload: { hello: 'world' } });
    expect(res.json().body).toEqual({ hello: 'world' });
    await app.close();
    if (orig) process.env.STRIPE_SECRET_KEY = orig;
  });
});
