/**
 * Rates / macro / greeks client.
 * Browser path: /api/macrovol/* → Node proxy → local FastAPI pipe that fans out to
 * real vendors (FRED, NYFed, yfinance, Frankfurter, FiscalData, CoinGecko, …).
 * "macrovol" is the route prefix only — not a market data vendor.
 */

const BASE = '/api/macrovol';

async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  // route-parity: GET /api/macrovol/*
  const res = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) {
    const msg = (data as { error?: string; detail?: string })?.error
      || (data as { detail?: string })?.detail
      || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  if (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) {
    throw new Error(String((data as { error: string }).error));
  }
  return data as T;
}

export const macrovolApi = {
  /** Probe rates summary as a cheap health check (proxy → local FRED/NYFed pipe). */
  health: async () => {
    try {
      await fetchJson(`${BASE}/rates/summary`);
      return { status: 'ok' as const };
    } catch {
      return { status: 'down' as const };
    }
  },

  ratesSummary: () => fetchJson<RatesSummary>(`${BASE}/rates/summary`),
  ratesCurve: () => fetchJson<RatesCurve>(`${BASE}/rates/curve`),
  ratesPlumbing: () => fetchJson<PlumbingData>(`${BASE}/rates/plumbing`),
  ratesBasis: () => fetchJson<BasisData>(`${BASE}/rates/basis`),
  ratesBasisHistory: (limit = 90) =>
    fetchJson<BasisHistoryData>(`${BASE}/rates/basis-history?limit=${limit}`),
  ratesCurveHistory: (periods = '1Y') =>
    fetchJson<RatesCurveHistory>(`${BASE}/rates/curve-history?periods=${encodeURIComponent(periods)}`),
  ratesShape: (history = 60) =>
    fetchJson<CurveShapeData>(`${BASE}/rates/shape?history=${history}`),
  ratesTermStructure: (T = 0.25) =>
    fetchJson<TermStructureData>(`${BASE}/rates/term-structure?T=${T}`),
  correlations: (window = 30, period = '1y') =>
    fetchJson<CorrelationData>(`${BASE}/rates/correlations?window=${window}&period=${encodeURIComponent(period)}`),

  macroSummary: () => fetchJson<MacroSummary>(`${BASE}/macro/summary`),
  /** Free FRED stress pack (HY/IG, VIX, BEI, USD, NFCI) — shared TTL via proxy. */
  macroStress: () => fetchJson<MacroStressPack>(`${BASE}/macro/stress`),
  /** Keyless OFR repo + ECB DFR — complements FRED stress (1h shared TTL). */
  macroPrimary: () => fetchJson<MacroPrimaryPack>(`${BASE}/macro/primary`),
  series: (id: string, limit = 500) =>
    fetchJson<SeriesData>(`${BASE}/macro/series/${encodeURIComponent(id)}?limit=${limit}`),

  stirStrip: () => fetchJson<StirStripData>(`${BASE}/stir/strip`),

  /** Japanese Government Bond curve from MoF Japan (real yields, not demo). */
  ratesJgbCurve: (compareDays = 365) =>
    fetchJson<JgbCurveData>(`${BASE}/rates/jgb-curve?compare_days=${compareDays}`),

  /** Multi-pair FX via Frankfurter / ECB (no key). */
  ratesFx: () => fetchJson<FxBoardData>(`${BASE}/rates/fx`),

  /** Upcoming U.S. Treasury auctions via FiscalData (no key). */
  ratesAuctions: (limit = 20) =>
    fetchJson<TreasuryAuctionsData>(`${BASE}/rates/auctions?limit=${limit}`),

  /** BTC/ETH spot from CoinGecko — Deribit backup (no key). */
  cryptoSpot: () => fetchJson<CryptoSpotData>(`${BASE}/crypto/spot`),

  /** US/DE/UK/FR/JP 10Y sovereign yields (FRED). */
  ratesGlobalYields: () => fetchJson<GlobalYieldsData>(`${BASE}/rates/global-yields`),

  /** BTC/ETH linear perp mark−index basis (Bybit public). */
  cryptoPerpBasis: () => fetchJson<PerpBasisData>(`${BASE}/crypto/perp-basis`),

  /** SEC EDGAR recent filings for equity ticker. */
  secContext: (symbol: string, limit = 8) =>
    fetchJson<SecContextData>(`${BASE}/sec/context/${encodeURIComponent(symbol)}?limit=${limit}`),

  /** Omit r to default to live SOFR (FRED). */
  surface: (ticker: string, r?: number | null, q = 0.0) => {
    const params = new URLSearchParams();
    if (r != null) params.set('r', String(r));
    params.set('q', String(q));
    return fetchJson<IVSurfaceData>(`${BASE}/surface/${encodeURIComponent(ticker)}?${params}`);
  },
  surfacePreview: (ticker: string) =>
    fetchJson(`${BASE}/surface/${encodeURIComponent(ticker)}/preview`),

  /**
   * Omit r → live SOFR / Treasury term (fail-closed).
   * Omit q → API estimates dividend yield from yfinance (no silent 1.3%).
   */
  greeks: (ticker: string, r?: number | null, q?: number | null) => {
    const params = new URLSearchParams();
    if (r != null) params.set('r', String(r));
    if (q != null) params.set('q', String(q));
    const qs = params.toString();
    return fetchJson<GreeksData>(
      `${BASE}/greeks/${encodeURIComponent(ticker)}${qs ? `?${qs}` : ''}`,
    );
  },
  greeksHistory: (ticker: string, period = '1mo') =>
    fetchJson<HistoryData>(`${BASE}/greeks/${encodeURIComponent(ticker)}/history?period=${encodeURIComponent(period)}`),
};

