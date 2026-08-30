/**
 * Shared desk feeds — browser only hits OUR backend.
 * Finnhub / Alpha Vantage / TradingView keys never leave the server.
 */

export interface DeskBudgets {
  fmp?: { used: number; capDaily: number };
  alphavantage?: { used: number; capDaily: number };
  finnhub?: { used: number; capDailySoft: number };
  tradingview?: { usedMonth: number; capMonthly: number; usedToday: number };
}

export interface DeskPack {
  symbol: string;
  finnhub_quote?: {
    price?: number | null;
    change_pct?: number | null;
    as_of?: string;
    fromCache?: boolean;
    ageMs?: number;
    error?: string | null;
    source?: string;
  };
  alphavantage_quote?: {
    price?: number | null;
    change_pct?: number | null;
    latest_trading_day?: string | null;
    as_of?: string;
    fromCache?: boolean;
    ageMs?: number;
    error?: string | null;
    source?: string;
  };
  alphavantage_daily?: {
    bars?: { date: string; close: number | null }[];
    count?: number;
    as_of?: string;
    fromCache?: boolean;
    error?: string | null;
  };
  alphavantage_overview?: {
    overview?: {
      name?: string | null;
      sector?: string | null;
      industry?: string | null;
      market_cap?: number | null;
      pe?: number | null;
      beta?: number | null;
      dividend_yield?: number | null;
      week52_high?: number | null;
      week52_low?: number | null;
      description?: string | null;
    } | null;
    as_of?: string;
    fromCache?: boolean;
    error?: string | null;
    source?: string;
  };
  finnhub_news?: unknown;
  finnhub_economic_calendar?: {
    events?: {
      id?: string;
      country?: string | null;
      event?: string | null;
      time?: string | null;
      impact?: string | null;
    }[];
    count?: number;
    error?: string | null;
    note?: string;
  };
  finnhub_recommendation?: {
    latest?: {
      period?: string | null;
      strongBuy?: number | null;
      buy?: number | null;
      hold?: number | null;
      sell?: number | null;
      strongSell?: number | null;
    } | null;
    error?: string | null;
  };
  finnhub_peers?: {
    peers?: string[];
    count?: number;
    error?: string | null;
  };
  derived?: {
    realized_vol_20d_pct?: number | null;
    realized_vol_note?: string;
  };
  tradingview?: {
    price?: number | null;
    change_pct?: number | null;
    error?: string | null;
    note?: string;
    source?: string;
    fromCache?: boolean;
  };
  budgets?: DeskBudgets | null;
  keys?: Record<string, boolean>;
  as_of?: string;
  note?: string;
}

export interface CacheStatus {
  status: string;
  budgets?: DeskBudgets;
  keys?: Record<string, boolean>;
  desk?: { equities: string[]; crypto: string[] };
  note?: string;
  entries?: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  // route-parity: /api/desk/pack | /api/cache/status
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  return data as T;
}

/** One shared board pack for Home (SPY default). */
export function fetchDeskPack(symbol = 'SPY'): Promise<DeskPack> {
  const q = new URLSearchParams({ symbol: symbol.toUpperCase() });
  return fetchJson(`/api/desk/pack?${q}`);
}

export function fetchCacheStatus(): Promise<CacheStatus> {
  return fetchJson('/api/cache/status');
}
