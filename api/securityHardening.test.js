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
