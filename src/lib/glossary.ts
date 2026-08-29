// Plain-English, beginner-friendly explanations for every metric shown in the
// terminal's tools. Keyed by a stable term id used by the <Explain> component.
// Keep each body to 1-3 short sentences and always state the sign/unit
// convention so a newcomer can read the number correctly.

export interface GlossaryEntry {
  title: string;
  body: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  // ---- Greeks ---------------------------------------------------------------
  delta: {
    title: 'Delta (Δ)',
    body: 'How much the option price moves per $1 move in the stock. Calls are positive (0 to +1), puts are negative (0 to −1). Roughly the odds the option finishes in-the-money.',
  },
  gamma: {
    title: 'Gamma (Γ)',
    body: 'How fast delta changes as the stock moves. For a long option gamma is ALWAYS positive — it can never be negative. Largest near the money and for short expirations; it is what makes delta "accelerate".',
  },
  theta: {
    title: 'Theta (Θ)',
    body: 'Time decay per day. Long options usually have negative θ (you pay for time). Short θ is NOT free income — it compensates for expected gamma/volga/vanna risk (Taylor/GVV). Shown per 1 day.',
  },
  taylorGvv: {
    title: 'Taylor / GVV identity',
    body: 'dV ≈ θ dt + Δ dS + ν dσ + ½ Γ dS² + ½ Volga dσ² + Vanna dS dσ. Short option θ is the premium for taking those second-order risks — not a free carry.',
  },
  // vega shown per 1 vol point (market convention)
  vega: {
    title: 'Vega (ν)',
    body: 'How much the option price changes per 1-point (1%) move in implied volatility. Always positive for a long option. Bigger for longer expirations.',
  },
  rho: {
    title: 'Rho (ρ)',
    body: 'How much the option price changes per 1-point move in interest rates. Small for short-dated options, bigger for long ones. Calls positive, puts negative.',
  },
  vanna: {
    title: 'Vanna',
    body: 'How delta changes when volatility changes (∂Δ/∂σ). Dealers rehedge when IV moves: e.g. a vol drop on a short-call book can force futures buying. Often conflicts with charm mid-session — path is contingent, not one-way.',
  },
  volga: {
    title: 'Volga / Vomma',
    body: 'How vega changes as implied volatility changes. Positive means vega grows when vol rises. Important for volatility trades and wing risk.',
  },
  charm: {
    title: 'Charm',
    body: 'How delta changes as time passes (Δ decay per calendar day). MM read: reprice the book a few minutes later, then hedge the new delta. Short calls decaying toward 0Δ → dealers unwind long futures (sell); morning is often active/vanna, midday weights charm more.',
  },
  speed: {
    title: 'Speed',
    body: 'The rate of change of gamma with respect to the stock price. A third-order Greek used in exotic/structured hedging.',
  },
  veta: {
    title: 'Veta',
    body: 'How vega changes as time passes. A higher-order volatility-time Greek.',
  },
  color: {
    title: 'Color / Dcolor',
    body: 'How gamma changes as time passes. A third-order Greek; relevant to gamma-scalping horizon.',
  },
  zomma: {
    title: 'Zomma',
    body: 'How gamma changes when volatility changes. Third-order cross Greek between spot and vol.',
  },
  ultima: {
    title: 'Ultima',
    body: 'How volga changes as the stock moves. A fourth-order Greek, rarely hedged directly.',
  },

  // ---- Greeks aggregates ----------------------------------------------------
  netDelta: {
    title: 'Net Delta',
    body: 'Sum of deltas across the whole option book, in shares of stock equivalent. Positive = long exposure (benefits if stock rises).',
  },
  netGamma: {
    title: 'Net Gamma',
    body: 'Sum of gammas across the book. Positive net gamma means you profit from big moves in either direction; negative means you lose from them (and must re-hedge).',
  },
  netVega: {
    title: 'Net Vega',
    body: 'Sum of vegas across the book. Positive = you profit if implied volatility rises.',
  },
  netTheta: {
    title: 'Net Theta',
    body: 'Sum of thetas across the book (per day). Positive = you collect time decay; negative = time decay costs you.',
  },

