# Trading Terminal Pro — Upgrade Plan V2

**Status:** owner-review draft; planning only

**Research authority:** [`docs/research/DOMAIN_AND_BENCHMARKS.md`](research/DOMAIN_AND_BENCHMARKS.md)

**Decision boundary:** this document defines the target and execution sequence. It does not authorize `WO-01`; implementation begins only after owner approval.

## Executive decision

This is not a plan to polish every existing page. The current crypto desk is a collection of individually built pages and tool clones sharing inconsistent math and data semantics. The upgrade replaces that arrangement with one derivatives product, one mathematical core, one provider contract, six workflows, and one public Node backend.

The order is deliberate:

1. Close immediate security gaps and establish measured baselines.
2. Build and independently verify the mathematical core.
3. Normalize Deribit and provenance semantics through one server-owned adapter.
4. Introduce a new six-workflow crypto shell behind a feature flag.
5. Rebuild the owner's two most visible failures—Volatility and Positioning/heat maps—on the verified core.
6. Rebuild Flow, Carry, Overview, and Trade & Risk as linked workflows.
7. Delete the replicas, full Plotly/Three path, duplicate math, old routes, abandoned Rust port, and obsolete plan documents.

No view is allowed to define its own Greeks, IV, funding, basis, positioning sign, unit conversion, or missing-data fallback.

## Non-negotiable laws

- Live mode is fail-closed: no fabricated, copied, interpolated, or synthetic value may appear as market data.
- Observed, exchange-derived, locally derived, fitted/modelled, heuristic, stale, and unavailable values are distinct domain types and visible UI states.
- Secrets remain server-side in `.env`; no provider credential reaches source, docs, browser bundles, logs, commits, or PR text.
- Every commit runs `scripts/check-secrets.sh`; environment files stay gitignored and mode `600` where supported.
- Stripe remains operational SaaS billing: no Connect, no `payment_method_types`, and the raw webhook parser stays scoped to the Stripe webhook plugin.
- TypeScript remains strict with `noUncheckedIndexedAccess`; no `any` escape hatches.
- Tests are migrated or strengthened, never deleted to make a gate pass.
- The repository remains green between phases. No big-bang branch that becomes testable only at the end.
- Existing unrelated working-tree changes are preserved.

## Current measured baseline

| Area | Verified baseline | Consequence |
|---|---|---|
| Unit/integration tests | 302 suites, 553/553 tests passing | Preserve as a behavior safety net, but replace assertions that encode disproven math only after authority tests exist. |
| Test quality | Passes with substantial Recharts zero-size, React `act`, R3F DOM, and duplicate-Three warnings | “Green” must become warning-clean for touched suites; the current warning flood cannot remain a release gate. |
| Build | `tsc -b && vite build` succeeds | Use as every-phase gate. |
| Lint | Succeeds with 8 warnings | Phase 1 makes zero warnings the baseline. |
| Main server | `server.js` is 2,415 lines | Reduce to a bootstrap/composition root; behavior moves into plugins/routes/providers. |
| Main code hotspots | `PositioningView.tsx` 1,329 lines; `Greeks10View.tsx` 1,046; `OptionCalculatorView.tsx` 991; `BtcView.tsx` 928; `analytics.ts` 900 | No rebuilt feature component should own fetching, normalization, domain math, and rendering together. |
| Crypto navigation | 15 top-level entries plus 14 Thalex Lab tools | Replace with six decision workflows; tools become modes/panels or are removed. |
| Bundle | Plotly chunk 4.65 MB raw / 1.37 MB gzip; OrbitControls chunk 0.90 MB raw / 0.24 MB gzip; main app chunk 0.81 MB raw / 0.23 MB gzip; Recharts shared chunk about 0.10 MB gzip | Remove Plotly and Three/R3F from the target product; use Canvas2D and focused time-series rendering. |
| Rate limiting | Lockfile resolves `@fastify/rate-limit` 11.1.0 | Patch to 11.2.0 or later immediately because the locked version is affected by the IPv6 bucket-bypass advisory. |
| Proxy trust | Production can set Fastify `trustProxy: true` | Replace with explicit hop/IP/CIDR/custom validation. |
| SSE | Direct `reply.raw.write()` calls ignore backpressure | Replace with one bounded, multiplexed stream and slow-client handling. |
| Python services | Both are actively used/proxied; the “orphaned” receipt is inaccurate | Keep only justified Python computation as private workers. Remove duplicate option math and public sidecar semantics. |
| Rust | `server-rs/` has no active runtime integration and contains build output | Delete it after a final reference check. |

# A. Product definition

## What the product is

VOLATERM is a source-explicit derivatives decision terminal. It helps a user answer six questions:

1. What regime is the market in?
2. Where is volatility priced across tenor and strike?
3. Where are gross positions and scenario hedging sensitivities concentrated?
4. What actually traded, on which side, and with what confidence?
5. What carry is embedded in perpetual funding and dated-future basis?
6. What does a proposed position cost, risk, and do under scenarios?

It is not a gallery of cloned analytics products. It does not claim proprietary dealer inventory from public OI. It does not fill a blank panel merely to keep a layout busy.

## Curated crypto information architecture

The fifteen current crypto routes become six workflows:

