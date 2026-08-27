import type { ActiveTab } from '../lib/options/types';

export type DeskNavItem = {
  id: string;
  label: string;
  short?: string;
  /** Upstream APIs for context line */
  apis?: string[];
};

/**
 * Macros & Rates section anchors (must match element ids).
 *
 * Option A — relevance-first (USD regime → US rates → G10 → FX → Japan → risk):
 *  1. US Macro — reserve currency sets the regime
 *  2. Money markets — SOFR/EFFR/IORB/OBFR primary prints
 *  3. ON basis history — visual for the same spreads
 *  4. Fed plumbing — RRP / reserves
 *  5. UST data then curves — discounting curve
 *  6. STIR / NY Fed — path + official prints
 *  7. Global 10Y → FX → Japan — DM relevance then carry special
 *  8. Premium / corr — risk book last
 */
/**
 * Rates red-bar = 4 modes only (not 17 section chips).
 * Deep-link ids (sec-stir, sec-mm-strip, …) still map to modes in RatesView.
 */
export const RATES_SECTIONS: DeskNavItem[] = [
  { id: 'rates-mode-funding', label: 'Funding', short: 'Fund', apis: ['FRED', 'NYFed'] },
  { id: 'rates-mode-ust', label: 'UST', short: 'UST', apis: ['FRED', 'FiscalData'] },
  { id: 'rates-mode-stir', label: 'STIR', short: 'STIR', apis: ['yfinance', 'NYFed', 'FRED'] },
  { id: 'rates-mode-world', label: 'World', short: 'World', apis: ['FRED', 'Frankfurter', 'MoF'] },
];

/** Legacy section id → rates mode (function codes / scroll targets). */
export const RATES_SECTION_TO_MODE: Record<string, 'funding' | 'ust' | 'stir' | 'world'> = {
  'rates-mode-funding': 'funding',
  'rates-mode-ust': 'ust',
  'rates-mode-stir': 'stir',
  'rates-mode-world': 'world',
  'sec-macro': 'funding',
  'sec-mm-strip': 'funding',
  'sec-basis': 'funding',
  'sec-cash-futures': 'funding',
  'sec-plumbing': 'funding',
  'sec-snapshot': 'funding',
  'sec-ust-data': 'ust',
  'sec-curves': 'ust',
  'sec-shape': 'ust',
  'sec-auctions': 'ust',
  'sec-stir': 'stir',
  'sec-nyfed': 'stir',
  'sec-global': 'world',
  'sec-fx': 'world',
  'sec-japan': 'world',
  'sec-premium': 'world',
  'sec-corr': 'world',
  'sec-asset-corr': 'world',
};

/** Vol = surface structure + Greeks 1.0 (single home for full greeks). */
export const VOL_SECTIONS: DeskNavItem[] = [
  { id: 'vol-sub-surface', label: 'Surface', short: 'Surf' },
  { id: 'vol-sub-smile', label: 'Smile', short: 'Smile' },
  { id: 'vol-sub-term', label: 'Term', short: 'Term' },
  { id: 'vol-sub-greeks', label: 'Greeks', short: 'GRK', apis: ['yfinance', 'FRED'] },
  { id: 'vol-sub-quality', label: 'Surface Fit', short: 'Fit' },
];

/**
 * Trade desk — 3 red-bar modes (not 12 tool chips).
 * Internal tool pickers live inside DeskView; legacy `desk-ws-*` ids still deep-link.
 * Combo Greeks = multi-leg portfolio tool, not the Greeks 1.0 surface (Vol).
 */
export const TRADE_SECTIONS: DeskNavItem[] = [
  { id: 'trade-sub-structure', label: 'Structure', short: 'STR', apis: ['yfinance', 'Deribit'] },
  { id: 'trade-sub-pnl', label: 'PnL', short: 'PnL', apis: ['yfinance', 'FMP'] },
  { id: 'trade-sub-risk', label: 'Hedge', short: 'HDG', apis: ['yfinance', 'Deribit'] },
];

/** Legacy / function-code tool id → red-bar mode. */
export const TRADE_TOOL_TO_MODE: Record<string, string> = {
  'desk-ws-sim': 'trade-sub-structure',
  'desk-ws-combo': 'trade-sub-structure',
  'desk-ws-grid': 'trade-sub-structure',
  'desk-ws-combopnl': 'trade-sub-pnl',
  'desk-ws-optionpnl': 'trade-sub-pnl',
  'desk-ws-straddle': 'trade-sub-pnl',
  'desk-ws-breakeven': 'trade-sub-pnl',
  'desk-ws-subjective': 'trade-sub-pnl',
  'desk-ws-backtest': 'trade-sub-pnl',
  'desk-ws-hedge': 'trade-sub-risk',
  'desk-ws-dfollow': 'trade-sub-risk',
  'desk-ws-basis': 'trade-sub-risk',
  'desk-ws-roll': 'trade-sub-risk',
  'desk-ws-analyze': 'trade-sub-structure',
};

