#!/usr/bin/env node
/**
 * Direct admin password reset — no email/token round-trip.
 *
 * Usage:
 *   node scripts/auth-reset.mjs <email> <newPassword>
 *   node scripts/auth-reset.mjs <email>            # generate a random 16-char password
 *
 * Updates .data/users.json (scrypt hash, same scheme as api/authStore.js),
 * revokes all of that account's sessions in .data/sessions.json, and prints
 * the new password once when it was generated. Run while the server is STOPPED
 * (or restart it afterwards) — the running process keeps state in memory and
 * will overwrite these files on its next persist.
 */
import { randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const DATA_DIR = process.env.BILLING_DATA_DIR || '.data';
const USERS_FILE = `${DATA_DIR}/users.json`;
const SESSIONS_FILE = `${DATA_DIR}/sessions.json`;

const [emailArg, pwArg] = process.argv.slice(2);
const email = String(emailArg || '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
  console.error('Usage: node scripts/auth-reset.mjs <email> [newPassword]');
  process.exit(1);
}
if (!existsSync(USERS_FILE)) {
  console.error(`No user store at ${USERS_FILE}`);
  process.exit(1);
}

const users = JSON.parse(readFileSync(USERS_FILE, 'utf8'));
const user = users[email];
if (!user) {
  console.error(`No account for ${email}`);
  process.exit(1);
}

const generated = !pwArg;
const password = generated ? randomBytes(12).toString('base64url') : String(pwArg);
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

user.salt = randomBytes(16).toString('hex');
user.hash = scryptSync(password, user.salt, 64).toString('hex');
user.passwordChangedAt = Date.now();
writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

// Revoke sessions so old cookies die with the old credential.
let revoked = 0;
if (existsSync(SESSIONS_FILE)) {
  const sessions = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
  for (const [tok, sess] of Object.entries(sessions)) {
    if (sess?.email === email) { delete sessions[tok]; revoked++; }
  }
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

console.log(`Password reset for ${email}${revoked ? ` — ${revoked} session(s) revoked` : ''}.`);
if (generated) console.log(`New password (shown once): ${password}`);
