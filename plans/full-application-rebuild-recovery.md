# Full-application rebuild recovery plan — audited continuation v2

Date: 2026-08-31
Branch: `codex/full-application-rebuild`
Worktree: `/home/kalde/trading-terminal-pro-rebuild`
Rollback/diff baseline: `e6753aeafb57369137d0afea6c5364bcb1b6fc3f`
Audited continuation baseline: `81d457ab36b4d9520148a07ed504301f62d7f782`
Authoritative specification: `/home/kalde/Documents/Codex/2026-08-29/he-finished-and-review-his-answer/MASTER_FULL_APPLICATION_REBUILD_PROMPT.md`

## Current verdict

**FAIL — recovery in progress.** HEAD `81d457a` is a useful foundation, not a promotable rebuild. The owner checkout is clean and preserved. Continue in the existing worktree; do not recreate or reset it.

The prior tranche correctly improved runtime route discovery, added six strict v1 operations, bounded several provider caches, added entitlement-state detection, moved `macrovol-api/` to `services/rates-worker/`, removed default wildcard CORS, and added rate-board ratio fields. Those changes remain subject to the corrections below.

## Audited corrections that supersede older recovery notes

### SERFF correction — P0

The previous R4 requirement incorrectly called `(SR3M5-SR3U5)-(SR3M6-SR3U6)` SERFF. That is a four-leg SR3 calendar-of-calendars/curve-curvature structure, **not SERFF**.

Authoritative behavior:

- CME/Bloomberg `SERFF` is the One-Month SOFR versus 30-Day Fed Funds inter-commodity spread for the same delivery month: `SR1 - ZQ`, ratio `1:1`.
- State the contract price-display convention and rate-sign convention explicitly.
- If either exact leg is absent, SERFF is Unavailable.
- `SR1 implied rate - cash EFFR` may be shown only as a labelled derived proxy, never as listed/observed SERFF.
- `SR3 - ZQ` is a different spread family and must use contract-provided legs/ratio/code.
- Four-leg SR3 structures may remain under Calendars/Curve Curvature with kind `calendar-of-calendars`; remove the SERFF name and kind.

Primary sources:

- https://www.cmegroup.com/trading/interest-rates/intercommodity-spread.html
- https://www.cmegroup.com/education/articles-and-reports/understanding-sofr-futures

### Velo correction — P0

Credential or base-URL presence is not a verified entitlement. `velo-configuration-detected` must never disable the public Binance/Bybit fallback. Only an authenticated server-side capability probe plus recorded license/quota/redistribution facts can enter `velo-active`. Until then the mode is `free-alternatives` plus a configuration warning.

### Billing-state correction — P0/P1

Preserve the deliberate pre-key public mode, but do not encode missing Stripe configuration as a real entitlement grant. Contracts must distinguish `billing-disabled-public` from `entitled`. When billing is enabled, unknown entitlement fails closed. Do not alter Stripe Connect, dynamic payment-method, scoped RAW webhook, or reset-token invariants.

### Bundle/3D correction — P0

The 3D analytical chunk exception is valid only if the user explicitly opens 3D and measurements prove it is absent from initial and ordinary Vol workflow loads. `SurfaceMatrixView` currently mounts the 3D tool automatically, so the exception is not yet earned.

## Current evidence and rejected claims

