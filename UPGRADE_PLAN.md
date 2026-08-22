# VOLATERM — Accuracy & Real-Time Upgrade Plan

Review date: 2026-07-09  
Scope: data pipeline accuracy, pricing/IV math, and live data freshness.

---

## Current Architecture (summary)

| Layer | Role | Notes |
|-------|------|--------|
| **DemoProvider** | Synthetic SVI surface | Fully offline; good UX fallback |
| **LiveProvider** | Spot (FMP) + chain (yfinance free / FMP paid) | Auto prefers yfinance chain |
| **yahoo.ts** | IV solve, arb filter, SVI wing smooth, snapshot build | Shared by both chain sources |
| **fmpClient + proxy** | Quotes, treasury, profile, news, history | Free-tier friendly with TTL cache |
| **Poll loop** | 5s live / 3s demo | Chain cache is 60s — most “ticks” are no-ops |

---

## Findings (accuracy)

### Critical
1. **ATM IV is wrong** — averages *all* call+put IVs on the slice instead of interpolating at spot. Corrupts term structure, header IV30, dashboard, skew metrics.
2. **Time to expiry is coarse & TZ-fragile** — integer calendar days via `new Date('YYYY-MM-DD')` (UTC midnight). Breaks 0DTE/weekly IVs and Greeks near the close.
3. **Hardcoded dividend yield (1.3%)** for every symbol — biases IV and put/call deltas for non-index names.
4. **Single short-rate RFR** (`year1`) for all tenors — long-dated IVs should use term-matched treasury interpolation.
5. **GEX put sign** — puts are added with the same sign as calls; dealer-style net GEX / flip is inverted or meaningless.
6. **Expected move** — uses first matching straddle in strike order, not the ATM straddle.

### High
7. **Greeks units** — raw BS θ (per year) and ν (per 100% vol) shown without market convention (θ/day, ν per 1 vol point).
8. **No bid–ask quality filter** — wide/empty markets still enter the surface.
9. **Yahoo chain fetcher** ignores `max` expiries arg; only first 8 expirations; slow `ticker.info` for spot.
10. **Live “history” scrubber** still synthetic even in live mode — IV rank/percentile are not real.

### Medium
11. **SPY Dist tab** uses seeded synthetic SPY/VIX, not market history.
12. **IV solver** Newton start fixed at 30% — slow/fragile for deep ITM/OTM; Brenner–Subrahmanyam seed helps.
13. **Provider has no data-quality metadata** on snapshots (spread, age, sources).

---

## Findings (real-time)

1. **Poll vs cache mismatch** — UI refreshes every 5s; option chain cached 60s (client + server). Spot FMP cache also 60s → false sense of live ticks.
2. **No market-hours awareness** — same poll rate nights/weekends; wastes quota and CPU.
3. **No staleness UI** — StatusBar shows `lastUpdate` but not chain age, source, or open/closed session.
4. **No streaming** — no WebSocket/SSE; everything is request/response.
5. **Vercel** cannot run yfinance — live chain only on Node/Docker.

---

## Phased Roadmap

### Phase 1 — Accuracy foundations *(this PR)*
- [x] Market time: fractional year fraction to 16:00 America/New_York expiry
- [x] Correct ATM IV (OTM wing interpolation at spot)
- [x] Bid–ask relative spread filter
- [x] Term-structure RFR from treasury curve
- [x] Dividend yield from profile / lastDiv when available
- [x] Greeks display convention: θ per day, ν per 1%
- [x] GEX put sign convention (dealer-style)
- [x] ATM straddle for expected move
- [x] Better IV initial guess
- [x] `fetch_options.py`: honor max expiries, faster spot

### Phase 2 — Real-time data quality *(this PR)*
- [x] Adaptive refresh (spot vs chain; open vs closed)
- [x] US equity session helper
- [x] Data provenance + staleness on StatusBar
- [x] Snapshot metadata (sources, timestamps)
- [x] SPY history: FMP real series when key present, synthetic fallback