| Workflow | Canonical contents | Existing routes folded into it | Explicit exclusions |
|---|---|---|---|
| **Overview** | Asset/venue/freshness strip; spot and forward state; ATM/DVOL/RV regime; term slope; funding/basis; OI/flow coverage; four linked decision callouts | `Overview`, the useful summary portions of `Levels`, `Tail Strike`, and `Scanner` | No full chain, no miniature duplicate of every page, no “dealer regime” without a named sign model. |
| **Volatility** | Actual-expiry ATM term; forward vol; DVOL vs ATM; IV/RV/VRP history; smile/skew; observed quote matrix; separately labelled fitted surface diagnostics | `Vol & Skew`, surface/smile/term portions of `Options`, `Tail Strike`, equity `TermView`, `SmileView`, and surface clones | No default 3D, no model-filled market cells, no one-number “vol regime” until validated on real history. |
| **Positioning** | OI by strike/expiry; signed and unsigned GEX/DEX/vanna/charm scenarios; exposure heat map; strike profile; expiry matrix; walls/flip/max-pain annotations; coverage and sign-model control | `Greek Heat`, `Levels`, `Open Interest`, positioning portions of `Scanner`, `SessionGexHeatmap`, `DealerGradientPanel`, `DealerGreekProfiles` | No silent OI→volume/unit fallback; no claim of observed dealer book. |
| **Flow** | Live trades; taker-side classification; premium by side/moneyness/expiry; premium matrix; block/RFQ where a real feed exists; source/confidence/coverage | `Options Flow`, flow portions of `Scanner` and legacy positioning | No fabricated blocks, no opening/closing inference without data, no volume-as-OI substitution. |
| **Carry** | Current funding by venue; native and simple-annualized rate; funding history; dated-future basis curve; simple/log carry toggle; actual-expiry table | `Fut Basis`, `Fut Term`, `Funding`, `PerpBasisBoard`, basis panels embedded in `BtcView` | Perpetual funding stays separate from dated maturity; no unlabeled “APR”; no synthetic missing expiry. |
| **Trade & Risk** | Chain; selected legs; strategy builder; premium/Greeks/P&L; spot-vol-time scenarios; hedge plan; validated historical/backtest analysis as a subordinate mode | `Options`, `Calculator`, `Backtest`, useful capabilities from the Thalex Lab and `src/components/desk/tools/` | No 14-card sub-app launcher; no tool with a private formula; unvalidated backtests remain unavailable. |

The shell keeps asset, venue, source mode, quote side, timestamp/freshness, and expiry selection global. Metric-specific controls remain next to the affected chart. URL state uses a stable form such as `?desk=crypto&view=positioning&asset=BTC&venue=deribit`; old `?crypto=&page=` links redirect for one compatibility release.

## Product-wide UI contract

Every analytical view must expose:

- source/venue and observation time;
- live/stale/partial/unavailable state and coverage percentage;
- native versus converted units;
- observed/derived/modelled/heuristic badge;
- formula or methodology link for non-obvious metrics;
- exact-value tooltips and a path to instrument/strike/expiry detail;
- an actionable empty state naming the missing prerequisite and retry path.

Desktop targets a dense 12-column workspace with a 220–240 px rail and compact 28–32 px controls. Tablet collapses the rail. Mobile becomes a workflow selector plus vertically ordered panels; it does not squeeze a desktop matrix into unreadable cells.

## What will not ship

- Separate top-level routes for Levels, Tail Strike, Scanner, three futures pages, Calculator, Lab, and Backtest.
- Multiple 3D volatility/Greeks surfaces.
- A Thalex-style external-tool gallery inside the terminal.
- Duplicate BTC/ETH page implementations; asset is state, not a component fork.
- Synthetic history/surfaces in live production paths.
- Proprietary-vendor labels for locally approximated calculations.

# B. Consolidation map

## R1–R10 resolution

| Receipt | Verified interpretation | Resolution and owner-visible outcome |
|---|---|---|
| **R1 — duplicate Black-Scholes** | `black-scholes.ts` and `blackscholes.ts` expose overlapping pricing with different surrounding utilities/units. | Replace both with `src/lib/math/black76.ts` plus explicit spot/venue adapters. One price/Greek convention powers every calculator and view. |
| **R2 — Deribit duplicated** | Inline `server.js` routes, `api/deribitMarketRoutes.js`, `deribitClient.ts`, `deribitFutures.ts`, and `options/deribit.ts` mix transport, normalization, and math. | One server provider owns Deribit HTTP/WS/cache/rate discipline; one browser client consumes normalized APIs; one domain normalizer preserves native fields. |
| **R3 — widget clones** | Multiple Greek surfaces, heat maps, carry boards, term views, and surface views exist. | One curve renderer, one rectangular heat-map renderer, one chain table, one positioning workspace, one carry workspace. Delete the old components after feature-flag parity. |
| **R4 — server monolith** | Confirmed 2,415 lines with routes, warming, proxying, auth, billing, SSE, static files, and config. | `server.js` becomes a small bootstrap. Route families, security, providers, streams, workers, and warming become scoped modules/plugins. |
| **R5 — bundle bloat** | Plotly and OrbitControls are isolated but enormous when opened. | Remove Plotly, Three, R3F, Drei, React Plotly, and their type shim from the target. Default analytical surfaces are 2D Canvas/curves. |
| **R6 — no math authority** | Unit conflicts, hard-coded Deribit rate, approximate near-expiry IV, incorrect SVI coordinate, insufficient arbitrage tests, and model-filled cells are confirmed. | Math phase precedes UI. Haug/QuantLib/Deribit/Gatheral fixtures and properties become merge-blocking. |
| **R7 — partial security** | Existing allowlists, key gating, scoped Stripe raw body, and some proxy tests are good; dependency, proxy trust, schemas, headers, SSE, logging, and reset flow need work. | Immediate security phase patches exploitable boundaries and creates a route-by-route policy inventory. |
| **R8 — dead weight** | Rust and obsolete plans are dead. Python services are active, so the original “two orphaned sidecars” statement is false. | Delete Rust and stale plan files. Keep Node as the only public backend; reduce Python to private, schema-bounded computation workers and remove duplicate Greeks/IV HTTP authority. |
| **R9 — tests under-used** | 553 tests pass but many assert replica presentation and emit warnings. | Preserve them during migration, add authority tests first, migrate view tests to workflow contracts, and require warning-clean touched suites. |
| **R10 — owner-visible quality** | Fifteen crypto routes, shallow clones, misleading fallbacks, and weak heat-map semantics match the owner's complaint. | Six linked workflows, decisive deletions, one visual/data grammar, and owner screenshot acceptance before legacy removal. |

## Canonical module map