| Area | Evidence at `81d457a` | Verdict |
|---|---|---|
| Runtime route discovery | 55 runtime patterns; frontend path parsing | Partial: matcher ignores HTTP method |
| Canonical REST | 6 `/api/v1` operations with output AJV validation | Partial: incomplete domain coverage; request params not runtime-validated |
| OpenAPI | 3.1 document generated; 55 paths/56 operations | Partial: most legacy responses unconstrained; only 6 strict v1 operations |
| MCP | 12 read-only tool names; input validation | Reject completion: no output schemas/validation; analytics tools return raw chains/legacy payloads |
| Provider cache | shared LRU/single-flight and selected quota tests | Partial: stale metadata discarded; direct legacy provider bypasses; quota ledger process-local |
| Velo | credential-presence detection only | Not an entitlement check or connector |
| Rates worker | moved and loopback start command added | Partial: still broad MacroVol/Greeks/Crypto service; old branding/env names; hard-coded rate fallback |
| SERFF | ratio field and two tests | Incorrect product classification and synthetic substitutions |
| Real-server E2E | 2 tests: contracts and Academy | Reject whole-app evidence |
| Visual suite | screenshots for workflow matrix | Mostly route-intercepted fixtures; several primary charts empty/sparse |
| 3D IV | restored with lazy module import | Partial: auto-mounted; no explicit entry; oversized exception unproven |
| 3D Greeks | screenshot explicitly says removed | Missing required capability |
| Strict TypeScript | UI strict TS; contracts have TS facade | Fastify and MCP remain JavaScript |

## Dependency graph

```text
C0 freeze evidence and correct false semantics
  ├─> C1 data/math truth shields
  ├─> C2 method-aware routes + strict canonical services
  │     ├─> C3 provider broker/cache/quota/Velo
  │     └─> C4 complete REST/OpenAPI/MCP + TypeScript migration
  ├─> C5 product and visual rebuild across all eight desks
  └─> C6 deterministic real-server fixture harness

C1,C2,C3,C4,C5,C6
  └─> C7 tree/ownership cleanup and bundle/performance proof
       └─> C8 full gates twice + independent reviews + final evidence
```

## C0 — Freeze evidence and remove false semantics

1. Record the `81d457a` audit in `docs/recovery-evidence/` with exact P0/P1 findings and screenshot paths.
2. Correct SERFF names/kinds/data construction in:
   - `services/rates-worker/services/rate_risk.py`
   - `services/rates-worker/main.py`
   - `src/components/macrovol/rates/SerffBoard.tsx`
   - `src/lib/macrovol/api.ts`
   - related fixtures/tests/docs.
3. Move four-leg SR3 rows to `calendar-of-calendars`; never include them in `serff_board`.
4. Add golden tests for same-month `SR1 - ZQ`, ratio `1:1`, exact missing-leg unavailability, derived cash proxy separation, sign convention, and UI labels.
5. Remove `return 0.04` from `interpolate_r`; change return type to nullable/unavailable and propagate it through `/api/rates/term-structure` and consumers.
6. Fix SR3 settlement compounding so a fixing with day count `n_i` contributes `1 + r_i*n_i/360`, not repeated daily compounding. Add weekend, holiday, leap-day, quarter-boundary, incomplete-quarter, and missing-fixing golden vectors.
7. Remove production credential-presence printing and update stale MacroVol naming/comments immediately where user-visible.

Exit: focused Python/TS tests pass, no false SERFF label remains, no hard-coded rate fallback, secret scan passes.

## C1 — Data, math, nullability, and execution truth

1. Replace `openInterest || 0` in premium/exposure paths with discriminated missing/partial state. A real observed zero remains zero.
2. Replace indicator warmup `NaN` with `null` or prove a typed internal-only finite array that cannot cross rendering/serialization boundaries. Add recursive no-NaN/Infinity tests for UI data, REST, exports, and MCP.
3. Make portfolio entry a discriminated executable basis:
   - long option: observed positive ask + `entryBasis:'ask'`;
   - short option: observed positive bid + `entryBasis:'bid'`;
   - explicit user entry: `entryBasis:'user'`;
   - otherwise unavailable, never midpoint/last/mark substitution.
4. Audit GEX/DEX/Vanna/Charm units and transformations across TypeScript and Python. Keep raw Greeks separate from `/1%`, `/day`, `/vol point`, contract multiplier, spot multiplier, and sign-model display adapters.
5. Add cross-language golden matrices, finite differences, boundary/property tests, null OI tests, crossed/one-sided quote tests, expired contract tests, and missing-event-time tests.

