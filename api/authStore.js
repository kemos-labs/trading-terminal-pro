/**
 * Minimal account store — email + password accounts, HMAC-signed session
 * cookies. Zero external dependencies (node:crypto only).
 *
 * Storage: `.data/users.json` (gitignored). Passwords stored as
 * scrypt(salt) hashes only. Sessions persist to `.data/sessions.json`
 * so restarts no longer force re-login; tokens remain server-side
 * (revocable) — the cookie carries token.signature, never state.
 *
 * Env:
 *   AUTH_SECRET        HMAC key for session tokens (auto-generated into
 *                      .data/auth-secret.txt when absent — set it explicitly
 *                      in multi-instance deployments).
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const DATA_DIR = process.env.BILLING_DATA_DIR || '.data';
const USERS_FILE = join(DATA_DIR, 'users.json');
const SESSION_COOKIE = 'vt_session';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

// ── Signing secret ────────────────────────────────────────────────────────────

function loadSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const f = join(DATA_DIR, 'auth-secret.txt');
  try {
    if (existsSync(f)) return readFileSync(f, 'utf8').trim();
    const s = randomBytes(32).toString('hex');
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(f, s, { mode: 0o600 });
    return s;
  } catch {
    return randomBytes(32).toString('hex'); // ephemeral fallback
  }
}
let SECRET = null;
const signingKey = () => (SECRET ??= loadSecret());

// ── Users ─────────────────────────────────────────────────────────────────────

/** @type {Map<string, {salt:string, hash:string, createdAt:number}>} keyed by email */
const users = new Map();

function persistUsers() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(USERS_FILE, JSON.stringify(Object.fromEntries(users), null, 2), { mode: 0o600 });
  } catch (e) {
    console.error('auth: users persist failed', e?.message || e);
  }
}

function loadUsers() {
  try {
    if (existsSync(USERS_FILE)) {
      for (const [k, v] of Object.entries(JSON.parse(readFileSync(USERS_FILE, 'utf8')))) users.set(k, v);
    }
  } catch (e) {
    console.error('auth: users load failed', e?.message || e);
  }
}
loadUsers();

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

function hashPassword(password, salt) {
  return scryptSync(String(password), salt, 64).toString('hex');
}

export function createUser(email, password) {
  const em = normalizeEmail(email);
  if (!isValidEmail(em)) throw Object.assign(new Error('Enter a valid email address.'), { code: 'INVALID_EMAIL' });
  if (typeof password !== 'string' || password.length < 8) {
    throw Object.assign(new Error('Password must be at least 8 characters.'), { code: 'WEAK_PASSWORD' });
  }
  if (users.has(em)) throw Object.assign(new Error('An account with that email already exists.'), { code: 'EXISTS' });
  const salt = randomBytes(16).toString('hex');
  users.set(em, { salt, hash: hashPassword(password, salt), createdAt: Date.now() });
  persistUsers();
  return em;
}

const DUMMY_SALT = randomBytes(16).toString('hex'); // timing equalizer for unknown emails

export function verifyCredentials(email, password) {
  const em = normalizeEmail(email);
  const u = users.get(em);
  if (!u) {
    // Burn the same scrypt cost as a real check so response time does not
    // reveal whether an account exists.
    hashPassword(password, DUMMY_SALT);
    return null;
  }
  const candidate = Buffer.from(hashPassword(password, u.salt), 'hex');
  const actual = Buffer.from(u.hash, 'hex');
  return candidate.length === actual.length && timingSafeEqual(candidate, actual) ? em : null;
}

export function userExists(email) {
  return users.has(normalizeEmail(email));
}

// ── Password reset tokens ─────────────────────────────────────────────────────
// Public request-reset never creates, returns, persists, or logs a token or
// email (see authRoutes.js — issuance is offline/operator-only via
// scripts/auth-reset.mjs on the deploy box). Tokens are single-use, 1h TTL,
// stored server-side only.

const RESET_FILE = join(DATA_DIR, 'reset-tokens.json');
const RESET_TTL_MS = 60 * 60 * 1000;
/** @type {Map<string, {email:string, expiresAt:number}>} token → grant */
const resetTokens = new Map();

function persistResetTokens() {
  try {
    const now = Date.now();
    for (const [tok, g] of resetTokens) if (g.expiresAt < now) resetTokens.delete(tok);
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(RESET_FILE, JSON.stringify(Object.fromEntries(resetTokens), null, 2), { mode: 0o600 });
  } catch (e) {
    console.error('auth: reset-token persist failed', e?.message || e);
  }
}