  // ---- Volatility -----------------------------------------------------------
  iv: {
    title: 'Implied Volatility (IV)',
    body: 'The volatility the market is pricing into the option, expressed as an annualized %. Higher IV = pricier options = bigger expected moves. This is the vertical axis of the 3D surface.',
  },
  atmIV: {
    title: 'ATM IV',
    body: 'Implied volatility of the option whose strike is closest to the current stock price (at-the-money). The benchmark vol for that expiration.',
  },
  impliedVol: {
    title: 'Implied Volatility',
    body: 'The volatility implied by an option’s market price. Read it as the market’s forecast of annualized price swings.',
  },
  smile: {
    title: 'Vol Smile / Skew',
    body: 'The curve of IV across strikes for one expiration. A "smile" rises on both ends; a "skew" (equities) rises on the put side — downside protection costs more.',
  },
  skew: {
    title: 'Skew',
    body: 'How IV tilts across strikes. Equity indexes usually show negative skew: puts (downside) are pricier than calls. Steeper skew = market fears a drop.',
  },
  riskReversal: {
    title: 'Risk Reversal (25Δ RR)',
    body: 'IV(25Δ put) − IV(25Δ call), equity-desk convention. Positive = put wing richer (downside fear); negative = call wing richer (upside demand). Quoted in vol points.',
  },
  butterfly: {
    title: 'Butterfly (25Δ Fly)',
    body: 'Average of the 25Δ call & put IV minus ATM IV. Measures the curvature (convexity) of the smile. High fly = fat wings / kinked smile.',
  },
  termStructure: {
    title: 'Term Structure',
    body: 'How ATM IV changes across expirations (short to long dated). Read it as the market’s volatility calendar.',
  },
  contango: {
    title: 'Contango',
    body: 'Longer-dated IV is higher than short-dated IV. The normal state — vol is expected to revert upward over time.',
  },
  backwardation: {
    title: 'Backwardation',
    body: 'Short-dated IV is higher than long-dated IV. Signals stress/urgency (e.g. before earnings or in a crash).',
  },
  volRegime: {
    title: 'Volatility Regime',
    body: 'The current level of front-month ATM IV — low / normal / elevated — versus its own recent range. Context for whether options are cheap or expensive.',
  },
  ivRank: {
    title: 'IV Rank',
    body: 'Where today’s IV sits within its recent historical range, as a %. 100% = highest IV seen; 0% = lowest. High rank = options relatively expensive.',
  },