Exit: all production outputs finite or null, execution-side law structurally enforced, math review accepts units/provenance.

## C2 — Method-aware route parity and canonical domain services

1. Make `scripts/route-parity.mjs` compare HTTP method plus normalized path. Infer `GET` only when fetch options are absent; parse literal method values; treat EventSource as GET; require annotations for unresolved dynamic method/path.
2. Add Fastify request schemas from the shared schema authority to every `/api/v1` operation. Invalid funding days/hours/count/instrument values return typed 400 instead of silently defaulting.
3. Expand canonical domain services and `/api/v1` operations for:
   - provider/cache status;
   - market snapshot;
   - option chain;
   - observed/model volatility surface;
   - Greeks;
   - positioning/exposure;
   - rates summary/curve;
   - STIR/SR3/SERFF;
   - crypto carry;
   - crypto flow;
   - KSA board where entitlement permits;
   - Academy index/search/article metadata.
4. Each envelope carries instrument identity, event time, fetch time, source list, per-field provenance/units, freshness, coverage, assumptions, warnings, and cache state.
5. `asOf` is the provider event/observation time, not merely fetch completion. When fields have different events, provide field-level times or an explicit mixed-snapshot warning.
6. Response schemas are strict, runtime-validated, and fail before serialization. Requests and errors use the same authority.
7. Legacy URLs become thin adapters over canonical services; no provider or math duplication.

Exit: method-aware parity negative tests pass; every workflow registry `apiOps` reference resolves to a runtime/OpenAPI operation; invalid requests fail typed 4xx.

## C3 — Provider broker, stale truth, quota, and Velo

1. Build provider-owned adapters and a shared broker; remove direct uncached calls in `server/routes/deskFeeds.js` and the Deribit index route.
2. Preserve `{fromCache, ageMs, stale, coalesced, providerError}` through free-crypto, Deribit, rates, Home, v1, and MCP. Do not return only `.data`.
3. Cache only validated successful snapshots. Keep last-good snapshots separate from current failure state. Enforce explicit maximum stale windows and visible stale reasons.
4. Canonicalize equivalent queries and bound every cache dimension. Add adversarial cardinality tests.
5. Make quota accounting deployment-appropriate and persistent or explicitly scoped; expose safe remaining budget/health without keys or sensitive query history.
6. Add N-client single-flight tests for direct provider routes and aggregate snapshots, cold/fresh/stale/error paths, partial venue failure, circuit open/half-open, and background-tab cadence.
7. Velo modes:
   - `free-alternatives`: always available when no verified connector;
   - `velo-config-unverified`: warning only; free alternative remains active;
   - `velo-active`: only after authenticated capability/license probe and recorded terms;
   - `velo-unavailable`: connector failed; independent free data remains available.
8. Never print, return, screenshot, document, or commit credential values or presence booleans to public clients unless explicitly safe and necessary. Operational detail is access-controlled.

Exit: quota/cache tests prove one cold fill, stale truth survives end to end, incomplete Velo config never disables free data.

## C4 — Strict TypeScript, complete OpenAPI, and analytical MCP

1. Incrementally migrate Fastify composition/routes/services and MCP from `.js` to strict `.ts`; keep commits small and behavior-parity tested.
2. Generate types/validators/OpenAPI/MCP schemas from one JSON Schema 2020-12 authority; remove hand-maintained schema drift.
3. OpenAPI describes every runtime public operation with request, success, and typed error schemas, method/path/auth/rate/cache ownership, deprecation, and stable operation ID.
4. MCP `tools/list` publishes strict input and output schemas. Validate `structuredContent` before return.
5. MCP calls domain services directly in-process or through an internal typed service boundary—not provider-native legacy routes. REST and MCP share analytics.
6. Implement actual analytical outputs for volatility surface, Greeks, positioning, rates/STIR, crypto carry/flow, and Academy search. Returning a raw chain plus a note is not completion.
7. Add malformed/oversized input, malformed output, timeout, provider-down, partial, quota-sharing, no-NaN, forbidden-tool, concurrency, protocol/framing, and REST/MCP parity tests.
8. Keep MCP strictly read-only: no order/account/withdrawal/Stripe/auth/reset/secret tools.

