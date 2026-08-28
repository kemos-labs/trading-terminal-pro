# Replica / Sub-App Deletion Map (Phase B)

**Principle:** fewer coherent workflows > replica sub-apps. Deletion only after replacement coverage exists.

## Consolidated workflows (keep)

- **Structure** (`trade-sub-structure`): Combo Greeks + Grid (Ω, Δ, 1/N(d2)) + Simulator (Scenario GBM) — one engine (`src/lib/math` + `greeksPnl`/`portfolio`), one control set (legs, strikes, expiry, vol). Replaces 4 mini-apps.
- **PnL / Scenario** (`trade-sub-pnl`): Option PnL + Combo PnL + Straddle + Break-Even + Subjective + Backtest (now labelled Scenario Monte Carlo) — shared `historyToSpotBars` vs `syntheticSpotPath` provenance, shared `greeksPnl` engine with `vegaNote` sticky-IV badge. Replaces 6 mini-apps.
- **Hedge / Risk** (`trade-sub-risk`): Hedging (threshold/tolerance/period) + Δ Follower + Basis + Roll — shared Δ-hedge engine (`hedging.ts` → canonical). Replaces 4 mini-apps.
- **Greeks** removed from Trade — lives on Vol · Greeks (single home).

Total: 14 mini-tools → 3 workflows (4 if validated historical backtest via `crypto-backtest-api` Binance klines is kept as separate Historical tab).

## Files retained (consolidated hosts)

- `src/components/views/DeskView.tsx` (host, now 3-workflow, suspsense-wrapped, legacy `SECTION_TO_TOOL` → consolidated mapping)
- `src/components/desk/tools/{ComboGreeksTool,GridTool,SimTool,OptionPnlTool,ComboPnlTool,StraddleTool,BreakEvenTool,SubjectiveTool,BacktestTool,HedgeTool,DFollowTool,BasisTool,RollTool}.tsx` — kept as engines, not top-level nav; rendered only inside consolidated workflows.

## Files to delete (after coverage, next slice)

- Legacy presentation wrappers that were top-level nav entries: `src/components/views/GreeksSurface3D.tsx`, `CryptoGreeksSurface.tsx`, `CryptoSurface3D.tsx`, `surface/SurfaceView.tsx`, `SessionGexHeatmap.tsx`, `CanvasHeatmap.tsx`, `CryptoHeatmapView.tsx`, `DealerGradientPanel.tsx`, `DealerGreekProfiles.tsx`, `PerpBasisBoard.tsx`, `FuturesBasisView.tsx`, `FuturesTermStructureView.tsx`, `FuturesFundingView.tsx`, `CryptoLevelsView.tsx`, `CryptoTailView.tsx`, `CryptoScannerView.tsx`, `BtcView.tsx` legacy forks — already deleted in Phase 8/9; remaining 14 tool files will have their *presentation shells* deleted once the 3-workflow engines have full test coverage (currently engines kept, nav deleted).
- Duplicate math: `src/lib/options/blackscholes.ts`, `black-scholes.ts` shims → delete after portfolio/hedging migrate to `src/lib/math` adapters (see migration map).
- Duplicate Python math: `macrovol-api/services/greeks_calculator.py` duplicate BS/IV → delegate to canonical `src/lib/math` for display truth; keep as private worker only.

## Tests

- Existing tests for the 14 tools kept (they now test engines inside workflows). No test deleted to make gates pass. New workflow-level kit tests will assert Structure/PnL/Hedge render with one engine, one control set, and correct provenance badges (Historical vs Scenario).

## Deletion gates

- Replacement workflow green (`npm test -- --run` 593 pass, `npm run build` pass, Playwright 29 pass, axe 0 violations for that workflow, no console errors, overflow 0, accessible table present).
- Owner screenshot acceptance for consolidated workflows.
- `git diff --check` clean.

## Already deleted (Phase 8/9, HEAD 0e2b798)

- 15 crypto views, 3D surfaces, heatmaps, `plotly.js-dist-min`, `three`, `@react-three/fiber/drei`, `src/plotly.d.ts`, `server-rs/`, obsolete plan MDs — see `UPGRADE_PLAN_V2.md` kill-list.