| Current cluster | Canonical destination | Consumers | Old code removed after parity |
|---|---|---|---|
| `black-scholes.ts`, `blackscholes.ts`, `greeks.ts`, `ivSolver.ts` | `src/lib/math/{black76,greeks,impliedVol,units,result}.ts` | Volatility, Positioning, Trade & Risk, backtest worker fixtures | Both Black-Scholes files and legacy solver/Greek exports |
| `svi.ts`, `interpolate.ts`, `noarb.ts`, surface helpers | `src/lib/math/surface/{svi,calibrate,arbitrage,types}.ts` | Volatility observed/model panels only | Legacy surface fit/interpolation/no-arb modules |
| `basis.ts`, `futuresMath.ts`, funding calculations in server/views | `src/lib/math/carry/{funding,basis,forwardVol}.ts` | Overview, Carry, Trade & Risk | Duplicate data/options carry modules and view-local math |
| Dealer portions of `analytics.ts`, Python `greeks_calculator.py` | `src/lib/math/positioning/{exposure,signModels,levels}.ts` | Positioning and Overview | Dealer math in the mega-module and Python duplicate endpoints |
| Remaining `analytics.ts` | `src/lib/analytics/{volatility,flow,portfolio}.ts` | Feature selectors/view models | The 900-line `analytics.ts` file |
| Deribit inline/API/client/futures/normalizer paths | `server/providers/deribit/*`, `src/domain/market/adapters/deribit/*`, and a thin `src/api/deribit.ts` | All crypto workflows | Inline routes, `api/deribitMarketRoutes.js`, `deribitFutures.ts`, legacy `options/deribit.ts` |
| Three Greek/surface implementations | `src/features/crypto/volatility/*` using shared `CurveChart` and `MatrixHeatmap` | Volatility; reusable by equity Vol | Plotly/Three surface components and geometry hooks |
| Three heat-map implementations and dealer profile panels | `src/features/crypto/positioning/*` plus `src/components/charts/MatrixHeatmap.tsx` | Positioning | `SessionGexHeatmap`, `CanvasHeatmap`, `CryptoHeatmapView`, duplicate dealer panels |
| `PerpBasisBoard` and three futures pages | `src/features/crypto/carry/CryptoCarryView.tsx` | Carry and Overview summary | All four old carry views |
| Chain, calculator, crypto backtest, and desk tool sub-apps | `src/features/trade-risk/*` with shared engines/selectors | Crypto and equity adapters | Crypto calculator/backtest pages, Lab route, and old tool presentation directory |
| `terminalStore` hot/cold mix and broad subscriptions | `src/store/{shellStore,marketStore}.ts` plus feature-local stores/selectors | Shell and features | Whole-store subscriptions and obsolete snapshot/playback fields |

## Named deletion/retirement list

Deletion occurs only after the replacement is green and the owner-visible screenshot gate passes.

### Quantitative and data duplicates

- `src/lib/options/black-scholes.ts`
- `src/lib/options/blackscholes.ts`
- `src/lib/options/greeks.ts`
- `src/lib/options/ivSolver.ts`
- `src/lib/options/svi.ts`
- `src/lib/options/interpolate.ts`
- `src/lib/options/noarb.ts`
- `src/lib/options/basis.ts`
- `src/lib/options/analytics.ts`
- `src/lib/data/futuresMath.ts`
- `src/lib/data/premiumMath.ts`
- `src/lib/data/deribitFutures.ts`
- `src/lib/options/deribit.ts` after its parsing/normalization responsibilities move
- `src/lib/options/synthetic.ts` from production code; deterministic fixture builders move under `src/test/fixtures/`

Legacy tests are moved and rewritten against canonical modules; coverage is not discarded.

### Replica UI

- `src/components/views/GreeksSurface3D.tsx`
- `src/components/views/crypto/CryptoGreeksSurface.tsx`
- `src/components/views/crypto/CryptoSurface3D.tsx`
- `src/components/views/surface/SurfaceView.tsx`
- `src/components/views/buildGreekSurfaceGeometry.ts`
- `src/components/views/surfaceStrikeMapping.ts`
- `src/components/views/useGreekSurfaceGeometry.ts`
- `src/components/views/SessionGexHeatmap.tsx`
- `src/components/views/CanvasHeatmap.tsx`
- `src/components/views/CryptoHeatmapView.tsx`
- `src/components/views/DealerGradientPanel.tsx`
- `src/components/views/DealerGreekProfiles.tsx`
- `src/components/views/PerpBasisBoard.tsx`
- `src/components/views/crypto/FuturesBasisView.tsx`
- `src/components/views/crypto/FuturesTermStructureView.tsx`
- `src/components/views/crypto/FuturesFundingView.tsx`
- `src/components/views/CryptoLevelsView.tsx`
- `src/components/views/CryptoTailView.tsx`
- `src/components/views/CryptoScannerView.tsx`
- Current `CryptoDashboardView`, `CryptoVolSkewView`, `CryptoOiView`, `CryptoFlowView`, `CryptoOptionsView`, `BacktestCryptoView`, `crypto/OptionCalculatorView`, and `BtcView` after their replacements ship
- `src/components/desk/tools/` presentation components after their useful engines are moved into the three Trade & Risk modes
- `THALEX_LAB_TOOLS`, `THALEX_APP_SLUG`, the Lab route, and external preview-card assets/copy

### Dependencies and abandoned artifacts

- `plotly.js-dist-min`, `react-plotly.js`, `three`, `@react-three/fiber`, and `@react-three/drei`
- `src/plotly.d.ts`
- `server-rs/`, including checked local build artifacts
- Obsolete root documents `MASTER_PLAN.md`, `UPGRADE_PLAN.md`, `UPSCALE_PLAN.md`, `UI_UX_PLAN.md`, and `DATA_AUDIT.md` after any still-valid operational facts are moved to maintained docs
- The old Derivatives Monkey handoff is archived under `docs/archive/` after the V2 product acceptance; it is not a current specification

# C. Math core specification

## Target structure

