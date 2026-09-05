# Full-application recovery continuity memory

Updated: 2026-09-05T08:00:00Z

Conventions in this file: **Implementation HEAD** is the newest commit that
changes product/test/config code. **Checkpoint commit** is the docs-only
commit that records this file. They differ whenever memory is checkpointed
separately; `git log --oneline` resolves both. Test counts below are measured
in-session (not copied from older reports). A node is PASS only when its plan
exit criteria are satisfied AND independently reviewed — otherwise it is
IN PROGRESS with the unmet criteria listed.

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

- Implementation HEAD: `8d58ef3` (fix(chain): bound the whole snapshot build).
- Checkpoint commit: the docs commit carrying this update (see `git log --oneline`; it touches only RECOVERY_MEMORY.md).
- Recovery worktree is clean at this checkpoint.
- Owner checkout was last verified clean at `/home/kalde/trading-terminal-pro`.
- Recovery verdict: **FAIL — recovery in progress**.
- A-tranche (on top of `a089e2d`): crypto overview recomposition
  (`1bd1133`), failure-state fixture scenarios + gate (`2f94808`), Home
  feeds aggregate + chain agreement (`b92ae52`), unattempted-vs-down
  terminal freshness (`e733934`), PnL definite heights + no-history states
  (`0b88d9e`), KSA entitlement panel + Academy density (`ca3afa0`),
  failure-state manifests (`03698d6`).
- B-tranche (on top of `bbb0c69`): Home freshness ledger (`b6c250e`),
  ledger scroll-region a11y (`a0feac8`), stale-by-age rule (`e84d7cc`),
  briefing freeFallback available flag (`3d99266`), shared
  header/ledger/strip stale derivation (`86bd6c1`, `8f63eed`).
- `test:e2e:failure-states` at `0cf60d8`: 4/4 viewports PASS in 2.1m;
  40/40 `fail-0cf60d8-*` captures carry sidecars, indexed by
  `docs/recovery-evidence/SCREENSHOT_MANIFEST_0cf60d8.json`.
- `test:e2e:real-server` at `0cf60d8`: 6/6 PASS in 4.1m; 108/108
  `real-0cf60d8-*` captures carry sidecars (same manifest). Ten
  pixel-inspected shots across both gates (not filename-approved).
- Full unit suite at `0cf60d8`: 160 files / 915 tests PASS; type-check PASS; lint PASS; secrets PASS (standard mode pre-commit every commit); npm audit 0 vulns (both scopes).
- Residual-defect tranche (this session, on top of `7679606`): derived-only
  BSM terminology (`f3dcd38`), level-guides rename (`c1fd162`), structural
  per-grid provenance (`c30cc1c`), fail-closed bounded reads (`55f6f7c`),
  type-strict Deribit index (`76153ef`), non-finite Greeks fail-closed
  (`87cc67b`), warning elimination (`fa6d55d`), e2e sidecars + collector
  (`3c3612e`), screenshot manifest (`ba36bc9`).
- C0: exit criteria re-checked this session — zero false-SERFF labels, zero
  hardcoded-rate fallbacks, rate_risk+stir 27 tests pass, no credential-value
  printing (one absent-key skip notice names the env var only), secrets pass.
  Independent review still pending, so C0 stays IN PROGRESS, not PASS.
- C1: nullability/execution-basis guarded in covered paths (premiumMath +
  indicators + portfolio + positioning-units: 29 tests pass; Greeks OI/price
  provenance + non-finite fail-closed: 23 + 4 Python tests pass). Full exit
  (all outputs finite-or-null everywhere + math review acceptance) is not
  proven — C1 stays IN PROGRESS.
- C2: method-aware parity PASS (38 frontend vs 65 runtime) and OpenAPI
  validation PASS (65 paths / 65 ops / 16 strict v1 / 27 workflows). Required
  canonical expansion (surface/Greeks/positioning and remaining analytics)
  is incomplete — C2 stays IN PROGRESS.
- C4 MCP surface/Greeks/positioning tools return their own strict analytical
  contracts instead of raw chains (prior session). Full strict-TypeScript
  migration remains incomplete.
- C6 deterministic success coverage passed all 27 workflows at four viewports
  with 108 screenshots at an older HEAD; required failure-state matrix,
  final-HEAD screenshots with sidecars, and independent visual review remain
  incomplete (screenshots are never reused as current evidence).

