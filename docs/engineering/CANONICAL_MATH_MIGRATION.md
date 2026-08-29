# Canonical Math Migration — Equity & Trade → src/lib/math

**Status:** Canonical math migration completed for the recovered application. Legacy duplicate option-math modules listed below were deleted; active consumers use `src/lib/math` and explicit display adapters.

## Decision

One mathematical authority: `src/lib/math/*` (Black76 + spot adapter, raw Greeks, Brent IV, SVI/arb, funding/basis, positioning). Display adapters convert raw → desk units (θ/day, ν/vol-pt, ρ/bp, etc.) with branded types preventing x100/x365 slips.

## Migration map

| Legacy module | Canonical destination | Adapter | Consumers migrated | Remaining & reason |
|---|---|---|---|---|
| `src/lib/options/black-scholes.ts` (S-based BS) | `src/lib/math/black76.ts` + `spotBsm.ts` | Deleted after consumers migrated | All active consumers use canonical pricing and explicit adapters. |
| `src/lib/options/blackscholes.ts` (duplicate) | same | — | — | Deleted; no compatibility shim remains. |
| `src/lib/options/greeks.ts` (computeGreeks per day/vol-pt mix) | `src/lib/math/greeks.ts` (raw per-year/per-1-vol) + `units.ts` adapters | Deleted; display scaling is explicit at consumers | Active views use canonical raw Greeks and named display conversions. |
| `src/lib/options/ivSolver.ts` (legacy solver) | `src/lib/math/impliedVol.ts` | Deleted; active callers use discriminated `solveImpliedVol` results | No near-expiry proxy or guessed volatility remains. |
| `src/lib/options/svi.ts` (legacy SVI) | `src/lib/math/surface/svi.ts` + `surface/arbitrage.ts` | Deleted; active surface code uses canonical forward-coordinate functions | Observed and model masks remain separate; no SVI shim remains. |
| `src/lib/options/basis.ts`, `futuresMath.ts`, `premiumMath.ts` carry | `src/lib/math/carry/{funding,basis,forwardVol}.ts` | `src/lib/options/basis.ts` → `carry/basis.ts` adapters; `funding` via `toFundingSnapshot` | Carry desk (`CryptoCarryView`) already uses canonical `computeBasis`/`toFundingSnapshot`; Rates `CalendarPacksBoard` fixed level vs spread bug (no `implied_rate*100` substitute) | Legacy `premiumMath` OI-weighted calcs kept until positioning fully migrated |
| `src/lib/options/analytics.ts` dealer GEX/DEX | `src/lib/math/positioning/{exposure,signModels,levels}.ts` | `analytics.ts` now delegates missing-OI → null (fail-closed) and exposes `weightFallback` provenance; canonical `aggregateExposure` is truth for new code | Equity PositioningView now expects `null` OI ⇒ unavailable, volume/unit are scenario modes with badge | Analytics still owns `scanParityEdges`/`inventoryByExpiry` (portfolio helpers) — will move to `lib/analytics/*` after trade consolidation. |
| Python `macrovol-api/services/greeks_calculator.py`, `iv_calculator.py` | `src/lib/math/*` (Node is SAAS shell, Python private workers) | Node proxy (`server/routes/macrovol.js`) is thin, allowlisted, bounded; Python remains private compute for heavy yfinance-backed greeks/surface | Ownership: Greeks/backtest computed in Python only when yfinance heavy; Node normalizes Deribit via `server/providers/deribit/*` | Python duplicate BS/IV kept only as worker impl, not exposed as public HTTP authority beyond allowlist; Node canonical is display/provenance truth. |

## Unit locking

- Internal: rates/vols decimal, T = ACT/365F exact, raw theta per year, raw vega per 1.0 vol, raw rho per 1.0 rate, vanna per 1.0, charm per year.
- Display: `thetaPerDay = raw/365`, `vegaPerVolPoint = raw/100`, `rhoPerBp = raw/10000`, `vannaPerVolPoint = raw*0.01`, `charmPerDay = raw/365` via `units.ts` branded types. Mix-ups are type errors.
- Contracts: Deribit OI already in BTC/ETH units — no ×100; equity snapshots set `contractSize:100` explicitly, not defaulted silently (log when assumed).

## Remaining work

The deleted modules have no supported import path. Ongoing work may further split higher-level analytics, but all option pricing, Greeks, IV solving, and surface primitives must remain in `src/lib/math`; no compatibility shim or duplicate authority may be reintroduced.

Cross-check: `src/lib/options/{black-scholes,blackscholes,greeks,ivSolver,svi}.ts` are absent and the deletion map records them as deleted.