```text
src/lib/math/
  units.ts                 branded units and conversion functions
  result.ts                discriminated success/failure results
  contracts.ts             instrument/model selection contracts
  black76.ts               canonical forward Black price
  spotBsm.ts               explicit spot adapter F=S*exp((r-q)T)
  greeks.ts                raw analytic Greeks
  impliedVol.ts            safeguarded inversion and diagnostics
  surface/
    svi.ts                 raw SVI evaluation only
    calibrate.ts           weighted calibration on forward log-moneyness
    arbitrage.ts           price-space and calendar checks
    types.ts               observed/model masks and fit diagnostics
  carry/
    forwardVol.ts
    funding.ts
    basis.ts
  positioning/
    exposure.ts
    signModels.ts
    levels.ts
  __tests__/
    haug.vectors.test.ts
    black.properties.test.ts
    impliedVol.properties.test.ts
    deribit.fixtures.test.ts
    surface.arbitrage.test.ts
    carry.vectors.test.ts
    positioning.units.test.ts
```

## Model authority and units

- Canonical price is discounted Black on a forward. Spot BSM is an adapter, not a second formula implementation.
- Deribit inverse BTC/ETH options use venue index, expiry forward, `R=ln(F/X)/T`, exact ACT/365F, coin premium, and a separately timestamped USD conversion.
- Rates, yields, and volatility are decimals. `T` is an exact year fraction. Prices retain native denomination.
- Raw core outputs: delta `∂V/∂S`; gamma `∂²V/∂S²`; theta per year; vega per raw `σ=1`; rho per raw `r=1`; vanna per raw vol; time-passage charm `-∂Δ/∂T` per year.
- Display adapters alone produce theta/day, vega/vol-point, rho/percentage-point or bp, vanna/vol-point, and charm/day. Names and branded types encode the scale.
- Contract multiplier and currency conversion are applied once. Deribit option OI already in underlying amount units must not receive an equity-style `100` multiplier.

## Required function contracts

`priceEuropean(input)` returns `{ price, model, nativeCurrency, diagnostics }` or a typed domain error.

`greeksEuropean(input)` returns raw Greeks only. Exchange-provided Greeks are stored separately as `exchangeGreeks`, never overwritten by local values.

`solveImpliedVol(input)` returns a discriminated union:

```ts
type IvResult =
  | { ok: true; sigma: DecimalVol; iterations: number; repricingError: QuotePrice; bracket: readonly [number, number] }
  | { ok: false; reason: 'invalid_input' | 'expired' | 'below_intrinsic' | 'above_upper_bound' | 'no_bracket' | 'non_convergent' | 'indeterminate' };
```

It checks exact model bounds, uses an adaptive bracket and safe Brent/bisection method, and accepts success only after repricing. There is no near-expiry proxy, fixed guessed volatility, or unreported clamp.

`fitSurface(observed)` returns a separate model surface with observed/model masks, forward source, calibration timestamp, weights, residuals, and constraint results. It never mutates or fills the observed quote grid.

`aggregateExposure(rows, signModel, shock)` requires OI/quantity, multiplier semantics, source time, Greek unit metadata, and an explicit sign model. Missing OI returns unavailable coverage, never a volume/unit fallback.

## Static-arbitrage rules

- Fit total variance `w=σ²T` against forward log-moneyness `k=ln(K/F)`.
- Quote admission rejects stale/crossed/invalid/domain-violating nodes.
- Calls must be non-negative, decreasing in strike, respect slope bounds, and be convex in strike.
- Calendar validation occurs at fixed forward log-moneyness; total variance/value cannot decrease with maturity under the declared interpolation.
- Raw SVI positivity constraints are not labelled “arbitrage-free.” A dense price-space test and appropriate SSVI/SVI conditions are required.
- Forward vol is null if `σ₂²T₂-σ₁²T₁ < 0`; it is never clamped into a plausible number.
- Model extrapolation may be displayed only in a dedicated model layer and never as a quote or executable value.

## Funding, basis, and positioning contracts

- Funding stores raw native interval rate, current premium, caps/damper metadata where supplied, direction, and timestamp. `rate8h*1095` is labelled `simpleAnnualizedRunRate`, not yield.
- Dated basis stores absolute, percentage, simple annualized, and log annualized values as separately named fields using exact ACT/365F.
- GEX per 1% move: `sign * gamma * underlyingQuantity * S² * 0.01`.
- DEX: `sign * delta * underlyingQuantity * S`.
- Vanna delta-notional per one vol point: `sign * vannaRaw * 0.01 * underlyingQuantity * S`.
- Charm delta-notional per elapsed calendar day: `sign * charmPassageRaw/365 * underlyingQuantity * S`.
- Positioning output is named `exposure proxy`; the sign model and coverage are mandatory UI fields.

## Authority vectors locked before UI work

| Test | Inputs | Expected |
|---|---|---:|
| Call price | `S=60, K=65, q=0, r=.08, T=.25, σ=.30` | `2.1334` |
| Put price | `S=100, K=95, q=.05, r=.10, T=.5, σ=.20` | `2.4648` |
| Call/put price | `S=K=19, q=r=.10, T=.75, σ=.28` | `1.7011` each |
| Call delta | `S=105, K=100, q=r=.10, T=.5, σ=.36` | `0.5946` |
| Put delta | same | `-0.3566` |
| Gamma | `S=55, K=60, q=0, r=.10, T=.75, σ=.30` | `0.0278` |
| Raw vega | same | `18.9358` |
| Put theta/year | `S=430, K=405, q=.05, r=.07, T=1/12, σ=.20` | `-31.1924` |
| Put theta/day | same | `-0.0855` |
| Raw call rho | `S=72, K=75, q=0, r=.09, T=1, σ=.19` | `38.7325` |

These rounded Haug/QuantLib vectors use publication-appropriate tolerance. Higher-precision fixtures come from an independent oracle. Required properties include parity, bounds, monotonicity, convexity, homogeneity, call/put gamma and vega equality, finite-difference Greeks, limiting behavior, IV round-trip, SVI price-space constraints, Deribit premium/OI unit normalization, and published funding examples.

# D. Security hardening plan

## Immediate priority order

