# VOLATERM — Full Code Review & Master Plan

Review date: 2026-08-22 · Reviewer: full-repo audit (server, API modules, Python services, frontend, tests, CI, deploy, git history)
Scope: ~63K LOC · 379 TS/JS/PY files · 107 test files (489 tests) · Node/Fastify + React 19/Vite + 2 Python FastAPI services.

---

## Part 1 — Code Review Findings

### 🔴 CRITICAL — Secrets exposure (act on this first)

**C1. Seven live API keys are committed and pushed to the public GitHub repo.**
`render-work.md` (commits `f0db190`, `6fd7865` on `master` → github.com/xxxova2/volaterm)
contains plaintext values for: FRED, FINNHUB, ALPHA_VANTAGE, RAPIDAPI, **SAHMK (live Tadawul key)**,
MASSIVE, FLASHALPHA. This violates AGENTS.md policy. Keys were also pasted into Render via API
(documented in the same file).

Required actions:
1. **Rotate every one of the 7 keys** on its provider portal (agents cannot rotate SAHMK/others — dashboard login needed).
2. Remove the secret table from `render-work.md`; replace with "keys set via Render dashboard".
3. Scrub history (`git filter-repo --path render-work.md --invert-paths` + force-push) **or** make the repo private. Rotation is mandatory either way — assume scraped.
4. Re-set the rotated keys in Render env vars.

**C2. `scripts/check-secrets.sh` has false positives that train devs to bypass it.**
The pattern `(FINNHUB|…)_API_KEY\s*=\s*[^[:space:]#]{12,}` matches legitimate code such as
`const FMP_API_KEY = process.env.FMP_API_KEY || null;` → every commit touching `server.js`
gets blocked → devs reach for `--no-verify` → real leaks like C1 slip through.
Fix: only match literal assignments, e.g. `KEY\s*=\s*['"][A-Za-z0-9_\-]{16,}['"]`,
and add explicit high-signal token patterns (`shmk_live_`, FRED 32-hex, RapidAPI 32-char hex+`jsn`).
Test the script against both a legit server.js line and a fake leak in CI.

### 🟠 HIGH

**H1. Test suite is red — time-bomb test.**
`src/lib/options/fmp.test.ts` hardcodes expiry `2026-08-10`, which is now in the past
(today: 2026-08-22). The snapshot builder correctly filters expired slices
(`yahoo.ts`: `T <= 0 → continue`) so `expiries.length === 0` → test fails.
488/489 pass today; UPGRADE_PLAN.md's "489/489" claim is stale. **Fix:** derive the expiry
dynamically (e.g. third Friday ≥ 45 days out) instead of a literal date. CI (`ci.yml`)
is currently failing on this.

**H2. SSE quote stream bypasses the FMP budget and shared TTL.**
`server.js` `/api/stream/quote/:symbol` → `writeTick()` calls `proxyFmp()` directly:
- No `recordBudget('fmp', …)` — invisible to budget accounting/caps.
- No `getOrFetch` with `TTL.FMP_QUOTE_MS` — only `_shared.js`'s 60s micro-cache throttles it.
One open tab ≈ 60 upstream FMP calls/hour → the 250/day free budget is exhausted by a single
tab left open ~4h, starving every other endpoint that *does* respect the budget.
**Fix:** route ticks through `getOrFetch('fmp:sse:'+symbol, TTL.FMP_QUOTE_MS, …)` +
`recordBudget`, or better, have the stream read the same shared SPY/desk quote cache the
warmer already fills; add per-client tick cap and session-aware cadence reuse.

**H3. Frontend bundle: ~6.7 MB raw JS initial load.**
`dist-C9JDo4Rf.js` = 4.65 MB (plotly.js-dist-min), `index-C0iR0IhV.js` = 2.15 MB.
Plotly is statically imported by `Greeks10View.tsx` / `IVSurfaceMacro.tsx`.
**Fix:** dynamic `import('react-plotly.js')` behind `React.lazy` for the two views that need
it, add `build.rollupOptions.output.manualChunks` (three, recharts, plotly), consider dropping
plotly entirely for the existing Recharts/three stack (one chart lib less). Target: <1.5 MB
initial gzip.

