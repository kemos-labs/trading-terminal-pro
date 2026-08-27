# Route Inventory — Phase 1 Baseline

Generated: 2026-08-27T05:25:55Z

Source scan: server.js, api/authRoutes.js, api/stripeBilling.js, api/deribitMarketRoutes.js, api/health.js, api/ksaFeeds.js, api/deskFeeds.js, api/_shared.js plus api/** (excluding tests).
Total routes: 53

Classification: `public` | `credential-public` | `authenticated` | `entitled` | `webhook` | `health` | `static`. Default: unregistered paths → 404 via `setNotFoundHandler` (assets/api get JSON 404, else SPA fallback). Rate-limit classes are enforced via @fastify/rate-limit keyGenerator with ipv6Subnet=64.

| Method | Path | File | Classification | Rate-limit class | Notes |
|---|---|---|---|---|
| GET | `/api/alphavantage/daily` | `server.js:1756` | public (market data) | scarce (30/min) |  |
| GET | `/api/alphavantage/overview` | `server.js:1781` | public (market data) | scarce (30/min) |  |
| GET | `/api/alphavantage/quote` | `server.js:1732` | public (market data) | scarce (30/min) |  |
| POST | `/api/auth/login` | `api/authRoutes.js:43` | credential-public | global (600/min) but route-specific override may apply | per-route 10/min + global |
| POST | `/api/auth/logout` | `api/authRoutes.js:54` | authenticated | global (600/min) but route-specific override may apply |  |
| GET | `/api/auth/me` | `api/authRoutes.js:64` | authenticated | global (600/min) but route-specific override may apply |  |
| POST | `/api/auth/register` | `api/authRoutes.js:31` | credential-public | global (600/min) but route-specific override may apply | per-route 10/min + global |
| POST | `/api/auth/reset-confirm` | `api/authRoutes.js:91` | credential-public | global (600/min) but route-specific override may apply | per-route 10/min + global |
| POST | `/api/auth/reset-request` | `api/authRoutes.js:83` | credential-public | global (600/min) but route-specific override may apply | per-route 10/min + global |
| POST | `/api/billing/checkout-session` | `api/stripeBilling.js:265` | authenticated | global (600/min) but route-specific override may apply |  |
| GET | `/api/billing/config` | `api/stripeBilling.js:254` | authenticated | global (600/min) but route-specific override may apply |  |
| GET | `/api/billing/gate` | `api/stripeBilling.js:251` | authenticated | global (600/min) but route-specific override may apply |  |
| POST | `/api/billing/portal-session` | `api/stripeBilling.js:317` | authenticated | global (600/min) but route-specific override may apply |  |
| GET | `/api/billing/status` | `api/stripeBilling.js:348` | authenticated | global (600/min) but route-specific override may apply |  |
| GET | `/api/boot/briefing` | `server.js:339` | public (health) | global (600/min) but route-specific override may apply |  |
| GET | `/api/cache/status` | `server.js:312` | public (market data) | global (600/min) but route-specific override may apply |  |
| GET | `/api/deribit-market/funding-history` | `api/deribitMarketRoutes.js:204` | public (market data) | upstream (120/min) |  |
| GET | `/api/deribit-market/index-price` | `api/deribitMarketRoutes.js:175` | public (market data) | upstream (120/min) |  |
| GET | `/api/deribit-market/instruments` | `api/deribitMarketRoutes.js:96` | public (market data) | upstream (120/min) |  |
| GET | `/api/deribit-market/tickers` | `api/deribitMarketRoutes.js:117` | public (market data) | upstream (120/min) |  |
| GET | `/api/deribit/futures/:currency` | `server.js:645` | public (market data) | upstream (120/min) |  |
| GET | `/api/deribit/index/:name` | `server.js:585` | public (market data) | upstream (120/min) |  |
| GET | `/api/deribit/market/:currency` | `server.js:707` | public (market data) | upstream (120/min) |  |
| GET | `/api/deribit/options/:currency` | `server.js:613` | public (market data) | upstream (120/min) |  |
| GET | `/api/deribit/ticker/:instrument` | `server.js:671` | public (market data) | upstream (120/min) |  |
| GET | `/api/deribit/trades/:currency` | `server.js:761` | public (market data) | upstream (120/min) |  |
| GET | `/api/deribit/volhistory/:currency` | `server.js:794` | public (market data) | upstream (120/min) |  |
| GET | `/api/desk/pack` | `server.js:1854` | public (market data) | upstream (120/min) |  |
| GET | `/api/finnhub/earnings` | `server.js:1341` | public (market data) | upstream (120/min) |  |
| GET | `/api/finnhub/economic-calendar` | `server.js:1490` | public (market data) | upstream (120/min) |  |
| GET | `/api/finnhub/news` | `server.js:1257` | public (market data) | upstream (120/min) |  |
| GET | `/api/finnhub/peers` | `server.js:1623` | public (market data) | upstream (120/min) |  |
| GET | `/api/finnhub/quote` | `server.js:1435` | public (market data) | upstream (120/min) |  |
| GET | `/api/finnhub/recommendation` | `server.js:1579` | public (market data) | upstream (120/min) |  |
| GET | `/api/flashalpha/exposure/gex/:symbol` | `server.js:2176` | public (market data) | upstream (120/min) |  |
| GET | `/api/flashalpha/exposure/levels/:symbol` | `server.js:2127` | public (market data) | upstream (120/min) |  |
| GET | `/api/fmp/stable/*` | `server.js:1167` | public (market data) | upstream (120/min) |  |
| GET | `/api/health` | `server.js:306` | public (health) | global (600/min) but route-specific override may apply |  |
| GET | `/api/history/spy` | `server.js:509` | public (market data) | upstream (120/min) |  |
| GET | `/api/ksa/board` | `server.js:954` | entitled (ksa desk) | upstream (120/min) |  |
| GET | `/api/ksa/budget` | `server.js:998` | entitled (ksa desk) | upstream (120/min) |  |
| GET | `/api/ksa/quote/:symbol` | `server.js:975` | entitled (ksa desk) | upstream (120/min) |  |
| GET | `/api/ksa/session` | `server.js:988` | entitled (ksa desk) | upstream (120/min) |  |
| GET | `/api/massive/prev/:symbol` | `server.js:1663` | public (market data) | upstream (120/min) |  |
| GET | `/api/opra/chain/:symbol` | `server.js:2250` | public (market data) | global (600/min) but route-specific override may apply |  |
| GET | `/api/opra/status` | `server.js:2233` | public (market data) | global (600/min) but route-specific override may apply |  |
| GET | `/api/options/:symbol` | `server.js:373` | public (market data) | upstream (120/min) |  |
| GET | `/api/stream/quote/:symbol` | `server.js:1007` | public (SSE) | global (600/min) but route-specific override may apply |  |
| POST | `/api/stripe/webhook` | `api/stripeBilling.js:491` | webhook | global (600/min) but route-specific override may apply | rateLimit:false, RAW body scoped to child context |
| GET | `/api/tradingview/snapshot` | `server.js:1807` | public (market data) | scarce (30/min) |  |
| GET | `/api/venues/options/:currency` | `server.js:919` | public (market data) | global (600/min) but route-specific override may apply |  |
| GET | `/api/yf/history/:symbol` | `server.js:464` | public (market data) | upstream (120/min) |  |
| GET | `/api/yf/info/:symbol` | `server.js:485` | public (market data) | upstream (120/min) |  |

## Policy summary

- **Static**: `fastifyStatic` serves `dist/` (wildcard:false) + `/docs/*` allowlist (academy only). Assets under `/assets/` and `/` are allowListed from rate-limit.
- **Health**: `/api/health*` and `/api/boot/briefing` are public but rate-limited as global.
- **Auth**: credential endpoints are 10/min per-route; session cookie `vt_session` is HttpOnly, SameSite=Lax, Secure in prod.
- **Entitled**: `/api/ksa/*` require active subscription when billing configured; cache-control `private, no-store`.
- **Webhook**: `/api/stripe/webhook` uses encapsulated RAW body parser; signature verified via STRIPE_WEBHOOK_SECRET; replay/idempotency via Stripe event id.
- **Market data**: all `/api/fmp/*`, `/api/finnhub/*`, `/api/deribit/*`, `/api/macrovol/*` are server-proxied; provider keys never reach browser.
- **SSE**: `/api/stream/quote/:symbol` uses hijacked text/event-stream; slow-client handling is Phase 8 scope.
- **Schemas**: per-route JSON Schema validation is P1 follow-up (currently params/query/body bounds via manual validateSymbol etc; response allowlisting incremental).
