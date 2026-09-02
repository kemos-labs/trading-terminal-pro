# Real-server runtime evidence — 2026-09-02 session

Date: 2026-09-02
HEAD at capture: `534433a` (server process) / `8c07bac` — the deprecation-header
commit lands after this capture; headers were verified before and after for boot
and macrovol routes.

## Method

- Real Fastify process on `PORT=3999`, `node server.js` (production paths, no
  HTTP mocks, no browser interception).
- localhost `curl` against the real listening socket.
- The private rates worker was intentionally NOT started, proving fail-closed
  semantics against the real proxy boundary.

## Endpoint evidence

| Route | Status | Content-Type | Body evidence |
|---|---|---|---|
| `GET /api/health` | 200 | application/json | healthy |
| `GET /api/boot/briefing` | 502 | application/json | `{"error":"Boot briefing failed","detail":"upstream-error"}` — sanitized; no worker internals |
| `GET /api/macrovol/rates/summary` | 502 | application/json | `{"error":"UPSTREAM_ERROR","detail":"upstream-error"}` — new typed code |
| `GET /api/deribit/market/BTC` | 200 | application/json | live: coverage 1, 993 instruments, indexPrice 77107.18, full cache envelope `{state:"miss",hit:false,ageMs:0,stale:false,coalesced:false,providerError:null}`, no NaN/Infinity |
| `GET /api/v1/market/crypto/BTC` | 200 | application/json | schemaVersion 1, data.currency BTC |
| `GET /api/workflows` | 200 | application/json | registry |
| `GET /api/openapi.json` | 200 | application/json | OpenAPI 3.1 document |

## Deprecation headers (live, curl -I)

- `GET /api/boot/briefing` → `deprecation: true`, `link: </api/home/briefing>; rel="successor-version"`
- `GET /api/macrovol/rates/summary` → `deprecation: true` (worker down → 502 `UPSTREAM_ERROR`)
- `GET /api/deribit/market/BTC` → no deprecation header at capture time; fixed in
  the following commit (`markDeprecated` on all five legacy deribit routes with
  successor links to `/api/v1/market/crypto/*`).

## What this proves vs does not prove

- Proves: real-server route registration, typed fail-closed 502s when the
  private worker is down, live Deribit success with truthful cache envelope,
  no worker-body/internal-message leakage, no NaN/Infinity.
- Does not prove: other desks' visuals, fixture-state matrix, four-viewport
  screenshots (C6 remains), Python worker success paths (worker not started
  here), or whole-app PASS.