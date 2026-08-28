# BILLING HANDOFF — Stripe + Auth integration (session 2026-08)

**Read this before touching billing/auth code.** Architecture reference:
`docs/engineering/BILLING.md`. Rules: root `AGENTS.md`.

---

## What was done (all verified working)

### 1. Stripe server integration — `api/stripeBilling.js`
Fastify plugin registered in `server.js` via `await registerStripeBilling(fastify)`.

| Endpoint | Purpose |
|---|---|
| `POST /api/billing/checkout-session` | Hosted Checkout (`mode: subscription` default, `payment` for one-time). Returns `{id,url}` |
| `POST /api/billing/portal-session` | Customer Portal URL; resolves customer by email or id |
| `GET /api/billing/status?email=` | Entitlement records by email/customerId |
| `GET /api/billing/gate` | `{enabled, gatedDesks[], entitled}` for the current session |
| `POST /api/stripe/webhook` | Signature-verified raw body; fulfills subscriptions |

Key implementation facts (do not regress):
- **`payment_method_types` is never passed** anywhere → dynamic payment methods.
- **Webhook parser is scoped**: `registerStripeBilling` wraps the route in an encapsulated
  child context with its own string content-type parser. Fastify's global JSON parsing is
  unaffected. Do not move the parser to the top-level instance.
- Fulfillment happens on `checkout.session.completed` **and**
  `checkout.session.async_payment_succeeded`, gated on `payment_status !== 'unpaid'`.
- Handled events: `checkout.session.completed/async_payment_succeeded/async_payment_failed`,
  `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`.
- `integration_identifier: volaterm_<flow>_<8 random letters>` is set per skill guidance.
- Entitlements persist to `.data/stripe-entitlements.json` keyed by Stripe customer id;
  records carry `email` so accounts link by billing email.

### 2. Accounts & sessions — `api/authStore.js`, `api/authRoutes.js`
- Email+password users, scrypt hashes, zero deps. Users in `.data/users.json`.
- Sessions: in-memory Map of HMAC-signed tokens (`vt_session` cookie, HttpOnly, SameSite=Lax,
  Secure in prod, 30d). Restart ⇒ re-login by design.
- Routes: `POST /api/auth/register|login|logout`, `GET /api/auth/me`
  (returns `{user, gate, billingConfigured}`).
- Session secret: env `AUTH_SECRET`, else auto-generated `.data/auth-secret.txt` (mode 600).

### 3. Desk paywall — server + client
- Server: `requireDeskAccess(request, reply)` in `server.js` guards `/api/ksa/board`,
  `/api/ksa/quote/:symbol`, `/api/ksa/budget`. Returns **402 SUBSCRIPTION_REQUIRED** when
  billing is configured AND the desk is gated AND the session has no active sub
  (`active|trialing`; `past_due` allowed unless `BILLING_LOCK_ON_PAST_DUE=1`).
- Gated desks config: `BILLING_GATED_DESKS` (default `ksa`; `"none"` disables gating).
- Client: `DeskViewGate` (in `src/components/layout/renderDeskView.tsx`) checks
  `useAccountStore().deskAllowed(tab)` and renders `DeskPaywall` instead of the desk.
  Bootstrapped by a `refresh()` effect in `TerminalLayout`.

### 4. Frontend UI
- `src/store/accountStore.ts` — zustand store: user/gate/billingOpen + refresh/signOut/deskAllowed.
- `src/components/terminal/BillingDialog.tsx` — Account & billing hub: register/login form,
  tier list from `GET /api/billing/config`, Checkout redirect, Portal redirect,
  status display. Self-gates rendering on `billingOpen` (no conditional mount needed).
- `TerminalHeader.tsx` — `acct` button opens the dialog (store-driven); tooltip shows email when signed in.
- `src/lib/billing.ts`, `src/lib/auth.ts` — typed fetch clients (no stripe-js in bundle).

### 5. Security tooling
- `scripts/check-secrets.sh`: added `(sk|rk)_(live|test)_…` and `whsec_…` patterns
  (previously only caught OpenAI-style `sk-…`). Self-test updated (7 plants) and passing.

### 6. Decisions logged (in `docs/engineering/BILLING.md`)
- **Connect NOT used** — operational SaaS, no third-party payouts. Revisit only if paying out contributors/resellers.
- Checkout+Portal over Elements (SAQ-A, no SDK weight). Webhooks are the sole fulfillment path.

### 7. Docs & env templates
- `docs/engineering/BILLING.md` — architecture, endpoints, gating model, go-live checklist.
- `.env.example` — all billing/auth vars as commented placeholders.

---

## Verification performed (repeat after changes)

