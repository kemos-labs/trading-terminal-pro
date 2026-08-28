/**
 * Function registry — projects TABS + deskNav into openable function codes.
 * No second navigation graph.
 */
import { TABS } from '../components/terminal/tabs';
import {
  findSectionMeta,
  sectionsForTab,
  tabLabel,
} from './deskNav';
import { setDeskJump } from '../lib/market/deskJump';
import { sanitizeSymbol } from '../lib/validation';
import { useTerminalStore } from '../store/terminalStore';
import type { ActiveTab } from '../lib/options/types';

export type FunctionId = string;

export type FunctionDescriptor = {
  functionId: FunctionId;
  /** Short codes (uppercase), first is primary */
  codes: string[];
  label: string;
  tab: ActiveTab;
  sectionId?: string;
  heavy?: boolean;
  /** Optional symbol switch (BTC/ETH) */
  symbol?: string;
  /** Shell-only actions (not a desk) */
  shell?: 'help' | 'watchlist';
  keywords?: string[];
};

/** Exact code → functionId (v1). */
const CODE_MAP: Record<string, FunctionId> = {
  HOME: 'home',
  LPAD: 'home',
  VOL: 'vol',
  DES: 'vol',
  SURF: 'vol:vol-sub-surface',
  OVDV: 'vol:vol-sub-surface',
  SMILE: 'vol:vol-sub-smile',
  SKEW: 'vol:vol-sub-smile',
  TERM: 'vol:vol-sub-term',
  FIT: 'vol:vol-sub-quality',
  /** Full Greeks on Vol (not Trade). */
  VGRK: 'vol:vol-sub-greeks',
  GRK: 'vol:vol-sub-greeks',
  HIVG: 'vol:vol-sub-term',
  HVT: 'vol',
  POS: 'positioning',
  CHAIN: 'positioning:pos-sub-chain',
  OMON: 'positioning:pos-sub-chain',
  BOOK: 'positioning:pos-sub-chain',
  DEAL: 'positioning:pos-sub-chain', // Book = chain + dealer together
  GEX: 'positioning:pos-sub-chain',
  LVL: 'positioning:pos-sub-tools',
  EDGE: 'positioning:pos-sub-tools',
  STRAT: 'positioning:pos-sub-tools',
  TOOLS: 'positioning:pos-sub-tools',
  OVME: 'positioning:pos-sub-tools',
  DESK: 'desk:desk-ws-sim',
  /** Thalex-class Trade lab */
  SIM: 'desk:desk-ws-sim',
  COMBO: 'desk:desk-ws-combo',
  GRID: 'desk:desk-ws-grid',
  CPNL: 'desk:desk-ws-combopnl',
  OPNL: 'desk:desk-ws-optionpnl',
  STRD: 'desk:desk-ws-straddle',
  BE: 'desk:desk-ws-breakeven',
  SUBJ: 'desk:desk-ws-subjective',
  HDG: 'desk:desk-ws-hedge',
  DFOL: 'desk:desk-ws-dfollow',
  ROLL: 'desk:desk-ws-roll',
  /** IV surface lives on Vol (legacy Greeks IV tab removed). */
  IVG: 'vol:vol-sub-surface',
  /** Legacy codes → Vol · Greeks (HEAT/PROF/…) or mesh theme (3D). */
  HEAT: 'vol:vol-sub-greeks',
  PROF: 'vol:vol-sub-greeks',
  SENS: 'vol:vol-sub-greeks',
  EXP: 'vol:vol-sub-greeks',
  '3D': 'vol:vol-sub-greeks',
  MM: 'desk:desk-ws-sim',
  BTC: 'crypto',
  ETH: 'crypto',
  RATES: 'rates',
  MACRO: 'rates:sec-macro',
  MMKT: 'rates:sec-mm-strip',
  SOFR: 'rates:sec-stir',
  BASIS: 'rates:sec-basis',
  PLUMB: 'rates:sec-plumbing',
  UST: 'rates:sec-ust-data',
  CURVE: 'rates:sec-curves',
  AUCT: 'rates:sec-auctions',
  NYFED: 'rates:sec-nyfed',
  FX: 'rates:sec-fx',
  JGB: 'rates:sec-japan',
  HELP: '__shell:help',
  WL: '__shell:watchlist',
  ACAD: 'academy',
  ACADSTART: 'academy:academy-sub-start',
  ACADOPT: 'academy:academy-sub-options',
  ACADMAC: 'academy:academy-sub-macro',
  ACADPOS: 'academy:academy-sub-start',
  ACADNEWS: 'academy:academy-sub-news',
  ACADTLS: 'academy:academy-sub-start', // legacy Tools track → Home
  ACADENG: 'academy:academy-sub-start',
  ACADGLOS: 'academy:academy-sub-glossary',
  FA: 'positioning:pos-sub-tools',
  FALVL: 'positioning:pos-sub-tools',
};