// ── Types ────────────────────────────────────────────────────

/**
 * Verbatim server cache envelope (`state/hit/ageMs/stale/coalesced/providerError`).
 * `fetchJson` preserves it without inference; staleness is ONLY `cache.stale`.
 * Missing/null = unknown (never stale); frozen `as_of` must never imply stale.
 * `ageMs` is milliseconds; `providerError` is a sanitized code (never a raw body).
 */
export interface CacheMeta {
  state?: string | null;
  hit?: boolean | null;
  ageMs?: number | null;
  stale?: boolean | null;
  coalesced?: boolean | null;
  providerError?: string | null;
}

export interface RatesSummary {
  sofr: number | null;
  effr: number | null;
  usy2: number | null;
  usy10: number | null;
  /** FRED percentage points (0.35 = 35 bps). */
  spread_2s10s: number | null;
  spread_3m10y: number | null;
  spread_unit?: string;
  spread_note?: string;
  risk_free_rate?: number | null;
  field_source?: Record<string, string>;
  obs_dates?: Record<string, string | null>;
  as_of?: string;
  source?: string;
  /**
   * Verbatim server cache envelope; staleness is ONLY `cache.stale === true`.
   * Missing/null = unknown (never stale); never infer staleness from `as_of`.
   */
  cache?: CacheMeta | null;
}

export interface RatesCurve {
  labels: string[];
  yields: (number | null)[];
  series_ids?: string[];
  obs_dates?: (string | null)[];
  note?: string;
  as_of?: string;
  source?: string;
}

/** Dual UST curve: live vs historical snapshot (default 1Y). */
export interface RatesCurveHistory {
  labels: string[];
  series_ids?: string[];
  today: (number | null)[];
  historical: (number | null)[];
  historical_dates?: (string | null)[];
  today_dates?: (string | null)[];
  today_as_of?: string | null;
  compare_as_of?: string | null;
  compare_label?: string;
  points?: Array<{
    label: string;
    today: number | null;
    historical: number | null;
    delta_bps?: number | null;
  }>;
  periods?: string;
  as_of?: string;
  source?: string;
  note?: string;
}

/** FX multi-pair board (Frankfurter / ECB). */
export interface FxPair {
  pair: string;
  rate: number | null;
  decimals?: number;
  note?: string;
}

export interface FxBoardData {
  base?: string;
  pairs: FxPair[];
  raw_usd_quotes?: Record<string, number>;
  ecb_date?: string | null;
  as_of?: string;
  source?: string;
  note?: string;
  error?: string;
}

/** Upcoming Treasury auctions (FiscalData). */
export interface TreasuryAuctionRow {
  auction_date?: string | null;
  issue_date?: string | null;
  announce_date?: string | null;
  security_type?: string | null;
  security_term?: string | null;
  cusip?: string | null;
  reopening?: string | null;
  offering_amt?: number | null;
  offering_label?: string | null;
}

