# Full-application recovery continuity memory

Updated: 2026-09-02T21:55:00Z

This file is the reset-safe checkpoint for `/home/kalde/trading-terminal-pro-rebuild`. It records execution state, not proof of completion. The master specification, audited recovery plan, and `AGENTS.md` remain authoritative when a statement conflicts.

## Required resume sequence

1. Read `AGENTS.md`, the master specification, `plans/full-application-rebuild-recovery.md`, every Markdown file in `docs/recovery-evidence/`, and this file.
2. Run:

   ```bash
   git status --porcelain
   git rev-parse HEAD
   git branch --show-current
   git -C /home/kalde/trading-terminal-pro status --porcelain
   ```

3. Confirm recovery branch `codex/full-application-rebuild`, preserve the clean owner checkout, and inspect rather than discard any dirty recovery diff.
4. Sol 5.6 remains the planner/orchestrator/reviewer. Use Luna 5.6 at medium reasoning for bounded implementation and command-execution work; Sol independently reviews and commits.
5. Continue the exact in-progress concern below. Do not report PASS until C8 and independent falsification are complete.

## Current checkpoint

- Recovery HEAD: `534433a` (`fix(deps): patch fastify schema-validation advisories`).
- Recovery worktree is clean at this checkpoint.
- Owner checkout was last verified clean at `/home/kalde/trading-terminal-pro`.
- Recovery verdict: **FAIL — recovery in progress**.
- C0 and C1 are substantially repaired.
- C2 now includes method-aware parity plus canonical surface, Greeks, and positioning analytics.
- C4 MCP surface/Greeks/positioning tools now return their own strict analytical contracts instead of raw chains. Full strict-TypeScript migration remains incomplete.
- C6 deterministic success coverage has passed all 27 workflows at four viewports and 108 screenshots were visually inspected, but required failure-state matrix and independent visual review remain incomplete.

## Current in-progress concern

No dirty implementation tranche exists at this checkpoint. Session commits: boot
briefing (`efd78b3`), MacroVol cache truth (`5f9a8d3`), MacroVol OpenAPI contract
(`2c1a087`), legacy Deribit cache truth (`b52b401`), and fastify security patch +
full-suite race fix (`534433a`).

