# Domain and Benchmarks

**Phase:** 0 research only

**Research snapshot:** 2026-08-27

**Scope:** crypto derivatives desk, shared quantitative core, shared client stack, and the Fastify boundary

**Status:** suitable as the evidence base for a later upgrade plan; it is not an implementation plan or work order

## Executive synthesis

The strongest terminals do not win by showing the most charts. They preserve the chain of meaning from a venue field, through a named transformation, to a display whose units and assumptions are visible. That is the central benchmark for this project.

The research establishes these conclusions:

1. Deribit's venue rules must be the authority for Deribit instruments. Inverse options use the expiry forward and exact calendar time on an ACT/365 basis. A generic spot Black-Scholes calculation with a fixed interest-rate assumption is not an equivalent reconstruction.
2. Executable, model, and reference values are different things. Bid/ask IV belongs to executable sides; `mark_iv` and mark price are risk/reference values. Deribit explicitly warns that mark price can lag or sit outside the spread.
3. Raw observations and fitted analytics must remain separate. A fitted SVI surface may be useful as a model view, but it may not silently fill missing market-data cells or be labelled as observed IV. Static-arbitrage claims require stronger tests than positivity or convexity of total variance.
4. Open interest alone cannot identify dealer inventory. GEX, DEX, vanna, and charm built from OI are scenario-weighted exposure proxies under an explicit sign convention. Missing OI must produce an incomplete-data state, not a silent volume or unit-weight fallback.
5. DVOL, ATM volatility, forward volatility, funding, and futures basis answer different questions. They should be compared only when their construction, tenor, and annualization are shown.
6. Good analytical UI uses a stable task hierarchy, compact controls near the affected chart, exact-value tooltips, meaningful color semantics, visible freshness/coverage, and drill-down from overview to quote/trade detail. A heat map is not improved by saturation alone.
7. The existing stack can support the product if high-frequency state is isolated, heavy visual packages are route-lazy, and dense time series/heat maps use fit-for-purpose Canvas/WebGL renderers. React memoization is not a substitute for correct store boundaries.
8. The server has a credible starting baseline, but current primary guidance calls for explicit proxy trust, schema validation/response serialization, bounded requests, safer proxy boundaries, backpressure-aware SSE, and a patched rate-limit dependency.

## Research method and evidence quality

Primary sources were preferred in this order: venue specifications and API documentation; original papers; mature reference implementations and their test vectors; vendor methodology/product documentation; then vendor help pages for UI behavior. Marketing claims are used only to describe that vendor's product. Proprietary calculations are never treated as reproducible formulas.

Three evidence labels are used:

- **Verified:** supported by a linked primary source.
- **Vendor-described:** the vendor says this is how its own product works, but the method is not independently reproducible from the public description.
- **Unverifiable:** no current public source exposed enough evidence; the document does not guess.

