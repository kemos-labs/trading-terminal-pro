import type { ActiveTab } from '../lib/options/types';
import { CRYPTO_V2 } from './featureFlags';

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

/**
 * Crypto desk — decision summary first, then progressive drill-down.
 * Overview = cross-expiry command board; Market = dual BTC/ETH tape;
 * Options = chain/surface; Lab keeps the Thalex second-screen catalog.
 */
export const CRYPTO_SECTIONS: DeskNavItem[] = [
  { id: 'crypto-sub-overview', label: 'Overview', short: 'OVR', apis: ['Deribit'] },
  { id: 'crypto-sub-heatmaps', label: 'Greek Heat', short: 'HEAT', apis: ['Deribit'] },
  { id: 'crypto-sub-levels', label: 'Levels', short: 'LVL', apis: ['Deribit'] },
  { id: 'crypto-sub-flow', label: 'Options Flow', short: 'FLOW', apis: ['Deribit'] },
  { id: 'crypto-sub-oi', label: 'Open Interest', short: 'OI', apis: ['Deribit'] },
  { id: 'crypto-sub-volskew', label: 'Vol & Skew', short: 'VSKW', apis: ['Deribit'] },
  { id: 'crypto-sub-tail', label: 'Tail Strike', short: 'TAIL', apis: ['Deribit'] },
  { id: 'crypto-sub-scanner', label: 'Scanner', short: 'SCAN', apis: ['Deribit'] },
  { id: 'crypto-sub-fbasis', label: 'Fut Basis', short: 'BAS', apis: ['Deribit'] },
  { id: 'crypto-sub-fterm', label: 'Fut Term', short: 'TERM', apis: ['Deribit'] },
  { id: 'crypto-sub-ffund', label: 'Funding', short: 'FUND', apis: ['Deribit'] },
  { id: 'crypto-sub-options', label: 'Options', short: 'Opts', apis: ['Binance'] },
  { id: 'crypto-sub-calc', label: 'Calculator', short: 'CALC', apis: ['Deribit'] },
  { id: 'crypto-sub-lab', label: 'Lab', short: 'Lab', apis: ['Thalex'] },
  { id: 'crypto-sub-backtest', label: 'Backtest', short: 'BT', apis: ['Binance'] },
];

export const CRYPTO_V2_SECTIONS: DeskNavItem[] = [
  { id: 'crypto-v2-overview', label: 'Overview', short: 'OVR', apis: ['Deribit'] },
  { id: 'crypto-v2-volatility', label: 'Volatility', short: 'VOL', apis: ['Deribit'] },
  { id: 'crypto-v2-positioning', label: 'Positioning', short: 'POS', apis: ['Deribit'] },
  { id: 'crypto-v2-flow', label: 'Flow', short: 'FLOW', apis: ['Deribit'] },
  { id: 'crypto-v2-carry', label: 'Carry', short: 'CARRY', apis: ['Deribit'] },
  { id: 'crypto-v2-trade-risk', label: 'Trade & Risk', short: 'T&R', apis: ['Deribit'] },
];

/**
 * KSA desk — Tadawul board via SAHMK (server-only key, shared Node cache).
 * Single scroll view; section ids are anchors for [ ] jump only.
 */
export const KSA_SECTIONS: DeskNavItem[] = [
  { id: 'ksa-sub-board', label: 'Board', short: 'BRD', apis: ['SAHMK'] },
];

/**
 * Path segment on https://thalextech.github.io/<slug>/ (deployed second-screen apps).
 * Source: github.com/thalextech/thalextech.github.io/apps/*
 */
export const THALEX_APP_SLUG: Record<string, string> = {
  'desk-ws-sim': 'simulator',
  'desk-ws-combopnl': 'combo-pnl',
  'desk-ws-straddle': 'straddle',
  'desk-ws-combo': 'combo-greeks',
  'desk-ws-analyze': 'greeks',
  'desk-ws-optionpnl': 'option-pnl',
  'desk-ws-breakeven': 'break-even',
  'desk-ws-roll': 'roll-pnl',
  'desk-ws-basis': 'futures-basis',
  'desk-ws-subjective': 'subjective',
  'desk-ws-backtest': 'backtest',
  'desk-ws-dfollow': 'dfollow',
  'desk-ws-hedge': 'hedging',
  'desk-ws-grid': 'grid',
};

