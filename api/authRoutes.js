/**
 * Auth routes — register / login / logout / me / password reset.
 * Mounted from server.js. `GET /api/auth/me` also returns billing gate info
 * so the SPA can decide desk access in one round-trip.
 *
 * Rate limiting: the global limiter (600/min in server.js) is far too loose
 * for credential endpoints, so each route here carries its own tight config
 * (10/min/IP). @fastify/rate-limit honors per-route `config.rateLimit`.
 */
import {
  COOKIE_CLEAR,
  confirmPasswordReset,
  createUser,
  getSessionEmail,
  issueSession,
  revokeSession,
  sessionSetCookieHeader,
  verifyCredentials,
} from './authStore.js';
import { billingEnabled, gateInfoForRequest } from './stripeBilling.js';

const SESSION_MAX_AGE = 30 * 24 * 3600;
// Tight per-IP caps for credential + reset endpoints (global limiter still applies beneath).
const AUTH_RL = { max: 10, timeWindow: '1 minute' };

export async function registerStripeAuth(fastify) {
  const setAuth = (reply, email) => {
    reply.header('set-cookie', sessionSetCookieHeader(issueSession(email), SESSION_MAX_AGE));
  };

  fastify.post('/api/auth/register', { config: { rateLimit: AUTH_RL } }, async (request, reply) => {
    const { email, password } = request.body || {};
    try {
      const em = createUser(email, password);
      setAuth(reply, em);
      return { user: { email: em } };
    } catch (err) {
      reply.code(400);
      return { error: err.message };
    }
  });

  fastify.post('/api/auth/login', { config: { rateLimit: AUTH_RL } }, async (request, reply) => {
    const { email, password } = request.body || {};
    const em = verifyCredentials(email, password);
    if (!em) {
      reply.code(401);
      return { error: 'Invalid email or password.' };
    }
    setAuth(reply, em);
    return { user: { email: em } };
  });

  fastify.post('/api/auth/logout', async (request, reply) => {
    const raw = request.headers.cookie || '';
    for (const part of raw.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === 'vt_session') revokeSession(rest.join('='));
    }
    reply.header('set-cookie', COOKIE_CLEAR);
    return { ok: true };
  });

  fastify.get('/api/auth/me', async (request) => {
    const email = getSessionEmail(request);
    return {
      user: email ? { email } : null,
      gate: gateInfoForRequest(request),
      billingConfigured: billingEnabled(),
    };
  });

  // ── Password reset ─────────────────────────────────────────────────────────
  // SECURITY (Phase 1): public self-service issuance is DISABLED until a real
  // mail provider exists. Previously the minted token was logged here for
  // "operator handoff", making any log reader a password-reset oracle — that
  // logging is gone and no token is minted from a web request at all.
  // Tokens for the confirm step are created only by the audited offline admin
  // path (scripts/auth-reset.mjs on the deploy box). Consuming tokens still
  // works via /api/auth/reset-confirm; responses stay generic so this endpoint
  // cannot be used to enumerate accounts.

  fastify.post('/api/auth/reset-request', { config: { rateLimit: AUTH_RL } }, async (request, reply) => {
    const hasEmail = typeof request.body?.email === 'string';
    request.log.warn({ hasEmail }, 'password reset requested — public issuance disabled (no mailer); use the offline admin path');
    // Always the same answer, whether or not the account exists. Truthful: no code is issued via this endpoint in this deployment.
    reply.header('set-cookie', COOKIE_CLEAR); // defensive: never chain a reset onto a session
    return { ok: true, message: 'If that account exists, an operator will handle the reset via the offline path. No code was issued by this endpoint (mailer not configured).' };
  });

  fastify.post('/api/auth/reset-confirm', { config: { rateLimit: AUTH_RL } }, async (request, reply) => {
    const { token, password } = request.body || {};
    try {
      const em = confirmPasswordReset(token, password);
      setAuth(reply, em); // fresh session on the new credential; old ones were revoked
      return { ok: true, user: { email: em } };
    } catch (err) {
      reply.code(400);
      return { error: err.message };
    }
  });
}
