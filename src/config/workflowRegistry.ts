/**
 * Workflow registry — the machine-readable product map (Phase 2).
 * One source of truth consumed by UI navigation, the command palette, deep
 * links, OpenAPI descriptions, MCP descriptions and the E2E deep-link matrix.
 * Registry consumers must never hardcode a second list.
 */
import { TABS } from '../components/terminal/tabs';
import {
  RATES_SECTIONS,
  VOL_SECTIONS,
  POSITIONING_SECTIONS,
  TRADE_SECTIONS,
  ACADEMY_SECTIONS,
  CRYPTO_SECTIONS as CRYPTO_V2_SECTIONS,
  KSA_SECTIONS,
  findSectionMeta,
} from './deskNav';

export type WorkflowEntry = {
  /** Workflow id — equals the deep-link section id used by ?desk=&sec= */
  id: string;
  desk: string;
  title: string;
  purpose: string;
  deepLink: string;
  /** Keyboard/function code from the function registry */
  code?: string;
  /** Upstream APIs listed for humans/agents (never credentials) */
  apis?: string[];
  /** Related API operations (operationIds) — filled by contracts layer */
  apiOps?: string[];
  /** Related MCP tool names */
  mcpTools?: string[];
  /** Data contract prerequisites for the workflow to render live values */
  requires?: string[];
};

function deskLabel(id: string): string {
  return TABS.find((t) => t.id === id)?.label ?? id;
}

type SectionLike = { id: string; label: string; short?: string; apis?: string[] };

function workflowsForDesk(
  desk: string,
  sections: SectionLike[],
  purposeFor: (id: string) => string,
): WorkflowEntry[] {
  return sections.map((s) => ({
    id: s.id,
    desk,
    title: `${deskLabel(desk)} · ${s.label}`,
    purpose: purposeFor(s.id),
    deepLink: `/?desk=${desk}&sec=${s.id}`,
    apis: s.apis,
  }));
}

export const WORKFLOW_REGISTRY: WorkflowEntry[] = [
  {
    id: 'home',
    desk: 'home',
    title: 'Home · Morning Brief',
    purpose: 'Provider health, per-desk snapshots (vol/positioning/rates/crypto/KSA) and function launcher',
    deepLink: '/?desk=home',
    code: 'HOME',
    apiOps: ['getHomeBriefing', 'getHealth'],
    mcpTools: ['terminal.get_health', 'terminal.get_provider_status'],
    requires: [],
  },
  ...workflowsForDesk('vol', VOL_SECTIONS, (id) => ({
    'vol-sub-surface': 'Observed IV matrix by strike × expiry with bid/ask/mid layers and optional 3D model mesh',
    'vol-sub-smile': 'Selected-expiry smile/skew: bid/ask/venue mark/solved mid/model layers',
    'vol-sub-term': 'ATM term structure, constant-delta term where supported, forward vol, IV/RV/VRP history',
    'vol-sub-greeks': 'Full Greeks: 2D profiles and lazy 3D Greek surface with observed/model separation',
    'vol-sub-quality': 'SVI fit quality: residuals, observed/model masks, coverage, arbitrage checks, calibration time',
  }[id] ?? 'Volatility analytics')),
  ...workflowsForDesk('positioning', POSITIONING_SECTIONS, (id) => ({
    'pos-sub-chain': 'Dealer exposure book: GEX/DEX/Vanna/Charm heatmaps, strike/expiry profiles, flip estimate',
    'pos-sub-tools': 'Key levels, walls, max pain (derived, methodology-labelled), edge and strategy context',
  }[id] ?? 'Positioning analytics')),
  ...workflowsForDesk('desk', TRADE_SECTIONS, (id) => ({
    'trade-sub-structure': 'Multi-leg structure builder on observed execution sides, combo Greeks, payoff, breakeven',
    'trade-sub-pnl': 'PnL/scenario: historical replay when real history exists, spot/vol/time/rate shocks, attribution',
    'trade-sub-risk': 'Delta hedge plan and flow, path-vol scenario from ATM IV, roll/basis comparisons, limits',
  }[id] ?? 'Trade & Risk')),
  ...workflowsForDesk('crypto', CRYPTO_V2_SECTIONS, (id) => ({
    'crypto-v2-overview': 'Deribit options health plus independent free multi-venue perp snapshot',
    'crypto-v2-volatility': 'Crypto ATM/delta term, forward vol, smile/skew, 2D matrix, optional 3D, DVOL where supported',
    'crypto-v2-positioning': 'Crypto GEX/DEX/Vanna/Charm heatmaps and profiles, spot-centered strikes',
    'crypto-v2-flow': 'Trade timeline/bubbles, call/put and buy/sell aggregates, expiry/strike distribution, tape',
    'crypto-v2-carry': 'Cross-venue funding with normalized annualization, perp premium, dated basis term structure',
    'crypto-v2-trade-risk': 'Crypto chain, multi-leg builder, Greeks, payoff/scenario/hedge — Deribit authoritative',
  }[id] ?? 'Crypto analytics')),
  ...workflowsForDesk('rates', RATES_SECTIONS, (id) => ({
    'rates-mode-funding': 'SOFR/EFFR/IORB/RRP corridor, history, spreads, funding-pressure interpretation',
    'rates-mode-ust': 'Treasury curve, curve changes, key slopes, auction/issuance context when sourced',
    'rates-mode-stir': 'SR1/SR3/Fed Funds strips, packs/butterflies, exact SERFF/basis spreads in bp',
    'rates-mode-world': 'Global curves, differentials, FX/carry relationships with clear source and unit rules',
  }[id] ?? 'Rates analytics')),
  ...workflowsForDesk('ksa', KSA_SECTIONS, (id) => ({
    'ksa-sub-board': 'Tadawul board: grouped summary, breadth, sectors, leaders, depth via SAHMK shared cache',
  }[id] ?? 'KSA market board')),
  ...workflowsForDesk('academy', ACADEMY_SECTIONS, (id) => ({
    'academy-sub-start': 'Academy start-here track: reading plan and core lessons',
    'academy-sub-options': 'Options essays: mechanics, positioning and vol lessons',
    'academy-sub-macro': 'Macro and rates-plumbing essays',
    'academy-sub-news': 'Curated market news with source links (untrusted display content)',
    'academy-sub-glossary': 'Glossary of market mechanics terms',
  }[id] ?? 'Academy publication')),
];

/** Resolve a registry entry by desk+section (used by deep-link hydration). */
export function findWorkflow(desk: string, sectionId?: string | null): WorkflowEntry | undefined {
  if (sectionId) {
    const hit = WORKFLOW_REGISTRY.find((w) => w.desk === desk && w.id === sectionId);
    if (hit) return hit;
  }
  return WORKFLOW_REGISTRY.find((w) => w.desk === desk && w.id === desk);
}

/** All workflows that chain a live equity option chain. */
export const CHAIN_DEPENDENT_WORKFLOWS = WORKFLOW_REGISTRY
  .filter((w) => w.desk === 'vol' || w.desk === 'positioning' || w.desk === 'desk')
  .map((w) => w.id);

/** Meta lookup delegating to the existing section registry (labels/apis). */
export const workflowMeta = findSectionMeta;
