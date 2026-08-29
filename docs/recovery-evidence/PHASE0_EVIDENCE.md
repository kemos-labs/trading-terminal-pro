# Phase 0 — Evidence, research, and capability inventory

Date: 2026-08-29 · Worktree: `/home/kalde/trading-terminal-pro-rebuild` · Branch: `codex/full-application-rebuild` · Rollback point: `e6753aeafb57369137d0afea6c5364bcb1b6fc3f`

## 1. Starting-state verification

- Owner checkout `/home/kalde/trading-terminal-pro` on `master` at `e6753ae`, working tree clean (`git status --porcelain` empty).
- Separate worktree created at `/home/kalde/trading-terminal-pro-rebuild` on `codex/full-application-rebuild` at `e6753ae`. All edits happen only in the worktree.
- Baseline gates at `e6753ae`: `npm run type-check` PASS · `npm run build` PASS (initial JS 137 kB gzip) · `npm test -- --run` 118 files / 618 tests PASS · `npm run lint` PASS.

## 2. Live route evidence (PORT=3199, real server, curl)

| Route | Status | Consumer |
|---|---|---|
| `GET /api/health` | 200 JSON | — |
| `GET /api/options/SPY` | **404** | `src/lib/options/yahoo.ts` (equity chain — Vol/Positioning/Trade) |
| `GET /api/yf/history/SPY` | **404** | `src/lib/data/yfinanceClient.ts` (history/RV) |
| `GET /api/yf/info/SPY` | **404** | `src/lib/data/yfinanceClient.ts` (profile/quote fallback) |
| `GET /api/desk/pack?symbol=SPY` | **404** | `src/lib/data/deskFeedsClient.ts` (Home strip, Academy news) |
| `GET /api/finnhub/news?symbol=SPY` | **404** | `src/lib/data/finnhubClient.ts` |
| `GET /api/venues/options/BTC` | **404** | `src/lib/data/deribitClient.ts` (venue summary) |
| `GET /docs/index.json?v=3` | **200 text/html (SPA fallback, not JSON)** | `src/components/views/AcademyView.tsx` — Academy cannot load |
| `GET /api/free-crypto/market/BTC` | 200 JSON | Crypto overview |
| `GET /api/deribit/market/BTC` | 200 JSON | Crypto desks |

Root cause: routes were deleted from `server/app.js` during decomposition (`git log -S` shows them alive at `64c90fa`/`166dd08` in `server.js`, gone after `5a6e8d0`). The registered handlers still exist in git history, including `fetch_options.py` / `fetch_yf.py` runners (files still on disk, working).

## 3. Frontend fetch map (canonical)

- Equity chain: `/api/options/:symbol` (404) → `fetchLiveSnapshot` → store.
- Equity enrichment: `/api/yf/history/:symbol`, `/api/yf/info/:symbol` (404), `/api/fmp/stable/*` (registered; **no FMP key** in `.env` → 503 typed fail-closed), `/api/flashalpha/*` (keyed).
- Home/Academy: `/api/desk/pack` (404), `/api/finnhub/news` (404), `/docs/index.json` (HTML).
- Crypto: `/api/deribit/market/:c`, `/api/deribit/instruments|trades|index|funding-history` (registered), `/api/free-crypto/market/:c` (registered), `/api/venues/options/:c` (404), `/api/deribit-market/*` legacy (registered).
- Rates/Macro: `/api/macrovol/*` → loopback FastAPI `macrovol-api` (Python, port 8765) — registered, allowlisted, schema-bounded.
- KSA: `/api/ksa/board|quote|session` — registered, server-only SAHMK key, shared warmer board.
- Auth/billing: registered, fail-closed invariants intact (Stripe RAW parser scoped, no Connect, no `payment_method_types`).

## 4. Credentials truth (names only, never values)