/**
 * Study-aliases (BBG-study synonyms that resolve to our primary codes).
 * These are keywords only — our codes (SURF/CHAIN/SMILE/…) stay authoritative.
 * functionId → extra keywords surfaced in palette / command-line search.
 */
const STUDY_ALIAS_KEYWORDS: Record<string, string[]> = {
  'vol:vol-sub-surface': ['ovdv', 'option monitor surface', 'vol surface'],
  'vol:vol-sub-smile': ['skew', 'vol smile', 'risk reversal'],
  'positioning:pos-sub-chain': ['omon', 'option monitor', 'chain monitor'],
  'vol:vol-sub-term': ['hivg', 'historical implied vol', 'term structure'],
  'vol:vol-sub-greeks': ['greeks', 'delta gamma', 'vol risk', 'vgrk', 'analyze', 'grk'],
  vol: [
    'hvt', 'historical vol', 'hist vol', 'realized vol',
    'des', 'description', 'security description',
  ],
  'positioning:pos-sub-tools': ['ovme', 'option payoff', 'scenario', 'strategy builder', 'levels', 'parity', 'flashalpha', 'fa'],
  academy: ['learn', 'education', 'training', 'docs', 'curriculum'],
  'academy:academy-sub-glossary': ['terms', 'definitions', 'dictionary'],
};

function buildRegistry(): FunctionDescriptor[] {
  const byId = new Map<FunctionId, FunctionDescriptor>();

  const upsert = (d: FunctionDescriptor) => {
    const prev = byId.get(d.functionId);
    if (!prev) {
      byId.set(d.functionId, d);
      return;
    }
    const codes = [...new Set([...prev.codes, ...d.codes])];
    byId.set(d.functionId, { ...prev, ...d, codes });
  };

  for (const t of TABS) {
    upsert({
      functionId: t.id,
      codes: [],
      label: t.label,
      tab: t.id as ActiveTab,
      keywords: [t.label, t.id],
    });
  }

  for (const t of TABS) {
    const tab = t.id as ActiveTab;
    for (const s of sectionsForTab(tab)) {
      const functionId = `${tab}:${s.id}`;
      upsert({
        functionId,
        codes: [],
        label: `${tabLabel(tab)} · ${s.label}`,
        tab,
        sectionId: s.id,
        keywords: [s.label, s.short ?? '', s.id, tab],
      });
    }
  }

  // Attach study-alias keywords (BBG-study synonyms) to the matching functionId
  for (const [fid, kws] of Object.entries(STUDY_ALIAS_KEYWORDS)) {
    const existing = byId.get(fid);
    if (existing) {
      upsert({
        ...existing,
        keywords: [...(existing.keywords ?? []), ...kws],
      });
    }
  }

  // Attach codes from CODE_MAP
  for (const [code, fid] of Object.entries(CODE_MAP)) {
    if (fid.startsWith('__shell:')) {
      const shell = fid === '__shell:help' ? 'help' : 'watchlist';
      upsert({
        functionId: fid,
        codes: [code],
        label: shell === 'help' ? 'Keyboard shortcuts' : 'Watchlist strip',
        tab: 'vol',
        shell,
        keywords: [code, shell],
      });
      continue;
    }
    const existing = byId.get(fid);
    if (existing) {
      upsert({ ...existing, codes: [...existing.codes, code] });
    } else {
      // Desk-only ids always exist from TABS
      upsert({
        functionId: fid,
        codes: [code],
        label: fid,
        tab: (fid.split(':')[0] as ActiveTab) ?? 'vol',
        sectionId: fid.includes(':') ? fid.split(':').slice(1).join(':') : undefined,
      });
    }
  }

  // BTC/ETH symbol overrides on crypto desk codes
  const btc = byId.get('crypto');
  if (btc) {
    // Keep crypto desk under BTC code; ETH uses same tab with symbol
    byId.set('crypto', {
      ...btc,
      codes: [...new Set([...btc.codes, 'BTC', 'ETH'].map((c) => c.toUpperCase()))],
    });
  }

  // Special descriptors for BTC/ETH that set symbol
  upsert({
    functionId: 'crypto',
    codes: ['BTC'],
    label: 'Crypto · BTC',
    tab: 'crypto',
    symbol: 'BTC',
    keywords: ['bitcoin', 'btc', 'crypto'],
  });
  upsert({
    functionId: 'crypto:eth',
    codes: ['ETH'],
    label: 'Crypto · ETH',
    tab: 'crypto',
    symbol: 'ETH',
    keywords: ['ethereum', 'eth', 'crypto'],
  });

  return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label));
}

let _cache: FunctionDescriptor[] | null = null;

export function listFunctions(): FunctionDescriptor[] {
  if (!_cache) _cache = buildRegistry();
  return _cache;
}