export interface TreasuryAuctionsData {
  auctions: TreasuryAuctionRow[];
  next?: TreasuryAuctionRow | null;
  next_coupon?: TreasuryAuctionRow | null;
  count?: number;
  total_count?: number;
  total_offering_usd?: number | null;
  total_offering_label?: string | null;
  filter_from?: string;
  as_of?: string;
  source?: string;
  note?: string;
  error?: string;
}

/** CoinGecko BTC/ETH spot backup. */
export interface CryptoSpotAsset {
  id: string;
  symbol: 'BTC' | 'ETH' | string;
  spot_usd: number;
  change_24h_pct?: number | null;
  volume_24h_usd?: number | null;
  market_cap_usd?: number | null;
  last_updated_at?: number | null;
}

export interface CryptoSpotData {
  assets: CryptoSpotAsset[];
  btc?: CryptoSpotAsset | null;
  eth?: CryptoSpotAsset | null;
  as_of?: string;
  as_of_ms?: number | null;
  source?: string;
  note?: string;
  error?: string;
}

export interface GlobalYieldPoint {
  code: string;
  label: string;
  series_id?: string;
  yield_pct: number | null;
  obs_date?: string | null;
  source?: string;
}

export interface GlobalYieldsData {
  points: GlobalYieldPoint[];
  spreads_vs_us_bps?: Array<{ pair: string; bps: number; foreign: string }>;
  count_live?: number;
  as_of?: string;
  source?: string;
  note?: string;
  error?: string | null;
}

export interface PerpBasisRow {
  symbol: string;
  ccy: string;
  mark: number | null;
  index: number | null;
  last?: number | null;
  funding_rate?: number | null;
  funding_ann_approx?: number | null;
  basis_bps: number | null;
  open_interest?: number | null;
  error?: string;
}

export interface PerpBasisData {
  rows: PerpBasisRow[];
  btc?: PerpBasisRow | null;
  eth?: PerpBasisRow | null;
  count_live?: number;
  as_of?: string;
  source?: string;
  note?: string;
  error?: string | null;
}

export interface SecFiling {
  form: string;
  filing_date: string;
  description?: string | null;
  url?: string | null;
}

export interface SecContextData {
  symbol: string;
  cik?: string | null;
  name?: string | null;
  filings: SecFiling[];
  latest?: SecFiling | null;
  as_of?: string;
  source?: string;
  note?: string;
  error?: string | null;
}

/** Japanese Government Bond CMT curve (MoF Japan) — live vs ~1Y. */
export interface JgbCurveData {
  labels: string[];
  today: (number | null)[];
  historical: (number | null)[];
  points?: Array<{
    label: string;
    today: number | null;
    historical: number | null;
    delta_bps?: number | null;
  }>;
  today_as_of?: string | null;
  compare_as_of?: string | null;
  compare_label?: string;
  periods?: string;
  as_of?: string;
  source?: string;
  note?: string;
  currency?: string;
  unit?: string;
  error?: string;
}

export interface PlumbingData {
  iorb: number | null;
  sofr: number | null;
  effr: number | null;
  rrp_rate: number | null;
  rrp_rate_source?: string;
  rrp_rate_note?: string;
  rrp_volume_latest: number | null;
  rrp_volume_history: { date: string; volume: number }[];
  wresbal_history: { date: string; reserves: number }[];
  as_of?: string;
  source?: string;
}

export interface BasisData {
  sofr: number;
  effr: number;
  iorb: number;
  sofr_effr: number;
  sofr_iorb: number;
  effr_iorb: number;
  unit?: string;
  regime?: string;
  regime_note?: string;
  context?: Record<string, string>;
  obs_dates?: Record<string, string | null>;
  as_of?: string;
  source?: string;
}

export interface BasisHistoryPoint {
  date: string;
  sofr: number;
  effr: number;
  iorb: number;
  sofr_effr_bps: number;
  sofr_iorb_bps: number;
  effr_iorb_bps: number;
}

