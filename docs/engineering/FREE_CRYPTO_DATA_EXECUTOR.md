# Free Crypto Data Integration — Executor Handoff

## Objective

Add a no-key, no-cost crypto market snapshot to the Crypto Overview while keeping Deribit as the authoritative options provider.

This is a free alternative to Velo. It does **not** claim to be Velo data, Velo-normalized data, or a replacement for the paid Velo API/MCP.

## Implemented contract

- Server route: `GET /api/free-crypto/market/:currency`
- Supported currencies: `BTC`, `ETH`
- Sources: public Binance Futures and Bybit linear-perpetual endpoints
- Returned fields: mark/index/last price, 8-hour funding, open interest, 24-hour USD volume, 24-hour percentage change
- Cache: 15 seconds, server-side
- Timeout: 8 seconds per upstream request
- Failure behavior: one venue may fail; the route returns remaining venues. It returns `502` only when both fail.
- No credentials, account permissions, order placement, or trading endpoints are used.

## Files

- `server/providers/freeCrypto/client.js` — upstream clients, normalization, cache
- `server/routes/freeCryptoMarket.js` — same-origin Fastify route
- `src/api/freeCrypto.ts` — browser contract/client
- `src/features/crypto/overview/CryptoOverviewView.tsx` — read-only display
- `server/app.js` — route and rate-limit registration

## Security and product rules

1. Never add exchange API keys for this read-only adapter.
2. Never add order, account, withdrawal, or private endpoints.
3. Keep upstream calls server-side; the browser calls only `/api/free-crypto/*`.
4. Preserve explicit `null` values when an upstream field is absent.
5. Keep Deribit as the source for the options chain, Greeks, and option trades.
6. Label the panel as free public exchange data and never label it as Velo.
7. Do not add `VELO_API_KEY` unless a paid/trial Velo account and redistribution permission are separately approved.

## Velo MCP decision

Velo's hosted MCP is read-only and requires a Velo API key. It is not part of this free implementation. If later approved, use it for AI research tools only; use a server-side Velo API adapter for app charts. Do not put a Velo key in Vite/browser code.

## Verification

Run:

```bash
npm run type-check
npm test -- --run
npm run build
```

Manual check:

```bash
curl -sS http://localhost:3001/api/free-crypto/market/BTC
```

The response should contain `source: "free-exchanges"` and one or two venue objects. Upstream outage must not create synthetic prices.