`.env` (server-only, gitignored, mode 600) defines: `FINNHUB_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `RAPIDAPI_KEY`, `RAPIDAPI_TV_HOST`, `MASSIVE_API_KEY`, `FLASHALPHA_API_KEY`, `SAHMK_API_KEY`. **No `FMP_API_KEY`** → FMP-proxied routes must fail closed with typed 503 (they do). **No Velo credential** → per master spec §6.1: do not block, keep Binance Futures + Bybit Linear public adapter labelled exactly as "Free multi-venue snapshot / Public exchange data; free alternative to Velo, not Velo-normalized". No account/trading/private endpoints anywhere (verified by route scan).

## 5. Git-history capability map (deleted valued capabilities)

Deletion commit `a5c9d6c` ("delete replica UI (15 crypto views, 3D surfaces, heatmaps)") + stub pass `0739565`:

| Capability | Old source (recover via `git show`) | Fate / new home |
|---|---|---|
| Greeks 3D surface (`@react-three/fiber` mesh, axes, ATM ridge, hover readout) | `5a6e8d0f:src/components/views/GreeksSurface3D.tsx`, `buildGreekSurfaceGeometry.ts`, `useGreekSurfaceGeometry.ts` | Restore as lazy 3D in **Vol · Greeks** with observed/model separation; WebGL engine loaded only on entry |
| IV 3D surface (Plotly) | `5a6e8d0f:src/components/macrovol/IVSurfaceMacro.tsx` (now a lazy `null` stub) | Restore in **Vol · Surface** + **Crypto · Volatility**, narrow GL3D distribution, observed matrix + separate model mesh |
| Canvas heatmap engine (diverging/sequential, missing mask) | `5a6e8d0f:src/components/views/CanvasHeatmap.tsx`, `ae9ffa6:src/components/charts/MatrixHeatmap.tsx` | One canonical heatmap engine in **Positioning** + **Crypto · Positioning**: spot-centered windows, pan/scope, tooltips, table fallback |
| Session GEX heatmap | `5a6e8d0f:src/components/views/SessionGexHeatmap.tsx` | Restore as session-change view in Positioning from stored observed snapshots |
| Dealer gradient / Greek profile tools | `DealerGradientPanel.tsx`, `DealerGreekProfiles.tsx` (still on disk, stub imports) | Fold into Positioning workflows with OI-proxy labelling |
| 13 Trade tool shells (Sim, Combo, Grid, OptionPnl, BreakEven, Straddle, Subjective, Backtest, Hedge, ΔFollow, Basis, Roll, Analyze) | `0141b61:src/components/desk/tools/*` | Not resurrected as 13 shells. Engines already live in `src/lib/options/*` (optionGrid, portfolio, pathSim, hedging, hedgeFlow, basis, breakEven, subjective). Three workflows (Structure / PnL / Hedge) must expose capability parity |

## 6. Product state per desk (code + vision baseline screenshots in this directory)

- **Home**: empty launchpad (grid of function codes) + huge empty region; store defaults `activeTab:'vol'`; boot modal gates chain-dependent desks and shows "API DOWN". Vision review confirms: no briefing content, unreadable subtitle contrast. → Rebuild as morning briefing per spec §5.1; root `/` opens Home.
- **Vol**: VolStructureView with Surface(2D matrix)/Smile/Term/Greeks(2D tables)/Fit; 3D deleted; `IVSurfaceMacro` lazy null stub. → Restore 3D + Greeks10 2D fallback retained.
- **Positioning**: 1295-line PositioningView (Book/Tools split) + CanvasHeatmap deleted; strike windows exist. → Rebuild on canonical heatmap engine.
- **Trade**: 3 workflows exist with testids; engines live; verify parity (grid, combo greeks, payoff/breakeven, hedge flow, roll/basis) and unavailable semantics.
- **Rates**: RatesPanel modes; SOFR chart titled "3 MONTH SOFR FUTURE · YIELD" with **hardcoded "Sep24→Dec30"**, `type="monotone"` (forbidden), duplicate axis labels (frame + axis), crowded labels. SERFF board resolves legs from data (`serff_board`) but chart must be bps/common-period with sign convention.
- **Crypto**: six workflows exist but each is 59–154 lines (mostly tables/prose); nested `VOLATERM` shell banner; Deribit authoritative; free Binance+Bybit panel independent. → Enrich primary visuals, merge into global shell.
- **KSA**: 651-line board with shared warmer, SAHMK server-only, breadth/value null-guards. → Polish grouping + freshness.
- **Academy**: `/docs/index.json` broken (HTML fallback); `api/academyCatalog.js` already has `academyIndexJson()` ready to serve; front-end fetches it. → Serve real JSON + static md from `/docs`.

## 7. Research notes (primary sources, applied)

- **CME 3M SOFR futures** (cmegroup.com education): price quotes = 100 − implied annualized compounded SOFR rate; contracts reference actual delivery quarters (SR3). Chart must therefore default to implied rate `100 − price`, offer Price mode, use discrete contract points with straight segments, never invent intermediate curvature.
- **CME SERFF** (inter-commodity spreads): SERFF = 1M SOFR (SR1) vs Fed Funds (ZQ) spread with documented ratio; other SR3-vs-ZQ spreads use different codes/ratios — legs must be resolved from the data contract, never guessed from the name. Y axis in bp on a common reference period; sign convention explained (secured vs unsecured funding).
- **Deribit public API** (docs.deribit.com): `public/get_instruments`, `public/get_book_summary_by_currency`, `public/get_trade_history_by_currency`, `public/ticker` — used server-side only; IV decimals normalized once; perp never treated as dated future; funding_8h annualization labelled.
- **Velo** (docs.velo.xyz): data API keys are subscription/trial entitlements; no credential present → integration rule §6.1.5 applies (free-exchange adapter preserved with exact label).
- **OpenAPI 3.1 / JSON Schema 2020-12** (spec.openapis.org): envelope + typed errors contract-driven; `additionalProperties:false`; request and serialized-response validation.
- **MCP** (modelcontextprotocol.io 2025-11-25): read-only tools with explicit input/output JSON Schemas, structured content, same broker/quota/cache as UI.
- **Accessibility**: WCAG 2A/2AA via @axe-core/playwright on all desks; canvas heatmaps get keyboard navigation + virtualized table fallback; charts distinguishable by dash/marker not color alone.

## 8. Language decision record (Rust gate)

Full Rust rewrite **rejected** (per master spec §3 and repo evidence): the app's failures are route/product regressions, not language performance; the security/auth/billing boundary (Fastify, Stripe, auth) and the canonical quant core (618 passing tests incl. Greeks/SVI/funding property tests) are verified TypeScript. **Rust entry gate**: committed benchmark proving ≥2× useful improvement under representative load + stable schema boundary + golden cross-language parity tests + owner approval. Until then no Rust directory is created (no unused Rust port).

Rates worker: Python `macrovol-api` retained (pandas/SciPy + validated FRED/NYFed/yfinance integrations, 6053 lines incl. tests); Node owns public schemas, caching, timeouts, auth. No public CORS surface; loopback-only.

## 9. Performance baseline

Initial JS 137.45 kB gzip (+101.66 kB recharts chunk lazy). Budgets: initial ≤250 kB ✓. 3D must be its own lazy chunk with documented analytical exception.

## 10. Vision review protocol

Model `deepseek/deepseek-v4-flash-vision-exp` (via commandcode provider) verified as independent screenshot reviewer: describes layout, text, colors, defects from PNGs without code access. Baseline defects recorded above. All rebuilt workflows will be re-captured at 1440×900/1280×800/1024×768/390×844 and re-reviewed.
