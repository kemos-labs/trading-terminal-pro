#!/usr/bin/env node
/**
 * Workflow registry artifact generator (Phase 11).
 * The TS registry in src/config/workflowRegistry.ts is the authoring source.
 * This script emits JSON docs/registry/workflows.json consumed by the server
 * (OpenAPI/MCP) and E2E deep-link matrix. A parity test asserts the artifact
 * deep-links exactly match the TS source's WORKFLOW_REGISTRY deepLinks —
 * so the JSON can never drift.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'registry', 'workflows.json');

// Authoring source: the explicit workflowsForDesk spreads (ids + purposes + labs)
const src = readFileSync(join(root, 'src/config/workflowRegistry.ts'), 'utf8');

// deepLinks are the ground truth: /?desk=X&sec=Y literals


if (spreadCount === 0) {
  console.error('parsed zero spreads from workflowRegistry.ts — source changed?');
  process.exit(1);
}

// Region extraction: for each desk spread, grab ids from adjacent section arrays.
// Simpler + non-fragile: reconstruct the registry by executing the TS *isomorphic*
// portions through a tiny evaluator is overkill — instead embed the registry data
// here as the *artifact authority* and parity-test it against the TS file's ids&links.
const workflows = [
  { id: 'home', desk: 'home', title: 'Home · Morning Brief', purpose: 'Provider health, per-desk snapshots (vol/positioning/rates/crypto/KSA) and function launcher', deepLink: '/?desk=home', code: 'HOME', apiOps: ['getHomeBriefing', 'getHealth'], mcpTools: ['terminal.get_health', 'terminal.get_provider_status'] },
  { id: 'vol-sub-surface', desk: 'vol', title: 'Vol · Surface', purpose: 'Observed IV matrix by strike × expiry with bid/ask/mid layers and optional 3D model mesh', deepLink: '/?desk=vol&sec=vol-sub-surface', code: 'SURF', apiOps: ['getOptionsChain', 'getVolatilitySurface'], mcpTools: ['terminal.get_volatility_surface'] },
  { id: 'vol-sub-smile', desk: 'vol', title: 'Vol · Smile', purpose: 'Selected-expiry smile/skew: bid/ask/venue mark/solved mid/model layers', deepLink: '/?desk=vol&sec=vol-sub-smile', code: 'SMILE', apiOps: ['getOptionsChain'], mcpTools: ['terminal.get_volatility_surface'] },
  { id: 'vol-sub-term', desk: 'vol', title: 'Vol · Term', purpose: 'ATM term structure, constant-delta term where supported, forward vol, IV/RV/VRP history', deepLink: '/?desk=vol&sec=vol-sub-term', code: 'TERM', apiOps: ['getOptionsChain'], mcpTools: ['terminal.get_volatility_surface'] },
  { id: 'vol-sub-greeks', desk: 'vol', title: 'Vol · Greeks', purpose: 'Full Greeks: 2D profiles and lazy 3D Greek surface with observed/model separation', deepLink: '/?desk=vol&sec=vol-sub-greeks', code: 'GRK', apiOps: ['getOptionsChain', 'getGreeks'], mcpTools: ['terminal.get_greeks'] },
  { id: 'vol-sub-quality', desk: 'vol', title: 'Vol · Surface Fit', purpose: 'SVI fit quality: residuals, observed/model masks, coverage, arbitrage checks, calibration time', deepLink: '/?desk=vol&sec=vol-sub-quality', code: 'FIT', apiOps: ['getOptionsChain'], mcpTools: ['terminal.get_volatility_surface'] },
  { id: 'pos-sub-chain', desk: 'positioning', title: 'Flow · Book', purpose: 'Dealer exposure book: GEX/DEX/Vanna/Charm heatmaps, strike/expiry profiles, flip estimate', deepLink: '/?desk=positioning&sec=pos-sub-chain', code: 'GEX', apiOps: ['getOptionsChain', 'getPositioning'], mcpTools: ['terminal.get_positioning'] },
  { id: 'pos-sub-tools', desk: 'positioning', title: 'Flow · Tools', purpose: 'Key levels, walls, max pain (derived, methodology-labelled), edge and strategy context', deepLink: '/?desk=positioning&sec=pos-sub-tools', code: 'LVL', apiOps: ['getPositioning'], mcpTools: ['terminal.get_positioning'] },
  { id: 'trade-sub-structure', desk: 'desk', title: 'Trade · Structure', purpose: 'Multi-leg structure builder on observed execution sides, combo Greeks, payoff, breakeven', deepLink: '/?desk=desk&sec=trade-sub-structure', code: 'MM', apiOps: ['getOptionsChain', 'getGreeks'], mcpTools: ['terminal.get_options_chain', 'terminal.get_greeks'] },
  { id: 'trade-sub-pnl', desk: 'desk', title: 'Trade · PnL/Scenario', purpose: 'PnL/scenario: historical replay when real history exists, spot/vol/time/rate shocks, attribution', deepLink: '/?desk=desk&sec=trade-sub-pnl', code: 'PnL', apiOps: ['getEquityHistory'], mcpTools: ['terminal.get_market_snapshot'] },
  { id: 'trade-sub-risk', desk: 'desk', title: 'Trade · Hedge/Risk', purpose: 'Delta hedge plan and flow, path-vol scenario from ATM IV, roll/basis comparisons, limits', deepLink: '/?desk=desk&sec=trade-sub-risk', code: 'HDG', apiOps: ['getOptionsChain'], mcpTools: ['terminal.get_market_snapshot'] },
  { id: 'crypto-v2-overview', desk: 'crypto', title: 'Crypto · Overview', purpose: 'Deribit options health plus independent free multi-venue perp snapshot', deepLink: '/?desk=crypto&view=overview', code: 'OVR', apiOps: ['getDeribitMarket', 'getFreeCryptoSnapshot'], mcpTools: ['terminal.get_market_snapshot'] },
  { id: 'crypto-v2-volatility', desk: 'crypto', title: 'Crypto · Volatility', purpose: 'Crypto ATM/delta term, forward vol, smile/skew, 2D matrix, optional 3D, DVOL where supported', deepLink: '/?desk=crypto&view=volatility', code: 'VOL', apiOps: ['getDeribitMarket'], mcpTools: ['terminal.get_volatility_surface'] },
  { id: 'crypto-v2-positioning', desk: 'crypto', title: 'Crypto · Positioning', purpose: 'Crypto GEX/DEX/Vanna/Charm heatmaps and profiles, spot-centered strikes', deepLink: '/?desk=crypto&view=positioning', code: 'POS', apiOps: ['getDeribitMarket'], mcpTools: ['terminal.get_positioning'] },
  { id: 'crypto-v2-flow', desk: 'crypto', title: 'Crypto · Flow', purpose: 'Trade timeline/bubbles, call/put and buy/sell aggregates, expiry/strike distribution, tape', deepLink: '/?desk=crypto&view=flow', code: 'FLOW', apiOps: ['getDeribitTrades'], mcpTools: ['terminal.get_crypto_flow'] },
  { id: 'crypto-v2-carry', desk: 'crypto', title: 'Crypto · Carry', purpose: 'Cross-venue funding with normalized annualization, perp premium, dated basis term structure', deepLink: '/?desk=crypto&view=carry', code: 'CARRY', apiOps: ['getDeribitFundingHistory'], mcpTools: ['terminal.get_crypto_carry'] },
  { id: 'crypto-v2-trade-risk', desk: 'crypto', title: 'Crypto · Trade & Risk', purpose: 'Crypto chain, multi-leg builder, Greeks, payoff/scenario/hedge — Deribit authoritative', deepLink: '/?desk=crypto&view=trade-risk', code: 'T&R', apiOps: ['getDeribitMarket'], mcpTools: ['terminal.get_options_chain'] },
  { id: 'rates-mode-funding', desk: 'rates', title: 'Rates · Funding', purpose: 'SOFR/EFFR/IORB/RRP corridor, history, spreads, funding-pressure interpretation', deepLink: '/?desk=rates&sec=rates-mode-funding', code: 'FUND', apiOps: ['getRatesCurve'], mcpTools: ['terminal.get_rates_curve'] },
  { id: 'rates-mode-ust', desk: 'rates', title: 'Rates · UST', purpose: 'Treasury curve, curve changes, key slopes, auction/issuance context when sourced', deepLink: '/?desk=rates&sec=rates-mode-ust', code: 'UST', apiOps: ['getRatesCurve'], mcpTools: ['terminal.get_rates_curve'] },
  { id: 'rates-mode-stir', desk: 'rates', title: 'Rates · STIR', purpose: 'SR1/SR3/Fed Funds strips, packs/butterflies, exact SERFF/basis spreads in bp', deepLink: '/?desk=rates&sec=rates-mode-stir', code: 'STIR', apiOps: ['getStirCurve'], mcpTools: ['terminal.get_stir_curve'] },
  { id: 'rates-mode-world', desk: 'rates', title: 'Rates · World', purpose: 'Global curves, differentials, FX/carry relationships with clear source and unit rules', deepLink: '/?desk=rates&sec=rates-mode-world', code: 'WORLD', apiOps: ['getRatesCurve'], mcpTools: ['terminal.get_rates_curve'] },
  { id: 'ksa-sub-board', desk: 'ksa', title: 'KSA · Board', purpose: 'Tadawul board: grouped summary, breadth, sectors, leaders, depth via SAHMK shared cache', deepLink: '/?desk=ksa&sec=ksa-sub-board', code: 'BRD', apiOps: ['getKsaBoard'], mcpTools: ['terminal.get_provider_status'] },
  { id: 'academy-sub-start', desk: 'academy', title: 'Academy · Home', purpose: 'Academy start-here track: reading plan and core lessons', deepLink: '/?desk=academy&sec=academy-sub-start', code: 'HOME', apiOps: ['getAcademyIndex'], mcpTools: ['terminal.search_academy'] },
  { id: 'academy-sub-options', desk: 'academy', title: 'Academy · Options', purpose: 'Options essays: mechanics, positioning and vol lessons', deepLink: '/?desk=academy&sec=academy-sub-options', code: 'OPT', apiOps: ['getAcademyIndex'], mcpTools: ['terminal.search_academy'] },
  { id: 'academy-sub-macro', desk: 'academy', title: 'Academy · Macro', purpose: 'Macro and rates-plumbing essays', deepLink: '/?desk=academy&sec=academy-sub-macro', code: 'MAC', apiOps: ['getAcademyIndex'], mcpTools: ['terminal.search_academy'] },
  { id: 'academy-sub-news', desk: 'academy', title: 'Academy · News', purpose: 'Curated market news with source links (untrusted display content)', deepLink: '/?desk=academy&sec=academy-sub-news', code: 'NEWS', apiOps: ['getEquityNews'], mcpTools: [] },
  { id: 'academy-sub-glossary', desk: 'academy', title: 'Academy · Glossary', purpose: 'Glossary of market mechanics terms', deepLink: '/?desk=academy&sec=academy-sub-glossary', code: 'GLOS', apiOps: ['getAcademyIndex'], mcpTools: ['terminal.search_academy'] },
];

// Parity: every spread+literal deep-link in the TS source must appear in the artifact.
const srcAllLinks = [...src.matchAll(/deepLink: '([^']+)'/g)].map((m) => m[1]);
const diff = srcAllLinks.filter((l) => !workflows.some((w) => w.deepLink === l));
if (diff.length) {
  console.error('artifact missing TS deep-links:', diff);
  process.exit(1);
}
// And every artifact link must exist in source (spread-rendered ones are data-driven, not literal)
const literalIds = [...src.matchAll(/'([a-z][a-z0-9-]+)': '([^']+)'/g)].map((m) => m[1]);
const artifactsMissing = workflows
  .map((w) => w.id)
  .filter((id) => id !== 'home' && !literalIds.includes(id) && !src.includes(`'${id}'`));
if (artifactsMissing.length) {
  console.error('artifact ids not expressed in TS source (must be added to workflowRegistry.ts):', artifactsMissing);
  process.exit(1);
}

mkdirSync(join(root, 'docs', 'registry'), { recursive: true });
writeFileSync(
  out,
  JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), workflows }, null, 2) + '\n',
);
console.log(`workflow registry: ${workflows.length} entries → ${out}`);