  // ---- Gamma exposure / dealer stack ----------------------------------------
  gex: {
    title: 'Gamma Exposure (GEX)',
    body: 'Dealers’ net gamma by strike ($ γ for a 1% move). GEX+ = long γ (buy dips / sell rips → dampen). GEX− = short γ (“toxic” / unstable: sell dips / buy rips → amplify; think lack of liquidity, not a direction). Assumes customers long listed OI.',
  },
  dex: {
    title: 'Delta Exposure (DEX)',
    body: 'Signed $ delta of listed open interest by strike (δ · S · OI · mult). Shows where dealer delta inventory (and hedge pressure) concentrates if customers are long options.',
  },
  vex: {
    title: 'Vanna Exposure (VEX)',
    body: 'Vanna · S · OI · mult by strike. Maps how dealer delta shifts when IV moves — the “vol drop = rally” (or sell) tape many 0DTE days. Pair with charm: they often conflict.',
  },
  charmExposure: {
    title: 'Charm Exposure',
    body: 'Overnight $ delta bleed of listed OI: (charm/day) · S · OI · mult. Even if spot is flat, dealers rehedge time decay — classic pin / grind into expiry. Positive listed charm under dealer-short OI often means futures selling pressure.',
  },
  dealerStack: {
    title: 'Dealer Stack',
    body: 'GEX + DEX + VEX + Charm: one strike map of how MM hedges may respond to spot, vol, and time. Use levels as test / range boundaries — not free signals. OI-based inference ≠ verified dealer books.',
  },
  hedgeFlow: {
    title: 'Hedge Flow Brief',
    body: 'Plain-English read of net GEX, charm, and vanna: dampen vs amplify γ regime, time-decay rehedge bias, and whether charm/vanna conflict. Educational path framing from inventory math — not a buy/sell call.',
  },
  riskBudget: {
    title: 'Risk Budget (stop vs option)',
    body: 'ATM call ≈ 0.4·S·σ√T. A perp stopped at that premium distance has ~69% chance of touch before T (reflection). For ~50% touch use ~0.67·S·σ√T ≈ 1.7× premium. Same risk budget as the long option; different path distribution.',
  },
  parityEdge: {
    title: 'Put–Call Parity Edge',
    body: 'Residual of C−P vs cash-and-carry forward. Large residual vs bid/ask half-spreads can flag conversion/reversal opportunities — check American exercise, borrow, and dividends first.',
  },
  gammaFlip: {
    title: 'Gamma Flip',
    body: 'Strike where cumulative net GEX crosses zero. With net long γ above the flip, hedges tend to dampen; below (short γ) they can amplify. Mixed when net GEX sign and spot-vs-flip disagree — treat as transition risk.',
  },
  callWall: {
    title: 'Call Resistance (CR)',
    body: 'Strike with the largest call GEX — Call Resistance wall. A common test level / range ceiling where dealer hedging can cap rallies if inventory holds.',
  },
  putWall: {
    title: 'Put Support (PS)',
    body: 'Strike with the most negative put GEX — Put Support wall. A common test level / range floor where dealer hedging can support or pin price.',
  },
  highVolLevel: {
    title: 'High Vol Level (HVL)',
    body: 'Strike of maximum |net GEX| on the book — a “vol magnet” / key γ node. Spot vs HVL frames whether the structure is still intact. Public OI proxy, not proprietary MenthorQ levels.',
  },
  gexProfile: {
    title: 'GEX Profile',
    body: 'Shape of net gamma exposure across strikes (bars) and often a cumulative profile line. +GEX clusters dampen; −GEX troughs can amplify path.',
  },
  dexProfile: {
    title: 'DEX Profile',
    body: 'Delta exposure across strikes — directional hedge pressure as spot walks. Sister to GEX: γ dampens/amplifies size of moves; DEX tilts hedge direction.',
  },
  dealerGradient: {
    title: 'Dealer 3-pane (VS3D B3 layout)',
    body: 'Dashboard strip: Positions by Strike (listed put← / call→ OI) beside dual Gamma and Charm gradients (K × DTE heat). Green/red lobes = where γ dampens/amplifies and where charm rehedge concentrates. Live-chain cross-section only — not multi-day TRACE tape, not proprietary MM inventory. Click a cell to isolate that expiry on the dealer chart.',
  },
  gexChange1d: {
    title: 'GEX / DEX Change 1D',
    body: 'Change in net dealer GEX or DEX vs the prior calendar day’s last sample in this browser (localStorage). Session Δ uses the first sample of today. OI-inferred only — not exchange open interest flow prints. Empty until a prior day is recorded.',
  },
  cashFuturesBasis: {
    title: 'Cash–futures basis (UST)',
    body: 'Classic relative-value: long cash CTD bond, short Treasury futures, finance in repo. Leverage + margin + rollover risk drive unwind risk when funding tightens (SOFR vs EFFR, RRP drain). The terminal pairs continuous futures marks with cash yields for context — not CTD-adjusted basis or G-SIB scores.',
  },
  equityForwardBasis: {
    title: 'Equity forward / basis',
    body: 'F − S along the option chain: market futures marks when present, else theo F = S e^{(r−q)T}. Annualized carry (F/S − 1)/T. For equities this is the listed cash–forward curve, not UST CTD basis.',
  },
  plumbingRegime: {
    title: 'Plumbing regime',
    body: 'Funding-corridor state from SOFR−EFFR, RRP, and reserves: excess cash (RRP elevated) vs private-repo / excess collateral (RRP drained). Educational — not a G-SIB score.',
  },
  sofrEffr: {
    title: 'SOFR − EFFR',
    body: 'Secured overnight vs effective fed funds. Positive SOFR−EFFR can flag dealer balance-sheet / capacity stress in private repo relative to unsecured EFFR prints.',
  },
  maxPain: {
    title: 'Max Pain',
    body: 'Strike where the most option contracts expire worthless — the point of least total payout to holders. A magnet some traders watch into expiration.',
  },
  keyLevels: {
    title: 'Key Levels',
    body: 'Inventory-defined levels desks watch as range boundaries: walls, max pain, gamma-flip, expected-move bands. Price often “tests” them; breaks can cascade when hedges flip.',
  },