**H4. 132 files (~10.3K insertions) staged but uncommitted.**
Includes the whole KSA desk, academy catalog, tests, docs. Any mishap loses weeks of work;
CI has never seen it. **Fix:** run `check-secrets.sh` (after C2 fix), commit in logical
chunks (KSA desk / academy / docs / chore), push, watch CI green.

### 🟡 MEDIUM

**M1. Upstream cache never evicts.** `api/upstreamCache.js` Map grows without bound
(bounded in practice by symbol diversity, but a symbol-search storm grows it forever).
Add max-size + LRU/TTL eviction (e.g. cap 2,000 entries, evict oldest).

**M2. yfinance options chain effectively dead on Render free tier.**
Render's shared Oregon IPs are 429'd by Yahoo (documented in render-work.md); pacing/retry
mitigates but does not solve. The equity chain is the product's core. Decide the data-source
strategy: get `FMP_API_KEY` (options endpoint already allow-listed), or Tradier free tier,
or accept degraded mode with honest provenance chips (current behavior).

**M3. Ops gaps on Render free tier:** 15-min idle sleep with cron ping documented but **not set up**;
no log access via CLI. Either set up cron-job.org/UptimeRobot or move to a paid always-on plan
($7/mo) once the app matters.

**M4. Python services CORS `allow_origins=["*"]`.** Mitigated (bound to 127.0.0.1, Node edge
blocks non-local MACROVOL_API_URL and debug paths) but tighten to `["http://127.0.0.1:*"]`
as defense-in-depth.

**M5. SSE endpoint sends `Access-Control-Allow-Credentials: true` with reflected origin.**
Not exploitable today (origin must be allow-listed) but drop the credentials header —
the stream uses none.

**M6. Docs drift.** UPGRADE_PLAN says 489/489 green (currently false until H1 fixed);
README still points at Railway as production while actual prod is Render
(kemos-research.onrender.com). Pick one canonical deploy doc.

### 🟢 LOW / hygiene

- 6 oxlint warnings (unused imports, spread nits) — trivial cleanup.
- `.kimchi`, `.opencode`, `.superpowers`, `.worktrees`, `.commandcode`, `screenshot.png`,
  `Trading_Reading_Plan.docx` clutter the root — most are gitignored; prune the rest.
- `vercel.json` SPA-only path invites confusion (documented, but consider deleting if Render is canonical).
- No Dockerfile HEALTHCHECK (platform healthcheck covers it on Render; nice-to-have locally).
- Open roadmap items from UPGRADE_PLAN Phase 3 remain: full chain SSE, early-close calendar, paid feeds interface.

### ✅ What is genuinely good (keep these patterns)

- **Fail-closed data philosophy** is consistently implemented end-to-end (no synthetic market data in LIVE mode; provenance chips).
- **Provider seam** (`DataProvider` / `LiveProvider` / chainMode routing) is clean and testable.
- **Shared-cache + warmer architecture** for free-tier APIs is well-designed: budget ledger per provider, month budgets, headroom, stale-on-error, single-flight.
- **Math core** (`black-scholes.ts`, `greeks.ts`, `ivSolver.ts`, `svi.ts`) properly documents units (θ/day, ν per vol point) and conventions (dealer GEX sign, 25Δ RR).
- **Tiered rate limiting** matched to provider scarcity; static assets exempted correctly.
- **Test breadth**: 107 files / 489 tests covering math, stores, views, and API modules; vitest config handles the React 19 `act` pitfall explicitly.
- **Security posture otherwise**: keys server-side only, zero `VITE_` secrets, endpoint allow-list on FMP proxy, SSRF-guarded MacroVol base URL, debug routes gated off by default, security headers on all responses, strict symbol validation everywhere.

---

## Part 2 — Master Plan

### Phase 0 — Emergency & hygiene *(this week, blocking everything)*

