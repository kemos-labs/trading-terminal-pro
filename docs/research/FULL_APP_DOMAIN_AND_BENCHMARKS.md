# FULL-APP DOMAIN AND BENCHMARKS — Non-Crypto Extension

**Extends:** `docs/research/DOMAIN_AND_BENCHMARKS.md` (crypto/shared core)
**Date:** 2026-08-28
**Scope:** equity options quotation, Black-Scholes/IV/Greeks units, SVI/arb, dealer positioning, SOFR/Treasury/STIR, Tadawul, backtesting, Home/shell, Academy, accessibility

Primary sources preferred. Each section records the correctness decision that follows for this terminal.

---

## 1. Equity option quotation, multipliers, executable semantics

**OCC symbology & contract terms**
- Standard US equity/ETF option = 100 shares, American exercise, PM settle under OCC. Spotted via OCC memos and Cboe/OPRA symbology: `AAPL  260116C00250000` ⇒ 100×. Contract multiplier is listed on the instrument record (Deribit crypto OI already in BTC/ETH units, not ×100). Mixing equity ×100 onto Deribit OI is a unit error — [Deribit book-summary units](https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency) and OPRA spec.
- Decision: every normalized quote carries `multiplier`, `nativeCurrency`, `underlyingUnits` (observed vs contracts×multiplier). GEX/DEX uses `Q = OI_underlying` directly; never apply ×100 to Deribit OI.

**Quote fields & provenance**
- Executable layers: `bid`/`ask` + `bidIV`/`askIV` (firm, size-limited), `last` + `lastIV` (historical print), `mark`+`markIV` (risk/reference, may sit outside spread per Deribit warning). Mid = `(bid+ask)/2` only when both sides positive and `ask ≥ bid`; otherwise mid is undefined, not `last` or one-sided. SPAN/OPRA feed mirrors this: one-sided quotes cannot be presented as executable mid.
- FMP/Yahoo feeds emit `bid`, `ask`, `last`, `volume`, `openInterest` per contract. Missing FMP `bid/ask/last/OI/volume` must be `null` (nullable per-field provenance), not `0`. `0` would be interpreted as a traded zero price / zero interest, corrupting IV and GEX.
- Decision: schema uses `bid: number|null`, `ask: number|null`, `last: number|null`, `openInterest: number|null`, `volume: number|null`, each with `provenance: 'observed'|'derived'|'model'|'unavailable'` and `timestamp`. Display shows `—` with badge `Unavailable` when null; never fabricate a mid.

**IV provenance**
- Three distinct IVs must not overwrite one field: observed `bidIV/askIV/markIV` from venue, `solvedIV` from inverting `mid` with per-tenor `r(T)` and parity-refined `q`, and `sviModelIV` from fitted surface. Quote row shows observed vs derived vs model layers with separate badges.

---

## 2. Black-Scholes / Black-76, IV bounds, Greeks units, SVI & price-space arb

**Model authority**
- Equity/ETF European ≈ Black-Scholes-Merton with continuous `q` or named discrete-div model. Option on forward/future = Black-76 (`F = S·exp((r−q)T)`, discounted by `df = exp(−rT)`). Deribit inverse uses venue forward `F` and `R=ln(F/X)/T` per spec. Spot adapter delegates to forward Black (single formula) — `F = S·exp((r−q)T)` — see `src/lib/math/spotBsm.ts`.

**Canonical units (internal decimal, raw math)**
- `T` = ACT/365F exact year fraction (crypto 24/7 divides by 365; equities use same calendar basis for pricing clock). Rates/vols decimal. Raw Greeks: `Δ=∂V/∂S`, `Γ=∂²V/∂S²`, `Θ/year=∂V/∂T`, `ν/raw=∂V/∂σ (Δσ=1.00)`, `ρ/raw=∂V/∂r (Δr=1.00)`, `vanna_raw=∂Δ/∂σ (per 1.00)`, `charm_raw=−∂Δ/∂T per year`. Display adapters `/365` for `/day`, `/100` for per-pt, `/10000` per bp — branded types in `src/lib/math/units.ts` prevent ×100/×365 slips.

**IV solver bounds & failures**
- Solver first checks `price ∈ [intrinsic, maxPrice]` at `σ→0` and `σ→∞` under chosen model. Failure reasons discriminated: `invalid_input|expired|below_intrinsic|above_upper_bound|no_bracket|non_convergent`. Adaptive bracket `[1e-9,5]` expand to 20, safe Brent/bisect, repricing check `|reprice−target|<1e-6`. No near-expiry proxy vol. Jäckel *Let's Be Rational* and QuantLib `blackformula.cpp` are numeric authorities; Haug vectors locked.

