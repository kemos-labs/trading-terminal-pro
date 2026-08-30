# Full-application rebuild recovery plan

Date: 2026-08-30
Branch: `codex/full-application-rebuild`
Rollback point: `e6753aeafb57369137d0afea6c5364bcb1b6fc3f`
Authoritative specification: `/home/kalde/Documents/Codex/2026-08-29/he-finished-and-review-his-answer/MASTER_FULL_APPLICATION_REBUILD_PROMPT.md`

## Verdict entering recovery

The branch is **not complete** and must not be promoted as a passing rebuild. The former PASS report is not reproducible: it omits required `/api/v1` contracts, runtime response validation, TypeScript server/MCP migration, rates-worker isolation, Velo entitlement handling, genuine real-server success-path tests, and complete OpenAPI/MCP coverage. Its own retained screenshots show expired crypto expiries, empty required workflows, a missing 3D Greeks surface, and loading/partial states presented as visual success.

Owner checkout changes are preserved by making all recovery edits only in `/home/kalde/trading-terminal-pro-rebuild`.

## Dependency graph

```text
R1 evidence + gate integrity
  ├─> R2 canonical contracts + runtime route inventory
  │     ├─> R3 provider/cache/quota/entitlement correctness
  │     ├─> R4 Rates + SERFF analytical correctness
  │     └─> R5 Crypto + options analytical correctness
  ├─> R6 unified shell/Home/registry/visual repair
  └─> R7 deterministic real-server + visual/accessibility coverage

R2,R3,R4,R5,R6,R7
  └─> R8 TypeScript service/MCP migration + complete OpenAPI/MCP
          └─> R9 all mandatory gates + independent reviews + final evidence
```

## Nodes

### R1 — Evidence and gate integrity
- Record falsifiable audit findings and screenshot verdicts.
- Repair broken workflow-registry generation.
- Replace hardcoded route claims with Fastify runtime discovery.
- Make `test:e2e:real-server` and `test:visual` distinct commands.
- Never call mocked or partial-state coverage a success-path pass.

### R2 — Canonical contracts and routes
- Add shared JSON Schemas for success/error envelopes, provenance, freshness, assumptions, and coverage.
- Add `/api/v1` canonical endpoints and documented legacy adapters.
- Validate serialized server and MCP responses.
- Generate complete OpenAPI from the route/contract authority.

### R3 — Providers, cache, quota, Velo
- Enforce one cached snapshot per provider/resource with keyed single-flight.
- Preserve last successful snapshots separately from failure cache entries.
- Return honest stale/error metadata and expose measured cache/quota state.
- Implement Velo entitlement/key detection; use labelled free adapters only when not entitled.

### R4 — Rates
- Move/isolate the private worker as `services/rates-worker` with loopback-only access.
- Verify SR3 expiry filtering/order, implied-rate/price semantics, DTE labels, and no fabricated history.
- Implement exact SERFF `(SR3M5 − SR3U5) − (SR3M6 − SR3U6)` with ratio, bp units, sign note, and explicit unavailability.

### R5 — Crypto/options math
- Fix expiry/right parsing and reject expired contracts.
- Fix GEX/DEX/Vanna/Charm units, selection scope, source spot, and missing-data semantics.
- Keep missing OI/history/futures as null, never zero.
- Implement non-empty volatility, positioning, flow, carry, and trade/risk success states.

### R6 — Product shell and visuals
- Use one shell/navigation/command/deep-link registry across all eight desks.
- Finish Home morning brief and launcher without internal IDs or oversized empty regions.
- Restore lazy 3D Greeks and canonical 2D fallback.
- Remove the separate Crypto mini-application shell.
- Correct mobile clipping, target sizes, duplicate labels, chart legends/axes, and visual hierarchy.

### R7 — Honest end-to-end coverage
- Add deterministic adapter-boundary fixtures behind a real local Fastify server; do not use browser route mocks for the real-server suite.
- Test populated success, partial, unavailable, loading, and error states.
- Assert exact workflow roots, semantics, data quality, no console/runtime errors, and WCAG rules including color contrast.
- Capture retained screenshots at all four required viewports.

### R8 — Service/MCP/OpenAPI architecture
- Migrate Fastify and MCP to strict TypeScript.
- Make MCP analytical and read-only, with strict input/output schemas and no trading/account tools.
- Cover all public v1 operations in OpenAPI and registry references.

### R9 — Promotion
- Run every command listed in the master prompt twice where required.
- Run secret scans, npm/pip audits, route/OpenAPI/MCP/integration/E2E/visual gates, bundle budgets, `git diff --check`, and clean-worktree verification.
- Obtain fresh independent visual, security/API, math/provenance, and final falsification reviews. A failed reviewer runtime is a blocker, not a waived gate.
- Replace the old PASS document only with reproducible evidence tied to final HEAD.

## Promotion rule

A node may be promoted only after its focused tests pass and `scripts/check-secrets.sh` passes. The overall verdict remains **FAIL / recovery in progress** until R9 is complete.
