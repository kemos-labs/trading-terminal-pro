# Corrective Evidence Report

## Status

This report documents corrective work after review findings. It does **not** claim final approval.

- Validated implementation HEAD: `5220d5f09e63d2853a238d4259767e819a22b31a`
- Evidence/report commit: committed separately after validation; its hash is intentionally not embedded here.
- Branch: `codex/full-application-rebuild`
- Worktree: `/home/kalde/trading-terminal-pro-rebuild`
- Rollback base: `e6753aeafb57369137d0afea6c5364bcb1b6fc3f`
- Owner checkout: `/home/kalde/trading-terminal-pro`, clean at `e6753aeafb57369137d0afea6c5364bcb1b6fc3f`

The authoritative candidate file inventory is generated with:

```bash
git diff --name-status e6753ae..HEAD
```

Corrective files in the implementation commit are `server/providers/freeCrypto/client.js`, `server/providers/freeCrypto/client.test.js`, `server/routes/freeCryptoMarket.js`, `server/routes/freeCryptoMarket.test.js`, `src/api/freeCrypto.ts`, `src/components/home/HomeBriefing.tsx`, `src/features/crypto/overview/CryptoOverviewView.tsx`, `mcp/mcp-server.js`, `mcp/mcp-contracts.test.ts`, `server/routes/openapi.js`, and regenerated `docs/openapi.generated.json`.

## Findings corrected

1. **Free crypto normalization:** only finite numbers and non-empty numeric strings are accepted. `null`, empty/whitespace strings, booleans, arrays, objects, `NaN`, and infinities normalize to `null`. Binance and Bybit payloads require at least one observed `mark`, `index`, or `last` price; unusable venues fail independently.
2. **No synthetic aggregate:** the free-crypto response has no top-level `index`; venue `mark`, `index`, and `last` fields remain separate and nullable. Frontend, Home fallback, OpenAPI, and tests use the corrected shape.
3. **Partial failures:** one usable venue returns 200; both unusable return typed 502; unsupported currencies return typed 400. BTC and ETH are supported. The 15-second cache and 8-second upstream abort remain in the provider.
4. **Crypto Overview independence:** Deribit failure now renders an explicit Deribit-unavailable state while the free snapshot renders independently. Free failure renders an explicit unavailable state. Required labels remain exact: `Free multi-venue snapshot` and `Public exchange data; free alternative to Velo, not Velo-normalized.`
5. **Deterministic tests:** provider tests cover both venues, one-venue partial failure, malformed/all-null payloads, null normalization, BTC/ETH, unsupported currency, cache behavior; Fastify route tests cover HTTP status and response shape.
6. **MCP protocol:** results use `structuredContent` plus matching JSON TextContent. Runtime schemas enforce required fields, types, enums, lengths, patterns, and additional properties. Notifications receive no response; complete newline-delimited chunks are processed; tool calls are concurrent; parse errors, unknown methods/tools, and invalid params use JSON-RPC errors; stderr uses `process.stderr`.
7. **MCP routing/claims:** exact `BTC`/`ETH` identifiers use Deribit routes for crypto market/option analytics. Carry checks market HTTP status. Crypto flow returns Deribit trades and the free snapshot with partial failure semantics. No private or trading capability was added.
8. **OpenAPI:** the source builder now documents the strict free-crypto 200 schema, nullable venue fields, `source: free-exchanges`, no aggregate index, and 400/502 typed responses. `docs/openapi.generated.json` was regenerated from that source.
9. **Evidence correction:** this report distinguishes implementation HEAD from the later report commit and avoids unsupported PASS claims. Status and inventories are Git-derived.

## Validation performed

At the corrective implementation HEAD:

| Command | Result |
|---|---|
| `npm run type-check` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run validate:openapi` | exit 0; 19 paths, 19 operations, 27 workflows |
| targeted provider/route/MCP Vitest | exit 0; 21 tests passed |

The complete required gate list was rerun at this implementation HEAD: unit suite exit 0 with 130 files and 688 tests; MCP contracts 8 passed; integration 16 passed; API contracts and OpenAPI exit 0; type-check/build/lint/secrets/diff checks were rerun. The build emits the existing large-chunk warning; no gate failed. No approval or overall PASS is asserted here.

## Live validation requirements

Live server validation was executed on port 3001. BTC and ETH returned HTTP 200 with `source: "free-exchanges"`, separate Binance/Bybit `mark`, `index`, and `last` fields, and no top-level `index`. DOGE returned HTTP 400 with `{ "error": "UNSUPPORTED_CURRENCY" }`. No average price was present.

The live server must be running on port 3001 before executing:

```bash
curl -sS http://localhost:3001/api/free-crypto/market/BTC
curl -sS http://localhost:3001/api/free-crypto/market/ETH
curl -i -sS http://localhost:3001/api/free-crypto/market/DOGE
```

The MCP generic stdio check sent initialize, `notifications/initialized`, tools/list, invalid empty academy query, and two health calls in one input chunk. It produced five responses: no response for the notification, an invalid-params `-32602` response for the empty query, and both health calls returned `structuredContent` alongside TextContent. The contract suite also confirms malformed/unknown handling and schema enforcement.

## Security and scope confirmation

No Velo key, exchange credential, trading endpoint, account endpoint, Stripe change, or secret was added. Provider access remains server-side and public exchange access remains read-only. The owner master checkout was not edited, merged, rebased, reset, or checked out.
