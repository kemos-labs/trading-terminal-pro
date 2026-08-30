/**
 * KSA / Tadawul board — browser reads shared Node cache only.
 * Never call SAHMK from the client.
 */

export type KsaSession = {
  timezone: string;
  local: string;
  weekday: string;
  tradingDay: boolean;
  phase: string;
  open: boolean;
  sessionNote: string;
};

export type KsaMover = {
  symbol: string;
  name?: string;
  name_en?: string;
  price?: number;
  change?: number;
  change_percent?: number;
  volume?: number;
  value?: number;
  updated_at?: string;
};

export type KsaQuote = {
  symbol: string;
  name?: string;
  name_en?: string;
  price?: number;
  change?: number;
  change_percent?: number;
  open?: number;
  high?: number;
  low?: number;
  previous_close?: number;
  volume?: number;
  value?: number;
  bid?: number;
  bid_size?: number;
  ask?: number;
  ask_size?: number;
  liquidity?: {
    inflow_value?: number;
    outflow_value?: number;
    net_value?: number;
    inflow_volume?: number;
    outflow_volume?: number;
  };
  is_delayed?: boolean;
  updated_at?: string;
  error?: string;
};

export type KsaSector = {
  sector_name?: string;
  sector_name_ar?: string;
  change_percent?: number;
  avg_change_percent?: number;
  volume?: number;
  num_stocks?: number;
};

export type KsaBoard = {
  configured?: boolean;
  unusable?: boolean;
  session?: KsaSession;
  tasi?: {
    index?: string;
    index_value?: number;
    index_change?: number;
    index_change_percent?: number;
    total_volume?: number;
    advancing?: number;
    declining?: number;
    unchanged?: number;
    market_mood?: string;
    is_delayed?: boolean;
    error?: string;
   timestamp?: string; };
  nomu?: {
    index?: string;
    index_value?: number;
    index_change?: number;
    index_change_percent?: number;
    total_volume?: number;
    is_delayed?: boolean;
    error?: string;
  };
  gainers?: KsaMover[];
  losers?: KsaMover[];
  volumeLeaders?: KsaMover[];
  valueLeaders?: KsaMover[];
  sectors?: KsaSector[];
  mega?: KsaQuote[];
  /** Derived depth — charts/history from shared pack (no extra SAHMK). */
  depth?: KsaBoardDepth;
  is_delayed?: boolean;
  data_mode?: string;
  source?: string;
  fromCache?: boolean;
  ageMs?: number;
  stale?: boolean;
  budget?: { used?: number; capDaily?: number; softCap?: number; note?: string };
  as_of?: string;
  error?: string;
  code?: string;
  hint?: string;
  errors?: string[];
};

export type KsaHistoryPoint = {
  t: string;
  ts: number;
  tasi: number;
  tasiChgPct?: number | null;
  nomu?: number | null;
  nomuChgPct?: number | null;
  volume?: number | null;
  adv?: number;
  dec?: number;
  unc?: number;
  breadth?: number | null;
  mood?: string | null;
  topSector?: { name?: string; pct?: number } | null;
  bottomSector?: { name?: string; pct?: number } | null;
};

export type KsaBoardDepth = {
  breadth?: {
    adv: number;
    dec: number;
    unc: number;
    total: number;
    ratio: number | null;
    advShare: number | null;
  };
  sectorBars?: { name: string; pct: number; volume?: number | null; n?: number | null }[];
  moverBars?: { symbol: string; name?: string; pct: number; side?: string }[];
  volLeaders?: { symbol: string; name?: string; volume: number; pct?: number | null }[];
  history?: KsaHistoryPoint[];
  historyNote?: string;
};

/** Client poll interval — server board TTL 30m; poll Node cache only. */
export const KSA_BOARD_POLL_MS = 5 * 60_000;

export function normalizeKsaSymbolClient(raw: string): string | null {
  let s = raw.trim().toUpperCase();
  if (s.endsWith('.SR') || s.endsWith('.SA')) s = s.slice(0, -3);
  s = s.replace(/[^0-9]/g, '');
  if (!s || s.length > 6) return null;
  return s;
}

export async function fetchKsaBoardClient(): Promise<KsaBoard> {
  const res = await fetch('/api/ksa/board');
  const data = (await res.json()) as KsaBoard;
  if (!res.ok && !data.session) {
    return {
      ...data,
      error: data.error || `HTTP ${res.status}`,
    };
  }
  return data;
}

export async function fetchKsaQuoteClient(symbol: string): Promise<{
  quote?: KsaQuote;
  error?: string;
  session?: KsaSession;
  as_of?: string;
}> {
  const sym = normalizeKsaSymbolClient(symbol);
  if (!sym) return { error: 'Invalid symbol (use e.g. 2222)' };
  const res = await fetch(`/api/ksa/quote/${encodeURIComponent(sym)}`);
  const data = await res.json();
  return data;
}