## Current in-progress concern

P1-15 representative failure-state gate: PASS at `8f63eed` — 4/4 viewports
green in 2.1m (10 steps x 4 viewports = 40 `fail-8f63eed-*` captures, all
with sidecars, indexed by
`docs/recovery-evidence/SCREENSHOT_MANIFEST_8f63eed.json`). Nine shots
pixel-inspected across the `ae15374`/`e84d7cc`/`3d99266`/`86bd6c1`/`8f63eed`
runs (not filename-approved). Pixel review drove four real fixes this
tranche: freeFallback available flag, 96h stale-by-age rule, shared
header/ledger/strip stale derivation, ledger scroll-region a11y.

Latest pixel findings at `0cf60d8` (both gates, inspected):
- home-partial desktop: strip/cells/ledger fully agree (PARTIAL; KSA
  unavailable; everything else LIVE at 0s).
- home-success desktop (`real-0cf60d8`): Feeds LIVE, KSA populated
  (TASI 12,150, delayed-truthful), ledger all Live + KSA Delayed.
  Rates fixture coherence fix confirmed (0s age, LIVE).
- Server aggregate now carries the 96h age verdict with a
  stale-observation warning naming the desk; fixture values stay
  deterministic (only the observation stamp is live, per-run in sidecars).
- Residual minor: ~30% bottom void below the ledger on 900px viewports;
  KSA ledger event/age honestly dashed (fixture carries no KSA timestamp).

Earlier findings at `ae15374` still on record: trade-loading post-load
populated with rendered curves; crypto-partial dense with expiries/top-OI
(~35% void); ksa-stale dense and decision-useful; ksa-entitlement honest
denial (sparse card, acceptable); chain-empty mobile honest with a
correct attempted-and-failed API DOWN pill; rates-malformed honest
fail-closed (sparse failure page, acceptable).

- `5671143` fix(greeks-3d): diverging ramp sign + wireframe holes + golden tests (P0-4, P0-5).
- `4763af5` fix(greeks): missing OI nullability + price provenance (P0-2, P0-3) with Python golden tests.
- `07f03fb` fix(greeks): observed/derived/model provenance separation + full 3D behaviors + act-safe 3D test (P0-1, P0-6, P1-11).
- `3515e75` fix(macrovol): runtime/OpenAPI status parity + migration exception (P1-7, P1-8).
- `f727f64` fix(providers): Deribit index validation + byte-limit fallback (P1-9, P1-10).
- `f4d1ca4` fix(tests): fixture comment correction + provenance contract tests (P1-12, P1-13).

Measured verification (this session, HEAD `ba36bc9`; code HEAD `3c3612e`):
type-check PASS; lint PASS; build PASS; bundle gate PASS (OrbitControls
230.4 kB gzip under 300 kB analytical exception; dist verified single three
revision 185). Full suite 158 files / 885 tests: 6 runs — 5x all-green,
1x 884/885 with a single unidentified failure that never recurred (honest
flake on record; consecutive-twice-green not cleanly claimed). Zero width(0)
and zero act warnings (one residual three dual-instance line: same-revision
CJS/ESM double-load under vitest only). Python worker 62 passed / 2 skipped;
pip-audit clean (direct-deps coverage, 2 environment warnings). npm audit 0
vulns (both scopes). Secrets PASS (all three modes). Route parity PASS
(38 vs 65); OpenAPI validation PASS (65/65/16/27); owner clean.
Real-server suite `test:e2e:real-server` 6/6 PASS in 4.5m at `3c3612e`.
108/108 new-run (real-3c3612e-*) captures carry sidecars; 816 total PNGs in
e2e/screenshots/, 708 archival without sidecars. Committed manifest
`docs/recovery-evidence/SCREENSHOT_MANIFEST_3c3612e.json` aggregates
sidecars plus pixel stats (automated signals only). Five screenshots
pixel-inspected (see findings below).

Remaining work: P1-14 final-HEAD screenshots with sidecars; P1-15 C6 failure-state matrix (loading/empty/stale/partial/malformed/provider-down/entitlement) with pixel inspection; P1-16 layout defects (Home dead space, Trade P&L/Risk blank charts, Crypto Overview/Vol dead space, Academy sparse, four-viewport geometry); C3 quota/provenance propagation; C4 strict-TS migration; C5 Crypto 3D + measured geometry; C6 full matrix; C7 Python ownership + perf proofs; C8 all gates twice + independent falsification.