Exit: all registry MCP references resolve; all tool inputs and outputs validate; strict TypeScript passes without `any` escape hatches at contract boundaries.

## C5 — Whole-product and professional visual rebuild

### Global shell and Home

- One shell/registry/deep-link/command system for all eight desks.
- Home renders immediately with a useful morning brief and launcher; optional provider failure cannot block it.
- Remove user-visible MacroVol/VOLATERM labels and internal IDs.
- Distinguish global API health from each independent provider/desk state.

### Volatility and Greeks

- Keep observed IV matrix, smile/skew, term/forward vol, fit diagnostics, and history.
- Add explicit `Open 3D` controls. Do not mount React Three Fiber until activated.
- Restore professional 3D IV and 3D Greeks, with observed nodes/holes, separate model mesh, axes/moneyness mode, camera presets, contours, ATM ridge, exact tooltip, keyboard controls, and 2D/table fallback.
- Replace screenshot text that says 3D Greeks was removed.

### Positioning and Flow

- Spot/forward-centered GEX/DEX/Vanna/Charm heatmaps and profiles with fixed zero-centered diverging scale, missing-cell hatch, exact tooltip, scope controls, and accessible table.
- OI coverage is visible; scenario weight modes are explicit.
- Session change needs actual time series/event times; a single frame is not session flow.

### Trade & Risk

- Preserve three coherent workflows: Structure, PnL/Scenario, Hedge/Risk.
- Prove capability parity for valuable deleted tools through visible controls and real calculations, not source-string tests.
- Enforce executable entry bases and unavailable states.

### Rates

- Populate the SR3 implied-rate chart with deterministic recorded contracts, actual reference-quarter dates, current/prior settlement, straight segments, adaptive ticks, and complete tooltips.
- Implement exact SERFF/other spread classifications from C0.
- Add DOM/canvas geometry assertions proving no axis/title/legend/tooltip overlap at all four viewports.

### Crypto

- Flatten the nested mini-shell into the global terminal chrome.
- Each of six workflows needs a primary decision visual: regime/venue comparison, vol matrix/term structure, positioning heatmap/profile, option-flow timeline/distribution, funding+basis term/history, and payoff/Greeks/risk.
- Keep Deribit option authority and independent free Binance/Bybit snapshot. No giant dead regions or contradictory Live/unavailable states.

### KSA and Academy

- KSA uses shared cached snapshots, explicit delayed/session/event/fetch time, provider-down/entitlement states, and no fake breadth/value proxy.
- Academy serves real JSON/static content, search/filter/deep links, sanitized untrusted article display, useful loading/error/empty states, and no giant empty canvas.

Exit: product owner can manually review every deep link; visual reviewer accepts actual screenshots/live app for populated and failure states.

## C6 — Deterministic real-server and visual fixture harness

1. Add adapter-boundary fixture mode to the real Fastify process. Browser interception remains forbidden in this suite.
2. Fixtures are recorded/normalized, deterministic, time-frozen, schema-validated, and explicitly test-only. They cover equities, rates/STIR/SERFF, Deribit, free crypto partial venues, KSA, and Academy.
3. Exercise all 27 registry workflows through their exact deep links and exact workflow-root test IDs.
4. Cover populated success, loading, empty, stale, partial, malformed-provider, provider-down, and entitlement states.
5. Run every workflow at 1440x900, 1280x800, 1024x768, and 390x844 against the real server.
6. Fail on unhandled requests, unexpected 4xx/5xx, console error/warn, page error, error boundary, NaN/Infinity, horizontal overflow, clipped controls, overlap, and missing primary visual.
7. Run WCAG 2A and 2AA including color contrast; no global rule disable. Any narrow exception requires owner approval and a documented alternative.
8. Capture screenshots with HEAD/fixture/scenario/viewport in file name or sidecar manifest. A reviewer must inspect pixels, not just existence.

