# Full-application recovery continuity memory

Updated: 2026-09-01T13:59:03Z

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

- Recovery HEAD before the current dirty tranche: `d37ee40` (`feat(analytics): add canonical surface Greeks and positioning`).
- Owner checkout was last verified clean at `/home/kalde/trading-terminal-pro`.
- Recovery verdict: **FAIL — recovery in progress**.
- C0 and C1 are substantially repaired.
- C2 now includes method-aware parity plus canonical surface, Greeks, and positioning analytics.
- C4 MCP surface/Greeks/positioning tools now return their own strict analytical contracts instead of raw chains. Full strict-TypeScript migration remains incomplete.
- C6 deterministic success coverage has passed all 27 workflows at four viewports and 108 screenshots were visually inspected, but required failure-state matrix and independent visual review remain incomplete.

## Current in-progress concern

C3 provider-error propagation is dirty and not yet committed. Expected touched files include:

- `api/upstreamCache.js`
- `api/upstreamCache.test.js`
- `packages/contracts/src/v1-contracts.schema.json`
- `packages/contracts/src/runtime.js`
- `server/routes/v1.js`
- `server/routes/v1Analytics.js`
- `server/routes/v1Analytics.test.js`
- `server/providers/freeCrypto/client.test.js`

Intent:

- stale cache serves expose a bounded, sanitized `providerError` code;
- fresh/miss results carry `providerError: null`;
- canonical cache envelopes require and propagate the field;
- raw provider messages, bodies, credentials, and arbitrary internal codes never cross the boundary.

Exact next action: inspect the dirty diff and run the focused upstream-cache, free-crypto, v1, v1-analytics, and MCP contract tests. Fix all resulting contract omissions, then run type-check, lint, OpenAPI validation, method-aware route parity, secret scan, and `git diff --check`. Sol reviews the diff and commits the concern.

## Recent verified commits

- `d37ee40` — canonical observed surface, explicit-rate BSM Greeks, honest OI positioning proxy, strict REST/OpenAPI/MCP contracts, bounded analytical rows, and negative/golden tests.
- `7c6e690` — deterministic rates fixture completion.
- `216ab84` — full real-server workflow accessibility time budget.
- `3ff8b72` — real provider-boundary all-workflow gate.
- `9397d82` — exact registry workflow roots on the built server.
- Earlier recovery commits remain in Git history; use `git log --oneline e6753ae..HEAD` for the authoritative sequence.

## Remaining major blockers after the current concern

- C3: circuit open/half-open behavior, direct-provider ownership cleanup, adversarial cache cardinality, and runtime timer/network proof for hidden-tab cadence.
- C4: migrate Fastify/MCP incrementally to strict TypeScript and close remaining schema-authority/negative-test gaps.
- C5: complete explicit-entry professional IV and Greeks 3D, geometry assertions, and remaining desktop/mobile dead-space defects.
- C6: real-server loading, empty, stale, partial, malformed-provider, provider-down, and entitlement matrices; inspect their pixels.
- C7: restrict Python ownership, complete naming/import cleanup, and prove bundle/cache-hit/3D lazy-load performance budgets.
- C8: every mandatory gate, full suite twice, dependency audits, Python lock audit, clean-state evidence, independent API/security/math/visual/a11y reviews, and final adversarial falsification.

## Evidence discipline

- Green mocks or focused tests never imply whole-application PASS.
- Never reuse old PASS reports or screenshots as current evidence.
- Update this file whenever HEAD, dirty state, exact next action, or blocker ownership changes.
