# Agent rules — trading-terminal-pro

These rules apply to every file and every agent working in this repository. The full product specification is:

`/home/kalde/Documents/Codex/2026-08-29/he-finished-and-review-his-answer/MASTER_FULL_APPLICATION_REBUILD_PROMPT.md`

For the active recovery branch, also read `plans/full-application-rebuild-recovery.md`. The master specification wins; a later audited correction in the recovery plan wins over an older contradictory recovery note.

## Current recovery authority — user update 2026-09-07

- Astra GPT-6 medium owns orchestration, architecture, review and acceptance in Codex. Verified free Pi models do coding and bulk analysis under supervised Orca dispatches. These current roles supersede Sol/Luna references below.
- Target one active app folder: `/home/kalde/trading-terminal-pro`. Until safe consolidation is reviewed, implementation is `/home/kalde/trading-terminal-pro/trading-terminal-pro-rebuild` on `codex/full-application-rebuild`.
- The user explicitly authorized consolidation and updating these instructions. Preserve the original master history and all user changes/ignored assets; no blind reset, deletion or additional app copy.
- One coding writer per checkout; no nested delegation, paid/default fallback or worker commits. Actual rate-limit failures may trigger verified-free fallback only after the preceding attempt settles and its partial changes are reviewed.
- Read `RECOVERY_MEMORY.md`; verify Git HEAD/status before each tranche. Existing quantitative, security, capability-preservation and promotion rules below remain mandatory.
- Historical documents are requirements evidence; current direct user instructions outrank stale path, role and workflow instructions.

## Scope and execution honesty

1. The product is the whole application: Home, Volatility, Positioning/Flow, Trade & Risk, Rates, Crypto, KSA, and Academy.
2. A green narrow test is not proof of a whole-app PASS. Mocked browser routes are deterministic state tests, not real-server success evidence.
3. Do not claim a phase, capability, route, visual, or provider is complete without the exact code, focused tests, real runtime evidence, and visual evidence required by the master plan.
4. Never delete a useful capability to make a bundle or test pass. A replacement needs capability-parity tests, a user-visible entry point, real rendered evidence, and a rollback path.
5. Make small per-concern commits. Run `scripts/check-secrets.sh` before every commit. Continue through all recovery nodes; do not stop merely to report a tranche.
6. An independent reviewer must try to falsify the final PASS. Failed/absent reviewer execution is not an approval.

## Market-data and quantitative truth

1. Never fabricate or silently default prices, rates, strikes, expiries, IV, Greeks, OI, volume, trades, history, timestamps, surfaces, provider status, or entitlements.
2. Missing values are `null`/Unavailable, not `0`, `0.04`, an empty series described as Live, or a model value presented as observed.
3. Stale data carries source event time, fetch time, age, stale reason, cache state, and a visible Stale label. Stale is never Live.
4. Keep observed, derived, model, scenario, and synthetic layers separate in contracts, math, tables, tooltips, legends, screenshots, REST, and MCP.
5. Keep bid, ask, two-sided midpoint, last, mark, model price, bid IV, ask IV, venue mark IV, solved midpoint IV, and model IV separate.
6. Long executable entry requires an observed positive ask. Short executable entry requires an observed positive bid. Do not substitute midpoint, last, mark, or model.
7. Missing OI remains missing/partial. OI-weighted exposure is a labelled positioning proxy, not observed dealer inventory.
8. Production UI, JSON, OpenAPI examples, MCP structured content, exports, logs, and test fixtures must not contain `NaN` or `Infinity`.
9. Quantitative changes need golden vectors, boundary tests, unit labels, nullability tests, and property or finite-difference tests where appropriate.

## Rates and SERFF law

1. `SERFF` means the CME One-Month SOFR versus 30-Day Federal Funds inter-commodity spread for the same delivery month: `SR1 - ZQ`, ratio `1:1`, with the spread display convention explicitly stated from the contract.
2. Never label an SR3 calendar, butterfly, four-leg calendar-of-calendars, SR3-versus-ZQ spread, or cash SOFR-minus-EFFR proxy as SERFF.
3. If ZQ or SR1 is unavailable, show SERFF Unavailable. A derived `SR1 implied rate - cash EFFR` value may exist only as a separately named and labelled proxy; it is not a listed SERFF observation.
4. SR3 settlement follows the CME Actual/360 daily-compounded formula using publication intervals/day counts. Weekend and holiday accrual must be proven with regression vectors; do not daily-compound a repeated fixing as if each calendar day were a new fixing.
5. The default SR3 chart is `3M SOFR Futures — Implied Rate`, where implied rate is `100 - price`. Price is a separate mode. Use real contract/reference-quarter dates and straight segments.
6. Rates axes, titles, tick labels, legends, tooltips, and controls must pass measured non-overlap checks at all four required viewports.