  // ---- Expected move --------------------------------------------------------
  expectedMove: {
    title: 'Expected Move',
    body: 'Market-implied ~1σ move to the front expiry: ATM straddle / 0.8 (near-term BS ATM rule of thumb). Fallback S·ATM IV·√T when no liquid straddle.',
  },
  impliedMove: {
    title: 'Implied Move',
    body: 'Dollar/% 1σ move implied by the front ATM straddle (straddle ≈ 0.8 × 1σ).',
  },
  probTouch: {
    title: 'Prob Touch',
    body: 'Approx. probability of touching the +expected-move level before expiry under zero-drift BM (reflection: 2·N(−d)). One-sided; not a two-barrier finish probability. Related: stop at ATM premium (~0.4σ) touches ~69% of the time.',
  },

  // ---- Surface / model health ----------------------------------------------
  surface: {
    title: 'Vol Surface',
    body: 'Implied volatility plotted across every strike (x) and expiration (z), drawn as a 3D landscape. It is the core input for pricing and risk.',
  },
  sviRmse: {
    title: 'SVI RMSE',
    body: 'Fit error of the stochastic-volatility-inspired (SVI) model to the raw surface, as a %. Lower = the smooth fitted surface matches real quotes more closely.',
  },
  arbitrage: {
    title: 'Arbitrage Violations',
    body: 'Spots where the raw vol surface breaks no-arbitrage rules (e.g. a calendar or butterfly that could be traded for risk-free profit). Red = violation; green = clean.',
  },
  calendarArb: {
    title: 'Calendar Arbitrage',
    body: 'When total variance is not increasing with time to expiration — a theoretical free-profit (or pricing error). Flagged red on the surface.',
  },
  butterflyArb: {
    title: 'Butterfly Arbitrage',
    body: 'When the convexity of the IV curve is negative — a risk-free butterfly profit (or bad quote). Flagged red on the surface.',
  },
  synthetic: {
    title: 'Synthetic Data',
    body: 'Not live market data. The terminal is showing a generated/demo surface (e.g. no API key or live feed unavailable). Switch to LIVE for real quotes.',
  },
  portfolioRisk: {
    title: 'Chain Inventory (not a book)',
    body: 'Sum of listed option Greeks across the chain — NOT your position risk. Scales with how many strikes are quoted. Use MM Desk multi-leg tools for real book risk once you have a blotter.',
  },