### Phase 3 — Streaming & institutional depth *(implemented core)*
- [x] SSE spot tick channel (`/api/stream/quote/:symbol` + `useSpotStream`)
- [x] Live frame ring buffer (real snapshots for playback / IV rank)
- [x] Put–call parity forward + dividend yield from options
- [x] Per-tenor RFR inside IV solve (curve r(T) per expiry)
- [x] US equity holiday calendar for session gating
- [ ] Optional paid feeds (Polygon/OPRA, CBOE LiveVol) — interface-ready later
- [ ] Full chain SSE / quote-level exchange timestamps
- [ ] Early-close calendar (half days)

### Phase 4 — Thalex-inspired MM desk + BTC *(implemented · all 12+ tools)*
Inspired by [thalextech.github.io](https://thalextech.github.io/) crypto options toolkit.

**Pricing foundation:** Black–Scholes–Merton with continuous dividend `q` and rate `r`.
Implied vol = Newton + bisection invert of BS mid price (`ivSolver.ts`). Deribit
supplies exchange `mark_iv` directly (still BS-style for greeks).

| # | Thalex tool | VOLATERM | Model / data |
|---|-------------|----------|--------------|
| 1 | Simulator | **MM Desk → Simulator** | GBM paths · BS sticky-IV marks · **time decay** |
| 2 | Combo PnL | **MM Desk → Combo PnL** | Hist path · Δ/Γ/Θ attribution · BS |
| 3 | Straddle | **MM Desk → Straddle** | BE mode (K±prem) + hist PnL mode |
| 4 | Combo Greeks | **MM Desk → Combo Greeks** | Multi-leg profiles vs spot |
| 5 | Greeks | **Greeks tab** (desk deep-link) | Full surface greeks |
| 6 | Option PnL | **MM Desk → Option PnL** | Single-leg hist mark + greek PnL |
| 7 | Break Even | **MM Desk → Break-even** | BE + N(d2) from BS |
| 8 | Roll PnL | **MM Desk → Roll PnL** + BTC desk | Funding/r−q carry heatmap |
| 9 | Basis | **MM Desk → Basis** + BTC desk | F=S·e^{(r−q)T}; crypto q≈−funding |
| 10 | Subjective | **MM Desk → Subjective** | r_eff=μ+q · σ_subj=IV−VRP · BS |
| 11 | Delta Follower | **MM Desk → Δ Follower** | Tolerance-band hedge bot |
| 12 | Hedging | **MM Desk → Hedging** | Threshold / tolerance / period |
| 13 | Option Grid | **MM Desk → Option Grid** | Ω=Δ·S/V · 1/N(d2) |

**API routing (chainMode=auto):**
- SPY / equity / ETF → **yfinance** chain (fallback FMP paid) · spot FMP/yfinance
- BTC / ETH pure → **Deribit** public options + mark IV + **futures marks** + 8h funding
- IBIT / BITO / MSTR → equity chain (proxy) + crypto smile helpers on BTC desk

- [x] New **BTC** tab (`B`) — crypto desk: live spot, smile, GEX, term, funding, basis
- [x] New **MM Desk** tab (`M`) — all Thalex tools on any symbol + API badge
- [x] Portfolio / pathSim / hedging / subjective / optionGrid / basis / greeksPnl libs
- [x] BTC / ETH / IBIT / BITO / MSTR presets + crypto smile model
- [x] LiveProvider: Deribit primary for BTC/ETH; yfinance equity chains
- [x] Simulator time-decays residual T (theta); greek PnL attribution closes

### Phase 4b — Quant trust P0 *(this session)*
- [x] GEX legend sign matches SpotGamma (net+ = dampen)
- [x] 25Δ RR = put − call (equity desk convention) + labels
- [x] Chain-sum greeks labeled **inventory Σ**, not portfolio/book
- [x] Sticky-IV / path-source labels on Option & Combo PnL
- [x] Deribit **futures book** on market bundle → market basis curve

---

## Success metrics

| Metric | Before | Target |
|--------|--------|--------|
| ATM IV vs known BS surface | ± several vol pts (mean of all strikes) | < 0.1 vol pt vs ATM strike |
| 0DTE T residual after 16:00 ET | wrong day / UTC shift | small positive residual or filtered |
| Net GEX sign | both legs same sign | puts negative (dealer convention) |
| Live chain refresh under open | every 5s (mostly cache hits) | spot ~10–15s, chain ~45–60s |
| Closed session load | same as open | ~5 min chain, slow spot |

---

## Risk notes

- Changing ATM IV and GEX will change dashboard numbers vs prior demos — intentional.
- Greeks unit scaling changes displayed magnitudes; docs/glossary should match.
- FMP free tier: keep negative caching and longer closed-session intervals.

---

# VOLATERM — 2026-07 KSA desk wiring + build/test stabilization

Review date: this patch · Scope: full review + fixes to reach a green build and a complete KSA desk.

## Findings (code & logical review)

1. **`SAHMK_FREE_DAILY` was never defined.** `api/ksaFeeds.js` imported it from
   `api/upstreamCache.js`, which never exported it. `softCap()` returned `NaN`, so
   `canAffordBoardPack()` **always returned `false`** and the KSA board warmer was
   permanently dead (and strict ESM threw on import). **Fixed** by exporting
   `SAHMK_FREE_DAILY = 100` from `api/upstreamCache.js`.
2. **KSA API routes were orphaned.** Docs (`docs/engineering/KSA_DATA_PROVIDERS.md`)
   declared `/api/ksa/board`, `/quote/:symbol`, `/session`, but `server.js` registered
   none and `api/ksaFeeds.js` was never imported. The browser client (`ksaClient.ts`) hit
   404s and `KsaMarketView` was never mounted. **Fixed:** registered the routes
   (+ `/budget` ops) in `server.js`, rate-limit class, imported the module, and mounted
   `KsaMarketView` as a new **KSA** desk (tab **7**).
3. **Hotkey `6` (Academy) was a dead key.** `useKeyboardShortcuts` dispatched `tab6`
   but `TerminalLayout` never mapped it — the tab bar advertised `1`–`6` yet 6 did
   nothing. **Fixed:** mapped `tab6` → Academy, `tab7` → KSA.
4. **Production build was broken** (`tsc -b`) by type errors in the in-progress crypto
   Options/Backtest views. **Fixed** all `TS6133`/`TS2532`/`TS18048`/`TS2869`/`TS2339`
   errors (unused imports/params, `noUncheckedIndexedAccess` guards, missing
   `optimal_capital_knee` on the equity-curve type, missing `displayMode` arg to
   `useSurfaceGeo`).
5. **Test suite was red** — 3 files failing:
   - `api/ksaFeeds.test.js` (the `SAHMK_FREE_DAILY` bug above + it used `node:test`
     which vitest could not discover → converted to vitest).
   - `src/config/deskNav.test.ts` (stale after the crypto-sections refactor moved Thalex
     tools off the Crypto desk → updated to the current Lab/Options/Backtest/Market list).
   - `src/components/views/GreeksView.test.tsx` (flake under parallel load — lazy import
     exceeded the default 1s wait → bumped to the same 8s budget as its sibling tests).

## Outcome

- `npm test` → **489/489 passing**
- `npm run build` (`tsc -b && vite build`) → **green**
- `npm run lint` (oxlint) → warnings only
- KSA desk served **live Tadawul data** in verification (TASI 10827, NOMU, session open,
  budget 6/100). Fails closed (HTTP 503 `configured:false` / 429 `BUDGET`) without the key.

## How to verify

```bash
npm test && npm run build
PORT=3001 node server.js
curl -s localhost:3001/api/ksa/session      # Riyadh session
curl -s localhost:3001/api/ksa/board        # TASI/Nomu/movers/sectors
curl -s localhost:3001/api/ksa/quote/2222   # free-tier: from shared board only
```
