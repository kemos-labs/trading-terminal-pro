# Runtime route inventory

Generated deterministically by `node scripts/route-parity.mjs --write` from Fastify's `onRoute` hook after all plugins are ready.

- Runtime path patterns: **49**
- Non-HEAD/OPTIONS operations: **50**
- Frontend route declarations checked: **38**
- Unregistered `/api` and `/docs` requests fail with JSON 404 responses.

| Method | Runtime path | Classification |
|---|---|---|
| GET | `/api/alphavantage/quote` | public server-proxied |
| POST | `/api/auth/login` | credential-public |
| POST | `/api/auth/logout` | authenticated |
| GET | `/api/auth/me` | authenticated |
| POST | `/api/auth/register` | credential-public |
| POST | `/api/auth/reset-confirm` | credential-public |
| POST | `/api/auth/reset-request` | credential-public |
| POST | `/api/billing/checkout-session` | authenticated / entitlement |
| GET | `/api/billing/config` | authenticated / entitlement |
| GET | `/api/billing/gate` | authenticated / entitlement |
| POST | `/api/billing/portal-session` | authenticated / entitlement |
| GET | `/api/billing/status` | authenticated / entitlement |
| GET | `/api/boot/briefing` | public server-proxied |
| GET | `/api/cache/status` | health / operations |
| GET | `/api/deribit/funding-history` | public server-proxied |
| GET | `/api/deribit/index/:name` | public server-proxied |
| GET | `/api/deribit/instruments` | public server-proxied |
| GET | `/api/deribit/market/:currency` | public server-proxied |
| GET | `/api/deribit/trades/:currency` | public server-proxied |
| GET | `/api/desk/pack` | public server-proxied |
| GET | `/api/finnhub/earnings` | public server-proxied |
| GET | `/api/finnhub/economic-calendar` | public server-proxied |
| GET | `/api/finnhub/news` | public server-proxied |
| GET | `/api/finnhub/peers` | public server-proxied |
| GET | `/api/finnhub/quote` | public server-proxied |
| GET | `/api/finnhub/recommendation` | public server-proxied |
| GET | `/api/flashalpha/exposure/:type/:symbol` | public server-proxied |
| GET | `/api/fmp/stable/*` | public server-proxied |
| GET | `/api/free-crypto/market/:currency` | public server-proxied |
| GET | `/api/health` | health / operations |
| GET | `/api/history/spy` | public server-proxied |
| GET | `/api/home/briefing` | public server-proxied |
| GET | `/api/ksa/board` | conditionally entitled |
| GET | `/api/ksa/quote/:symbol` | conditionally entitled |
| GET | `/api/ksa/session` | conditionally entitled |
| GET | `/api/macrovol/*` | public server-proxied |
| POST | `/api/macrovol/*` | public server-proxied |
| GET | `/api/openapi.json` | public server-proxied |
| GET | `/api/opra/chain/:symbol` | public server-proxied |
| GET | `/api/opra/status` | public server-proxied |
| GET | `/api/options/:symbol` | public server-proxied |
| GET | `/api/stream/quote/:symbol` | public server-proxied |
| POST | `/api/stripe/webhook` | webhook |
| GET | `/api/tradingview/snapshot` | public server-proxied |
| GET | `/api/venues/options/:currency` | public server-proxied |
| GET | `/api/workflows` | public server-proxied |
| GET | `/api/yf/history/:symbol` | public server-proxied |
| GET | `/api/yf/info/:symbol` | public server-proxied |
| GET | `/docs/*` | static allowlist |
| GET | `/docs/index.json` | static allowlist |

## Gate semantics

- Backend inventory is runtime-discovered; this document is not a route authority.
- Frontend literal/template network calls are parsed with the TypeScript AST.
- A dynamic URL must declare its finite expected route patterns in an adjacent `route-parity:` annotation, each of which is matched against the runtime table.
- Route existence does not prove response-contract completeness; OpenAPI/schema validation is a separate gate.
