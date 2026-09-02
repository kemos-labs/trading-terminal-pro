# Full-application recovery continuity memory

Updated: 2026-09-02T09:45:55Z

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

- Recovery HEAD: `fcf849b` (`fix(cache): bound provider key cardinality`).
- Recovery worktree was clean at this checkpoint.
- Owner checkout was last verified clean at `/home/kalde/trading-terminal-pro`.
- Recovery verdict: **FAIL — recovery in progress**.
- C0 and C1 are substantially repaired.
- C2 now includes method-aware parity plus canonical surface, Greeks, and positioning analytics.
- C4 MCP surface/Greeks/positioning tools now return their own strict analytical contracts instead of raw chains. Full strict-TypeScript migration remains incomplete.
- C6 deterministic success coverage has passed all 27 workflows at four viewports and 108 screenshots were visually inspected, but required failure-state matrix and independent visual review remain incomplete.

## Current in-progress concern

No dirty implementation tranche exists at this checkpoint. The next bounded C3 concern is complete provider/cache metadata propagation.

Exact next action: inventory every `getOrFetch` result crossing a REST, MCP, or internal service boundary and find callers that destructure away `stale`, `coalesced`, `providerError`, or precise age/hit state. Repair a bounded coherent slice using the shared cache envelope contract, including stale-expiry fail-closed and negative tests. Also audit the existing file-backed quota ledger's deployment assumptions and evidence before deciding whether further accounting work is required. Luna medium implements the bounded tranche; Sol reviews metadata truth, quota semantics, and evidence before commit.

## Recent verified commits

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

- C3: complete provider metadata propagation remains. A file-backed single-process quota ledger exists and has restart tests, but deployment assumptions and multi-process limitations still require an explicit audit before quota completion can be claimed. Circuit behavior, provider key cardinality, free-options ownership, and runtime hidden-tab cadence are implemented and tested for the current bounded owners.
- C4: migrate Fastify/MCP incrementally to strict TypeScript and close remaining schema-authority/negative-test gaps.
- C5: complete explicit-entry professional IV and Greeks 3D, geometry assertions, and remaining desktop/mobile dead-space defects.
- C6: real-server loading, empty, stale, partial, malformed-provider, provider-down, and entitlement matrices; inspect their pixels.
- C7: restrict Python ownership, complete naming/import cleanup, and prove bundle/cache-hit/3D lazy-load performance budgets.
- C8: every mandatory gate, full suite twice, dependency audits, Python lock audit, clean-state evidence, independent API/security/math/visual/a11y reviews, and final adversarial falsification.

## Evidence discipline

- Green mocks or focused tests never imply whole-application PASS.
- Never reuse old PASS reports or screenshots as current evidence.
- Update this file whenever HEAD, dirty state, exact next action, or blocker ownership changes.
