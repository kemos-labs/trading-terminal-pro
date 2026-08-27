import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import Fastify from 'fastify';

describe('Stripe invariant — no payment_method_types, no Connect', () => {
  it('source contains no payment_method_types code (only the OMITTED comment)', () => {
    const src = readFileSync('./api/stripeBilling.js', 'utf8');
    // Remove the single allowed comment line entirely, then assert no occurrence remains
    const withoutAllowedComment = src.replace(
      /payment_method_types is intentionally OMITTED.*$/m,
      '',
    );
    expect(withoutAllowedComment).not.toMatch(/payment_method_types/);
    // Explicitly forbid Connect transfer patterns
    expect(src).not.toMatch(/transfer_data/);
    expect(src).not.toMatch(/stripe\.accounts/);
    expect(src).not.toMatch(/application_fee/);
  });

  it('webhook raw parser is scoped — sibling JSON routes still parse to object', async () => {
    vi.resetModules();
    delete process.env.STRIPE_SECRET_KEY;
    const { registerStripeBilling } = await import('./stripeBilling.js');
    const app = Fastify({ logger: false });
    await registerStripeBilling(app);
    app.post('/api/echo', async (req) => ({ body: req.body, isString: typeof req.body === 'string' }));
    // Normal JSON route should parse to object, not raw string
    const res = await app.inject({
      method: 'POST',
      url: '/api/echo',
      payload: { hello: 'world' },
    });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.isString).toBe(false);
    expect(j.body).toEqual({ hello: 'world' });
    await app.close();
  });

  it('billing endpoints fail closed when STRIPE_SECRET_KEY absent (503)', async () => {
    vi.resetModules();
    const saved = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    const { registerStripeBilling } = await import('./stripeBilling.js');
    const app = Fastify({ logger: false });
    await registerStripeBilling(app);
    const checkout = await app.inject({
      method: 'POST',
      url: '/api/billing/checkout-session',
      payload: { priceId: 'price_test_123' },
    });
    expect(checkout.statusCode).toBe(503);
    const portal = await app.inject({
      method: 'POST',
      url: '/api/billing/portal-session',
      payload: {},
    });
    expect(portal.statusCode).toBe(503);
    await app.close();
    if (saved) process.env.STRIPE_SECRET_KEY = saved;
  });

  it('webhook without stripe-signature is rejected (400/401 when configured, 503 when not)', async () => {
    vi.resetModules();
    // When not configured, webhook fails closed with 503 — also a safe rejection
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { registerStripeBilling: regA } = await import('./stripeBilling.js');
    const appA = Fastify({ logger: false });
    await regA(appA);
    const resA = await appA.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      payload: { type: 'checkout.session.completed', data: { object: {} } },
    });
    expect([400, 401, 503]).toContain(resA.statusCode);
    await appA.close();

    // When configured, missing signature must be 400 (signature verification)
    vi.resetModules();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy_123');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_dummy_123456');
    const { registerStripeBilling: regB } = await import('./stripeBilling.js');
    const appB = Fastify({ logger: false });
    await regB(appB);
    const resB = await appB.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } }),
    });
    expect([400, 401]).toContain(resB.statusCode);
    await appB.close();
    vi.unstubAllEnvs();
  });
});
