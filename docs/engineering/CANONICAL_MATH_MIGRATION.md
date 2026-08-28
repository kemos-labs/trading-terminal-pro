# Canonical Math Migration — Equity & Trade → src/lib/math

**Status:** Phase A (crypto) already on `src/lib/math`; Phase B (equity/trade) in progress — adapters in place, raw units locked.

## Decision

One mathematical authority: `src/lib/math/*` (Black76 + spot adapter, raw Greeks, Brent IV, SVI/arb, funding/basis, positioning). Display adapters convert raw → desk units (θ/day, ν/vol-pt, ρ/bp, etc.) with branded types preventing x100/x365 slips.

## Migration map

| Legacy module | Canonical destination | Adapter | Consumers migrated | Remaining & reason |
|---|---|---|---|---|
| `src/lib/options/black-scholes.ts` (S-based BS) | `src/lib/math/black76.ts` + `spotBsm.ts` (F=S·exp((r-q)T) adapter) | `src/lib/options/black-scholes.ts` now re-exports canonical via `priceEuropeanSpot` shim (kept for compatibility) | `yahoo.ts` now uses `solveImpliedVol` via canonical for new code; legacy `blackScholes` kept shim until portfolio/hedging fully switched | `portfolio.ts`, `hedging.ts`, `pathSim.ts` still import `black-scholes.ts` shim — migrate after trade workflows consolidate their shared engine (next slice). Documented, not deleted. |
| `src/lib/options/blackscholes.ts` (duplicate) | same | — | — | Duplicate file kept as shim re-exporting `black-scholes.ts` → canonical; delete after consumers moved (tracked). |
| `src/lib/options/greeks.ts` (computeGreeks per day/vol-pt mix) | `src/lib/math/greeks.ts` (raw per-year/per-1-vol) + `units.ts` adapters | `src/lib/options/greeks.ts` now wraps `greeksEuropean` + `thetaPerDay/vegaPerVolPoint` etc. Raw stays in math, display scaled in wrapper | `yahoo.ts` build path uses wrapper (`computeGreeks` per-day) — correct for chain build; positioning uses canonical directly for raw exposure math | Keep wrapper until positioning/analytics fully use canonical `aggregateExposure` for all desks. |
| `src/lib/options/ivSolver.ts` (Newton/bisect with sub-hour proxy) | `src/lib/math/impliedVol.ts` (Brent/bisect, discriminated failures, no proxy) | `src/lib/options/ivSolver.ts` delegates to `solveImpliedVol` and maps `IvResult` → `number|null` for legacy callers | New code should call `solveImpliedVol` directly for provenance | Sub-hour proxy removed from canonical; legacy solver kept shim with deprecation note. |
| `src/lib/options/svi.ts` (raw SVI w/ Gatheral, k=ln(K/spot)) | `src/lib/math/surface/svi.ts` + `surface/arbitrage.ts` | `src/lib/options/svi.ts` re-exports canonical `svi`/`sviIv` and `fitSVI` shim | `yahoo.ts` smoothWings now records `modelIv` separately and never overwrites observed `iv` without provenance | `yahoo.ts` still uses `fitSVI` shim; migrate to `surface/calibrate.ts` with explicit `k=ln(K/F)` and masks after observed/model layer split. |
| `src/lib/options/basis.ts`, `futuresMath.ts`, `premiumMath.ts` carry | `src/lib/math/carry/{funding,basis,forwardVol}.ts` | `src/lib/options/basis.ts` → `carry/basis.ts` adapters; `funding` via `toFundingSnapshot` | Carry desk (`CryptoCarryView`) already uses canonical `computeBasis`/`toFundingSnapshot`; Rates `CalendarPacksBoard` fixed level vs spread bug (no `implied_rate*100` substitute) | Legacy `premiumMath` OI-weighted calcs kept until positioning fully migrated |
| `src/lib/options/analytics.ts` dealer GEX/DEX | `src/lib/math/positioning/{exposure,signModels,levels}.ts` | `analytics.ts` now delegates missing-OI → null (fail-closed) and exposes `weightFallback` provenance; canonical `aggregateExposure` is truth for new code | Equity PositioningView now expects `null` OI ⇒ unavailable, volume/unit are scenario modes with badge | Analytics still owns `scanParityEdges`/`inventoryByExpiry` (portfolio helpers) — will move to `lib/analytics/*` after trade consolidation. |
| Python `macrovol-api/services/greeks_calculator.py`, `iv_calculator.py` | `src/lib/math/*` (Node is SAAS shell, Python private workers) | Node proxy (`server/routes/macrovol.js`) is thin, allowlisted, bounded; Python remains private compute for heavy yfinance-backed greeks/surface | Ownership: Greeks/backtest computed in Python only when yfinance heavy; Node normalizes Deribit via `server/providers/deribit/*` | Python duplicate BS/IV kept only as worker impl, not exposed as public HTTP authority beyond allowlist; Node canonical is display/provenance truth. |

## Unit locking

- Internal: rates/vols decimal, T = ACT/365F exact, raw theta per year, raw vega per 1.0 vol, raw rho per 1.0 rate, vanna per 1.0, charm per year.
- Display: `thetaPerDay = raw/365`, `vegaPerVolPoint = raw/100`, `rhoPerBp = raw/10000`, `vannaPerVolPoint = raw*0.01`, `charmPerDay = raw/365` via `units.ts` branded types. Mix-ups are type errors.
- Contracts: Deribit OI already in BTC/ETH units — no ×100; equity snapshots set `contractSize:100` explicitly, not defaulted silently (log when assumed).

## Remaining legs

- Migrate `portfolio.ts`/`hedging.ts`/`pathSim.ts` pricing to `priceEuropeanSpot`/`greeksEuropean` with explicit adapters (trade engine consolidation is the vehicle).
- Move `analytics.ts` mega-module's non-positioning parts to `src/lib/analytics/{volatility,flow,portfolio}.ts`.
- Delete `blackscholes.ts`/`black-scholes.ts` duplicates after last consumer migrates; keep shim with documented reason until then.