The current Derivatives Monkey terminal is publicly inspectable, and its live pages were reviewed for this research. A critical naming correction follows: current Derivatives Monkey presents itself as an independent, Derive-sponsored terminal ([live dashboard](https://www.derivativesmonkey.com/btc/dashboard)); Amberdata acquired Genesis Volatility/GVOL in 2022 ([Amberdata announcement](https://blog.amberdata.io/amberdata-acquires-crypto-options-analytics-company-genesis-volatility)), and Kaiko announced its acquisition of Amberdata in June 2026 ([Amberdata/Kaiko announcement](https://blog.amberdata.io/kaiko-acquires-amberdata-in-landmark-digital-asset-data-consolidation)). No first-party evidence was found that links current Derivatives Monkey to Amberdata. The prompt's parenthetical association is therefore treated as a conflation, and the two products are researched separately.

## 1. Derivatives Monkey and Amberdata Derivatives

### Naming correction and current Derivatives Monkey structure

**Verified:** the live [Derivatives Monkey terminal](https://www.derivativesmonkey.com/) uses persistent decision-domain navigation: Dashboard; Volatility; Greeks; Flow; Block RFQ; Multi-Exchange; Premium; Futures; Strategy; TradFi; Builder; and Resources. Global state—asset, price/source count, palette, language, and search—sits above the analytical pages. Its [documentation page](https://www.derivativesmonkey.com/btc/docs) describes normalized quotes, trades, and Greeks while retaining exchange provenance.

The most relevant live pages communicate the following:

| Live page | Panel structure and analytical purpose | Product lesson |
|---|---|---|
| [Term Structure](https://www.derivativesmonkey.com/btc/term) | Cross-source mean ATM IV by tenor; ATM/forward-vol toggle; current versus historical curves; tenor history; implied one-sigma move; active maturities; regime bands. Hollow points denote single-venue observations. | Combine current curve, derived forwards, history, expected move, and coverage in one canonical workflow. Forward vol is absent when forward variance is invalid. |
| [Premium Matrix](https://www.derivativesmonkey.com/btc/premium) | Standing premium is disclosed as mark price × OI by strike × expiry. Controls select standing OI/buy flow/sell flow, calls/puts/both, strike window, color mode, and global/square-root scale. Totals cover the visible window and the strike ladder is Deribit-anchored. | Put formula, visible-window scope, anchor venue, scaling transform, and source filter beside the matrix. “ATM-forward matrix” is not the page's name or formula. |
| [Funding Rates](https://www.derivativesmonkey.com/btc/futures/funding) | Current Deribit/Binance/Bybit/OKX cards show native eight-hour rate, annualized rate, mark, and next-funding countdown; a venue-selectable history adds lookback and unit controls. | Pair native and annualized values, compare venues only after normalization, and keep history behind one consistent unit selector. |
| [Dealer Positioning](https://www.derivativesmonkey.com/btc/greeks) | An OI-weighted Gamma/Vanna/Charm surface plus per-strike GEX/VEX/DEX, flow-signed versus naive modes, DEX/expiry, cumulative GEX/flip, profile, max pain, and risk-neutral ITM probability. | Signing methodology and OI weighting are first-class controls; naive and flow-signed estimates are not observed inventory. |
| [Heatmaps](https://www.derivativesmonkey.com/btc/heatmaps) | Four coordinated maps: time × strike notional footprint; expiry × strike OI; DTE × strike signed GEX; DTE × strike signed VEX. Spot is a dashed reference; hover exposes strike/DTE/exposure; color legends state sign and an arctangent intensity transform. | Meaningful axes, spot reference, exact tooltip, sign legend, and disclosed compression are the closest direct benchmark for this desk. |
| [Open Interest](https://www.derivativesmonkey.com/btc/open-interest) | Current navigation and panels keep OI concentration, expiry/strike structure, source state, and related flow questions in one domain. | OI is a committed-position lens, not interchangeable with flow volume. |
| [Vol Regime](https://www.derivativesmonkey.com/btc/vol-regime) | The page intentionally reports the classifier offline while it is rebuilt on real history, explains that unverified confidence scores will not be shown, and states the restoration condition. | This is a strong fail-closed empty-state benchmark: unavailable, why, current status, and what must be validated. |

The live pages verify the structure and visible formulas above, but the full flow-signed dealer model, MBVI, cross-venue normalization, and regime classifier are not publicly specified enough to reproduce. Those methods remain **unverifiable**.

### What is verifiable now

Amberdata's current derivatives product exposes an analytics taxonomy rather than a single omnibus dashboard. Its public product material groups work into implied volatility, constant delta/maturity analytics, deep history, GEX, realized volatility, risk monitoring, surface calibration, and derivatives data. It describes a Butterfly Index that compares Deribit DVOL with 30-day ATM volatility, a constant-maturity series, term structure with forward volatility, GEX, and footprint volatility curves ([Amberdata derivatives overview](https://www.amberdata.io/derivatives-info)). The public application shell exposes top-level areas such as Global All Market, Real Vol, Performance, Greeks, Yields, Options, Spot, and altcoin volatility calibration, while the analytical contents are login-gated ([AD Derivatives public app shell](https://pro.amberdata.io/profile/)).

These panels communicate distinct questions:

| Display | The question it answers | Correct reading |
|---|---|---|
| DVOL | What constant-30-day volatility level is embedded in a weighted strip of Deribit OTM option prices? | A VIX-like index, not an ATM quote and not realized volatility. Deribit's endpoint returns timestamp/OHLC index candles ([Deribit volatility-index data](https://docs.deribit.com/api-reference/market-data/public-get_volatility_index_data)); Amberdata documents the strike-weighted index construction separately ([Amberdata volatility-index dictionary](https://docs.amberdata.io/data-dictionary/analytics/derivatives/volatility-index)). |
| DVOL volatility-of-volatility | How unstable has the DVOL index itself been? | A close-to-close rolling volatility of DVOL, distinct from DVOL's level ([Amberdata DVol volatility-of-volatility](https://docs.amberdata.io/http/analytics/derivatives/volatility-of-volatility-dvol-index)). |
| Butterfly Index | Are the option wings rich or cheap relative to the ATM belly? | Amberdata describes the ratio/spread of DVOL, which includes a broader strike set, to 30-day ATM volatility; it is not the classic single-expiry 25-delta butterfly quote ([Amberdata derivatives overview](https://www.amberdata.io/derivatives-info)). |
| ATM constant maturities | How did like-for-like tenor volatility change through time? | A vendor-derived interpolated series. It must be labelled as interpolated/modelled and must not replace actual expiry quotes. |
| Actual-expiry term structure | Which listed maturities are rich or cheap? | Plot actual expiries with their DTE and timestamp. Forward volatility is variance-derived, `sqrt((σ₂²T₂-σ₁²T₁)/(T₂-T₁))`, and must be null when forward variance is invalid—not clamped ([Amberdata term structure](https://docs.amberdata.io/data-dictionary/analytics/derivatives/term-structure)). |
| Volatility metrics matrix | How did ATM, risk reversals, butterflies, and the underlying move by expiry? | Preserve expiry and comparison timestamp; Amberdata's endpoint explicitly reports per-expiry current values and changes ([Amberdata volatility metrics](https://docs.amberdata.io/http/analytics/derivatives/volatility-metrics-24-hr)). |
| Funding/basis | What is the carry and positioning pressure in perpetuals and dated futures? | Keep venue, instrument, observation window, and annualization convention visible. |
| GEX/positioning | Under a stated inference method, where could hedging sensitivity concentrate? | Amberdata says it combines quote/trade aggressor matching, immediate OI changes, and proprietary heuristics. Public OI alone cannot reproduce it ([Amberdata derivatives overview](https://www.amberdata.io/derivatives-info)). |

Amberdata's Level 1 quote schema is a useful display benchmark because it keeps best bid/ask, mark, bid/ask/mark IV, Greeks, index, open interest, multiplier, timestamp, and exchange-provided/calculated provenance together ([Amberdata Level 1 quotes](https://docs.amberdata.io/http/analytics/derivatives/level-1-quotes)). Its delta-surface methodology interpolates in variance space only between bracketing delta/maturity observations and returns null outside available brackets ([Amberdata delta surfaces](https://docs.amberdata.io/data-dictionary/analytics/derivatives/delta-surfaces-constant-and-floating)). A terminal should not collapse these fields into a single unexplained “IV” or “price,” and modelled interior values must retain their provenance.

### Prior local capture

The prior repository capture, [`docs/DERIVATIVES_MONKEY_CLONE_HANDOFF.md`](../DERIVATIVES_MONKEY_CLONE_HANDOFF.md), records an earlier route set from the [BTC dashboard](https://www.derivativesmonkey.com/btc/dashboard): Dashboard/Custom/Strike Insight; Volatility; Greeks; Flow; Block/RFQ; divergence and lead/lag; basis/premium; Futures; Strategy; Calculator; Stats; and Docs. It also records page compositions for Greek Exposure, Heatmaps, Order Flow, Open Interest, and Skew.

This is historical evidence, not a substitute for the current live review above. Differences may reflect product evolution. It must also never be represented as Amberdata behavior. The defensible benchmark is the task grammar—overview, volatility, risk, flow, positioning, and carry—not a claim of corporate or methodological equivalence.

### Product lesson

The useful pattern is progressive disclosure: summary regime first; actual-expiry/strike structure second; raw quotes and trades last. Custom workspaces are valuable after canonical analytical views exist. A large route count is not evidence of product depth.

## 2. Deribit public API v2 semantics

### Endpoint map

| Need | Primary endpoint/channel | Important semantics |
|---|---|---|
| Instrument catalogue | [`public/get_instruments`](https://docs.deribit.com/api-reference/market-data/public-get_instruments) | Filter by `kind`; preserve `instrument_type`, base/quote/settlement currencies, `contract_size`, tick sizes, expiry, and amount units. It has a custom 1 request/second sustained limit and 50-request burst. |
| Broad snapshot | [`public/get_book_summary_by_currency`](https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency) | Efficient summary with OI, volume, BBO, mark, and option `mark_iv`; it does **not** provide executable-side bid/ask IV. Deribit recommends ticker subscriptions for real-time updates. |
| Per-instrument live state | [`public/ticker`](https://docs.deribit.com/api-reference/market-data/public-ticker) or `ticker.{instrument}.{interval}` | Provides bid/ask/mark IV for options and exchange Greeks. Use bid IV with bid price, ask IV with ask price, and mark IV with mark price. |
| Full book | [`public/get_order_book`](https://docs.deribit.com/api-reference/market-data/public-get_order_book) / book subscription | Initial WebSocket message is a full snapshot; incremental handling must detect `prev_change_id` gaps and resnapshot. Use depth only where the UI needs liquidity, not for every tile. |
| Trades | [`public/get_last_trades_by_currency_and_time`](https://docs.deribit.com/api-reference/market-data/public-get_last_trades_by_currency_and_time) | Time-bounded history is limited to the prior 24 hours. `direction` is taker direction; option trades include IV. Preserve amount units and pagination. |
| DVOL history | [`public/get_volatility_index_data`](https://docs.deribit.com/api-reference/market-data/public-get_volatility_index_data) | Returns timestamp/OHLC arrays and continuation. It is a volatility-index series, not an option-chain IV surface. |
| Funding history | [`public/get_funding_rate_history`](https://docs.deribit.com/api-reference/market-data/public-get_funding_rate_history) | Hourly records expose `interest_1h` and `interest_8h` as decimal rates. Preserve raw rate and timestamp before applying any display annualization. |
| Historical marks | [`public/get_mark_price_history`](https://docs.deribit.com/api-reference/market-data/public-get_mark_price_history) | Five-minute marks, currently only for the subset of options used by volatility-index calculations. An empty result for another option is expected, not evidence of zero price. |
| Option mark stream | [`markprice.options.{index_name}`](https://docs.deribit.com/subscriptions/market-data/markpriceoptionsindex_name) | Streams timestamp, instrument, mark price, and IV for risk/valuation. It does not make mark values executable. |
| Index | [`public/get_index_price`](https://docs.deribit.com/api-reference/market-data/public-get_index_price) | Reference index used for settlement/risk calculations; do not conflate with the expiry forward. |

### Contract and unit rules

Deribit inverse BTC/ETH options are European, cash settled, quoted and margined in base coin, with a one-coin contract size. The displayed USD equivalent uses the latest index. The expiry forward is the corresponding future's mark, or a venue synthetic forward when no corresponding future exists. Delivery uses the index TWAP from 07:30–08:00 UTC ([Deribit inverse-option specification](https://support.deribit.com/hc/en-us/articles/31424939096093-Inverse-Options)).

Amount units are instrument-dependent. Deribit's book-summary documentation states that open interest for perpetuals and inverse futures is in USD amount units, while options and linear futures use underlying base-currency units. Volume and notional fields also have distinct units. Therefore every normalized record needs an explicit instrument family, settlement/quote currency, contract multiplier, and source-unit tag before aggregation ([book-summary response schema](https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency)).

Instrument metadata, not symbol-string parsing, is authoritative for expiry timestamp, strike, option side, multiplier, and instrument type. Parsing a display symbol can be a guarded compatibility path only. Deribit's public documentation distinguishes inverse/reversed and linear instruments and deprecates older metadata such as `future_type` ([instrument catalogue](https://docs.deribit.com/api-reference/market-data/public-get_instruments)).

### Mark versus executable values

Deribit defines mark price as a robust reference for risk, margin, unrealized P&L, and liquidation. Stabilization can make it lag or sit outside the live bid/ask, and Deribit warns against relying on it for trading decisions ([Deribit mark prices](https://support.deribit.com/hc/en-us/articles/25944746962973-Mark-Prices)). Consequently:

- `mark_price`/`mark_iv`: reference/model layer.
- best bid/ask and their IVs: executable-side layer, subject to size and book depth.
- last trade and trade IV: historical execution layer.
- midpoint: a transparent local arithmetic derivation only when both sides are valid; never a trade.

Every view must label which layer it shows. An option row with only `mark_iv` may support risk context but cannot truthfully show “market mid IV” or an executable spread.

Deribit's documentation names the IV fields but is not sufficiently explicit across all endpoint examples about their numeric scale. The normalization contract must be locked with timestamped testnet/production fixtures before schemas assume percent points versus decimal volatility. Exchange Greeks also require semantic separation: the ticker documentation notes that for less than one day remaining, exchange theta is the lesser of one-day theta and lifetime theta, so `exchangeTheta` is not always the same as analytic calendar-day theta ([Deribit ticker](https://docs.deribit.com/api-reference/market-data/public-ticker)).

### Rate-limit and collection discipline

Deribit uses credits. The documented default non-matching request costs 500 credits against a 50,000 pool with 10,000 credits/second refill: 20 requests/second sustained and a 100-request burst in the illustrative default. Unauthenticated public access is separately limited per IP and may be stricter. `public/get_instruments` has the custom limit noted above ([Deribit rate limits](https://docs.deribit.com/articles/rate-limits)).

There is a documentation discrepancy worth treating conservatively: the current rate page lists `get_instruments` at 1 request/second with burst 50, while a June 2025 notice describes a tighter WebSocket-specific limit and recommends REST or instrument-state notifications ([Deribit June 2025 notice](https://support.deribit.com/hc/en-us/articles/27847292466205-10-June-2025)). The safe conclusion is to seed once, subscribe to lifecycle changes, cache the catalogue, and avoid recurring calls rather than code to the larger allowance.

Deribit asks clients to use WebSocket subscriptions instead of repeated ticker/order-book polling, caps a subscription request at 500 channels, and may restrict clients that repeat malformed or rate-limited requests ([API usage policy](https://docs.deribit.com/articles/api-usage-policy)). Its collection guidance recommends narrow subscriptions and instrument-lifecycle handling rather than periodically rebuilding the entire universe ([market-data collection](https://docs.deribit.com/articles/market-data-collection-best-practices)).

The server-side behavioral baseline is therefore: one shared catalogue cache; one shared market-data connection per product group where practical; narrow subscriptions; sequence-gap recovery; bounded exponential reconnect; stale timestamps carried to clients; and no browser fan-out to Deribit.

## 3. Options mathematics and numerical authority

### Model selection

| Product | Pricing convention | Required inputs |
|---|---|---|
| Equity/ETF European option | Black-Scholes-Merton with continuous dividend yield, or an explicitly named discrete-dividend model | Spot, strike, exact expiry time, rate curve/assumption, dividend input, volatility |
| Option on a forward/future | Black-76 ([Black 1976](https://doi.org/10.1016/0304-405X%2876%2990024-6)) | Forward/futures price, strike, discount factor, exact expiry time, volatility |
| Deribit inverse BTC/ETH option | Venue specification, algebraically expressed by Deribit using index `X` and forward-implied `R = ln(F/X)/T` | Deribit index, expiry forward, strike, exact ACT/365 time, option premium in coin or labelled USD equivalent, contract convention ([Deribit inverse options](https://support.deribit.com/hc/en-us/articles/31424939096093-Inverse-Options)) |

For Deribit, `F` is not recreated from a hard-coded generic rate when the venue supplies the relevant forward/underlying. The venue formula takes precedence. USD conversion of an inverse premium is a display conversion and must preserve the original coin premium.

### Canonical units

The mathematical core should use one internal convention and convert only at display boundaries:

| Quantity | Internal unit | Permitted display conversion |
|---|---|---|
| Time `T` | exact years; ACT/365F for 24/7 crypto | DTE/hours shown alongside exact expiry timestamp |
| Rate/yield/volatility | decimal (`0.50` = 50% vol) | percent only through named formatter |
| Price | contract-native quote currency per underlying unit | USD equivalent with conversion index and timestamp |
| Delta | `∂V/∂S` | raw; delta-notional is a separate named derived metric |
| Gamma | `∂²V/∂S²` | raw; “per 1% move” exposure is a separately named aggregation |
| Theta | `∂V/∂t` per year | divide by 365 for calendar-day theta |
| Vega | `∂V/∂σ` for `Δσ = 1.00` | divide by 100 for one volatility point |
| Rho | `∂V/∂r` for `Δr = 1.00` | divide by 100 for one percentage point, or 10,000 for one basis point |
| Charm | define explicitly as time-passage charm, `-∂Δ/∂T` per year where `T` is time remaining | divide by 365 for one calendar day; never mix with the opposite-sign `∂Δ/∂T` convention |
| Vanna | `∂Δ/∂σ = ∂Vega/∂S` on raw-vol scale | multiply by 0.01 for a one-vol-point scenario |

The application must not expose two functions both named “Greeks” when one returns raw annual theta/vega and another returns theta per day/vega per point. Types or property names must encode the scale.

Trading-day annualization (`√252`) is appropriate only for an explicitly sampled trading-day realized-volatility estimator. It is not the pricing clock for a 24/7 crypto option. Deribit includes the full fractional calendar time and divides by 365 in its own example ([Deribit inverse options](https://support.deribit.com/hc/en-us/articles/31424939096093-Inverse-Options)).

### Implied-volatility inversion

An IV solver must first enforce theoretical price bounds under the selected model. It then needs a bracket whose endpoint prices straddle the target, a safe Newton/Brent-style iteration, explicit price and volatility tolerances, and a failure result carrying a reason. It must never return a guessed “local vol” merely because expiry is near.

Jäckel's work targets reliable Black implied-volatility inversion across difficult regions and is an appropriate numerical authority ([Jäckel, *Let's Be Rational*](https://doi.org/10.1002/wilm.10395)). QuantLib's Black-formula implementation and tests are a mature independent oracle ([QuantLib `blackformula.cpp`](https://github.com/lballabio/QuantLib/blob/master/ql/pricingengines/blackformula.cpp)). A solver result is accepted only when repricing the returned IV recovers the target within a declared price tolerance.

Failure reasons should distinguish: invalid domain; expired; price below intrinsic; price above the model maximum; no bracket; non-convergence; and numerically indeterminate. Near expiry, an honest missing IV is better than a plausible-looking estimate.

### Smile/surface representation and static arbitrage

SVI models total implied variance, not volatility directly:

`w(k) = a + b[ρ(k-m) + √((k-m)² + σ²)]`, where `w = σ_BS² T` and `k = ln(K/F)`.

The forward in log-moneyness matters. Using spot without the carry transformation changes the smile coordinate. Gatheral and Jacquier show that a surface is free of static arbitrage only when it is free of both calendar-spread and butterfly arbitrage ([*Arbitrage-free SVI volatility surfaces*](https://arxiv.org/abs/1204.0646)). Positivity of minimum variance is necessary but not sufficient for butterfly freedom, and positive `b` says nothing by itself about calendar arbitrage across separately fitted expiries.

The validation layers are:

1. Quote admissibility: timestamps, non-crossed prices, positive forwards, valid expiry, and model bounds.
2. Per-expiry price-space checks: discounted call price is non-negative, non-increasing in strike, slope respects call-spread bounds, and price is convex in strike (non-negative butterfly density).
3. Cross-expiry checks at fixed forward log-moneyness: total variance/option value must not decrease with maturity under the chosen interpolation.
4. SVI/SSVI parameter constraints and dense-grid price-space checks after calibration; SSVI's published sufficient conditions may be used when the SSVI form is selected.
5. Observed/model masks: raw quoted nodes remain identifiable; fitted nodes carry model name, calibration timestamp, residual/error, and never overwrite raw fields.

Interpolation is acceptable only as an explicitly labelled analytical model. The project's fail-closed market-data law forbids using a fitted value to make a missing quote appear observed or executable.

### Established numeric and property test vectors

QuantLib's European-option test suite includes published Haug reference values and is the primary golden-vector source ([QuantLib `europeanoption.cpp`](https://github.com/lballabio/QuantLib/blob/master/test-suite/europeanoption.cpp)). Initial vectors, with inputs in decimal and outputs in the model's quote currency, are:

| Test | Type | `S` | `K` | `q` | `r` | `T` | `σ` | Expected |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Price | Call | 60 | 65 | 0 | 0.08 | 0.25 | 0.30 | `2.1334` |
| Price | Put | 100 | 95 | 0.05 | 0.10 | 0.50 | 0.20 | `2.4648` |
| Price | Call | 19 | 19 | 0.10 | 0.10 | 0.75 | 0.28 | `1.7011` |
| Price | Put | 19 | 19 | 0.10 | 0.10 | 0.75 | 0.28 | `1.7011` |
| Delta | Call | 105 | 100 | 0.10 | 0.10 | 0.50 | 0.36 | `0.5946` |
| Delta | Put | 105 | 100 | 0.10 | 0.10 | 0.50 | 0.36 | `-0.3566` |
| Gamma | Call | 55 | 60 | 0 | 0.10 | 0.75 | 0.30 | `0.0278` |
| Vega raw | Call | 55 | 60 | 0 | 0.10 | 0.75 | 0.30 | `18.9358` |
| Theta raw/year | Put | 430 | 405 | 0.05 | 0.07 | `1/12` | 0.20 | `-31.1924` |
| Theta/day | Put | 430 | 405 | 0.05 | 0.07 | `1/12` | 0.20 | `-0.0855` |
| Rho raw | Call | 72 | 75 | 0 | 0.09 | 1.00 | 0.19 | `38.7325` |

These rounded Haug values need tolerances appropriate to their four-decimal publication. A higher-precision independent oracle should generate committed fixtures for the full matrix, but the oracle implementation must not be the same code under test.

Mandatory properties include call-put parity; price bounds; call-price monotonicity and convexity in strike; positive gamma/vega for regular European cases; delta bounds; limits as `T→0` and `σ→0`; IV round-trip over moneyness/tenor/volatility grids; and finite-difference agreement for every Greek with its declared units. A timestamped Deribit fixture should additionally reconcile venue forward, premium denomination, mark IV, and exchange Greeks within documented tolerances; it is a fixture, not a timeless golden number.

## 4. Funding and futures basis

### Perpetual funding

Deribit defines the premium rate as `(mark - index) / index`. It applies a ±0.025% damper/deadband and instrument-specific caps. A positive rate means longs pay shorts; the UI expresses the rate on an eight-hour basis, but payment accrues continuously in proportion to time held ([Deribit funding specification](https://support.deribit.com/hc/en-us/articles/31424939178397-Funding-Specifications)).

Therefore a funding panel should preserve:

- venue and perpetual instrument;
- raw `interest_8h` and/or `interest_1h` with source timestamp;
- the interval actually observed;
- payment direction;
- current mark/index premium;
- any derived annualization, explicitly labelled “simple annualized.”

`rate8h × 3 × 365` is a simple arithmetic annualization, not an effective compounded yield and not the actual continuous payment schedule. Cross-venue comparisons must normalize each venue's funding interval/method before aggregation. Coinbase's institutional primer illustrates that an eight-hour 0.01% rate becomes 10.95% by simple annualization and notes that exchange mechanisms differ ([Coinbase perpetual-futures primer](https://www.coinbase.com/institutional/research-insights/research/market-intelligence/a-primer-on-perpetual-futures)).

### Dated-future basis and term structure

For an actual future with price `F`, spot/index `S`, and exact year fraction `T`:

- absolute basis: `F - S`;
- percentage basis: `F/S - 1`;
- simple annualized basis: `(F/S - 1)/T`;
- continuously compounded annualized basis: `ln(F/S)/T`.

The last two are different measures and must never share one unlabeled “APR” field. Amberdata describes its APR basis as converting the futures/spot difference to a percentage and annualizing it, and distinguishes actual-expiry term structure from interpolated constant-maturity basis ([Amberdata APR basis](https://docs.amberdata.io/data-dictionary/analytics/derivatives/apr-basis)).

An actual term structure is the ordered set of live listed expiries with mark or executable midpoint, basis, exact DTE, and freshness. A constant-maturity curve is a derived interpolation and must live in a model layer with its interpolation method and bracketing expiries visible. It cannot fill an absent market instrument.

## 5. Dealer positioning: methodology and limits

### What can be computed

First normalize the position quantity to underlying units: `Q = contracts × contractMultiplier` when the feed reports contracts, or `Q = OI` when the venue already reports option OI in underlying base-currency units. Given per-underlying Greeks, spot `S`, and an explicit position-sign assumption `a ∈ {-1,+1}`:

| Metric | Scenario convention | Formula in quote-currency exposure |
|---|---|---|
| GEX per 1% spot move | Change in delta-notional for a 1% spot shock | `a × gamma × Q × S² × 0.01` |
| DEX | Delta notional | `a × delta × Q × S` |
| Vanna exposure per +1 vol point | Delta-notional change under `Δσ=0.01` | `a × vanna_raw × 0.01 × Q × S` |
| Charm exposure per calendar day | Delta-notional change for one day of elapsed time | `a × (-∂delta/∂T) × Q × S / 365` |

If a vendor uses per-dollar gamma instead of per-1%-move gamma, the numerical scale differs. The shock convention belongs in the metric name/axis, not only in documentation.

For Deribit options, the API reports OI in underlying base-currency amount units. Applying an equity-style 100 multiplier, or multiplying by a coin contract size a second time after OI is already normalized, is a unit error ([Deribit book summary](https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency)).

### What cannot be inferred from OI

Open interest is gross outstanding interest: aggregate long OI equals aggregate short OI. It does not reveal which side is a dealer, opening versus closing flow, or hedge direction ([CFTC explanatory notes](https://www.cftc.gov/MarketReports/CommitmentsofTraders/ExplanatoryNotes/index.htm)). Cboe's 0DTE analysis similarly shows why large gross notional can net to modest dealer exposure when customer buying and selling offset ([Cboe 0DTE market-impact study](https://www.cboe.com/insights/posts/volatility-insights-evaluating-the-market-impact-of-spx-0-dte-options/)).

Accordingly:

- An OI-weighted chart is an **exposure proxy under a named sign convention**, not “the dealer book.”
- The common `calls positive / puts negative` convention is a scenario assumption, not observed inventory.
- Volume is flow, not stock; it cannot silently replace missing OI.
- Unit weighting measures shape only; it cannot carry currency exposure units.
- Trade-side classification is a separate inferred-flow model. Taker direction helps, but opening/closing status and counterparty identity may still be unknown.
- When OI is absent or stale, show coverage and an empty/incomplete state.

MenthorQ's public guide provides a useful display grammar—GEX/DEX by expiry, normalized shares, OI change, profiles, and regime/context labels—while stressing that gamma exposure is a dealer-behavior proxy ([MenthorQ options menu](https://menthorq.com/guide/options-menu/), [MenthorQ GEX guide](https://menthorq.com/guide/what-is-gex/)). Its vanna guide correctly frames vanna and charm as interacting sensitivities that are hard to isolate from the full book ([MenthorQ vanna guide](https://menthorq.com/guide/vanna-chart-explained-in-practice/)). These vendor pages inform UI vocabulary, not an independent ground-truth dealer inventory.

Amberdata says its GEX process combines true-aggressor matching, immediate OI changes, and roughly 30 proprietary heuristics ([Amberdata derivatives overview](https://www.amberdata.io/derivatives-info)). That method is **vendor-described and not publicly reproducible**. The terminal must not imply equivalence when it only has public OI and trades.

## 6. Terminal UI benchmarks

### Comparative findings

| Product | What it does well | What to borrow—not clone |
|---|---|---|
| Derivatives Monkey | Live pages coordinate actual-expiry curves, flow/OI/premium matrices, dealer-proxy modes, funding comparisons, and source-quality encodings in a single domain hierarchy ([live terminal](https://www.derivativesmonkey.com/)). | Formula and transform beside the chart; coverage encoded in the marks; explicit naive/flow-signed modes; honest offline state when a classifier is unvalidated. |
| Laevitas | Coherent hierarchy: assets → perps/futures/options → chain, screener, T&S, volume/OI, flows, volatility, skew/BF, monitor/run, and GEX. The current public navigation makes the task grouping visible ([Laevitas terminal](https://app.laevitas.ch/)). | Stable information architecture, same asset/time/source controls across views, and drill-down from overview to instrument. Avoid reproducing every route as a separate local implementation. |
| Amberdata | Keeps raw data, normalized volatility analytics, historical surfaces, constant delta/maturity, term structure, forward vol, and positioning conceptually distinct ([Amberdata derivatives overview](https://www.amberdata.io/derivatives-info)). | Show provenance and separate observed quotes from vendor/model transformations. |
| Volmex | Focused index product with a documented, model-free 30-day implied-volatility methodology and term products rather than a general chart warehouse ([Volmex methodology](https://volmex.finance/docs), [methodology paper](https://volmex.finance/Volmex-IV-paper.pdf)). | A benchmark metric should have a visible methodology and stable tenor. Do not treat an older v1 formula as current. |
| ExoCharts | Makes order flow a dedicated workspace: profile, DOM, tape, footprint, and linked workspaces. Its volume-cluster modes explicitly distinguish adaptive, current-rotation, and fixed color domains ([ExoCharts features](https://exocharts.com/features.html), [volume-cluster guide](https://help.exocharts.com/hc/en-us/articles/360018308857-Volume-Cluster)). | Fixed domains for comparison; adaptive domains only when the legend makes the changing scale unmistakable. Keep flow controls next to the flow view. |
| TradingView | Footprints encode seller/buyer volume by price with POC, value area, delta summaries, imbalance settings, and methodology caveats ([footprint guide](https://www.tradingview.com/support/solutions/43000726164-volume-footprint-charts-a-complete-guide/)). Heat maps separate size and color metrics, show legends/tooltips, group and drill down ([heat-map guide](https://www.tradingview.com/support/solutions/43000766446-tradingview-heatmaps-from-global-trends-to-details/)). | Every encoding has a label; overview supports hover and drill-down; historical reconstruction limitations are disclosed. |

### Heat-map doctrine

A strike-by-expiry heat map should use:

- x-axis: strike or forward moneyness, with an explicit spot/forward marker;
- y-axis: actual expiry and DTE, ordered near to far;
- cell: exactly one metric and one unit/scenario convention;
- diverging, perceptually uniform scale centered at zero for signed exposures;
- sequential, perceptually uniform scale for non-negative OI/volume/magnitude;
- a symmetric signed domain when comparing positive and negative exposure;
- a fixed domain across side-by-side/time comparisons, or a prominent notice when adaptive;
- exact-value tooltip with raw inputs, source timestamp, observed/model flag, and coverage;
- a missing-data treatment that is visually distinct from zero;
- optional clipping/winsorization only with the threshold on the legend and unclipped tooltip value.

Crameri demonstrates why perceptually uniform, color-vision-deficiency-safe maps are preferable and why a diverging map needs a meaningful midpoint ([Crameri, *The misuse of colour in science communication*](https://doi.org/10.1038/s41467-020-19160-7)). Rainbow ramps and red/green-only semantics distort magnitude or exclude viewers.

The view must answer “where, how much, in what unit, under what assumption, and how fresh?” A smooth gradient over imputed cells fails that test even if it looks polished.

### Information-density pattern

The benchmark layout is compact but not indiscriminate:

1. page title, asset, venue/source, freshness, and coverage;
2. a small regime strip with definitions/tooltips;
3. one primary analytical canvas;
4. controls scoped to that canvas;
5. linked strike/expiry detail or table;
6. methodology and assumptions in-context;
7. explicit empty, stale, partial, and error states.

This makes depth come from linked evidence rather than many disconnected cards.

## 7. React, state, and visualization performance

### React 19 and Zustand

React Compiler can automatically memoize components and values, but React recommends incremental adoption and does not make manual memoization a semantic guarantee ([React Compiler introduction](https://react.dev/learn/react-compiler/introduction), [`useMemo`](https://react.dev/reference/react/useMemo)). Correctness must never depend on `useMemo`; existing memoization should be removed only after profiling and compiler adoption prove it redundant.

For high-frequency market state:

- normalize by instrument and separate raw feed state from derived view state;
- subscribe components to the smallest primitive/slice possible;
- use stable selectors and `useShallow` only for composite selections whose shallow equality is correct ([Zustand `useShallow`](https://zustand.docs.pmnd.rs/reference/hooks/use-shallow));
- do not subscribe an entire page to the whole quote store;
- batch/coalesce feed updates to a visual frame or declared cadence;
- compute expensive chain/surface aggregates once per input snapshot, outside render;
- keep transient hover/crosshair state local to the chart;
- profile commit frequency and long tasks with production builds.

The current Vite config uses the standard React plugin without a React Compiler transform, so no compiler behavior should be assumed. Current shell components including `TerminalLayout`, `SidePanel`, `StatusBar`, `PlaybackBar`, and `TerminalHeader` call `useTerminalStore()` without selectors and therefore subscribe broadly. That local pattern is exactly where store-boundary work matters more than adding component memoization.

### Renderer choice by workload

| Workload | Appropriate default | Rationale |
|---|---|---|
| Small summary series and simple categorical charts | Existing Recharts, route-local | Developer-friendly; acceptable when node count and update rate are modest. |
| Dense time series, funding, basis, DVOL/RV histories | uPlot or Lightweight Charts after a measured spike | uPlot is a small Canvas time-series library with published benchmarks ([uPlot README](https://github.com/leeoniya/uPlot/blob/master/README.md)); Lightweight Charts is purpose-built for financial series and supports ESM tree-shaking ([Lightweight Charts](https://tradingview.github.io/lightweight-charts/)). |
| Strike × expiry rectangular heat maps | Custom Canvas2D first; WebGL only beyond measured limits | Direct cells, axes, hit-testing, missing-data masks, and fixed color domains do not require a general charting runtime. |
| Very large point aggregation | GPU aggregation after profiling | deck.gl documents better GPU scaling at high counts but overhead and precision trade-offs for smaller data ([deck.gl aggregation overview](https://deck.gl/docs/api-reference/aggregation-layers/overview)). Its geographic heat-map KDE is not a natural default for a discrete options matrix. |
| 3D surface | Route-lazy specialized renderer only if 3D supplies a decision unavailable in 2D slices | A 3D effect alone does not justify its bundle or interaction cost. Always provide precise 2D slices/table. |

Plotly's own bundle information describes the full library as roughly 3.6 MB minified and compressed versus about 250 kB for partial bundles ([Plotly graphing libraries](https://plotly.com/graphs/)). Any retained Plotly surface should be isolated behind route-level lazy loading and a custom partial build where supported; it should not enter the initial shell chunk.

The existing built assets corroborate the concern: the current Plotly distribution chunk is about 4.65 MB raw and an OrbitControls-related chunk about 0.90 MB raw. These are local build observations, not gzip sizes. Route-laziness limits initial cost but does not remove parse/memory cost when those views open.

Performance conclusions must be validated with the repository's real datasets and production bundle output. Library marketing benchmarks are screening evidence, not a substitute for local measurement.

## 8. Fastify production hardening research

### Boundary and plugin baseline

Fastify recommends operating behind a reverse proxy for production capacity and traffic management ([Fastify recommendations](https://fastify.dev/docs/latest/Guides/Recommendations/)). Proxy trust must be a specific hop/IP/CIDR or validation function; Fastify warns that trusting arbitrary forwarded headers allows spoofing ([Fastify `trustProxy`](https://fastify.dev/docs/latest/Reference/Server/#trustproxy)). A production boolean `true` is therefore too broad unless the origin is provably unreachable except through one controlled proxy.

Fastify's JSON Schema validation and response serialization provide both boundary enforcement and response-field control. Schemas are application code because validation compilation uses `new Function`; user-supplied schemas are not safe. Default validation details may disclose schema structure and should be normalized for public errors ([Fastify validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)).

The hardening baseline supported by primary sources is:

- explicit `connectionTimeout`, non-zero `requestTimeout` when an upstream proxy does not enforce one, body-size limits, and route-specific tighter limits;
- JSON Schemas for params/query/body and response serialization for every public API family;
- `@fastify/helmet` with a deliberate CSP and route-specific exceptions where necessary ([`@fastify/helmet`](https://github.com/fastify/fastify-helmet));
- rate limits by route class and user/session for authenticated abuse, IP fallback for anonymous use, and a shared store such as Redis if multiple Node instances must share quotas ([`@fastify/rate-limit`](https://github.com/fastify/fastify-rate-limit));
- signed, `HttpOnly`, `Secure`, explicit `SameSite` cookies, preferably `__Host-` names, and signing-secret rotation where supported ([`@fastify/cookie`](https://github.com/fastify/fastify-cookie));
- fixed upstream origins, allowlisted path/parameters, stripped inbound authorization/cookie/provider headers, server-only credential injection, abort timeouts, bounded response size, and validated JSON for every proxy;
- generic public upstream errors plus structured server logs that do not include keys, session cookies, or full hostile bodies;
- one scoped raw-body parser for Stripe only; never globalize it.

### SSE scaling and lifecycle

Node's `response.write()` returning `false` means data is queued and the producer should wait for `drain`; ignoring this creates an unbounded slow-client memory risk ([Node HTTP response](https://nodejs.org/api/http.html)). An SSE implementation therefore needs backpressure, heartbeats, disconnect cleanup, idle/stale termination, and replay/`Last-Event-ID` only when the event model supports it. Fastify's official SSE plugin documents heartbeat, replay, and backpressure patterns ([`@fastify/sse`](https://github.com/fastify/sse)).

Browsers commonly cap HTTP/1.1 SSE connections to about six per browser/origin; HTTP/2 negotiates a stream limit instead ([MDN server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)). A terminal should multiplex symbols/topics over one connection per tab/app where feasible rather than opening one stream per widget. Multiple Node instances require a shared pub/sub source or sticky ownership; in-memory timers alone do not scale horizontally.

### Current repository collisions discovered during Phase 0

These are audit facts that affect interpretation of the research, not a proposed plan:

- `package-lock.json` resolves `@fastify/rate-limit` 11.1.0. The project's use of client-IP buckets with proxy trust intersects the official high-severity IPv6 bucket-bypass advisory affecting versions below 11.2.0; 11.2.0 is the patched version ([GHSA-grpc-p53c-r64v](https://github.com/fastify/fastify-rate-limit/security/advisories/GHSA-grpc-p53c-r64v)).
- `server.js` conditionally turns `TRUST_PROXY` into Fastify's boolean `trustProxy: true`; current Fastify guidance favors a specific hop/network or function.
- `server.js` sets several security headers manually but has no centralized CSP/HSTS/helmet policy and no explicit Fastify request/body timeout configuration.
- The quote SSE writes without checking the boolean return of `reply.raw.write()`, so it has no explicit slow-client backpressure path.
- Stripe's raw-body parser is correctly scoped inside the webhook plugin in `api/stripeBilling.js`; the project law to preserve that boundary is consistent with the research.

## Local quantitative collision points

These observations explain why the correctness doctrine is necessary. They are not implementation instructions.

| Area | Current evidence | Research implication |
|---|---|---|
| Greek units | `black-scholes.ts` documents raw annual theta/raw vega, while `greeks.ts` returns theta/day and vega/vol-point under the same general result family; rho stays raw. | Scale must be encoded in the canonical type/property and converted once. |
| Deribit pricing | `src/lib/options/deribit.ts` defaults to `r=0.04`, `q=0`, computes spot BSM Greeks, and constructs the forward from spot/rate. | This does not implement Deribit's forward-derived venue convention and can drift from exchange IV/Greeks. |
| IV solver | `ivSolver.ts` checks a loose lower bound, clamps volatility to `[0.001,5]`, then returns a rough moneyness/time proxy for sub-hour expiries. | An unbracketed or near-expiry failure must be explicit; a proxy must not be returned as solved IV. |
| SVI coordinate | `svi.ts` documents `k=ln(K/F)` but `fitSVI` receives `spot` and uses `ln(K/spot)`. | Fit coordinate and forward source must agree. |
| No-arbitrage claim | `projectNoArb` enforces positivity-like raw-SVI constraints and labels them no-calendar/no-butterfly; `noarb.ts` treats convexity of `IV²` in log-moneyness as butterfly freedom. | The current checks are not sufficient static-arbitrage guarantees under Gatheral/Jacquier. |
| Market/model separation | `interpolateSurface` replaces every row with fitted SVI values, interpolates missing expiries, copies neighboring rows, and finally fills remaining holes with one global fitted IV. | This violates fail-closed presentation if emitted as market data. Observed and model grids must be separate. |
| Positioning | `resolveExposureWeight` silently falls from OI to volume, then unit weight “so the dealer stack is never blank.” | A nonblank chart is not more truthful than an empty state; units and inference change under each fallback. |
| Dealer sign | Calls are assigned positive GEX and puts negative under a named “naive dealer convention.” | Keep the assumption visible and call the output a proxy; do not infer actual dealer inventory. |
| Funding/basis | Funding is displayed with simple `×3×365`; futures carry uses `(mark/index - 1)/T`. | The arithmetic is defensible only with “simple annualized” labels, raw values, and venue timestamps. |

## Correctness doctrine

This doctrine governs ties between formulas, sources, inherited behavior, and visual expectations.

### 1. Authority order

1. **Venue contract/API specification wins for venue instruments and fields.** It decides denomination, multiplier, expiry, settlement, forward/index choice, field units, funding mechanics, and what a mark means.
2. **Original mathematical literature wins for model definitions and formal constraints.** Black/Black-Scholes, Gatheral/Jacquier, and published numerical methods define the model—not a vendor screenshot.
3. **Mature independent implementations and published vectors win for numerical verification.** QuantLib/Haug/Jäckel serve as oracles; the same local function cannot generate and verify its own golden output.
4. **Transparent vendor methodology governs only that vendor's named metric.** Proprietary heuristics may be described, never silently reimplemented or claimed equivalent.
5. **Local code and legacy UI are evidence of current behavior, never authority for correctness.** A passing regression test can preserve an error; it must yield to higher authority with an explicit test migration.

When two higher-tier sources differ, the product/instrument context decides. The selected convention is recorded with a source link, effective date, and fixture. Ambiguity fails closed until resolved.

### 2. Market-data truth

- Every datum carries provider, venue, instrument, source timestamp, receive timestamp, native unit, and freshness state.
- Raw, normalized, and derived fields are different types/layers. Normalization never destroys the native value.
- Bid, ask, last, midpoint, mark, index, and forward are not interchangeable.
- Missing, stale, partial, crossed, out-of-domain, and provider-error states are explicit. `0`, a copied neighbor, or a smooth fitted value is never used as a missing-data substitute.
- Caching may return stale data only when the response and UI visibly say stale and include age. No stale response is labelled live.
- Public provider quotas are shared server-side. The browser never receives provider credentials or fans out directly.

### 3. Model and time selection

- Select the model from the contract, then select inputs. Never select a familiar formula first and force the instrument into it.
- Deribit inverse options use the venue's index/forward/time convention; equity European options use their declared dividend/rate/time assumptions; futures options use a forward model.
- Crypto pricing uses exact 24/7 calendar time on ACT/365F unless the venue states otherwise. Equity expiry uses the actual market expiry timestamp and a declared day-count. `252` is an estimator annualization, not an option-pricing clock.
- Curves/rates and dividends are sourced or explicitly assumed. A constant hidden rate is not a market fact.

### 4. Units and transformations

- Internal rates and volatility are decimals; exact year fractions are years; native prices retain denomination.
- Raw Greeks are mathematical derivatives. Per-day, per-vol-point, per-basis-point, notional, and per-1%-spot versions have distinct names and types.
- Contract multiplier and currency conversion are applied exactly once. Aggregation rejects mixed units unless a timestamped conversion makes them common.
- Every axis, KPI, export, and tooltip shows the unit and scenario shock. A formatter cannot change the underlying semantic type.

### 5. Numerics and verification

- Model-domain and no-arbitrage bounds are checked before solving IV.
- Solvers return a discriminated success/failure result with iterations, residual, bracket, and reason; no guessed fallback is reported as a solution.
- A solved IV must reprice to the target within declared absolute/relative tolerances.
- Prices and first-/higher-order Greeks are checked against independent golden vectors and finite differences at regular, near-expiry, low-vol, high-vol, deep ITM, and deep OTM points.
- Properties—parity, bounds, monotonicity, convexity, Greek signs/bounds, and IV round trip—run across generated grids.
- Venue reconciliation fixtures retain the raw response, capture time, instrument metadata, and expected normalization. Fixtures are refreshed intentionally, never by silently accepting new results.

### 6. Surfaces

- The raw quote matrix is immutable evidence. Bid, ask, midpoint, and mark surfaces are separate selections.
- Calibration uses forward log-moneyness and total variance with weights based on declared liquidity/spread rules.
- A fitted surface is labelled with model, calibration time, inputs/coverage, residual, constraints, and observed/model mask.
- Static-arbitrage validation occurs in price space and across maturities; a parameter clamp or visually smooth result is insufficient.
- Fitted/interpolated values may support analysis only. They never become quotes, fill an execution table, or hide a feed gap.

### 7. Funding, basis, and positioning

- Funding retains venue-native interval and direction. Annualized values state simple versus compounded and never erase the raw rate.
- Basis states absolute/percentage and simple/log annualization, exact DTE, spot/index source, and whether a point is actual or constant-maturity modelled.
- OI-derived exposures are scenario proxies. The sign convention, contract multiplier, shock unit, coverage, and timestamp are visible.
- No OI means no OI-weighted exposure. Volume/unit variants are different named analyses, not fallbacks.
- Proprietary vendor positioning is not claimed reproducible without the required trade/OI-change data and published method.

### 8. Visual and failure honesty

- Visual encoding cannot confer confidence the data lacks. Missing is not zero; model is not market; mark is not executable; proxy is not position.
- Diverging colors require a meaningful zero and a symmetric comparison domain. Sequential colors are used for magnitudes. Legends and exact-value tooltips are mandatory.
- Every analytical view exposes freshness, source, coverage, assumptions, and a route to raw detail.
- Empty/error states explain which prerequisite is absent and what can be retried. They do not generate synthetic content to preserve layout.
- If a result cannot satisfy this doctrine, the correct output is an explicit unavailable state.

## Source register

The links inline above are the citation of record. The most important authorities are:

- Deribit: [API documentation](https://docs.deribit.com/), [inverse options](https://support.deribit.com/hc/en-us/articles/31424939096093-Inverse-Options), [funding](https://support.deribit.com/hc/en-us/articles/31424939178397-Funding-Specifications), [mark prices](https://support.deribit.com/hc/en-us/articles/25944746962973-Mark-Prices), and [rate limits](https://docs.deribit.com/articles/rate-limits).
- Quantitative: [Black 1976](https://doi.org/10.1016/0304-405X%2876%2990024-6), [Gatheral/Jacquier SVI](https://arxiv.org/abs/1204.0646), [Jäckel IV inversion](https://doi.org/10.1002/wilm.10395), and [QuantLib European-option tests](https://github.com/lballabio/QuantLib/blob/master/test-suite/europeanoption.cpp).
- Vendor/methodology: [Amberdata derivatives](https://www.amberdata.io/derivatives-info), [Laevitas](https://app.laevitas.ch/), [Volmex](https://volmex.finance/docs), [MenthorQ](https://menthorq.com/guide/options-menu/), [ExoCharts](https://exocharts.com/features.html), and [TradingView footprint methodology](https://www.tradingview.com/support/solutions/43000726164-volume-footprint-charts-a-complete-guide/).
- Engineering: [React Compiler](https://react.dev/learn/react-compiler/introduction), [Zustand selectors](https://zustand.docs.pmnd.rs/reference/hooks/use-shallow), [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), and [Fastify rate-limit advisory](https://github.com/fastify/fastify-rate-limit/security/advisories/GHSA-grpc-p53c-r64v).