| # | Task | Files | Done when |
|---|------|-------|-----------|
| 0.1 | Rotate all 7 leaked keys on provider portals; re-enter via Render dashboard | external | old keys return 401 |
| 0.2 | Strip secret table from `render-work.md`; scrub history or privatize repo | `render-work.md`, git history | `git grep shmk_live $(git rev-list --all)` empty |
| 0.3 | Fix check-secrets.sh regex (literal assignments only) + self-test | `scripts/check-secrets.sh` | hook passes on server.js, blocks planted leak |
| 0.4 | Fix time-bomb test with computed future expiry | `src/lib/options/fmp.test.ts` | 489/489, CI green |
| 0.5 | Commit the 132 staged files in logical chunks; push; verify CI | index | master pushed, CI pass |

### Phase 1 — Quota & reliability *(week 2)*

1. **SSE through shared cache/budget**: `/api/stream/quote` reads the warmer-filled quote cache; `recordBudget('fmp')` on cold fills; hard per-symbol upstream floor (e.g. ≥60s between real ticks regardless of client count). Add an integration test asserting N clients ≠ N× upstream calls.
2. **Cache eviction**: LRU cap in `upstreamCache.js` (+ stats expose evictions).
3. **Data-source decision for chains**: evaluate FMP options vs Tradier vs status quo; document choice in `docs/engineering/`; keep fail-closed UX as-is.
4. **Ops**: set up the keep-alive cron (or upgrade plan); add `/api/health` detail flag for MacroVol/backtest liveness; document Render log workflow.
5. **Docs**: reconcile README (deploy target = Render), UPGRADE_PLAN metrics table, mark stale claims.

### Phase 2 — Performance *(week 3)*

1. Lazy-load plotly (`React.lazy` + Suspense in Greeks10View / IVSurfaceMacro) or replace with Recharts; remove `plotly.js-dist-min` from the main graph.
2. `manualChunks`: three/react-three, recharts, vendor-react split.
3. Measure: bundle analyzer before/after; budget in `src/config/perfBudget.ts` extended to assert initial JS < 1.5 MB gz in CI (fail build on regression).
4. Audit re-renders on PositioningView/Greeks10View (5 useEffects each) — memoize heavy derived grids if profiling shows >16ms paths (perf marks already exist).

### Phase 3 — Product completion *(weeks 4–6, from UPGRADE_PLAN leftovers)*

1. Full-chain SSE (chain diffs, not just spot) building on the fixed Phase-1 stream.
2. Early-close calendar (half days) in `usEquitySession`.
3. Paid-feed adapter slot (Polygon/OPRA/LiveVol) — seam exists (`StreamingDataProvider`, OPRA skeleton); wire when commercial decision lands.
4. yfinance `info` degradation (null fields on Render IP): switch Quote-tab enrichment order to FMP-first once key exists.

### Phase 4 — Scale & hardening *(ongoing)*

1. Persistence: swap in-memory cache for Redis (or SQLite WAL) when multi-instance becomes real; budget ledger must survive restarts before any paid tier.
2. Observability: structured logging (Fastify logger currently disabled), request IDs, error-rate metric per upstream; optional Sentry.
3. Dependency renovate groups currently auto-PR — add e2e smoke (playwright is already a devDep, unused in CI) for boot→Vol-desk→chain-load path.
4. Security re-audit after rotation: confirm no key material anywhere in repo/history; add `render-work.md`-style ops docs to a private store going forward (never in-repo).

### Success metrics

| Metric | Now | Target |
|--------|-----|--------|
| Leaked live keys in repo/history | 7 | 0 (rotated + scrubbed) |
| Test suite | 488/489 (red) | 489+/489+, CI green |
| Initial JS (raw) | ~6.7 MB | < 4 MB raw / < 1.5 MB gz |
| FMP calls/hour @ 1 open tab (SSE) | ~60, unbudgeted | ≤ 5, budgeted |
| Staged-but-uncommitted files | 132 | 0 |
| Options chain uptime on prod host | ~0% (yfinance 429) | decided source, >95% RTH |
