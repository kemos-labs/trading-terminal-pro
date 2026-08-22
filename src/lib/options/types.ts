export interface OptionQuote {
  strike: number;
  expiry: string;
  type: 'call' | 'put';
  bid: number;
  ask: number;
  last: number;
  mid: number;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  vanna: number | null;
  charm: number | null;
  volga: number | null;
  speed: number | null;
  rho: number | null;
  veta: number | null;
  color: number | null;
  zomma: number | null;
  ultima: number | null;
  openInterest: number;
  volume: number;
}

export interface OptionChain {
  symbol: string;
  spot: number;
  riskFreeRate: number;
  dividendYield: number;
  expiries: string[];
  quotes: OptionQuote[];
  timestamp: number;
}

export interface SurfaceGrid {
  expiries: string[];
  /** Days to expiration per row (parallel to `expiries`). Required for calendar arbitrage checks. */
  dtes: number[];
  strikes: number[];
  iv: (number | null)[][];
  bid: (number | null)[][];
  ask: (number | null)[][];
  delta: (number | null)[][];
}

export interface GEXPoint {
  strike: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
}

export interface GEXProfile {
  points: GEXPoint[];
  totalGEX: number;
  gammaFlip: number | null;
  callWall: number | null;
  putWall: number | null;
}

export interface TermStructurePoint {
  expiry: string;
  dte: number;
  atmIV: number;
  forwardIV: number | null;
}

export interface SVIParams {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
}

export interface SVIFit {
  params: SVIParams;
  rmse: number;
  samples: number;
}

/** Listed futures / perpetual mark (Deribit, etc.) for market basis. */
export interface FuturesMark {
  instrument: string;
  /** ISO date YYYY-MM-DD; null for perpetual */
  expiry: string | null;
  /** Calendar days to expiry; null for perpetual */
  dte: number | null;
  /** Mark price in quote currency (USD for Deribit BTC/ETH) */
  mark: number;
  /** Index / spot at fetch */
  index: number;
  /** mark − index */
  basis: number;
  /** Annualized (mark/index − 1) / T when T known */
  annCarry: number | null;
  isPerp?: boolean;
}

export interface VolSnapshot {
  symbol: string;
  spot: number;
  riskFreeRate: number;
  dividendYield: number;
  timestamp: number;
  expiries: ExpirySlice[];
  /** How the surface was built (live chain vs synthetic fallback). */
  surfaceSource?: 'live' | 'synthetic';
  /**
   * Contract multiplier for GEX / notional (equities 100, Deribit crypto 1).
   * Defaults to 100 when omitted.
   */
  contractSize?: number;
  /** Optional annualized funding (crypto perps) for basis/carry tools. */
  fundingAnn?: number;
  /** Live futures / perp marks when available (Deribit). */
  futuresMarks?: FuturesMark[];
}

export interface ExpirySlice {
  expiry: string;
  dte: number;
  calls: OptionQuote[];
  puts: OptionQuote[];
  atmIV: number;
  /** Implied forward from put–call parity (when available). */
  forward?: number;
  /** Tenor-matched risk-free rate used for this slice. */
  riskFreeRate?: number;
  /** Effective continuous dividend yield used for this slice. */
  dividendYield?: number;
}

export interface HistoricalFrame {
  snapshot: VolSnapshot;
  surface: SurfaceGrid;
  timestamp: number;
}

export type DisplayMode = 'strike' | 'moneyness' | 'delta';
/** Top-level desk tabs — keep in sync with components/terminal/tabs.ts */
export type ActiveTab =
  | 'vol'
  | 'positioning'
  | 'desk'
  | 'crypto'
  | 'rates'
  | 'academy'
  | 'ksa';


export interface GreeksProfile {
  strikes: number[];
  values: number[];
}

export interface SensitivityMatrix {
  spotShocks: number[];
  ivShocks: number[];
  delta: number[];
  gamma: number[];
  vega: number[];
  theta: number[];
}

// ── FlashAlpha types ────────────────────────────────────────

export interface FALevelStack {
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
  topOI: number | null;
  mp: number | null;
}

export interface FALevels {
  symbol: string;
  as_of: string;
  levelStack: FALevelStack;
  netGEX: number | null;
  dealerCushion: number | null;
  flipDistancePct: number | null;
  source: 'flashalpha';
}

export interface FAGexStrike {
  strike: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
}

export interface FAGexProfile {
  symbol: string;
  expiration: string;
  strikes: FAGexStrike[];
  totalGEX: number;
  as_of: string;
  source: 'flashalpha';
}