**SVI**
- Total variance `w(k)=a+b(ρ(k−m)+√((k−m)²+σ²))`, `k=ln(K/F)`, `w=σ²T`. Fit on forward moneyness, not spot. Raw positivity `b≥0, σ>0, |ρ|<1` is *necessary not sufficient*. True static-arb freedom needs per-expiry price-space checks (call non-neg, decreasing in K, convex/butterfly ≥0) plus calendar at fixed `k` (`w` non-decreasing in `T`). Surface fit returns separate `observedMask|modelMask`, `residuals`, `constraintResults`, `calibrationMs`; observed nodes never overwritten.

---

## 3. Dealer positioning methodology and limitations

- Public OI is gross outstanding; cannot identify dealer side, opening/closing, or hedge direction — CFTC COT explanatory notes, Cboe 0DTE study. Any GEX/DEX/vanna/charm from OI is a **scenario exposure proxy** under explicit sign model.
- Formulas (per-underlying Greeks, `S`=spot, `Q`=underlying units):
  - `GEX₁% = sign·γ·Q·S²·0.01`
  - `DEX = sign·δ·Q·S`
  - `Vanna₁pt = sign·vanna_raw·0.01·Q·S`
  - `Charm₁d = sign·charm_raw/365·Q·S`
- `sign` from `SIGN_MODELS` (`calls+/puts−` naive, inverse, unsigned, flow-signed fallback). Missing `Q` (null OI) ⇒ `null` exposure, counted in `coverage`, never volume/unit fallback when label says Observed. Volume/unit are separate scenario modes with badges `Volume-weighted proxy` / `Unit weight — structure only`.
- Gremlin: per-dollar gamma vs per-share gamma changes scale; shock convention in axis label (`per 1% move`), not hidden in docs.

---

## 4. SOFR, Treasury, STIR, curve, spread & basis units

**SOFR/EFFR/IORB corridor**
- SOFR (secured overnight, NY Fed), EFFR (fed funds), IORB (interest on reserve balances), RRP offering = `IORB−10bp`. FRED series `SOFR,DFF,IORB,RRPONTSYD`. Spreads quoted in bps = `(rateA−rateB)*100`. Nominal corridor diagnostics: `SOFR−IORB` ample-reserves ≈ −15 to +5 bp. Decision: store rates decimal, display `%` or `bp` via named formatters, preserve `obs_date` and `as_of` (exchange event vs fetch time separate).

**Treasury curve**
- Constant maturity yields `DGS1MO/DGS3MO/DGS6MO/DGS1/DGS2/DGS5/DGS10/DGS20/DGS30` in percent points. Spread = `10Y−2Y` etc. Yield: `y` decimal, `y*100` percent, `(yA−yB)*100` pp → `*100` again for bp? We use `y_decimal*10000` bp internally? No — spreads remain pp×100=bp: `(0.0455−0.0419)*10000=36bp`. Chart axis labelled `Yield %` vs `Spread bps` separately.

**STIR / SOFR futures**
- CME 3M SOFR futures (SR3) quoted as `price = 100 − implied_rate%`. Implied_rate = `100−price`. SR3 `last_price` vs SOFR-compounded final settlement: for expired contract, `rate = (Π(1+SOFR_i/360)−1)*360/D*100` ACT/360 CME final settlement (see `services/stir.py`). Missing SR3 price for expired without settlement ⇒ `null` with `Stale` badge, not invented.
- Pack/CALENDAR vs fly vs pack spreads: level `rate%` ("implied_rate") vs spread `rate_bps` (`Δprice*100` NOT `Δimplied_rate*10000` double-scaling). **CalendarPacksBoard bug:** outright `implied_rate*100` was substituted into `rate_bps` bps series labelled "bps" — unit/semantic error. Fix: show `implied_rate` in its own level panel; spreads compute `price_spread*100` (price points → bps) or `implied_rate_spread*100` consistently, labelled.

**Funding & basis**
- Perp funding: raw `rate8h` decimal + `premium=(mark−index)/index` per Deribit spec, direction badge, `simpleAnnualizedRunRate = rate8h*1095` labelled `simple` not yield. Dated basis: absolute `F−S`, pct `F/S−1`, simple `pct/T`, log `ln(F/S)/T` as distinct named fields — never collapse to single "APR".

---

## 5. Tadawul session & market-field semantics

- Week Sun–Thu, continuous ~10:00–15:20 Asia/Riyadh, pre-open 09:30–10:00, T+2 SAR. Verify via Tadawul calendar and SAHMK docs. `riyadhSessionSnapshot()` returns `phase ∈ {open,preopen,postclose,closed}`, `tradingDay`, `timezone`, `local` event time distinct from `fetched_at` server fetch time — two timestamps, labelled.
- SAHMK free board pack = 6 calls (TASI, Nomu, gainers, losers, volume, sectors). `valueLeaders` duplicates `volumeLeaders` on free tier — original tile "Value (vol proxy)" labelled a replica as value. Fix: delete replica tile unless true `traded_value` field present; otherwise omit section with `Unavailable` empty state.
- Breadth: `advancing/declining/unchanged` from index summary; missing ⇒ `null` (not `0`). Zero would falsely signal flat market. Display `—` + `Unavailable` badge.
- Symbol normalization digits-only, optional `.SR` stripped, 3-4 digits; server-only `SAHMK_API_KEY` in header `X-API-Key`, never client.