Exit: `test:e2e:real-server` and `test:visual` are distinct, meaningful, all-workflow gates; screenshots are populated and independently accepted.

## C7 — Ownership cleanup and performance proof

1. Restrict `services/rates-worker` to rates/macro integrations that materially need Python. Migrate crypto spot/perp, equity IV/Greeks, SEC feed, and duplicate quantitative ownership to canonical TypeScript services unless a benchmark/validation document justifies retention.
2. Introduce `RATES_WORKER_URL` with loopback validation; keep `MACROVOL_API_URL` only as a deprecated compatibility alias. Rename service title, start logs, docs, env examples, comments, tests, and user copy.
3. Reject wildcard CORS even when an env variable is set. Bind `127.0.0.1` in every supported start path; test it.
4. Complete the target `apps/` and `packages/` tree incrementally without big-bang moves. Enforce package ownership/import boundaries.
5. 3D analytical chunk loads only after explicit action. Add network/performance assertions, cold-load timing, memory cleanup, context-loss fallback, and its own reviewed cap.
6. Enforce normal initial/chunk/workflow budgets and cache-hit p95. Do not hide over-budget chunks behind unverified exceptions.
7. Update hashed Python lock comments/paths and audit the exact deployment lock.

Exit: ownership/import tests pass, no visible legacy branding, performance evidence validates analytical exceptions.

## C8 — Promotion and independent falsification

Run all master gates twice where specified, from clean HEAD. Record command, start/end time, exit code, test count, skip/warning count, artifact paths, and commit.

Mandatory independent reviews:

- route/API/OpenAPI/MCP contract review;
- provider/quota/cache/security review;
- quantitative math/provenance/units/nullability review;
- visual/a11y review using live app and actual screenshots;
- final adversarial reviewer that attempts to falsify every PASS claim.

Any P0/P1 rejection returns to its owning node. A reviewer tool/usage failure is not approval and must be retried or replaced by an independent reviewer.

Final PASS requires every mandatory gate, all workflow deep links, clean status, preserved owner checkout, and no open required limitation. Otherwise report FAIL/BLOCKED honestly and continue all other safe work.

## Exact next action from `81d457a`

Start with C0 in this order:

1. Correct SERFF classification and tests.
2. Remove hard-coded `0.04` and fix SR3 day-count compounding with golden vectors.
3. Remove credential-presence logging and stale visible MacroVol strings in touched paths.
4. Run focused Python/TS tests, type-check, lint, secret scan, and diff check.
5. Commit one concern. Continue immediately to C1; do not return a tranche-complete report.

## Execution ledger (live)

### C0 — DONE (commit `7567e10`, 2026-08-31)

- SERFF corrected to same-month `SR1 − ZQ` (1:1) with exact-leg availability and
  Unavailable states; four-leg SR3 → `calendar-of-calendars`; SR3−ZQ note no
  longer claims SERFF; cash-EFFR rows moved to `derived-proxy` group
  (non-listed, non-executable).
- `interpolate_r` returns `null` on empty curve; `/api/rates/term-structure`
  propagates `available`/`curve_coverage`/`warnings`; IV/Greeks calculators
  fail closed on missing rate (no `0.04`/`0.05` stubs).
- `compound_sofr_rate` rewritten to CME Actual/360 publication-interval form
  `Π(1 + r_i·n_i/360)`; 9 golden vectors (business days, weekend, holiday,
  leap day, quarter boundary, incomplete quarter, missing fixing, flat,
  daily-publication) with independently derived expected values.
- Worker security/branding: credential-presence print removed, title →
  "Rates Worker", wildcard CORS rejected even when configured,
  `RATES_WORKER_URL` (loopback-validated) with `MACROVOL_API_URL` deprecated
  alias (`server/ratesWorkerUrl.js`), stale reset-token comment corrected.