export function resolveFunctionId(input: string): FunctionDescriptor | null {
  const raw = input.trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  const mapped = CODE_MAP[upper];
  if (mapped) {
    if (upper === 'ETH') {
      return listFunctions().find((f) => f.functionId === 'crypto:eth') ?? null;
    }
    if (upper === 'BTC') {
      const d = listFunctions().find((f) => f.functionId === 'crypto' && f.symbol === 'BTC');
      if (d) return d;
    }
    return listFunctions().find((f) => f.functionId === mapped) ?? null;
  }

  // Direct functionId
  const byId = listFunctions().find(
    (f) => f.functionId === raw || f.functionId === raw.toLowerCase(),
  );
  if (byId) return byId;

  return null;
}

export function searchFunctions(query: string, limit = 20): FunctionDescriptor[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    // Popular top-level + codes first
    return listFunctions()
      .filter((f) => f.codes.length > 0 || !f.sectionId)
      .slice(0, limit);
  }

  const scored: { d: FunctionDescriptor; score: number }[] = [];
  for (const d of listFunctions()) {
    let score = 0;
    for (const c of d.codes) {
      if (c.toLowerCase() === q) score = Math.max(score, 100);
      else if (c.toLowerCase().startsWith(q)) score = Math.max(score, 80);
      else if (c.toLowerCase().includes(q)) score = Math.max(score, 50);
    }
    if (d.functionId.toLowerCase() === q) score = Math.max(score, 95);
    if (d.functionId.toLowerCase().includes(q)) score = Math.max(score, 40);
    if (d.label.toLowerCase().includes(q)) score = Math.max(score, 35);
    for (const k of d.keywords ?? []) {
      if (k.toLowerCase().includes(q)) score = Math.max(score, 30);
    }
    if (score > 0) scored.push({ d, score });
  }
  scored.sort((a, b) => b.score - a.score || a.d.label.localeCompare(b.d.label));
  return scored.slice(0, limit).map((s) => s.d);
}

export type OpenFunctionHooks = {
  onHelp?: () => void;
  onWatchlistFocus?: () => void;
};

/**
 * Open a function by code or functionId. Writes desk.jump + setActiveTab.
 * Tiles workspace branch is a no-op until workspace module lands.
 */
export function openFunction(
  input: string,
  hooks: OpenFunctionHooks = {},
): { ok: boolean; kind: 'function' | 'symbol' | 'shell' | 'none'; detail?: string } {
  const d = resolveFunctionId(input);
  if (d?.shell === 'help') {
    hooks.onHelp?.();
    return { ok: true, kind: 'shell', detail: 'help' };
  }
  if (d?.shell === 'watchlist') {
    hooks.onWatchlistFocus?.();
    return { ok: true, kind: 'shell', detail: 'watchlist' };
  }

  if (d) {
    // Legacy Trade Analyze / greeks-* → Vol · Greeks (single home)
    let sectionId = d.sectionId;
    let tab = d.tab;
    if (
      sectionId === 'greeks-sub-surface3d'
      || sectionId === 'greeks-mesh'
      || sectionId === 'greeks-desk'
      || sectionId === 'greeks-iv'
      || sectionId === 'desk-ws-analyze'
    ) {
      if (sectionId === 'greeks-sub-surface3d' || sectionId === 'greeks-mesh') {
        try {
          localStorage.setItem('ui.greeks.surfaceTheme', 'mesh');
        } catch { /* ignore */ }
      }
      sectionId = 'vol-sub-greeks';
      tab = 'vol';
    }
    // 3D mnemonic still sets mesh even when CODE_MAP already points at analyze
    if (input.trim().toUpperCase() === '3D') {
      try {
        localStorage.setItem('ui.greeks.surfaceTheme', 'mesh');
      } catch { /* ignore */ }
    }
    if (sectionId) setDeskJump(sectionId);
    useTerminalStore.getState().setActiveTab(tab);
    if (d.symbol) {
      useTerminalStore.getState().setSymbol(d.symbol);
    }
    if (sectionId) {
      useTerminalStore.getState().setDeskSection(sectionId);
      const meta = findSectionMeta(sectionId, tab);
      if (meta) {
        useTerminalStore.getState().setDeskContext({
          id: sectionId,
          label: meta.label,
          apis: meta.apis,
        });
      }
    }
    return { ok: true, kind: 'function', detail: d.functionId };
  }

  // Bare ticker
  const sym = sanitizeSymbol(input);
  if (sym) {
    useTerminalStore.getState().setSymbol(sym);
    return { ok: true, kind: 'symbol', detail: sym };
  }

  return { ok: false, kind: 'none' };
}

/** Launchpad favorites — primary codes for Home grid. */
export const LAUNCHPAD_CODES: string[] = [
  'HOME',
  'VOL',
  'SMILE',
  'POS',
  'GEX',
  'LVL',
  'GRK',
  '3D',
  'MM',
  'BTC',
  'RATES',
  'SOFR',
  'MACRO',
  'FX',
];
