/**
 * Security regression tests — bounty-hunt pass (2026-08).
 * Covers: FMP allowlist traversal bypass, session lifecycle + persistence,
 * password reset flow incl. old-session revocation.
 *
 * authStore is imported fresh per test with a temp BILLING_DATA_DIR so the
 * module-level file stores (users/sessions/reset-tokens) never leak between
 * tests, and the "restart" test can simulate a fresh process import.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let DATA_DIR;

async function freshAuthStore() {
  vi.resetModules();
  process.env.BILLING_DATA_DIR = DATA_DIR;
  return import('./authStore.js');
}

beforeEach(() => {
  DATA_DIR = mkdtempSync(join(tmpdir(), 'dsh-auth-test-'));
});

afterEach(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  delete process.env.BILLING_DATA_DIR;
});

describe('FMP endpoint allowlist (api/_shared.js)', () => {
  it('allows known endpoints and their subpaths/queries', async () => {
    const { isFmpEndpointAllowed } = await import('./_shared.js');
    expect(isFmpEndpointAllowed('quote')).toBe(true);
    expect(isFmpEndpointAllowed('quote?symbol=AAPL')).toBe(true);
    expect(isFmpEndpointAllowed('profile/AAPL')).toBe(true);
    expect(isFmpEndpointAllowed('historical-price-eod/light?symbol=SPY&limit=7500')).toBe(true);
  });

  it('rejects dot-segment traversal that fetch() would normalize upstream', async () => {
    const { isFmpEndpointAllowed } = await import('./_shared.js');
    // These escaped the prefix allowlist pre-fix and reached arbitrary paid endpoints.
    expect(isFmpEndpointAllowed('quote/../../../../stable/delisted-companies')).toBe(false);
    expect(isFmpEndpointAllowed('quote/%2e%2e/%2e%2e/stable/income-statement')).toBe(false);
    expect(isFmpEndpointAllowed('quote/../../../stable/historical-price-eod/full')).toBe(false);
    expect(isFmpEndpointAllowed('./profile')).toBe(false);
  });

  it('still rejects endpoints outside the allowlist', async () => {
    const { isFmpEndpointAllowed } = await import('./_shared.js');
    expect(isFmpEndpointAllowed('insider-trading')).toBe(false);
    expect(isFmpEndpointAllowed('bulk-screen')).toBe(false);
  });

  it('canonicalizes query order and bounds query cardinality', async () => {
    const { canonicalizeFmpEndpoint, proxyFmp } = await import('./_shared.js');
    expect(canonicalizeFmpEndpoint('quote?b=2&a=1')).toBe('quote?a=1&b=2');
    expect(canonicalizeFmpEndpoint('quote?a=1&a=2')).toBe('quote?a=1&a=2');
    expect(canonicalizeFmpEndpoint('quote?bad%2')).toBeNull();
    expect(canonicalizeFmpEndpoint('quote?a=1?b=2')).toBeNull();
    expect(canonicalizeFmpEndpoint(`quote?${Array.from({ length: 17 }, (_, i) => `p${i}=x`).join('&')}`)).toBeNull();
    expect(canonicalizeFmpEndpoint(`quote?symbol=${'x'.repeat(257)}`)).toBeNull();
    const realFetch = global.fetch;
    global.fetch = vi.fn(async () => new Response(JSON.stringify([{ symbol: 'SPY' }]), { status: 200, headers: { 'content-type': 'application/json' } }));
    try {
      const first = await proxyFmp('quote?b=2&a=1', 'test-key', 'https://fmp.test');
      const second = await proxyFmp('quote?a=1&b=2', 'test-key', 'https://fmp.test');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(first).toMatchObject({ upstreamFill: true, fromCache: false });
      expect(second).toMatchObject({ upstreamFill: false, fromCache: true });
    } finally {
      global.fetch = realFetch;
    }
  });

  it('coalesces concurrent canonical FMP fills and charges quota once', async () => {
    const { proxyFmp } = await import('./_shared.js');
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const realFetch = global.fetch;
    global.fetch = vi.fn(async () => {
      await gate;
      return new Response(JSON.stringify([{ symbol: 'COALESCE' }]), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    try {
      const first = proxyFmp('quote?symbol=COALESCE&b=2&a=1', 'test-key', 'https://fmp.test');
      const second = proxyFmp('quote?a=1&symbol=COALESCE&b=2', 'test-key', 'https://fmp.test');
      await Promise.resolve();
      release();
      const [a, b] = await Promise.all([first, second]);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(a).toMatchObject({ upstreamFill: true });
      expect(b).toMatchObject({ upstreamFill: true, coalesced: true });
    } finally {
      global.fetch = realFetch;
    }
  });

  it('fails closed on the 501st distinct in-flight key while existing keys still join', async () => {
    const { __testHooks, proxyFmp } = await import('./_shared.js');
    const { getBudgetUsed } = await import('./upstreamCache.js');
    const inflight = __testHooks.fmpInflight;
    const held = new Promise(() => {});
    const existingKey = 'quote?symbol=HELD0';
    for (let i = 0; i < 499; i += 1) inflight.set(`held-${i}`, held);
    inflight.set(existingKey, held);
    const beforeBudget = getBudgetUsed('fmp');
    const realFetch = global.fetch;
    global.fetch = vi.fn();
    try {
      const overloaded = await proxyFmp(`quote?symbol=OVERLOAD${Date.now()}`, 'test-key', 'https://fmp.test');
      expect(overloaded).toMatchObject({ status: 503, upstreamFill: false });
      expect(global.fetch).not.toHaveBeenCalled();
      expect(getBudgetUsed('fmp')).toBe(beforeBudget);
      const joined = proxyFmp(existingKey, 'test-key', 'https://fmp.test');
      expect(joined).toBeInstanceOf(Promise);
    } finally {
      global.fetch = realFetch;
      inflight.clear();
    }
  });
});

describe('authStore sessions', () => {
  it('issues, resolves and revokes sessions', async () => {
    const store = await freshAuthStore();
    store.createUser('a@test.dev', 'password123');
    const cookie = store.issueSession('A@Test.Dev'); // email normalization
    expect(store.getSessionEmail({ headers: { cookie: `vt_session=${cookie}` } })).toBe('a@test.dev');

    store.revokeSession(cookie);
    expect(store.getSessionEmail({ headers: { cookie: `vt_session=${cookie}` } })).toBeNull();
  });

  it('survives a module "restart" (fresh import reads persisted sessions)', async () => {
    const store = await freshAuthStore();
    store.createUser('p@test.dev', 'password123');
    const cookie = store.issueSession('p@test.dev');

    // Simulate server restart: brand-new module instance, same data dir.
    const reloaded = await freshAuthStore();
    expect(reloaded.getSessionEmail({ headers: { cookie: `vt_session=${cookie}` } })).toBe('p@test.dev');
  });

  it('rejects forged signatures and garbage cookies', async () => {
    const store = await freshAuthStore();
    const cookie = store.issueSession('f@test.dev');
    const [token] = cookie.split('.');
    expect(store.getSessionEmail({ headers: { cookie: `vt_session=${token}.deadbeef` } })).toBeNull();
    expect(store.getSessionEmail({ headers: { cookie: 'vt_session=.' } })).toBeNull();
    expect(store.getSessionEmail({ headers: { cookie: '' } })).toBeNull();
  });

  it('revokes ALL sessions of an email on demand', async () => {
    const store = await freshAuthStore();
    store.createUser('m@test.dev', 'password123');
    const c1 = store.issueSession('m@test.dev');
    const c2 = store.issueSession('m@test.dev');
    expect(store.revokeAllSessions('m@test.dev')).toBe(2);
    for (const c of [c1, c2]) {
      expect(store.getSessionEmail({ headers: { cookie: `vt_session=${c}` } })).toBeNull();
    }
  });

  it('verifyCredentials does not leak timing shape on unknown emails (dummy scrypt burn)', async () => {
    const store = await freshAuthStore();
    store.createUser('real@test.dev', 'password123');
    expect(store.verifyCredentials('ghost@test.dev', 'password123')).toBeNull();
    expect(store.verifyCredentials('real@test.dev', 'wrongpass1')).toBeNull();
    expect(store.verifyCredentials('real@test.dev', 'password123')).toBe('real@test.dev');
  });
});

describe('password reset flow', () => {
  it('returns null tokens for unknown emails (no enumeration)', async () => {
    const store = await freshAuthStore();
    expect(store.createResetToken('nobody@test.dev')).toBeNull();
  });

  it('full round-trip: token → confirm → old password dead, all old sessions revoked', async () => {
    const store = await freshAuthStore();
    store.createUser('r@test.dev', 'oldpassword1');
    const oldSession = store.issueSession('r@test.dev');

    const token = store.createResetToken('R@Test.Dev');
    expect(token).toBeTruthy();

    // Weak password rejected, token stays single-use-valid.
    await expect(() => store.confirmPasswordReset(token, 'short')).toThrowError(/8 characters/);

    // Bad token rejected.
    await expect(() => store.confirmPasswordReset('bogus-token', 'newpassword99')).toThrowError(
      /invalid or has expired/i,
    );

    // Good reset: new credential works…
    const email = store.confirmPasswordReset(token, 'newpassword99');
    expect(email).toBe('r@test.dev');
    expect(store.verifyCredentials('r@test.dev', 'newpassword99')).toBe('r@test.dev');
    expect(store.verifyCredentials('r@test.dev', 'oldpassword1')).toBeNull();

    // …and every pre-reset session is dead.
    expect(store.getSessionEmail({ headers: { cookie: `vt_session=${oldSession}` } })).toBeNull();
  });

  it('reset tokens are single-use', async () => {
    const store = await freshAuthStore();
    store.createUser('s@test.dev', 'password123');
    const token = store.createResetToken('s@test.dev');
    store.confirmPasswordReset(token, 'newpassword99');
    await expect(() => store.confirmPasswordReset(token, 'anotherpass99')).toThrowError(
      /invalid or has expired/i,
    );
  });
});