- Evidence: pytest 40 passed/2 skipped; vitest rates suites 21 passed;
  type-check PASS; lint PASS; check-secrets PASS (incl. self-test);
  `git diff --check` clean.

### C1 — DONE (commit `6b8a962`)

- `premiumMath`: missing OI → null premium/`oiMissing` flag; observed zero stays
  0; scanner `openInterest`/`volume` nullable; expiry summaries carry
  `oiCoverage` full/partial/missing. Tests: `premiumMath.test.ts` (6).
- `indicators`: warmup → `null` (Unavailable), never NaN; recursive no-NaN
  tests (`indicators.test.ts`, 4).
- Portfolio `entryBasis` restricted to `ask|bid|user` and structurally
  enforced across evaluateCombo/payoff/BE/combo-PnL: long requires observed
  positive ask, short observed positive bid, `user` explicit override,
  mid/last/mark substitution fails closed. `portfolio.test.ts` +7.
- `exposure.ts`: non-finite row inputs fail closed (found by new no-NaN
  property test); finite-difference GEX identity (`γQS²·0.01 = Δ(delta
  notional) for +1% spot`) and per-1-vol-point vanna / per-day charm
  assertions added. `positioning.units.test.ts` +3.
- Pre-existing baseline failures recorded (reproduced at `81d457a`):
  `futuresMath.test.ts` and `provider.test.ts` stale fixtures vs canonical
  `/api/v1` crypto routes — fixed in C2/C6.
- Evidence: type-check PASS; lint PASS; vitest 235/236 focused PASS;
  check-secrets PASS. Full suite 744 passed / 2 pre-existing failed.

### C2 — IN PROGRESS / core tranche DONE (commits `e44c3e4`, `8870f4d`, 2026-08-31)

- Route parity is method-aware (HTTP method + normalized path), with EventSource
  GET handling, method-prefixed dynamic annotations, pure helper library, and
  negative wrong-method fixtures.
- `/api/v1` funding/trade request schemas reject invalid enum/range values with
  canonical `INVALID_REQUEST` 400 envelopes; no silent defaults/clamping.
- Added validated canonical operations for provider/cache status, rates STIR and
  nullable term structure, crypto carry/flow, Academy index, and KSA board.
  REST handlers share existing provider adapters/cache and preserve unavailable
  states; OpenAPI has 13 strict v1 operations and 62 runtime paths.
- Evidence: focused route/v1/analytics tests 21 passed; route parity PASS
  (38 frontend declarations/62 runtime patterns); OpenAPI PASS (63 operations);
  type-check/lint/secrets/diff checks PASS. Remaining C2 work: surface/Greeks/
  positioning canonical analytics and full service/type migration.

### C3 — IN PROGRESS (commit `403f968`, 2026-08-31)

- Corrected Velo semantics: credentials/base URL are configuration only, not
  entitlement. Any unverified Velo presence yields `velo-config-unverified`;
  Binance Futures + Bybit Linear remain available and independently labelled.
  Updated health warning, strict contract enum, and negative entitlement tests.
- Evidence: entitlement/v1/analytics focused tests 18 passed; type-check/lint/
  secret scan/diff checks PASS.
- Remaining C3: end-to-end cache metadata (`hit`, age, stale, coalesced,
  providerError), direct/aggregate provider ownership, bounded canonical keys,
  persistent quota scope, circuit/partial-failure and hidden-tab cadence tests.

### C4 — IN PROGRESS (commit `edcd641`, 2026-08-31)

- Every MCP tool now publishes a strict output schema for the MCP result
  envelope (`content`, `structuredContent`, `isError`), with a contract test;
  read-only tool set and structured content behavior remain unchanged.
- Evidence: MCP contract tests 10 passed; secret/diff gate PASS.
- Remaining C4: migrate tools from legacy routes to canonical v1 services,
  publish per-tool analytical data schemas, and complete negative validation.
