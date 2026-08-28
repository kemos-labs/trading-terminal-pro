# Replica / Sub-App Deletion Map (Phase B)

**Principle:** fewer coherent workflows > replica sub-apps. Deletion only after replacement coverage exists.

## Consolidated workflows (keep)

- **Structure** (`trade-sub-structure`): Combo Greeks + Grid (Ω, Δ, 1/N(d2)) + Simulator (Scenario GBM) — one engine (`src/lib/math` + `greeksPnl`/`portfolio`), one control set (legs, strikes, expiry, vol). Replaces 4 mini-apps.
- **PnL / Scenario** (`trade-sub-pnl`): Option PnL + Combo PnL + Straddle + Break-Even + Subjective + Backtest (now labelled Scenario Monte Carlo) — shared `historyToSpotBars` vs `syntheticSpotPath` provenance, shared `greeksPnl` engine with `vegaNote` sticky-IV badge. Replaces 6 mini-apps.
- **Hedge / Risk** (`trade-sub-risk`): Hedging (threshold/tolerance/period) + Δ Follower + Basis + Roll — shared Δ-hedge engine (`hedging.ts` → canonical). Replaces 4 mini-apps.
- **Greeks** removed from Trade — lives on Vol · Greeks (single home).

Total: 14 mini-tools → 3 workflows. Historical backtesting is intentionally unavailable until a provenance-backed implementation exists.

## Files retained (consolidated hosts)

- `src/components/views/DeskView.tsx` (host, now 3-workflow, suspsense-wrapped, `SECTION_TO_TOOL` maps every legacy `desk-ws-*` directly to `structure`|`pnl`|`risk`)
- `src/components/desk/workflows/{StructureWorkflow,PnlWorkflow,HedgeWorkflow}.tsx` — sole presentation shells; engines in `src/lib/options/*` and `src/lib/math/*`
- `src/components/desk/DeskToolShell.tsx`, `DeskField.tsx`, `DeskChart.tsx`, `PrintStrip.tsx`, `seriesGrammar.ts` — shared UI primitives

## Files deleted (this slice — engines preserved in src/lib)

- `src/components/desk/tools/{ComboGreeksTool,GridTool,SimTool,OptionPnlTool,ComboPnlTool,StraddleTool,BreakEvenTool,SubjectiveTool,BacktestTool,HedgeTool,DFollowTool,BasisTool,RollTool}.tsx` + `.test.tsx` — 26 files; presentation shells only, engines remain in `src/lib/options/{portfolio,optionGrid,pathSim,greeksPnl,breakEven,subjective,hedging,basis}.ts`
- `src/lib/options/black-scholes.ts`, `blackscholes.ts`, `greeks.ts`, `ivSolver.ts`, `svi.ts` — duplicate math; consumers migrated to `src/lib/math/{spotBsm,greeks,adapters,impliedVol,norm,surface/svi,surface/sviFit}`
- `src/lib/math/surface/{calibrate.ts,types.ts}` — dead placeholder `fitSurface`/`FittedSurface` (no consumers)
- Legacy presentation wrappers already deleted in Phase 8/9: `GreeksSurface3D.tsx`, `CryptoGreeksSurface.tsx`, `CryptoSurface3D.tsx`, `surface/SurfaceView.tsx`, `SessionGexHeatmap.tsx`, `CanvasHeatmap.tsx`, `CryptoHeatmapView.tsx`, `DealerGradientPanel.tsx`, `DealerGreekProfiles.tsx`, `PerpBasisBoard.tsx`, `FuturesBasisView.tsx`, `FuturesTermStructureView.tsx`, `FuturesFundingView.tsx`, `CryptoLevelsView.tsx`, `CryptoTailView.tsx`, `CryptoScannerView.tsx`, `BtcView.tsx` forks

## Tests

- Deleted 13 obsolete tool presentation tests (they asserted shell rendering, not engines). Engines remain covered by `src/lib/options/{portfolio,hedging,breakEven,subjective,pathSim,greeksPnl,synthetic}.test.ts`, `src/lib/math/__tests__/boundary.test.ts`, `haug.vectors.test.ts`, `black.properties.test.ts`, `svi.test.ts` (now via `math/surface/sviFit`), `greeks.{charm,units}.test.ts` (now via `math/adapters`).
- New `src/components/desk/workflows/workflows.test.tsx` asserts 3 canonical shells exist.

## Deletion gates (met)

- `npm test -- --run` 606 pass (128 files), `npm run type-check` pass, `npm run build` pass.
- Playwright whole-app gate to be re-run after items 1,5-9 (see FINAL recovery).
- `git diff --check` clean, `rg 'options/(black-scholes|blackscholes|greeks|ivSolver|svi)' src` finds only legit `greeksPnl` substrings.

## Already deleted (Phase 8/9, HEAD 0e2b798)

- 15 crypto views, 3D surfaces, heatmaps, `plotly.js-dist-min`, `three`, `@react-three/fiber/drei`, `src/plotly.d.ts`, `server-rs/`, obsolete plan MDs — see `UPGRADE_PLAN_V2.md` kill-list.