Dependency security: fastify 5.12.0 -> 5.12.1 via `npm audit fix` closes
GHSA-w2qp-rph6-63g4 (schema validation bypass) and GHSA-3m5p-2c4r-xxw2
(X-Forwarded-* spoofing); both npm audit scopes now report 0 vulnerabilities.
Full suite 155 files/857 tests passes twice under the default threads pool after
repairing a 1ms fake-timer race in the TradingView budget-bound test (real
product code was correct; the test advanced a knife's-edge margin).

Remaining C3/C4/C5/C6 items: strict-TypeScript server migration is blocked on a
runtime tooling decision (this Node 22.22.1 build has no unflagged native TS
stripping for ESM; enabling requires adding `tsx` and changing dev/start scripts
— a deployment-affecting infra tranche). MCP consumes only canonical /api/v1
operations and has comprehensive negative validation (verified this session).
C5: explicit-entry 3D + geometry assertions + dead-space fixes. C6: real-server
failure-state matrix + four-viewport screenshots + independent visual review.
C7: Python ownership restriction, naming/import cleanup, bundle/cache-hit/3D
lazy-load performance proof. C8: full gates at final HEAD + independent
adversarial review.

## Recent verified commits

- `534433a` — fastify 5.12.0→5.12.1 security patch (schema-validation bypass +
  X-Forwarded spoofing advisories closed; both npm audit scopes 0
  vulnerabilities) plus deterministic fake-timer fix for the TradingView
  budget-bound test (1ms race under full-suite thread load). Independent
  evidence: full suite 155 files/857 tests passed twice on the default threads
  pool, OpenAPI/parity/type-check/lint/secret gates, owner-clean, diff checks
  clean.
- `b52b401` — legacy Deribit routes expose full sanitized cache envelopes
  (cold/fresh/stale with reason), zero-coverage fills throw
  `insufficient_coverage` so labelled-stale/fail-closed engages, all five 502
  paths redact internal messages to sanitized typed codes, desk pack/venues
  catch paths sanitized. Independent evidence: 13 integration tests (4 new
  injection tests incl. zero-coverage stale), 26 tests across v1/v1Analytics/
  rateLimitBuckets/deskFeeds, OpenAPI/parity/type-check/lint/secret gates,
  owner-clean, diff checks clean.
- `2c1a087` — explicit deprecated GET-only OpenAPI contract for the macrovol
  wildcard: typed 400/404/502 envelopes with Ajv-validated runtime responses,
  optional `cache` envelope documented on cached paths, migration description to
  /api/v1; runtime registration narrowed to GET (false POST operation removed,
  65 operations now) and runtime error bodies aligned to published typed codes.
  Independent evidence: 16 macrovol tests across three files (openapi contract,
  cache behavior, validation), OpenAPI/parity gates, type-check, lint, all three
  secret-scan modes, owner-clean, diff checks clean.
- `5f9a8d3` — MacroVol legacy adapter: bounded streamed reads (Content-Length
  precheck, reader cancel, 500 kB byte cap), status/content-type/JSON/plain-object
  validation before caching (malformed 2xx payloads now typed 502 and never
  cached), full sanitized cache envelope (state/hit/ageMs/stale/coalesced/
  providerError) in frontend-visible body plus X-Cache-Coalesced/X-Provider-Error
  headers, explicit max stale windows (50 min light / 30 min heavy) with
  fail-closed expiry, sanitized typed errors that preserve worker status
  semantics while never leaking worker bodies/fragments/diagnostics, HTTP
  Deprecation header. Independent evidence: 14 tests across
  `server/routes/macrovol.cache.test.js` (11 new route-injection tests) and
  `macrovol.validation.test.js`, OpenAPI 65 paths/66 operations/16 strict v1,
  method-aware parity 38/65, type-check, lint, all three secret-scan modes,
  owner-clean, `git diff --check` clean.
- `ad29700` — checkpointed boot-briefing completion and MacroVol inventory next action.
- `efd78b3` — deprecated `GET /api/boot/briefing` compatibility adapter now settles
  rates/macro/stress worker calls independently with per-source coverage/warnings,
  bounded streamed reads (500 kB cap, Content-Length precheck, reader cancel),
  status/content-type validated before any read, JSON + object-shape validation,
  full sanitized cache envelope (state/hit/ageMs/stale/coalesced/providerError),
  bounded stale fallback with fail-closed expiry, redacted error bodies, HTTP
  deprecation headers pointing to canonical `/api/home/briefing`, strict OpenAPI
  contract, and inventory deprecation. Independent evidence: 47 focused tests
  (`server/routes/restoredRoutes.test.js` + `api/upstreamCache.test.js`), OpenAPI
  65 paths/66 operations/16 strict v1, method-aware parity 38/65, type-check, lint,
  all three secret-scan modes, owner-clean, `git diff --check` clean.

- `9874cb1` — yfinance history/info routes now validate snapshots before caching, propagate full cache state, serve bounded labeled stale results, fail closed after expiry, and redact provider diagnostics. Missing/null/blank/boolean or non-finite OHLC values are dropped rather than coerced to zero; OHLC must be positive while observed zero volume remains valid; non-finite info numerics become null server-side and do not propagate through frontend profiles. Explicit OpenAPI contracts and client tests cover the behavior. Independent evidence: 51 focused tests across three files followed by 31 post-cleanup tests, warning-free lint, OpenAPI 65 paths/66 operations, method-aware parity, project-reference type-check, all three secret-scan modes, owner-clean, and diff checks passed.
- `9215224` — Finnhub daily headroom is now enforced at the common provider-call boundary: cached hits cost zero, exhausted calls fail before fetch, and every attempted network/HTTP call is counted exactly once. News preserves labeled one-source partial results but total failure and exhaustion fail closed; upstream bodies are never included in public diagnostics; all six Finnhub routes consistently expose typed 429 responses in runtime and OpenAPI. Independent evidence: 44 focused tests across two files, OpenAPI 65 paths/66 operations, method-aware parity, project-reference type-check, lint, all three secret-scan modes, owner-clean, and diff checks passed.
- `4d1d596` — Finnhub earnings, economic calendar, recommendation, and peers now preserve complete sanitized cache state through REST and frontend types; explicit OpenAPI contracts replace generic discovered adapters, malformed provider shapes are rejected before caching, cached economic results remain available after quota exhaustion, failed upstream attempts are counted, and stale recommendation data fails closed after expiry. Independent evidence: 42 focused tests across two files, OpenAPI 65 paths/66 operations, method-aware parity, project-reference type-check, lint, all three secret-scan modes, owner-clean, and diff checks passed.
- `8cb88bd` — AlphaVantage and TradingView budget exhaustion now serves cached quotes only within an explicit ten-TTL stale ceiling and fails closed with typed 429/null values after expiry; both routes expose full cache diagnostics, failed upstream attempts consume quota, and TradingView now increments the monthly ledger rather than the unrelated daily counter. Independent evidence: 41 focused tests across two files, OpenAPI 65 paths/66 operations, method-aware parity, project-reference type-check, lint, all three secret-scan modes, owner-clean, and diff checks passed.
- `ab7b033` — Finnhub quote/news responses now expose full sanitized cache projections, the shared provider-error vocabulary consistently permits the internally generated `upstream-error` code, and real Finnhub quote route tests prove miss/hit, one-fill concurrent joins, bounded stale fallback, and expired-stale 502 behavior. Independent evidence: 47 focused tests across three files, OpenAPI, method-aware parity, type-check, lint, all three secret-scan modes, owner-clean, and diff checks passed.
- `a311d4e` — Home briefing now exposes a full sanitized cache envelope and derives freshness from actual desk/source coverage; all-provider-down is unavailable, partial is not live, stale is never live, malformed child data triggers stale fallback, and expired stale data fails closed. Independent evidence: 16 real route tests, OpenAPI, method-aware parity, type-check, lint, all three secret-scan modes, owner-clean, and diff checks passed.
- `7c118bb` — legacy and canonical equity-options responses now preserve hit, age, stale, coalesced, and bounded provider-error state; real canonical route tests prove miss/hit, concurrent join, stale fallback, and expired-stale typed failure. The quota-ledger deployment contract now explicitly limits restart-persistent file accounting to one process and rejects deployment-wide claims without a single owner or shared atomic counter. Independent evidence: 44 focused tests across three files, OpenAPI, method-aware parity, type-check, lint, all three secret-scan modes, owner-clean, and diff checks passed.
- `fcf849b` — canonical FMP endpoints now collapse equivalent query order, bound query dimensions, use a hard 500-entry LRU and bounded same-key in-flight coalescing, and charge quota exactly once at the actual upstream-attempt boundary including failures; FlashAlpha dimensions and the options-venue query surface now reject uncontrolled variants before cache/provider work. Independent evidence: 34 focused tests across three files, OpenAPI 65 paths/66 operations, method-aware parity, type-check, lint, all three secret-scan modes, owner-clean, and diff checks passed.
- `4b23d76` — provider-owned OKX and Bybit public option-summary adapters now use canonical BTC/ETH keys, separate bounded circuits, timeout/content-type/schema/stream-size guards, stale-aware shared cache metadata, and partial-failure isolation; the route reuses the canonical Deribit snapshot and exposes explicit nullable unit fields under a strict OpenAPI contract. Independent evidence: 61 focused tests across six files, OpenAPI 65 paths/66 operations, method-aware parity, type-check, lint, all three secret-scan modes, owner-clean, and diff checks passed.
- `97376cc` — one production-used visibility-aware single-flight scheduler now owns terminal, Deribit futures/funding, dual crypto books, shared strip, and KSA polling; mounted fake-timer tests prove active cadence, hidden suppression, safe resume, no overlap, and cleanup. Independent evidence: 25 tests across seven files, type-check, lint, secret scan, and diff checks passed.
- `35bea43` — fixed-ID closed/open/half-open circuits protect Deribit, Binance Futures, and Bybit Linear; one half-open probe is enforced, an older request cannot close a newer probe, free venues remain independent, and canonical provider status exposes a strict safe three-row projection. Independent evidence: 60 focused tests, OpenAPI 65 paths/66 operations, method-aware parity, type-check, lint, all secret-scan modes, and diff checks passed.
- `ad27efc` — checkpointed provider-error completion and circuit-breaker next action.
- `0eb54e8` — bounded/redacted provider-error codes now survive stale cache results and are mandatory through canonical REST/OpenAPI/MCP cache envelopes; 71 focused tests, type-check, lint, OpenAPI, route parity, secrets, and diff checks passed.
- `5faa987` — reset-safe repository memory and Sol/Luna execution-role rules.
- `d37ee40` — canonical observed surface, explicit-rate BSM Greeks, honest OI positioning proxy, strict REST/OpenAPI/MCP contracts, bounded analytical rows, and negative/golden tests.
- `7c6e690` — deterministic rates fixture completion.
- `216ab84` — full real-server workflow accessibility time budget.
- `3ff8b72` — real provider-boundary all-workflow gate.
- `9397d82` — exact registry workflow roots on the built server.
- Earlier recovery commits remain in Git history; use `git log --oneline e6753ae..HEAD` for the authoritative sequence.

## Remaining major blockers after the current concern

- C3: boot briefing and selected MacroVol metadata propagation remain. The file-backed quota ledger is explicitly documented and exposed as single-process only; deployment-wide quota completion still requires a single quota owner or shared atomic counter. Circuit behavior, provider key cardinality, canonical options/Home/Finnhub/yfinance response metadata and shared Finnhub quota enforcement, AlphaVantage/TradingView bounded budget stale behavior, free-options ownership, and runtime hidden-tab cadence are implemented and tested for the current bounded owners.
- C4: migrate Fastify/MCP incrementally to strict TypeScript and close remaining schema-authority/negative-test gaps.
- C5: complete explicit-entry professional IV and Greeks 3D, geometry assertions, and remaining desktop/mobile dead-space defects.
- C6: real-server loading, empty, stale, partial, malformed-provider, provider-down, and entitlement matrices; inspect their pixels.
- C7: restrict Python ownership, complete naming/import cleanup, and prove bundle/cache-hit/3D lazy-load performance budgets.
- C8: every mandatory gate, full suite twice, dependency audits, Python lock audit, clean-state evidence, independent API/security/math/visual/a11y reviews, and final adversarial falsification.

## Evidence discipline

- Green mocks or focused tests never imply whole-application PASS.
- Never reuse old PASS reports or screenshots as current evidence.
- Update this file whenever HEAD, dirty state, exact next action, or blocker ownership changes.
