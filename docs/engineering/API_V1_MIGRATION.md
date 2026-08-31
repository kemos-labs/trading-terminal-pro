# Canonical API v1 and legacy migration

## Authority

Canonical response schemas live in:

- `packages/contracts/src/v1-contracts.schema.json`
- `packages/contracts/src/runtime.js`
- `packages/contracts/src/index.ts`

Every canonical handler builds a common envelope and validates it with Ajv 2020-12 immediately before serialization. Invalid output is rejected as `INTERNAL_CONTRACT_ERROR`; it is not serialized as a best-effort payload.

The required envelope fields are `schemaVersion`, `requestId`, `asOf`, `fetchedAt`, `source`, `provenanceByField`, `unitsByField`, `freshness`, `coverage`, `assumptions`, `warnings`, and `data`. Canonical objects set `additionalProperties:false`.

## Canonical operations implemented

| Operation | Route | Contract |
|---|---|---|
| `v1GetHealth` | `GET /api/v1/system/health` | `healthResponse` |
| `v1GetWorkflows` | `GET /api/v1/workflows` | `workflowsResponse` |
| `v1GetOptionsChain` | `GET /api/v1/market/options/:symbol` | `optionsResponse` |
| `v1GetCryptoMarket` | `GET /api/v1/market/crypto/:currency` | `cryptoMarketResponse` |
| `v1GetCryptoFunding` | `GET /api/v1/market/crypto/:currency/funding` | `cryptoFundingResponse` |
| `v1GetCryptoTrades` | `GET /api/v1/market/crypto/:currency/trades` | `cryptoTradesResponse` |

The equity and Deribit v1 routes call shared service functions. Their unversioned equivalents call the same functions; canonical routes do not proxy themselves over HTTP.

## Browser migration completed

- Equity option-chain consumers use `/api/v1/market/options/:symbol`.
- Crypto market, flow, funding, option-engine, and futures adapters use `/api/v1/market/crypto/*`.
- Trade right/expiry parsing occurs at the server contract boundary.
- Missing funding, OI, IV, volume, and premiums remain `null` rather than becoming zero.

## Legacy adapters

All unversioned `/api/*` operations are retained for compatibility and are marked `deprecated` plus `x-legacy-adapter:true` in OpenAPI. They may retain provider-native shapes. New browser or MCP consumers must not add dependencies on them when a v1 operation exists.

OpenAPI is generated from Fastify's runtime route inventory. The gate requires every runtime API/docs method to be represented. Runtime-discovered compatibility operations receive an explicit deprecated placeholder if no curated description exists; this prevents route omission from masquerading as API completeness.

## Remaining migration work

Rates, Home, KSA, Academy, free-crypto/Velo, and analytical volatility/Greeks/positioning operations still require strict v1 contracts before the rebuild can pass overall. Their legacy routes remain documented but do not satisfy canonical-contract completion.
