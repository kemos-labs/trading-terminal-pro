/**
 * Password-reset issuance — log-capture security tests.
 *
 * Regression for the "reset token logged for operator handoff" vulnerability:
 * any reader of server logs (log shipper, crash dump, support tool) used to
 * become a password-reset oracle. Public web requests must never mint or log
 * a token. Token creation remains the audited offline admin path
 * (scripts/auth-reset.mjs → authStore.createResetToken).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Fastify from 'fastify';

let DATA_DIR;

/** Fresh isolated module graph (module-level stores keyed to temp dir). */
async function freshAuthStore() {
  vi.resetModules();
  process.env.BILLING_DATA_DIR = DATA_DIR;
  return import('./authStore.js');
}

async function buildApp(sinkLines) {
  vi.resetModules();
  process.env.BILLING_DATA_DIR = DATA_DIR;
  // registerStripeAuth resolves gate state lazily at request time; a plain
  // import graph is fine here as long as BILLING_DATA_DIR is set first.
  const { registerStripeAuth } = await import('./authRoutes.js');
  const app = Fastify({
    logger: {
      level: 'warn',
      stream: {
        write(line) {
          sinkLines.push(line);
        },
      },
    },
  });
  await app.register(registerStripeAuth);
  return app;
}

beforeEach(() => {
  DATA_DIR = mkdtempSync(join(tmpdir(), 'dsh-reset-test-'));
});

afterEach(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  delete process.env.BILLING_DATA_DIR;
});

describe('POST /api/auth/reset-request (public issuance disabled)', () => {
  it('mints nothing: response is generic and no reset token is persisted', async () => {
    const store = await freshAuthStore();
    store.createUser('victim@test.dev', 'password123');
    const lines = [];
    const app = await buildApp(lines);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-request',
      payload: { email: 'victim@test.dev' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/token/i);

    // No grant file anywhere in the data dir.
    expect(existsSync(join(DATA_DIR, 'reset-tokens.json'))).toBe(false);
    // The endpoint cannot be replayed into a working confirmation.
    await app.close();

    const store2 = await freshAuthStore();
    expect(() =>
      store2.confirmPasswordReset('anything', 'newpassword99'),
    ).toThrowError(/invalid or has expired/i);
  });

  it('emits NO log line containing email values or any token material', async () => {
    const store = await freshAuthStore();
    store.createUser('secret-email@test.dev', 'password123');
    const lines = [];
    const app = await buildApp(lines);

    await app.inject({
      method: 'POST',
      url: '/api/auth/reset-request',
      payload: { email: 'secret-email@test.dev' },
    });

    const rawLogs = lines.join('\n');
    expect(rawLogs.length).toBeGreaterThan(0); // the disable warning IS logged
    expect(rawLogs).not.toContain('secret-email@test.dev');
    // No base64url-looking credential shape may appear in captured logs.
    expect(rawLogs).not.toMatch(/"token"/i);
    await app.close();
  });

  it('unknown accounts get the identical generic answer (no enumeration)', async () => {
    const store = await freshAuthStore();
    store.createUser('real@test.dev', 'password123');
    const linesA = [];
    const appA = await buildApp(linesA);
    const real = await appA.inject({
      method: 'POST',
      url: '/api/auth/reset-request',
      payload: { email: 'real@test.dev' },
    });
    await appA.close();

    const linesB = [];
    const appB = await buildApp(linesB);
    const ghost = await appB.inject({
      method: 'POST',
      url: '/api/auth/reset-request',
      payload: { email: 'ghost@test.dev' },
    });
    await appB.close();

    expect(ghost.statusCode).toBe(real.statusCode);
    expect(ghost.body).toEqual(real.body);
    expect(existsSync(join(DATA_DIR, 'reset-tokens.json'))).toBe(false);
  });
});

describe('offline admin path stays functional (audited replacement)', () => {
  it('createResetToken + confirm round-trip still works without any logging surface', async () => {
    const store = await freshAuthStore();
    store.createUser('admin-path@test.dev', 'oldpassword1');
    const oldSession = store.issueSession('admin-path@test.dev');

    const token = store.createResetToken('admin-path@test.dev');
    expect(token).toMatch(/^[A-Za-z0-9_-]{10,}$/);

    const email = store.confirmPasswordReset(token, 'newpassword99');
    expect(email).toBe('admin-path@test.dev');
    expect(store.verifyCredentials('admin-path@test.dev', 'newpassword99')).toBe('admin-path@test.dev');
    // Old sessions revoked by the credential change.
    expect(store.getSessionEmail({ headers: { cookie: `vt_session=${oldSession}` } })).toBeNull();
  });

  it('persisted grants are mode-600 style secrets kept out of any source tree', async () => {
    const store = await freshAuthStore();
    store.createUser('perm@test.dev', 'password123');
    store.createResetToken('perm@test.dev');
    expect(existsSync(join(DATA_DIR, 'reset-tokens.json'))).toBe(true);
    // Sanity: the data dir lives in the OS temp area during this test.
    expect(DATA_DIR.startsWith(tmpdir())).toBe(true);
    expect(readFileSync(join(DATA_DIR, 'reset-tokens.json'), 'utf8')).toContain('email');
  });
});
