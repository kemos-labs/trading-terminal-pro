# VOLATERM Billing & Auth Architecture

Stripe integration covering **Payments**, **Billing**, **Invoicing-ready**
customer records — plus the local account system that links subscriptions to
desk access. All Stripe calls are server-side; keys never reach Vite/browser
(see `AGENTS.md` secrets policy).

## Decision log

- **Checkout over PaymentIntents / Elements:** Stripe-hosted Checkout +
  Customer Portal ⇒ SAQ-A PCI scope, zero card-handling code, no `stripe-js`
  bundle weight. The SPA only performs redirects.
- **`payment_method_types` omitted everywhere:** dynamic payment methods;
  enabled methods are managed in the Stripe Dashboard.
- **Fulfillment via webhooks only:** never on the Checkout success page.
- **Connect: not used.** VOLATERM is operational SaaS (we charge subscribers,
  Stripe pays us) — no money routed between third parties. Revisit Accounts v2
  only if we ever pay out contributors/resellers.
- **Auth: minimal email+password accounts** (`api/authStore.js`) using scrypt
  hashes and HMAC-signed HttpOnly session cookies (`vt_session`, 30d). Sessions
  are in-memory; restart ⇒ re-login. No DB dependency yet — users persist to
  `.data/users.json`, entitlements to `.data/stripe-entitlements.json`.

## Server map

| Piece | File | Notes |
|---|---|---|
| Billing plugin | `api/stripeBilling.js` | checkout/portal/status/gate endpoints, webhook handler |
| Auth routes | `api/authRoutes.js` | register/login/logout/me |
| Session store | `api/authStore.js` | scrypt + signed cookies, `.data/users.json` |
| Desk paywall | `server.js` → `requireDeskAccess()` | 402s gated desk APIs without an active sub |

### Endpoints

- `POST /api/billing/checkout-session` `{priceId, mode?, email?}` → hosted Checkout URL
- `POST /api/billing/portal-session` `{email}` → Customer Portal URL
- `GET  /api/billing/status?email=` → subscription records
- `GET  /api/billing/gate` → `{enabled, gatedDesks[], entitled}`
- `POST /api/stripe/webhook` → signature-verified raw body (encapsulated parser)
- `POST /api/auth/register|login|logout`, `GET /api/auth/me`

## Gating model

- Gated desks default to `ksa` (the only vendor-cost desk). Override with
  `BILLING_GATED_DESKS=a,b` or `"none"`.
- Server: gated `/api/ksa/*` routes return `402 SUBSCRIPTION_REQUIRED` unless
  the session user matches an entitlement record with status
  `active|trialing` (`past_due` allowed during dunning unless
  `BILLING_LOCK_ON_PAST_DUE=1`).
- Client: `DeskViewGate` swaps the desk for a paywall panel driven by
  `GET /api/auth/me`; server stays the source of truth.
- Email is the join key: subscribe logged-out, register later with the same
  billing email — access links automatically at next webhook/me refresh.

## Env vars (all optional; endpoints fail closed)

`STRIPE_SECRET_KEY` (prefer restricted `rk_…`) · `STRIPE_WEBHOOK_SECRET` ·
`APP_BASE_URL` · `STRIPE_PRICE_<TIER>_<MONTHLY|ANNUAL|ONETIME>` ·
`STRIPE_PORTAL_ENABLED` · `BILLING_GATED_DESKS` · `BILLING_LOCK_ON_PAST_DUE` ·
`AUTH_SECRET`

## Go-live checklist

1. Dashboard: create Products (one per tier) + monthly/annual Prices → set price env vars.
2. Create restricted live key (`rk_live_…`) with Checkout/Billing/Customer scopes → Railway env.
3. Add production webhook endpoint → `https://<host>/api/stripe/webhook`
   (events: checkout.session.*, customer.subscription.*, invoice.*) → set signing secret.
4. Activate Customer Portal → `STRIPE_PORTAL_ENABLED=1`.
5. Set `AUTH_SECRET` (and `BILLING_DATA_DIR` to a persisted volume) in prod.
6. If charging US/EU: enable Stripe Tax only after tax registrations exist.