| Priority | Current issue | Required change | Proof |
|---|---|---|---|
| P0 | `@fastify/rate-limit` 11.1.0 is below the IPv6-bypass fix | Upgrade lockfile to 11.2.0+; configure `ipv6Subnet`; test canonicalized IPv4/IPv6 buckets | Advisory regression test and dependency audit |
| P0 | Password reset tokens are logged for operator handoff | Stop logging tokens. Disable public reset issuance until a real mail delivery exists; keep an audited offline admin reset command meanwhile | Log-capture test proves token/cookie/authorization absence |
| P0 | Production can trust all forwarded headers | Configure exact ingress hop/IP/CIDR or custom trust function; origin is not directly reachable in production | Spoofed XFF/host/proto integration tests |
| P0 | SSE ignores write backpressure | Await `drain`, cap clients/queued bytes, heartbeat, idle/max-age close, cleanup on disconnect/shutdown | Slow-client load test with bounded memory |
| P1 | Manual partial headers and no centralized CSP | Add Fastify-compatible Helmet; explicit CSP, Referrer/Permissions policies; HSTS at TLS edge | Header snapshots for HTML/API/webhook |
| P1 | No systematic route schemas/response allowlists | Add JSON Schema for params/query/body/response with bounds and `additionalProperties:false` | Route inventory reports 100% policy/schema status |
| P1 | `logger:false` removes useful structured security telemetry | Enable Pino with redaction for cookie, authorization, provider headers, tokens, secrets, and sensitive bodies | Redaction tests and sampled structured logs |
| P1 | JSON-file auth/session state is single-process and sync scrypt blocks the event loop | Introduce auth storage interface; async password hashing; SQLite for explicitly single-node local mode, production database/session store before horizontal scaling | concurrency, restart, revocation, timing, and migration tests |

## Server boundary requirements

- `Fastify({ bodyLimit, connectionTimeout, requestTimeout, keepAliveTimeout, trustProxy })` receives explicit environment-specific values. Long backtest jobs are asynchronous jobs, not 120-second request handlers.
- Every provider uses a fixed origin, encoded allowlisted path/parameters, `redirect:'error'`, abort timeout, content-type check, response-size cap, JSON shape validation, and sanitized public errors.
- Strip inbound `authorization`, cookies, provider-key headers, hop-by-hop headers, and forwarded headers before an upstream call. Inject provider keys only inside the server adapter.
- The browser calls only same-origin normalized APIs. Provider credentials are checked out of `dist/` as part of release validation.
- Route inventory classifies public, authenticated, entitled, administrative, webhook, health, and static routes. Default classification is deny/unregistered.
- Health endpoints expose component status and age without revealing which keys or secrets are configured.

## Authentication and billing

- Use `@fastify/cookie` or an equally audited parser; production cookie becomes `__Host-vt_session`, `Path=/`, `HttpOnly`, `Secure`, explicit `SameSite=Lax`, no `Domain`.
- Validate Origin/Referer on state-changing cookie-authenticated requests; add CSRF tokens if any cross-site flow requires weaker SameSite behavior.
- Rotate signing secrets with a key ring; revoke sessions after password change; expire and prune server-side sessions; make multi-instance storage explicit.
- Credential endpoints rate-limit by canonical IP before authentication and account identifier after safe normalization. Do not reveal account existence.
- Stripe invariants are regression tests: no Connect, no `payment_method_types`, signed webhook, raw parser scoped only to `/api/stripe/webhook`, replay/idempotency ordering, fail-closed missing key, entitlement response `private, no-store`.

## Dependency and secrets runbook

- Run `npm audit --omit=dev`, full `npm audit`, lockfile diff review, and direct advisory review for runtime dependencies each release.
- Run `pip-audit` for retained workers; pin hashes/versions through a reproducible lock strategy.
- Remove Rust dependencies with `server-rs/` rather than maintaining an unused audit surface.
- Run `scripts/check-secrets.sh`, scan built assets/source maps, confirm `.env` files are ignored, and verify file mode without printing their contents.
- Update dependencies in bounded batches with tests and bundle comparison; never blanket-upgrade the whole stack during a feature phase.

# E. Performance budget and rendering strategy

## Release budgets

| Metric | Target | Gate |
|---|---:|---|
| Initial application JS, total transferred | ≤ 250 kB gzip | Build manifest script fails over budget |
| Initial CSS | ≤ 35 kB gzip | Build manifest script |
| Any single final JS chunk | ≤ 180 kB gzip | No exception for chart libraries |
| First-open cumulative JS for an analytical workflow | ≤ 350 kB gzip | Playwright resource timing |
| Plotly/Three/R3F payload | 0 bytes in final target | Dependency/import/build scan |
| Desk switch to usable shell, warm cache | p75 ≤ 100 ms, p95 ≤ 200 ms | Browser performance marks |
| Quote update main-thread work | p95 ≤ 8 ms | Production-profile benchmark |
| Chain normalization + row model, 10k rows | p95 ≤ 12 ms | Node/browser benchmark fixture |
| Heat-map pan/hover | p95 frame ≤ 16.7 ms; no >50 ms long task | Playwright trace on reference grid |
| Max mounted option rows | ≤ 60 DOM rows | Virtualization assertion |
| Layout shift | CLS ≤ 0.10 | Lighthouse/Playwright |
| Mobile/desktop horizontal overflow | 0 px at required viewports | Playwright assertion |
| Stream lifecycle | 0 leaked listeners/timers after 20 workflow switches | automated lifecycle test |

## Chart decisions

- Recharts remains only for low-cardinality, low-frequency summary charts.
- Dense DVOL/RV/funding/basis history uses a local proof-of-concept between uPlot and Lightweight Charts; choose one after bundle, update, accessibility, and tooltip tests.
- Strike×expiry heat maps use one custom Canvas2D renderer with fixed/adaptive scale modes, device-pixel-ratio control, hit testing, keyboard/table fallback, missing-cell mask, and accessible legend.
- 3D is removed. Smile slices, term curves, and a 2D observed/model matrix communicate the data more precisely and eliminate two heavy render stacks.
- All chart packages are route-lazy. Shared shell and state modules must not import route charts.

## React and state