---

## 6. Historical backtesting, costs, bias controls

- Backtest vs Monte Carlo vs scenario: backtest = historical data with provenance (source, `as_of`, transaction costs, slippage, fees, look-ahead guards, point-in-time universe, survivorship). Monte Carlo / path-sim = user-controlled stochastic paths with named params (drift, vol, steps, seed, fee_bps). Labels must not cross: synthetic GBM must be labelled `Scenario Monte Carlo` not `Historical Backtest`.
- Requirement: `BacktestTool` currently seeded GBM (120 paths, weekly short straddle) is Monte Carlo, not backtest. Keep as `Scenario Monte Carlo` workflow with explicit `Local GBM` badge; connect historical path via Binance klines / crypto-backtest-api or delete duplicate orphan Python endpoint — one truthful product.
- Costs: Binance `fee_bps` round-trip deducted from `ret_{h}h`. Greeks PnL scenario uses sticky-IV repricing with `bs-sticky-iv` method, labelled, with zero vega attribution flagged as `Sticky IV — no vol move` badge, not hidden.
- Bias controls: signal uses `shift(24)` look-ahead safe; no future `close` in entry; history ring sourced from realized klines or FMP history with `as_of_ms`.

---

## 7. Accessibility & responsive terminal patterns

- Target viewports: 1440×900, 1280×800, 1024×768, 390×844. Zero horizontal overflow at each (Playwright `scrollWidth−clientWidth==0`). Tables scroll vertically within `overflow-auto` container; no viewport-wide scroll.
- Keyboard: `Tab`/`Shift-Tab` between desks, `[` `]` jump sections, `j/k` board row focus, `y` copy, `/` palette. All controls reachable without pointer; focus ring visible (`focus-visible`). Deep-links `?desk=…&view=…` restore section.
- Charts: Canvas/SVG must have accessible table alternative (`<table>` with `<caption>`), `aria-label`, keyboard focus. Axe WCAG 2A/AA pass with `color-contrast` disabled only where terminal palette intentionally low-contrast? No — we keep contrast check enabled except documented terminal dim legends with ≥3:1.
- Dense grids use `VirtualRows` capped ≤60 DOM rows, `Canvas2D` `MatrixHeatmap` with hit-test fallback.

---

## 8. Correctness decisions (lock before UI)

1. **Spot is required.** No `quotes[0].strike` fallback. Live valuation returns `unavailable` when spot null.
2. **Quote per-field null.** `bid/ask/last/OI/volume` null when missing; mid undefined without both sides.
3. **IV three layers.** Observed `bid/ask/markIV`, solved mid IV (`solvedIV`), model SVI (`modelIV`) distinct.
4. **Greeks units raw.** Store raw per-year / per-1 vol / per-1 rate; display adapters named.
5. **SVI not observed.** Fit on `k=ln(K/F)`, total variance `w=σ²T`, separate masks, price-space arb checks, `forwardVol` null if `fwdVar<0`.
6. **Positioning proxy.** Missing OI ⇒ null exposure; volume/unit are scenario modes with badge; sign model explicit.
7. **Rates level≠spread.** Implied rate vs spread bps separate; SR3 settlement via FRED compounded SOFR; missing = stale/unavailable.
8. **Tadawul times.** Event time vs fetch time separate; value without traded_value omitted; breadth null not zero.
9. **Scenario honesty.** Synthetic paths labelled `Synthetic Scenario`; Monte Carlo labelled `Scenario Monte Carlo`; historical backtest labelled `Historical` only when backed by observed klines with provenance.
10. **Fail-closed live.** Any synthetic/model value under Live/Observed/Historical label is a P0 defect.

---

## Sources (primary, checked 2026-08)

- Deribit API v2: `public/get_instruments`, `public/ticker`, `public/get_book_summary_by_currency`, mark prices, funding, inverse options [docs.deribit.com]
- OCC symbology & 100-share equity contract; OPRA spec
- Black 1976; Haug *The Complete Guide to Option Pricing Formulas*; QuantLib `blackformula.cpp` / Haug vectors; Jäckel *Let's Be Rational*
- Gatheral — *Arbitrage-free SVI volatility surfaces* (2012) & Gatheral/Jacquier
- FRED: SOFR, DFF, IORB, DTB3, DGS series; CME final settlement (ACT/360 SOFR compounding); NY Fed RRP/IORB docs
- Tadawul trading calendar; SAHMK developer docs (header `X-API-Key`, week Sun–Thu ~10:00–15:20 Asia/Riyadh)
- CFTC COT explanatory notes; Cboe 0DTE GEX analysis; Menthor Q GEX guide
- WCAG 2.2 A/AA; Playwright + axe-core patterns