  // ---- Market / chain columns ----------------------------------------------
  spot: {
    title: 'Spot',
    body: 'The live price of the underlying stock/index right now. The reference point for moneyness and the surface.',
  },
  moneyness: {
    title: 'Moneyness',
    body: 'How far a strike is from spot, as a %. 0% = at-the-money; negative = in-the-money calls / out-of-the-money puts; positive = the opposite.',
  },
  strike: {
    title: 'Strike',
    body: 'The fixed price at which the option can be exercised. Columns left of the center are calls, right are puts.',
  },
  dte: {
    title: 'DTE',
    body: 'Days To Expiration — time left until the option expires. Shorter DTE = cheaper but faster-decaying options.',
  },
  bid: {
    title: 'Bid',
    body: 'The highest price a buyer is willing to pay right now. You sell at the bid.',
  },
  ask: {
    title: 'Ask',
    body: 'The lowest price a seller will accept right now. You buy at the ask.',
  },
  mid: {
    title: 'Mid',
    body: 'The midpoint of bid and ask — the fair mark used for pricing and the surface.',
  },
  openInterest: {
    title: 'Open Interest (OI)',
    body: 'Total number of open contracts. A gauge of liquidity and where positions are concentrated (walls form here).',
  },
  volume: {
    title: 'Volume (Vol)',
    body: 'Number of contracts traded today. Shows intraday activity; pair with OI to see whether positions are building or closing.',
  },
  beta: {
    title: 'Beta',
    body: 'How much the stock moves relative to the broader market (S&P 500). Beta 1.2 ≈ moves 20% more than the market.',
  },
  marketCap: {
    title: 'Market Cap',
    body: 'Total value of the company’s shares (share price × shares outstanding). Size context for the name.',
  },
  sma20: {
    title: 'SMA 20',
    body: '20-day Simple Moving Average of price — the short-term trend line. Price above it = short-term uptrend.',
  },
  sma50: {
    title: 'SMA 50',
    body: '50-day Simple Moving Average — the medium-term trend line. Often used as a support/resistance level.',
  },
  bollinger: {
    title: 'Bollinger Bands (20,2)',
    body: 'Price bands 2 standard deviations above/below the 20-day average. Wide bands = high volatility; price hugging a band = a strong move.',
  },

  // ---- MM desk / Thalex-style tools ----------------------------------------
  hedgePnl: {
    title: 'Hedged PnL',
    body: 'Mark-to-model P&L of the option plus its delta hedge (cash + stock/future). Shows the residual risk after rebalancing.',
  },
  nd2: {
    title: 'N(d2)',
    body: 'Black–Scholes risk-neutral probability the option finishes in-the-money. Related to digital pricing; 1/N(d2) is sometimes read as payoff-odds leverage.',
  },
  rollPnl: {
    title: 'Roll / Funding PnL',
    body: 'Carry from holding a forward/perp: notional × annualized funding × time. Positive funding pays longs; negative pays shorts (crypto perps).',
  },
  omega: {
    title: 'Omega (elasticity)',
    body: 'ω = Δ · S / V — percent change in option value per percent change in spot. High omega = leveraged directional exposure per premium dollar.',
  },
  vrp: {
    title: 'Variance Risk Premium',
    body: 'Gap between implied vol and realized vol (e.g. ATM IV vs RV20), not ATM vs VIXCLS unless you label that as VIX basis. Positive VRP means you think options are rich → short vol edge. Short weekly straddles harvest VRP when IV > RV after hedges — more γ risk and often more edge in shorter DTE.',
  },
  collar: {
    title: 'Collar (25Δ-style)',
    body: 'Long OTM put + short OTM call vs long stock/crypto: cuts delta and drawdown, sells upside. Rolling short-dated collars converts premium P&L into a risk budget you can reinvest — risk reduction that can fund risk expansion.',
  },
  shortStraddle: {
    title: 'Short Straddle (hedged)',
    body: 'Sell ATM call+put, delta-hedge on a schedule. If IV ≈ RV, γ P&L and θ offset. Edge comes from variance risk premium and strike/time selection (e.g. weekly roll). More γ on short DTE = higher P&L vol and often higher Sharpe when premium is rich.',
  },
};