Pixel findings at `3c3612e` (inspected, not filename-approved):
- desktop-home: brief panels populated but contradictory CHAIN API-DOWN vs
  FEEDS-ok badges; LPAD grid + KSA column leave ~55% near-empty (dead space
  open); Volatility ATM IV shows unavailable dash.
- desktop-trade-sub-pnl: blotter/controls populated but BOTH PnL principal
  charts render empty axes (no curves) — blank-principal defect open.
- desktop-crypto-v2-overview: regime/coverage/free-snapshot populated with
  exact required labels, but bottom ~50% dead space — defect open.
- desktop-vol-sub-greeks: structural fallback badge renders honestly
  ('legacy grid · exact table below (provenance unavailable)'); CHARM/VANNA
  chart populated; surface/GEX honestly empty in fixture mode; honest
  EXPIRED deterministic-fixture badge.
- desktop-academy-sub-start: populated header/hero; essay list below fold
  (density to review).

Exact next action: P1-15 C6 failure-state harness (loading/empty/stale/
partial/malformed/provider-down/entitlement-denied × 27 workflows × 4
viewports) with pixel review; P1-16 layout corrections for the confirmed
defects above (Home dead space, Trade PnL blank principals, Crypto dead
space, contradictory status badges); Crypto 3D restore with explicit entry
and 3D-network proof; C3 quota/provenance propagation; C4 strict-TS/shared-
schema/MCP completion; C7 Python ownership + perf proofs; independent
API/security/math/visual/a11y reviews and final adversarial falsification.

## Recent verified commits

- `3d5a120` — removed duplicate `sec-mm-strip` section id (RatesPanel wrapper
  vs MoneyMarketStrip's CollapsibleSection): exactly one owns the id now.
  Deterministic render test (single id + observed cells). Canonical C6
  real-server suite green.
- `66ec44b` — StructureWorkflow option grid scrollable region made focusable
  (tabIndex=0 + aria-label) fixing axe 'scrollable-region-focusable' WCAG 2.1.1
  violation surfaced by the real-server C6 suite; deterministic render test
  added. 15 workflow tests green.
- `66853af` — 3D Greeks restored as lazy explicit-entry analytical module:
  observed nodes with true holes (null/NaN never rendered), ATM ridge, optional
  observed-cell wireframe (explicitly not a fitted model — no canonical model
  fit exists), diverging zero-centered ramp, exact-unit Z ticks, DOM overlay +
  hover readout, gate-testable Open 3D. Pure geometry helper (no WebGL) is
  unit-tested for holes/no-NaN/diverging-midpoint/ATM/empty. Greeks10View
  gets explicit 3D entry; obsolete '3D removed' copy and its locking test
  replaced. Bundle: shared drei OrbitControls vendor chunk documented under
  analytical exception (cap 300 kB). Evidence: 10 focused tests + full suite
  156 files/864 tests pass twice, bundle gate PASS, OpenAPI/parity/type/lint/
  secrets/diff gates pass.
- `29eb677` — legacy deribit family now sets Deprecation headers with exact
  /api/v1/market/crypto/* successor links; real-server evidence report
  (REAL_SERVER_2026-09-02.md) recorded. 4 focused suites (53 tests) green;
  type-check/lint/diff/secret gates pass.
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
- C5: 3D Greeks restored (explicit-entry, lazy); remaining = Crypto 3D (also deleted in history), measured geometry/overlap assertions for 3D surfaces, and desktop/mobile dead-space fixes.
- C6: real-server loading, empty, stale, partial, malformed-provider, provider-down, and entitlement matrices; inspect their pixels.
- C7: restrict Python ownership, complete naming/import cleanup, and prove bundle/cache-hit/3D lazy-load performance budgets.
- C8: every mandatory gate, full suite twice, dependency audits, Python lock audit, clean-state evidence, independent API/security/math/visual/a11y reviews, and final adversarial falsification.

## Evidence discipline

- Green mocks or focused tests never imply whole-application PASS.
- Never reuse old PASS reports or screenshots as current evidence.
- Update this file whenever HEAD, dirty state, exact next action, or blocker ownership changes.