export interface BasisHistoryData {
  history: BasisHistoryPoint[];
  latest: BasisHistoryPoint | null;
  zscore: {
    sofr_effr: number | null;
    sofr_iorb: number | null;
    effr_iorb: number | null;
    window: number;
  };
  unit?: string;
  note?: string;
  as_of?: string;
  source?: string;
}

export interface MacroSummary {
  cpi_yoy: number | null;
  core_cpi_yoy: number | null;
  core_pce_yoy: number | null;
  nfp_mom: number | null;
  unemployment: number | null;
  retail_sales: number | null;
  housing_starts: number | null;
  fed_balance_sheet: number | null;
  units?: Record<string, string>;
  obs_dates?: Record<string, string | null>;
  fallback_fields?: string[];
  note?: string;
  as_of?: string;
  source?: string;
}

/** Free FRED risk/liquidity prints — one shared pack for the desk. */
export interface MacroStressPack {
  vix: number | null;
  hy_oas: number | null;
  ig_oas: number | null;
  bei_5y: number | null;
  bei_10y: number | null;
  real_10y: number | null;
  usd_broad: number | null;
  nfci: number | null;
  term_sofr_3m: number | null;
  units?: Record<string, string>;
  labels?: Record<string, string>;
  obs_dates?: Record<string, string | null>;
  field_source?: Record<string, string>;
  series_ids?: Record<string, string>;
  missing_fields?: string[];
  note?: string;
  as_of?: string;
  source?: string;
}

/** Keyless primary sources: OFR NY Fed repo + ECB DFR (not FRED VIXCLS). */
export interface MacroPrimaryPack {
  bgcr: number | null;
  tgcr: number | null;
  sofr_ofr: number | null;
  ecb_dfr: number | null;
  units?: Record<string, string>;
  labels?: Record<string, string>;
  obs_dates?: Record<string, string | null>;
  field_source?: Record<string, string>;
  series_ids?: Record<string, string>;
  missing_fields?: string[];
  note?: string;
  as_of?: string;
  source?: string;
}

export interface StirContract {
  contract: string;
  /** Board ticker e.g. SFRM6 */
  ticker?: string;
  month: string;
  implied_rate: number | null;
  /** Futures price (≈ 100 − implied rate) */
  last_price?: number | null;
  prev_close?: number | null;
  /** Settlement proxy = previous close (CME board) */
  settlement?: number | null;
  high?: number | null;
  low?: number | null;
  open?: number | null;
  volume?: number | null;
  product?: string | null;
  /** Price change last − prev */
  net?: number | null;
  change?: number | null;
  source: 'live' | 'fallback' | 'unavailable' | string;
  historical_1w?: number | null;
  historical_1m?: number | null;
  historical_3m?: number | null;
}

export interface NyFedRefPrint {
  code: string;
  rate?: number | null;
  p1?: number | null;
  p25?: number | null;
  p75?: number | null;
  p99?: number | null;
  volume_bn?: number | null;
  effective_date?: string | null;
  target_from?: number | null;
  target_to?: number | null;
}

/** Trader-facing implication chip from strip/spread levels */
export interface ImplyRead {
  bias: string;
  label: string;
  text: string;
  confidence?: string;
}

export interface SerffBoardRow {
  cc: string;
  name: string;
  description?: string;
  last_bps?: number | null;
  price_spread?: number | null;
  legs?: string[];
  /** 'serff' = listed same-month SR1−ZQ; 'derived-proxy' = cash-EFFR proxy (non-listed, non-executable) */
  kind?: 'serff' | 'derived-proxy' | string;
  ratio?: string | null;
  imply?: ImplyRead | null;
}

export interface StirSpread {
  name: string;
  kind:
    | 'calendar'
    | 'fly'
    | 'pack'
    | 'calendar-of-calendars'
    | 'serff'
    | 'derived-proxy'
    | 'inter'
    | 'cash'
    | string;
  legs: string[];
  ratio?: string | null;
  rate_bps: number | null;
  price_spread?: number | null;
  implied_rate?: number | null;
  note?: string;
  priority?: number;
  imply?: ImplyRead | null;
}

export interface StirSpreadsBlock {
  spreads: StirSpread[];
  by_kind?: Record<string, StirSpread[]>;
  counts?: Record<string, number>;
  note?: string;
  labels3?: string[];
}

