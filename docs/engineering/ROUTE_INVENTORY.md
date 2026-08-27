# Route Inventory — Phase 1 Baseline

Generated: 2026-08-27T22:35:56Z

Source scan: server.js, server/app.js, api/authRoutes.js, api/stripeBilling.js, server/routes/deribitMarket.js, api/health.js, api/ksaFeeds.js, api/deskFeeds.js, api/_shared.js plus api/** (excluding tests).
Total routes: 28

Classification: `public` | `credential-public` | `authenticated` | `entitled` | `webhook` | `health` | `static`. Default: unregistered paths → 404 via `setNotFoundHandler` (assets/api get JSON 404, else SPA fallback). Rate-limit classes are enforced via @fastify/rate-limit keyGenerator with ipv6Subnet=64.

| Method | Path | File | Classification | Rate-limit class | Notes |
|---|---|---|---|---|
| POST | `/api/auth/login` | `api/authRoutes.js:43` | credential-public | global (600/min) but route-specific override may apply | per-route 10/min + global |
| POST | `/api/auth/logout` | `api/authRoutes.js:54` | authenticated | global (600/min) but route-specific override may apply |  |
| GET | `/api/auth/me` | `api/authRoutes.js:64` | authenticated | global (600/min) but route-specific override may apply |  |
| POST | `/api/auth/register` | `api/authRoutes.js:31` | credential-public | global (600/min) but route-specific override may apply | per-route 10/min + global |
| POST | `/api/auth/reset-confirm` | `api/authRoutes.js:91` | credential-public | global (600/min) but route-specific override may apply | per-route 10/min + global |
| POST | `/api/auth/reset-request` | `api/authRoutes.js:83` | credential-public | global (600/min) but route-specific override may apply | per-route 10/min + global |
| MULTI | `/api/backtest/*` | `server/app.js:133` | public (market data) | upstream (120/min) |  |
| POST | `/api/billing/checkout-session` | `api/stripeBilling.js:265` | authenticated | global (600/min) but route-specific override may apply |  |
| GET | `/api/billing/config` | `api/stripeBilling.js:254` | authenticated | global (600/min) but route-specific override may apply |  |
| GET | `/api/billing/gate` | `api/stripeBilling.js:251` | authenticated | global (600/min) but route-specific override may apply |  |
| POST | `/api/billing/portal-session` | `api/stripeBilling.js:317` | authenticated | global (600/min) but route-specific override may apply |  |
| GET | `/api/billing/status` | `api/stripeBilling.js:348` | authenticated | global (600/min) but route-specific override may apply |  |
| GET | `/api/boot/briefing` | `server/app.js:193` | public (health) | global (600/min) but route-specific override may apply |  |
| GET | `/api/cache/status` | `server/app.js:259` | public (market data) | global (600/min) but route-specific override may apply |  |
| GET | `/api/deribit/funding-history` | `server/routes/deribitMarket.js:162` | public (market data) | upstream (120/min) |  |
| GET | `/api/deribit/index/:name` | `server/routes/deribitMarket.js:153` | public (market data) | upstream (120/min) |  |
| GET | `/api/deribit/instruments` | `server/routes/deribitMarket.js:115` | public (market data) | upstream (120/min) |  |
| GET | `/api/deribit/market/:currency` | `server/routes/deribitMarket.js:89` | public (market data) | upstream (120/min) |  |
| GET | `/api/deribit/trades/:currency` | `server/routes/deribitMarket.js:124` | public (market data) | upstream (120/min) |  |
| GET | `/api/flashalpha/exposure/:type/:symbol` | `server/app.js:109` | public (market data) | upstream (120/min) |  |
| GET | `/api/fmp/stable/*` | `server/app.js:78` | public (market data) | upstream (120/min) |  |
| GET | `/api/health` | `server/app.js:258` | public (health) | global (600/min) but route-specific override may apply |  |
| GET | `/api/ksa/board` | `server/app.js:158` | entitled (ksa desk) | upstream (120/min) |  |
| GET | `/api/ksa/quote/:symbol` | `server/app.js:168` | entitled (ksa desk) | upstream (120/min) |  |
| GET | `/api/ksa/session` | `server/app.js:178` | entitled (ksa desk) | upstream (120/min) |  |
| GET | `/api/opra/chain/:symbol` | `server/app.js:221` | public (market data) | global (600/min) but route-specific override may apply |  |
| GET | `/api/opra/status` | `server/app.js:215` | public (market data) | global (600/min) but route-specific override may apply |  |
| POST | `/api/stripe/webhook` | `api/stripeBilling.js:491` | webhook | global (600/min) but route-specific override may apply | rateLimit:false, RAW body scoped to child context |

## Policy summary

- **Static**: `fastifyStatic` serves `dist/` (wildcard:false) + `/docs/*` allowlist (academy only). Assets under `/assets/` and `/` are allowListed from rate-limit.
- **Health**: `/api/health*` and `/api/boot/briefing` are public but rate-limited as global.
- **Auth**: credential endpoints are 10/min per-route; session cookie `vt_session` is HttpOnly, SameSite=Lax, Secure in prod.
- **Entitled**: `/api/ksa/*` require active subscription when billing configured; cache-control `private, no-store`.
- **Webhook**: `/api/stripe/webhook` uses encapsulated RAW body parser; signature verified via STRIPE_WEBHOOK_SECRET; replay/idempotency via Stripe event id.
- **Market data**: all `/api/fmp/*`, `/api/finnhub/*`, `/api/deribit/*`, `/api/macrovol/*` are server-proxied; provider keys never reach browser.
- **SSE**: `/api/stream/quote/:symbol` uses hijacked text/event-stream; slow-client handling is Phase 8 scope.
- **Schemas**: per-route JSON Schema validation is P1 follow-up (currently params/query/body bounds via manual validateSymbol etc; response allowlisting incremental).