- Split slow shell/preferences/account state from hot market state. Feature-local filter state remains local or URL-backed.
- Normalize market records by instrument; update changed instruments rather than replacing whole chain objects.
- Components use atomic selectors or `useShallow` only where shallow equality is correct. Whole-store `useTerminalStore()` subscriptions in shell components are removed.
- Expensive analytics are pure selectors keyed by immutable snapshot identity and computed once per source update, outside render.
- Canvas/time-series adapters may use `subscribeWithSelector` plus `requestAnimationFrame`; ordinary DOM UI remains React-driven.
- React Compiler is not assumed. After state boundaries are correct, enable it incrementally for rebuilt leaf directories and compare production profiles before removing manual memoization.

## Data cadence

- One backend Deribit WebSocket/catalogue per product group fans out normalized updates.
- Quotes/tickers are coalesced to a visual cadence; trades remain event-driven; expensive surfaces/exposures recompute at a slower declared cadence or when material inputs change.
- Cache responses carry observed time, receive time, age, stale state, and source. Single-flight prevents duplicate provider refreshes.
- Browser tabs receive one multiplexed SSE stream where possible; hidden tabs reduce chart cadence without losing source timestamps.

# F. Target architecture

## Repository shape

```text
src/
  app/                         routing, feature flags, error boundaries
  domain/market/               instruments, quotes, provenance, snapshots
    adapters/deribit/          normalized Deribit domain mapping + fixtures
  lib/math/                    sole derivatives mathematical authority
  lib/analytics/               transparent higher-level pure analytics
  api/                         thin same-origin browser clients
  store/                       shellStore, marketStore, selectors
  components/charts/           CurveChart, TimeSeries, MatrixHeatmap, ChainTable
  features/crypto/
    shell/
    overview/
    volatility/
    positioning/
    flow/
    carry/
    trade-risk/

server/
  app.js                       Fastify construction and plugin composition
  config.js                    validated environment/config
  plugins/
    security.js
    observability.js
    cache.js
    auth.js
    billing.js
    static.js
  providers/
    deribit/
      client.js
      schemas.js
      normalize.js
      stream.js
    fmp/ finnhub/ ksa/ ...
  routes/
    health.js
    market.js
    macro.js
    backtest.js
  streams/marketDataHub.js
  workers/client.js

workers/
  macro-analytics/             private Python worker, no option-math authority
  backtest/                    private bounded job worker

server.js                      <80-line bootstrap
```

## Data flow

```text
Venue/provider
  → server provider adapter
  → runtime schema validation
  → native record + provenance
  → normalized SourceEnvelope
  → shared cache/stream hub
  → browser API client
  → normalized market store
  → canonical math/analytics selector
  → workflow view model
  → chart/table with source, unit, coverage, and freshness
```

The UI never imports provider response types directly into a chart. The math core never fetches. Provider adapters never render. A view cannot reach around the server adapter to call Deribit.

## Deribit target

- Server seeds `get_instruments`, maintains lifecycle, and uses one shared WS connection for whole-chain mark/ticker needs.
- Raw fields preserve bid/ask/mark/trade price and IV separately, OI amount units, contract metadata, current/projected funding, and source timestamps.
- Sequence gaps cause resnapshot. `10028` causes single-flight jittered backoff, not browser retry storms.
- REST snapshots remain a bootstrap/fallback, not per-browser fan-out.
- Frontend `src/api/deribit.ts` knows only normalized same-origin response schemas.

## Python and Rust decision

`macrovol-api` is active, not dead. It currently supplies rates/macro/provider orchestration and duplicates some option math. During migration:

- Remove `/api/greeks/*`, `/api/surface/*`, `services/greeks_calculator.py`, and `services/iv_calculator.py` after the TypeScript math core and clients are verified.
- Move provider retrieval and light transformations to Node when doing so removes an HTTP hop without losing a tested scientific dependency.
- Retain correlations/rates computations that materially use pandas/SciPy as a loopback-only worker if benchmarked value remains. It has no public CORS/auth surface and returns a schema validated by Node.

`crypto-backtest-api` is also active and uses numpy/pandas/pyarrow for vectorized and Parquet work. Its justified end state is a private job worker, not a second public backend:

- split transport from a deterministic engine;
- Node validates jobs, caps parameters/concurrency/runtime/output, assigns IDs, and serves status/results;
- worker has no direct internet-facing listener or credentials it does not need;
- add deterministic fixtures, fee/slippage/data-version metadata, and cancellation.

`server-rs/` has no justified runtime role and is deleted. The target has one public Node/Fastify backend; Python exists only behind its controlled worker boundary.

# G. Phased milestones

## Worker-tier policy

- **Strongest available:** quantitative specification/review, security threat review, architecture boundaries, final visual/product review.
- **Mid-tier:** scoped feature/server implementation from exact contracts, integration tests, chart adapters.
- **Free/low-cost:** inventories, import maps, codemods, schema coverage reports, fixture transcription, screenshot matrices, bundle reports, dead-reference verification.

Cheap workers never decide formulas, security policy, product IA, or whether a failing test is obsolete. Each phase has one integration owner; parallel workers receive non-overlapping file scopes.

## Phase 1 — Safety and trustworthy baseline

**Goal:** stop known security risks, make the baseline measurable, and avoid changing product behavior.

**Scope:** rate-limit upgrade; explicit proxy trust; remove reset-token logging/disable incomplete public reset flow; structured redacted logging; server time/body/header limits; Helmet/CSP baseline; endpoint policy inventory; zero lint warnings; baseline bundle/test scripts.

**Estimated touch:** 15–25 files.

**Worker mix:** strongest security reviewer; mid-tier implementer; free-tier route/dependency inventory.

**Exit gates:** build, 553+ tests, lint zero warnings, secrets scan, `npm audit --omit=dev` reviewed, spoofed-proxy/IPv6/reset-log/header tests, Stripe invariant tests, unchanged owner screenshots.

**Rollback:** one isolated security commit per concern; dependency lock rollback only if advisory-safe replacement exists. Stripe/Auth behavior changes remain independently revertible.