Official semantic authorities:

- CME Interest Rate Futures Inter-Commodity Spreads: https://www.cmegroup.com/trading/interest-rates/intercommodity-spread.html
- CME Understanding SOFR Futures: https://www.cmegroup.com/education/articles-and-reports/understanding-sofr-futures

## Provider, cache, quota, and Velo law

1. Provider calls stay server-side and pass through provider-owned adapters plus a shared quota-aware broker. Browser widgets consume canonical snapshots.
2. Cache keys are canonical and bounded. Concurrent clients/tabs share one cold upstream fill per key/TTL. Count quota only on actual upstream fills.
3. Preserve cache metadata (`hit`, `ageMs`, `stale`, `coalesced`, providerError) through services and response envelopes; do not discard it at adapter boundaries.
4. Use bounded timeouts, response-size limits, schema validation, partial-failure isolation, circuit breaking, and stale windows. A stale window expiry fails closed.
5. In-memory counters are not a durable quota ledger. Document process scope and add persistent or deployment-appropriate accounting before claiming quota completion.
6. Pause/reduce polling for hidden tabs and prove it with timers/network assertions.
7. Velo credential presence is not entitlement. Do not label Velo active until a server-side capability probe verifies licensed endpoints, quota, resolution, history, and display/redistribution permission.
8. Until Velo is verified active, keep Binance Futures + Bybit Linear available and label it exactly: `Free multi-venue snapshot` and `Public exchange data; free alternative to Velo, not Velo-normalized.` A stray/incomplete Velo variable must not disable the free fallback.
9. Deribit remains authoritative for crypto options, option trades, option Greeks, and volatility surfaces. No account, order, trade, withdrawal, or private exchange endpoint is allowed.

## Architecture and ownership

1. Keep React 19 + strict TypeScript for the UI. Do not start a full Rust rewrite.
2. Migrate the Fastify composition/API and MCP incrementally to strict TypeScript. Shared JSON Schema 2020-12 contracts are the authority for Fastify validation, generated TypeScript, OpenAPI 3.1, clients, and MCP.
3. REST and MCP call the same domain services, provider broker, cache, and quantitative code. MCP must not call legacy routes that bypass canonical services or return raw chains in place of requested analytics.
4. The private Python service is a rates worker, not a product and not a public browser API. Bind loopback only, reject wildcard CORS, rename visible/internal product branding, and migrate non-rates ownership out unless pandas/SciPy/rates integrations justify it.
5. Keep temporary `/api/macrovol/*` adapters only while consumers migrate; never display `MacroVol` or `VOLATERM` as a user-facing product/vendor.
6. Rust requires a committed representative benchmark showing at least a useful 2x improvement, a stable schema boundary, parity tests, and an actual production consumer.

## REST, OpenAPI, registry, and MCP

1. Every frontend network call must match a real runtime Fastify route by HTTP method and path.
2. Canonical `/api/v1` routes must validate params, query, body, and serialized success/error responses at runtime. Invalid values return typed 4xx errors; never silently normalize an invalid enum/range to a default.
3. Every market envelope includes schema version, request ID, instrument identity, event time, fetch time, exact source(s), per-field provenance, per-field units, freshness, coverage, assumptions, warnings, cache state, and typed data/error.
4. OpenAPI must describe the actual runtime operations. Legacy adapters remain explicitly deprecated and get real schemas or an explicit time-bounded migration exception.
5. MCP is read-only and analytical. Every tool publishes strict `inputSchema` and `outputSchema`, validates `structuredContent`, uses canonical domain services, and has negative tests. No trading/account/Stripe/reset/secret tool.
6. The workflow registry is the machine authority for navigation, command palette, deep links, API operation IDs, MCP tools, and E2E workflow roots. Registry references must resolve.

## Product and visual acceptance