export function thalexAppUrl(sectionOrToolId: string): string | null {
  const slug = THALEX_APP_SLUG[sectionOrToolId];
  if (!slug) return null;
  return `https://thalextech.github.io/${slug}/`;
}

/** Thalex tool catalog for Lab home grid (blurbs match thalextech.github.io index.yml). */
export const THALEX_LAB_TOOLS: {
  id: string;
  label: string;
  blurb: string;
  /** Preview on Thalex public lab */
  preview: string;
}[] = [
  {
    id: 'desk-ws-sim',
    label: 'Simulator',
    blurb: 'Simulate price paths for a multi-leg combination with configurable drift, volatility, and horizon.',
    preview: 'https://thalextech.github.io/images/simulator.png',
  },
  {
    id: 'desk-ws-combopnl',
    label: 'Combo PnL',
    blurb: 'Replay the historical P&L of a multi-leg option position and decompose it by greeks.',
    preview: 'https://thalextech.github.io/images/combo-pnl.png',
  },
  {
    id: 'desk-ws-straddle',
    label: 'Straddle',
    blurb: 'Switch between break-even and historical PnL of the straddle for a chosen maturity.',
    preview: 'https://thalextech.github.io/images/straddle.png',
  },
  {
    id: 'desk-ws-combo',
    label: 'Combo Greeks',
    blurb: 'Visualize greeks of multi-leg option positions as a function of index and time-to-maturity.',
    preview: 'https://thalextech.github.io/images/combo-greeks.png',
  },
  {
    id: 'desk-ws-analyze',
    label: 'Greeks',
    blurb: 'Visualize delta, gamma, theta, vega, and vanna across one or more maturities.',
    preview: 'https://thalextech.github.io/images/greeks.png',
  },
  {
    id: 'desk-ws-optionpnl',
    label: 'Option PnL',
    blurb: 'Select a single option and analyze its historical mark PnL between two points in time.',
    preview: 'https://thalextech.github.io/images/option-pnl.png',
  },
  {
    id: 'desk-ws-breakeven',
    label: 'Break Even',
    blurb: 'Explore option break-even prices and N(d2) for a selected maturity.',
    preview: 'https://thalextech.github.io/images/break-even.png',
  },
  {
    id: 'desk-ws-roll',
    label: 'Roll PnL',
    blurb: 'Heatmap of funding/basis against index. Evaluate carry P&L between two points in time.',
    preview: 'https://thalextech.github.io/images/roll-pnl.png',
  },
  {
    id: 'desk-ws-basis',
    label: 'Basis',
    blurb: 'Compare futures basis against index and annualized carry over time.',
    preview: 'https://thalextech.github.io/images/basis.png',
  },
  {
    id: 'desk-ws-subjective',
    label: 'Subjective Valuation',
    blurb: 'Price options against your own drift and variance-risk-premium assumptions and compare to the market.',
    preview: 'https://thalextech.github.io/images/subjective.png',
  },
  {
    id: 'desk-ws-backtest',
    label: 'Backtest',
    blurb: 'Run the weekly BTC short straddle delta-hedged backtest from local Thalex parquet history.',
    preview: 'https://thalextech.github.io/images/straddle.png',
  },
  {
    id: 'desk-ws-dfollow',
    label: 'Delta Follower',
    blurb: 'Simulate a dfollow bot that tracks an option delta with a future or option hedge instrument.',
    preview: 'https://thalextech.github.io/images/delta-follower.png',
  },
  {
    id: 'desk-ws-hedge',
    label: 'Hedging',
    blurb: 'Simulate threshold, tolerance, and period based delta hedging for a selected option.',
    preview: 'https://thalextech.github.io/images/hedging.png',
  },
  {
    id: 'desk-ws-grid',
    label: 'Option Grid',
    blurb: 'Grid showing leverage (omega) and N(d2)^-1 by strike and expiry.',
    preview: 'https://thalextech.github.io/images/grid.png',
  },
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
      return CRYPTO_V2 ? CRYPTO_V2_SECTIONS : CRYPTO_SECTIONS;
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