/** Map any desk section id (mode or legacy tool) → red-bar mode id. */
export function resolveTradeModeSection(sectionId: string | null | undefined): string {
  if (!sectionId) return 'trade-sub-structure';
  if (
    sectionId === 'trade-sub-structure'
    || sectionId === 'trade-sub-pnl'
    || sectionId === 'trade-sub-risk'
  ) {
    return sectionId;
  }
  return TRADE_TOOL_TO_MODE[sectionId] ?? 'trade-sub-structure';
}

/** @deprecated Legacy — full Greeks live on Vol · Greeks */
export const GREEKS_SECTIONS: DeskNavItem[] = [
  { id: 'vol-sub-greeks', label: 'Greeks', short: 'GRK', apis: ['yfinance', 'FRED'] },
];

/** Flow: Book = chain+dealer split; Tools = levels+edge+strategy stacked. */
export const POSITIONING_SECTIONS: DeskNavItem[] = [
  { id: 'pos-sub-chain', label: 'Book', short: 'Book' },
  { id: 'pos-sub-tools', label: 'Tools', short: 'Tools' },
];

/**
 * Academy desk — Substack-style publication (docs/index.json).
 * Education only: Home / Options / Macro / News / Glossary.
 * Positioning is the POS desk product (not an Academy section).
 * Engineering / Design / Tools tracks are not Academy chrome.
 */
export const ACADEMY_SECTIONS: DeskNavItem[] = [
  { id: 'academy-sub-start', label: 'Home', short: 'HOME' },
  { id: 'academy-sub-options', label: 'Options', short: 'OPT' },
  { id: 'academy-sub-macro', label: 'Macro', short: 'MAC' },
  { id: 'academy-sub-news', label: 'News', short: 'NEWS' },
  { id: 'academy-sub-glossary', label: 'Glossary', short: 'GLOS' },
];

/** Crypto desk — six coherent workflows (V2 is the product, no flag). */
export const CRYPTO_SECTIONS: DeskNavItem[] = [
  { id: 'crypto-v2-overview', label: 'Overview', short: 'OVR', apis: ['Deribit'] },
  { id: 'crypto-v2-volatility', label: 'Volatility', short: 'VOL', apis: ['Deribit'] },
  { id: 'crypto-v2-positioning', label: 'Positioning', short: 'POS', apis: ['Deribit'] },
  { id: 'crypto-v2-flow', label: 'Flow', short: 'FLOW', apis: ['Deribit'] },
  { id: 'crypto-v2-carry', label: 'Carry', short: 'CARRY', apis: ['Deribit'] },
  { id: 'crypto-v2-trade-risk', label: 'Trade & Risk', short: 'T&R', apis: ['Deribit'] },
];

export const CRYPTO_V2_SECTIONS = CRYPTO_SECTIONS;

/**
 * KSA desk — Tadawul board via SAHMK (server-only key, shared Node cache).
 * Single scroll view; section ids are anchors for [ ] jump only.
 */
export const KSA_SECTIONS: DeskNavItem[] = [
  { id: 'ksa-sub-board', label: 'Board', short: 'BRD', apis: ['SAHMK'] },
];

const TAB_LABELS: Record<string, string> = {
  vol: 'Vol',
  positioning: 'Flow',
  greeks: 'Vol · Greeks', // legacy deep-links
  desk: 'Trade',
  crypto: 'Crypto',
  rates: 'Rates',
  academy: 'Academy',
  ksa: 'KSA',
};

export { TAB_LABELS };

export function tabLabel(tab: ActiveTab | string): string {
  return TAB_LABELS[tab] ?? String(tab);
}

export function sectionsForTab(tab: ActiveTab | string): DeskNavItem[] {
  switch (tab) {
    case 'rates':
      return RATES_SECTIONS;
    case 'vol':
      return VOL_SECTIONS;
    case 'desk':
      return TRADE_SECTIONS;
    case 'greeks': // legacy → Vol · Greeks registry
      return GREEKS_SECTIONS;
    case 'positioning':
      return POSITIONING_SECTIONS;
    case 'crypto':
      return CRYPTO_V2_SECTIONS;
    case 'academy':
      return ACADEMY_SECTIONS;
    case 'ksa':
      return KSA_SECTIONS;
    default:
      return [];
  }
}

export function findSectionMeta(id: string, tab: ActiveTab | string): DeskNavItem | undefined {
  return sectionsForTab(tab).find((s) => s.id === id);
}