## Phase 2 — Canonical math core, tests first

**Goal:** establish a single verified source for price, Greeks, IV, surfaces, funding, basis, and exposure units before any UI consumes it.

**Scope:** create `src/lib/math`; commit authority fixtures/property tests first; implement core; add compatibility adapters; shadow-compare legacy/new outputs; remove near-expiry guessed IV and disproven no-arb labels from new paths.

**Estimated touch:** 30–45 files.

**Worker mix:** strongest quant lead and independent quant reviewer; mid-tier test implementer; free-tier fixture transcription/import census.

**Exit gates:** all Haug/QuantLib vectors, finite differences, IV repricing/round-trip, parity/bounds/convexity, SVI price-space/calendar properties, Deribit/funding/OI fixtures; zero unexplained shadow deltas; build/lint/secrets/full test suite.

**Rollback:** legacy adapters remain available behind a development-only comparison flag; no view switches until the core is accepted.

## Phase 3 — Provenance model and one Deribit adapter

**Goal:** make every value's venue, unit, side, timestamp, and derivation unambiguous.

**Scope:** domain types; `SourceEnvelope`; instrument metadata; one server Deribit provider; catalogue cache; WS lifecycle/gap recovery; normalized response schemas; one browser client; stale/partial/error contracts; move synthetic builders to tests.

**Estimated touch:** 25–40 files.

**Worker mix:** strongest provider-contract reviewer; mid-tier server/client implementers; free-tier endpoint fixture capture and import migration.

**Exit gates:** contract tests against recorded raw fixtures; bid/ask/mark/trade separation; OI and multiplier tests; rate-limit/backoff/gap-recovery tests; no direct browser Deribit calls; old/new snapshot shadow comparison; full gates.

**Rollback:** `DERIBIT_ADAPTER_V2` feature flag and side-by-side metrics; old adapter remains read-only until two stable phases pass.

## Phase 4 — V2 shell and workflow skeleton

**Goal:** replace route noise with the six-workflow product without yet deleting legacy screens.

**Scope:** new `features/crypto` shell; URL state; global source/freshness/coverage controls; common loading/empty/error states; Overview skeleton; old-link redirects; accessibility and responsive frame.

**Estimated touch:** 20–30 files.

**Worker mix:** strongest product/visual lead; mid-tier React implementer; free-tier URL/viewport/screenshot matrix.

**Exit gates:** `CRYPTO_V2` off preserves old behavior; on exposes exactly six workflows; keyboard/focus/ARIA smoke; 0 px overflow at 1440×900, 1280×800, 1024×768, 390×844; owner shell screenshots; full gates.

**Rollback:** one feature flag switches to legacy crypto desk; no old route/component deletion.

## Phase 5 — Volatility rebuilt

**Goal:** replace the disliked Vol & Greeks experience with a coherent volatility workstation built on observed data and verified math.

**Scope:** actual ATM/forward term, DVOL/ATM/RV/VRP history, smile/skew, observed quote matrix, model diagnostics as an opt-in layer, methodology/coverage, time-series renderer proof and selection.

**Estimated touch:** 20–35 files.

**Worker mix:** strongest quant/product reviewers; mid-tier feature/chart implementers; free-tier fixture and visual regression work.

**Exit gates:** no model value labelled observed; invalid forward variance yields unavailable; mark/executable selector semantics tested; local and venue Greeks reconciliation displayed correctly; performance budgets; owner desktop/mobile screenshots; full gates.

**Rollback:** workflow-level feature flag returns only Volatility to legacy while V2 shell remains.

## Phase 6 — Positioning and Flow rebuilt

**Goal:** replace flat/misleading heat maps and dealer claims with an auditable exposure/flow workstation.

**Scope:** Canvas matrix renderer; OI/unsigned/signed exposure modes; explicit sign models; GEX/DEX/vanna/charm shock units; strike/expiry profiles; levels as annotations; live tape/premium matrix; coverage and confidence.

**Estimated touch:** 25–40 files.

**Worker mix:** strongest quant and visual reviewers; mid-tier Canvas/feature implementers; free-tier accessibility/table fallback and scale fixtures.

**Exit gates:** missing OI produces unavailable, not fallback; null differs from zero; fixed/symmetric color-domain tests; exact tooltip/unit tests; 60-fps reference-grid interaction target; flow never claims opening/closing without data; owner screenshots; full gates.

**Rollback:** Positioning and Flow have independent flags; old pages stay untouched until acceptance.

## Phase 7 — Carry, Overview, and Trade & Risk rebuilt

**Goal:** finish the six workflows and eliminate sub-app behavior at the product level.

**Scope:** one Carry view; source-linked Overview; shared chain/leg selector; strategy/P&L/hedge modes; canonical calculator; Node-owned asynchronous backtest jobs; remove Lab navigation from V2.

**Estimated touch:** 30–50 files across client/server/worker.

**Worker mix:** strongest quant/backtest reviewer; mid-tier React/server/Python implementers with separate scopes; free-tier tool-capability matrix and fixture reports.

**Exit gates:** simple/log basis labels; funding native/annualized distinction; deterministic strategy vectors; fees/slippage/data-version in backtest results; resource/cancellation tests; no 14-card launcher; owner workflow screenshots; full Node and touched-worker test suites.

**Rollback:** feature flags per workflow; backtest worker is additive and job API can be disabled without affecting market views.

## Phase 8 — Server decomposition and worker containment

**Goal:** reduce the monolith without changing the now-accepted API contract.

**Scope:** create `server/` tree; move config/security/cache/providers/routes/streams/warmers; make `server.js` bootstrap-only; contain Python workers; remove duplicate Python Greeks/surface endpoints; add operational metrics and graceful shutdown.

**Estimated touch:** 35–55 files.

**Worker mix:** strongest architecture/security reviewer; mid-tier module migration workers by non-overlapping route family; free-tier route parity and dependency graph checks.

**Exit gates:** route manifest identical or intentionally versioned; Node is sole public listener; worker origins loopback/private; graceful shutdown and SSE cleanup; schema coverage 100%; integration tests for auth/billing/market/macro/backtest/static; full gates.