1. `npx tsc --noEmit` → clean.
2. `node --check api/stripeBilling.js api/authStore.js api/authRoutes.js server.js`.
3. `bash scripts/check-secrets.sh --self-test` → passes; `--all` scan clean.
4. Live smoke (dummy test creds, no network):
   - unconfigured boot: `/api/billing/config` → `{enabled:false}`; checkout/webhook → 503.
   - configured boot (`STRIPE_SECRET_KEY=sk_test_dummy… STRIPE_WEBHOOK_SECRET=whsec_dummy…`):
     webhook with bogus signature → `400 Invalid signature`.
   - full auth/gate flow (10 checks): anon gate `{gatedDesks:['ksa'],entitled:false}` → KSA 402 →
     weak-pw register rejected → register ok (+cookie) → me shows entitled:true via seeded
     entitlement matching email → KSA 200 → login/logout flows re-gate correctly.
5. `npx vitest run src/components/terminal/TerminalHeader.test.tsx` → pass (5).

## Known gaps / honest caveats

- ~~Sessions are memory-only (restart logs everyone out).~~ **Fixed (hardening pass,
  2026-08):** sessions persist to `.data/sessions.json` and survive restarts. Tokens stay
  server-side (revocable); a password reset revokes all of the account's sessions.
- ~~No email verification / password reset yet.~~ **Password reset added** — but this
  deployment has NO email delivery, so `POST /api/auth/reset-request` returns a generic
  response and does **not** issue or log a token. Operators use the offline admin path:
  `node scripts/auth-reset.mjs <email>
  [newPassword]` (run while the server is stopped). Email verification still not built.
- Entitlement↔account linking is by billing email only (documented in the dialog UI).
- `.data/*` persistence needs a real volume in production deploys.
- Auth endpoints carry their own tight per-route rate limit (10/min/IP) on top of the global
  limiter. This exposed + fixed a pre-existing bug: the global `errorResponseBuilder` in
  `server.js` returned a plain object; @fastify/rate-limit THROWS the builder result, so it
  must be an `Error` with `statusCode`, or blocked requests answered **500 instead of 429**
  (and `context.ttl` is milliseconds, so the retry message was wrong too).
- Entitlement changes are audited append-only to `.data/entitlement-audit.jsonl`
  (`source`=Stripe event type, status before/after, full patch).

---

## Resume checklist — what's left

Owner: human (Stripe Dashboard) unless keys are provided:

1. Create Products (one per tier) + monthly/annual Prices → set
   `STRIPE_PRICE_<TIER>_<MONTHLY|ANNUAL|ONETIME>` in `.env` (placeholders documented).
2. Restricted test key `rk_test_…` → `.env` as `STRIPE_SECRET_KEY` (**secrets policy: write to
   .env only, redact in chat, chmod 600**).
3. Local webhooks: `stripe listen --forward-to localhost:3001/api/stripe/webhook`
   → put its `whsec_…` into `.env`.
4. Dashboard: activate Customer Portal → set `STRIPE_PORTAL_ENABLED=1`.

Next agent tasks once keys exist:

- [ ] E2E subscribe flow with test cards (4242…), verify entitlement file + audit log
      populate via webhook.
- [ ] Verify paywall unlock round-trip in browser (subscribe → return → gate flips).
- [ ] Go-live per `docs/engineering/BILLING.md` checklist (live RAK, prod webhook endpoint,
      AUTH_SECRET, persisted volume, optional Stripe Tax after registrations).
- [ ] Remaining hardening: email delivery for password reset (the public request endpoint
      remains non-token-issuing), email verification, entitlement-change alerting.

## Hardening completed (2026-08 session)

- Session persistence: `.data/sessions.json`, expired entries pruned on load/save.
- Password reset: `POST /api/auth/reset-request` is generic and non-token-issuing; offline
  `scripts/auth-reset.mjs` creates single-use 1h tokens in `.data/reset-tokens.json`; all account sessions revoked on reset; client
  flow lives in `BillingDialog.tsx` ("forgot password?").
- Rate limiting: register/login/reset routes capped at 10/min/IP via per-route
  `config.rateLimit`; global limiter's error builder fixed to throw a proper 429 Error.
- Audit: every `upsertEntitlement` writes a JSONL line to `.data/entitlement-audit.jsonl`.

## Gotchas for new agents

- Don't add `payment_method_types` anywhere. Don't "fix" the scoped webhook parser.
- Don't gate more desks without checking vendor-cost reality (only SAHMK/KSA has paid budget today).
- `git status` may show unrelated pre-existing modifications (FunctionMenuBar, deskSections,
  BtcView, CryptoOptionsView, deribitClient, …) — they predate the billing work; commit them separately.
- Stripe skills live in `.agents/skills/` (installed via `npx skills add https://docs.stripe.com`);
  consult `stripe-best-practices/references/*.md` before changing integration patterns.
