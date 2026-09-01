# Full-application recovery continuity memory

Updated: 2026-09-01T17:47:04Z

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

- Recovery HEAD: `35bea43` (`feat(providers): add bounded circuit breakers`).
- Recovery worktree was clean at this checkpoint.
- Owner checkout was last verified clean at `/home/kalde/trading-terminal-pro`.
- Recovery verdict: **FAIL — recovery in progress**.
- C0 and C1 are substantially repaired.
- C2 now includes method-aware parity plus canonical surface, Greeks, and positioning analytics.
- C4 MCP surface/Greeks/positioning tools now return their own strict analytical contracts instead of raw chains. Full strict-TypeScript migration remains incomplete.
- C6 deterministic success coverage has passed all 27 workflows at four viewports and 108 screenshots were visually inspected, but required failure-state matrix and independent visual review remain incomplete.

## Current in-progress concern

No dirty implementation tranche exists at this checkpoint. The next bounded C3 concern is runtime proof that hidden browser tabs do not continue polling at the active cadence.

Exact next action: inspect `src/store/terminalStore.ts`, `src/hooks/useDeribitFutures.ts`, `src/hooks/useCryptoDualBooks.ts`, and their consumers. Replace the weak source-string hidden-tab assertion with deterministic fake-timer/runtime tests that count actual network/service calls while `document.hidden` changes. Prove active cadence, hidden pause or documented reduction, visibility-resume behavior without a retry storm, and timer cleanup on unmount/reset. Luna medium implements the bounded tranche; Sol reviews the diff and independently runs the timer/network evidence before commit.

## Recent verified commits

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

- C3: direct-provider ownership cleanup, adversarial cache cardinality, and runtime timer/network proof for hidden-tab cadence; circuit open/half-open behavior is now implemented for Deribit and the two free futures venues.
- C4: migrate Fastify/MCP incrementally to strict TypeScript and close remaining schema-authority/negative-test gaps.
- C5: complete explicit-entry professional IV and Greeks 3D, geometry assertions, and remaining desktop/mobile dead-space defects.
- C6: real-server loading, empty, stale, partial, malformed-provider, provider-down, and entitlement matrices; inspect their pixels.
- C7: restrict Python ownership, complete naming/import cleanup, and prove bundle/cache-hit/3D lazy-load performance budgets.
- C8: every mandatory gate, full suite twice, dependency audits, Python lock audit, clean-state evidence, independent API/security/math/visual/a11y reviews, and final adversarial falsification.

## Evidence discipline

- Green mocks or focused tests never imply whole-application PASS.
- Never reuse old PASS reports or screenshots as current evidence.
- Update this file whenever HEAD, dirty state, exact next action, or blocker ownership changes.