export interface StirPathPoint {
  contract?: string;
  month?: string;
  ticker?: string;
  implied_rate: number | null;
  source?: string;
  vs_sofr_bps?: number | null;
  imply?: ImplyRead | null;
}

export interface StirStripData {
  sr3: StirContract[];
  sr1?: StirContract[];
  zq: StirContract[];
  treasury_futures?: StirContract[];
  live_count: number;
  settled_count?: number;
  live_sr1?: number;
  live_zq?: number;
  live_tsy?: number;
  total_sr3: number;
  fallback_count?: number;
  unavailable_count?: number;
  history_note?: string | null;
  quality_note?: string;
  delivery_note?: string;
  spreads?: StirSpreadsBlock;
  serff_board?: SerffBoardRow[];
  nyfed?: {
    rates?: Record<string, unknown>;
    sofr_avg?: {
      avg_30d?: number | null;
      avg_90d?: number | null;
      avg_180d?: number | null;
      index?: number | null;
      effective_date?: string | null;
    } | null;
    target?: { from?: number | null; to?: number | null; mid?: number | null } | null;
    corridor?: { sofr_effr_bps?: number | null };
    as_of?: string | null;
    source?: string;
    note?: string;
    ref_print?: NyFedRefPrint[];
  };
  effr?: number | null;
  iorb?: number | null;
  path?: {
    points: StirPathPoint[];
    live_count?: number;
    sofr?: number | null;
    path_change_bps?: number | null;
    approx_25bp_cuts_priced?: number | null;
    front_vs_sofr_bps?: number | null;
    note?: string;
    front?: StirPathPoint | null;
    back?: StirPathPoint | null;
    imply?: ImplyRead | null;
    front_imply?: ImplyRead | null;
  };
  chart?: Array<{
    x: string;
    contract?: string;
    ticker?: string;
    implied_rate: number | null;
    /** Prior settlement implied yield = 100 − settlement/prev_close */
    prior_rate?: number | null;
    source?: string;
    vs_sofr_bps?: number | null;
  }>;
  sofr?: number | null;
  as_of?: string;
  source?: string;
}

export interface CurveShapeSpread {
  pp: number | null;
  bps: number | null;
  formula?: string;
  note?: string;
  imply?: ImplyRead | null;
}

export interface CurveShapeData {
  spreads: Record<string, CurveShapeSpread>;
  levels: Record<string, number | null>;
  regime: string;
  regime_note?: string;
  imply?: ImplyRead | null;
  unit_note?: string;
  curve?: { labels: string[]; yields: (number | null)[]; obs_dates?: (string | null)[] };
  history?: {
    spark_2s10s?: number[];
    spark_5s30s?: number[];
    spark_2s5s?: number[];
    spark_5s10s?: number[];
    spark_10s30s?: number[];
    spark_3m10y?: number[];
    spark_fly?: number[];
    '2s10s'?: { date: string; spread_bps: number }[];
    '5s30s'?: { date: string; spread_bps: number }[];
    '2s5s'?: { date: string; spread_bps: number }[];
    '5s10s'?: { date: string; spread_bps: number }[];
    '10s30s'?: { date: string; spread_bps: number }[];
    '3m10y'?: { date: string; spread_bps: number }[];
    fly_2s5s10s?: { date: string; spread_bps: number }[];
  };
  as_of?: string;
  source?: string;
}

export interface TermStructureData {
  T: number;
  /** Interpolated rate (decimal). null = curve unavailable — never a fabricated default. */
  r: number | null;
  r_pct: number | null;
  available?: boolean;
  r_source?: string;
  curve_points?: { T: number; r: number; r_pct: number }[];
  curve_coverage?: { points: number; state: string };
  warnings?: string[];
  sofr?: number | null;
  as_of?: string;
  source?: string;
}

export interface SeriesData {
  series: string;
  data: { date: string; value: number }[];
  as_of?: string;
  source?: string;
}

export interface CorrelationData {
  instruments: string[];
  matrix: number[][];
  as_of?: string;
  note?: string;
  source?: string;
  error?: string;
}