1. Root `/` opens useful Home content and never waits forever for an optional provider.
2. Crypto uses the global terminal shell. It may have one workflow selector but not a nested mini-application shell or duplicated header/banner chrome.
3. Every required workflow has a decision-useful primary visual, exact units, provenance/freshness, and loading, empty, stale, partial, malformed-provider, and provider-down states.
4. Heatmaps use professional, fixed-domain semantic scales; missing differs from zero; strike scope centers on spot/forward/delta/moneyness; exact tooltip, reference lines, keyboard controls, and an accessible table are required.
5. 3D IV/Greeks has an explicit user entry control and lazy-loads only after activation. It preserves observed holes and separates observed nodes from model mesh. Include axes, presets, contours, ATM ridge, crosshair/tooltip, keyboard support, and 2D/table fallback.
6. Do not approve screenshots because files exist. Inspect the pixels. Reject empty principal charts, huge dead regions, clipped/mobile overflow, unreadable axes, nested-card clutter, duplicated chrome, or mocked labels such as `mock surface`.
7. Visual and WCAG 2A/2AA including color contrast must pass at 1440x900, 1280x800, 1024x768, and 390x844.

## Secrets (always, no asking)

When the user pastes or mentions an API key, token, password, or credential:

1. Write it only to local server `.env` (or the correct server env file). Never source, docs, `.env.example`, commits, PR text, screenshots, MCP, OpenAPI examples, or chat echoes.
2. Never re-print it; redact as `***`.
3. Confirm `.env` is gitignored and prefer `chmod 600 .env`.
4. Provider keys never reach browser/Vite code.
5. If a live key was pasted into chat/logs, recommend provider-side rotation.
6. Do not log credential presence from production services.
7. Run `scripts/check-secrets.sh`, `scripts/check-secrets.sh --all`, and `scripts/check-secrets.sh --self-test` at the required gates.

## Stripe Billing and Auth invariants

Architecture and human continuation instructions remain in `docs/engineering/BILLING_HANDOFF.md` and `docs/engineering/BILLING.md`.

- No Stripe Connect without an explicit new owner decision.
- Never pass `payment_method_types` to Stripe.
- Stripe webhook RAW parsing stays scoped inside `registerStripeBilling`.
- Checkout/portal/webhook/auth mutations fail closed when configuration is missing or invalid.
- Preserve the intentionally public pre-key product mode, but do not represent it as `entitled: true`. Model it explicitly as billing disabled/public access; a real entitlement remains false/unknown until verified.
- When billing is enabled or a desk is configured as gated, unknown/unverified entitlement denies access.
- Public reset-request never creates, returns, persists, or logs reset tokens or emails. Reset creation remains offline/operator-only.
- Remove misleading comments that claim public reset requests log tokens.
- Never print secrets or sensitive auth material.

## Minimum promotion gates

Run every command in the master specification. At minimum, run type-check, build, the full test suite twice, lint, secret scans, both npm audits, route inventory, bundle gate, OpenAPI validation, method-aware route parity, API/MCP/integration contracts, real-server E2E, visual E2E, Python tests and hashed-lock audit, diff check from `e6753ae`, and clean status.

The final verdict remains FAIL/recovery-in-progress until every mandatory gate and independent review passes. A skipped, blocked, mocked-only, partial, or uninspected gate is not PASS.

## Reset continuity and execution roles

1. `RECOVERY_MEMORY.md` is the single current checkpoint for this recovery. Read it completely after `AGENTS.md`, the master specification, the recovery plan, and `docs/recovery-evidence/`, before resuming implementation.
2. The primary Astra GPT-6 medium agent owns orchestration, plan changes, domain/security review, evidence review, commits, and final verdicts.
3. Delegate bounded coding and command-execution tranches to verified free frontier Pi models at supported medium reasoning. Executors do not declare completion, weaken gates, edit the owner checkout, or commit unless the primary agent explicitly assigns that exact action.
4. The primary agent reviews every worker diff and test claim independently before committing. Executor output is a lead, never evidence by itself.
5. After every committed concern, and before any expected reset or handoff, update `RECOVERY_MEMORY.md` with HEAD, clean/dirty state, completed concern, exact verification, current in-progress files, next command, and remaining C0-C8 blockers. Include that update in the concern commit when practical; otherwise commit it as a small documentation checkpoint.
6. On resume, do not recreate the branch or repeat completed tranches. Verify the recorded state with Git, inspect any dirty diff, then continue from the recorded exact next action.