function loadResetTokens() {
  try {
    if (!existsSync(RESET_FILE)) return;
    const raw = JSON.parse(readFileSync(RESET_FILE, 'utf8'));
    const now = Date.now();
    for (const [tok, g] of Object.entries(raw)) {
      if (g?.email && typeof g.expiresAt === 'number' && g.expiresAt > now) resetTokens.set(tok, g);
    }
  } catch (e) {
    console.error('auth: reset-token load failed', e?.message || e);
  }
}
loadResetTokens();

/** Issues a reset token. Returns null for unknown emails (caller responds generically). */
export function createResetToken(email) {
  const em = normalizeEmail(email);
  if (!users.has(em)) return null;
  const token = randomBytes(24).toString('base64url');
  resetTokens.set(token, { email: em, expiresAt: Date.now() + RESET_TTL_MS });
  persistResetTokens();
  return token;
}

/**
 * Consumes a reset token and sets the new password. Revokes every existing
 * session for the account. Throws {code:'WEAK_PASSWORD'|'INVALID_TOKEN'}.
 */
export function confirmPasswordReset(token, newPassword) {
  const grant = typeof token === 'string' ? resetTokens.get(token) : null;
  if (!grant || grant.expiresAt < Date.now()) {
    resetTokens.delete(String(token));
    persistResetTokens();
    throw Object.assign(new Error('Reset link is invalid or has expired.'), { code: 'INVALID_TOKEN' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    throw Object.assign(new Error('Password must be at least 8 characters.'), { code: 'WEAK_PASSWORD' });
  }
  const u = users.get(grant.email);
  if (!u) throw Object.assign(new Error('Account no longer exists.'), { code: 'INVALID_TOKEN' });
  u.salt = randomBytes(16).toString('hex');
  u.hash = hashPassword(newPassword, u.salt);
  u.passwordChangedAt = Date.now();
  persistUsers();
  resetTokens.delete(token);
  persistResetTokens();
  revokeAllSessions(grant.email); // old sessions must not survive a credential change
  return grant.email;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

/** @type {Map<string, {email:string, expiresAt:number}>} token → session */
const sessions = new Map();
const SESSIONS_FILE = join(DATA_DIR, 'sessions.json');

function persistSessions() {
  try {
    const now = Date.now();
    for (const [tok, sess] of sessions) if (sess.expiresAt < now) sessions.delete(tok);
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2), { mode: 0o600 });
  } catch (e) {
    console.error('auth: sessions persist failed', e?.message || e);
  }
}

function loadSessions() {
  try {
    if (!existsSync(SESSIONS_FILE)) return;
    const raw = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
    const now = Date.now();
    for (const [tok, sess] of Object.entries(raw)) {
      if (sess && typeof sess.expiresAt === 'number' && sess.expiresAt > now && sess.email) {
        sessions.set(tok, sess);
      }
    }
  } catch (e) {
    console.error('auth: sessions load failed', e?.message || e);
  }
}
loadSessions();

function sign(token) {
  return createHmac('sha256', signingKey()).update(token).digest('base64url');
}

export function issueSession(email) {
  const token = randomBytes(32).toString('base64url');
  sessions.set(token, { email: normalizeEmail(email), expiresAt: Date.now() + SESSION_TTL_MS });
  persistSessions();
  return `${token}.${sign(token)}`;
}

export function revokeSession(cookieValue) {
  if (!cookieValue) return;
  const token = cookieValue.split('.')[0];
  if (!sessions.delete(token)) return;
  persistSessions();
}

/** Revokes every session held by an email (used after a password reset). */
export function revokeAllSessions(email) {
  const em = normalizeEmail(email);
  let removed = 0;
  for (const [tok, sess] of sessions) {
    if (sess.email === em) { sessions.delete(tok); removed++; }
  }
  if (removed) persistSessions();
  return removed;
}

export function resolveSession(cookieValue) {
  if (!cookieValue || !cookieValue.includes('.')) return null;
  const [token, sig] = cookieValue.split('.');
  const expected = sign(token);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const sess = sessions.get(token);
  if (!sess || sess.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return sess;
}

/** Extracts the authenticated email from a Fastify request, or null. */
export function getSessionEmail(request) {
  const raw = request.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      return resolveSession(rest.join('='))?.email ?? null;
    }
  }
  return null;
}

export function sessionSetCookieHeader(value, maxAgeSeconds) {
  // Render/Railway serve HTTPS without setting NODE_ENV — treat their markers
  // as production so the session cookie is never sent without Secure over TLS.
  const secure =
    process.env.NODE_ENV === 'production' || process.env.RENDER_EXTERNAL_URL || process.env.RAILWAY_PUBLIC_DOMAIN
      ? '; Secure'
      : '';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}
export const COOKIE_CLEAR = sessionSetCookieHeader('', 0);