export interface IVSurfaceData {
  ticker?: string;
  spot: number;
  strikes: number[];
  expiries: number[];
  iv_grid: number[][];
  raw_points?: number;
  r?: number;
  q?: number;
  r_source?: string;
  timestamp?: string;
  as_of?: string;
  source?: string;
  error?: string;
}

export interface GreeksPoint {
  T: number;
  K: number;
  iv: number;
  /** IV price basis: midpoint (two-sided) or last (fallback) — never midpoint-observed when last-derived. */
  iv_source?: 'midpoint' | 'last';
  /** Solved option price with preserved provenance. */
  price?: number;
  price_source?: 'midpoint' | 'last';
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  /** Missing OI is null/unavailable; provider-reported zero stays 0. */
  oi: number | null;
  type: 'call' | 'put';
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  vanna: number;
  charm: number;
}

/**
 * Structural provenance stamp for one interpolated Greeks model grid.
 * Mirrors services/rates-worker/services/greeks_provenance.py — the worker
 * emits this on every grid; only bid/ask/last quotes may be called observed.
 */
export interface GreeksSurfaceProvenance {
  kind: 'interpolated-model';
  method: string;
  derived_source: string;
  observed_fields: string[];
  quote_time: string | null;
  quote_time_note: string;
  side: string;
  unit: string;
  nullability: string;
}

export interface SurfaceGrid {
  T_vals: number[];
  K_vals: number[];
  grid: (number | null)[][];
  /** Structural provenance stamp emitted by the worker (never provider quotes). */
  provenance?: GreeksSurfaceProvenance;
}

/** Read a grid's structural provenance stamp, or null for legacy payloads. */
export function getSurfaceProvenance(grid: SurfaceGrid | null | undefined): GreeksSurfaceProvenance | null {
  if (!grid || typeof grid !== 'object') return null;
  const p = (grid as { provenance?: unknown }).provenance;
  if (!p || typeof p !== 'object') return null;
  return p as GreeksSurfaceProvenance;
}

/** Violation strings when a grid lacks valid structural provenance. */
export function validateSurfaceProvenance(grid: SurfaceGrid | null | undefined): string[] {
  const p = getSurfaceProvenance(grid);
  if (!p) return ['provenance missing: grid carries no structural provenance'];
  const violations: string[] = [];
  if (p.kind !== 'interpolated-model') violations.push('provenance.kind must be interpolated-model');
  if (!p.method) violations.push('provenance.method missing');
  if (!p.derived_source) violations.push('provenance.derived_source missing');
  if (!Array.isArray(p.observed_fields) || p.observed_fields.length === 0) {
    violations.push('provenance.observed_fields must be a non-empty list');
  }
  if (!p.side) violations.push('provenance.side missing');
  if (!p.unit) violations.push('provenance.unit missing');
  if (!p.quote_time_note) violations.push('provenance.quote_time_note missing');
  if (!p.nullability) violations.push('provenance.nullability missing');
  return violations;
}

export interface GreeksData {
  ticker: string;
  spot: number;
  timestamp?: string;
  total_points: number;
  atm: GreeksPoint | null;
  gex: { strike: number; gex: number }[];
  gex_flip?: { strike: number; spot_vs_flip: string; net_gex: number } | null;
  gex_convention?: string;
  points: GreeksPoint[];
  surfaces?: Record<string, SurfaceGrid>;
  gex_grid?: SurfaceGrid;
  charm_grid?: SurfaceGrid;
  r?: number;
  q?: number;
  r_source?: string;
  q_source?: string;
  r_mode?: string;
  units?: {
    delta?: string;
    gamma?: string;
    theta?: string;
    vega?: string;
    charm?: string;
    vanna?: string;
    surface_side?: string;
  };
  /** Explicit layer separation: observed quotes -> derived points -> interpolated model grid. */
  surface_provenance?: {
    observed: string;
    derived: string;
    model: string;
    model_kind: 'interpolated-model';
    model_method: string;
    surface_side: string;
    holes: string;
    oi: string;
    price_provenance: string;
  };
  points_provenance?: string;
  charm_note?: string;
  surface_note?: string;
  as_of?: string;
  source?: string;
  error?: string;
}

export interface HistoryData {
  ticker: string;
  data: { date: string; open: number; high: number; low: number; close: number; volume: number }[];
  as_of?: string;
  source?: string;
}