**Rollback:** migrate one plugin/route family per commit; bootstrap can temporarily register legacy modules for any not-yet-moved family.

## Phase 9 — Deletion, bundle, and state cleanup

**Goal:** realize the consolidation rather than leaving V2 beside every clone.

**Scope:** execute named deletion list; remove Plotly/Three dependencies; remove old crypto routes and tool launcher; split stores/selectors; delete Rust and obsolete root plans; archive historical handoff; remove compatibility adapters after two stable phases.

**Estimated touch:** 50–90 files, mostly deletions/import/test migrations.

**Worker mix:** strongest integration owner; mid-tier codemod/test migration; free-tier unused-export/import/dependency and route-link scans.

**Exit gates:** no imports/references to deleted paths; exact six crypto workflows; no Plotly/Three in lockfile/build; bundle budgets; all tests migrated and green; no warning flood; two consecutive full green runs; owner regression screenshots.

**Rollback:** deletions are a dedicated commit after replacements are accepted; recovery uses the prior green commit, never destructive worktree reset.

## Phase 10 — Release hardening and owner acceptance

**Goal:** prove the rebuilt product under live-like conditions and document only the maintained system.

**Scope:** production-mode provider fixtures/live smoke, load/slow-client tests, accessibility, browser matrix, failure injection, security/dependency review, operational runbook, migration notes, final kill of flags after soak.

**Estimated touch:** 10–20 source/docs/test files.

**Worker mix:** strongest final security/quant/product reviewers; mid-tier fix owner; free-tier evidence collection.

**Exit gates:** all verification doctrine items below; owner signs off six workflow screenshots and manual sanity checklist; no unresolved P0/P1 findings; rollback release artifact retained.

**Rollback:** retain the last accepted deployment artifact and data-compatible route version through the soak window; feature flags are removed only after owner acceptance.

# H. Verification doctrine

## Correctness is proven at four boundaries

### 1. Mathematical

- Independent golden vectors for price/Greeks.
- Property grids for parity, bounds, monotonicity, convexity, limiting behavior, finite differences, and IV round-trip.
- Static-arbitrage tests in price space and across maturity.
- Deribit fixtures covering inverse denomination, forward, exact expiry time, mark/bid/ask IV, exchange/local Greek distinction, OI units, and funding examples.
- Tolerances are declared per test; no snapshot-update command can silently bless changed math.

### 2. Data and server

- Recorded raw-provider fixtures validate schemas and normalization.
- Contract tests assert provenance, native unit, timestamp, stale/partial state, and error reason.
- Failure injection covers timeout, malformed JSON, oversized response, unsupported content type, redirect, 429/`10028`, connection gap, worker crash, cache stale, and missing credential.
- Security tests cover origin/CORS, proxy spoofing, IPv6 rate-limit identity, auth enumeration/timing, session/cookie flags, CSRF boundary, secret/log redaction, Stripe signature/replay/raw-body scope, path traversal, and entitlement caching.

### 3. Product and visual

- Playwright screenshots for every workflow at 1440×900 and 390×844; shell/heat-map/chain also at 1280×800 and 1024×768.
- Automated checks: zero horizontal overflow, no clipped controls, no duplicate page bars, visible source/freshness/coverage, tooltip exact values, keyboard navigation, focus visibility, and accessible table fallback for Canvas.
- Failure-state screenshots for loading, stale, partial, no OI, no executable quote, provider down, and model-calibration failure.
- Owner comparison is against the V2 product definition and research principles, not pixel mimicry of a vendor.

### 4. Performance and operations

- Build manifest enforces gzip budgets and banned imports.
- Production browser traces measure initial workflow loads, quote-update commits, heat-map frames, memory, listeners, and timers.
- Load tests include normal and deliberately slow SSE clients, multiple tabs, provider reconnect, and backtest concurrency.
- Structured logs/metrics expose provider latency/errors, cache hit/stale rates, WS reconnect/gap counts, SSE clients/queued bytes/drops, auth failures, rate-limit blocks, and worker job durations without sensitive values.

## Gate command set

Every phase runs, at minimum:

```bash
npm run type-check
npm run build
npm test -- --run
npm run lint
scripts/check-secrets.sh
```

When relevant:

```bash
python3 -m pytest macrovol-api/services
python3 -m pytest workers
npm audit --omit=dev
pip-audit
```

The executor also runs the phase-specific Playwright, bundle, load, and fixture gates. A command passing with new unreviewed warnings is not a clean pass.

## Manual owner sanity checklist

- Can I explain every headline metric's source, time, unit, and construction in one click?
- Does Volatility distinguish DVOL, ATM, forward vol, RV, observed quotes, and model output?
- Does Positioning state that it is a proxy, show the sign model, refuse missing OI, and explain the shock unit?
- Does the heat map reveal exact values, zero, missing cells, spot/forward, scale transform, and coverage without visual distortion?
- Does Flow distinguish trade direction from opening/closing or dealer identity?
- Does Carry distinguish perpetual funding, dated basis, and simple versus log annualization?
- Does Trade & Risk use the same price/Greek units as every other workflow?
- Are there only six coherent crypto workflows, with no hidden gallery of replicas?
- When a feed or model fails, does the terminal say so instead of inventing a normal-looking answer?
- Does the terminal feel faster and quieter than the old app on both desktop and mobile?

## Evidence packet required from each phase

- commit/diff scope and preserved unrelated changes;
- commands and exit codes;
- test counts and any intentional test migration rationale;
- authority/fixture results for math or data changes;
- bundle/performance before-and-after for client changes;
- security evidence for server/auth/provider changes;
- Playwright screenshots and overflow/accessibility results for UI changes;
- known limitations, rollback point, and explicit PASS/FAIL.

## Approval boundary

After owner approval, the next response may emit `WO-01` for Phase 1 only. No later work order is issued until the preceding one reports PASS with evidence. Ambiguity about formulas, destructive scope, secrets, Stripe behavior, data fabrication, or product deletion is a stop condition and returns to the owner.
