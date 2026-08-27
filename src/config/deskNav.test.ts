import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sectionsForTab, tabLabel, findSectionMeta } from './deskNav';

describe('deskNav', () => {
  it('labels desks', () => {
    expect(tabLabel('rates')).toBe('Rates');
    expect(tabLabel('vol')).toBe('Vol');
  });

  it('returns rates modes (4) with apis', () => {
    const secs = sectionsForTab('rates');
    expect(secs.length).toBe(4);
    expect(secs.find((s) => s.id === 'rates-mode-stir')?.apis).toContain('yfinance');
    expect(secs.find((s) => s.id === 'rates-mode-world')?.label).toMatch(/World/i);
    expect(secs.find((s) => s.id === 'rates-mode-funding')?.apis).toContain('FRED');
    expect(secs.find((s) => s.id === 'rates-mode-ust')?.label).toMatch(/UST/i);
  });

  it('positioning is Book + Tools only', () => {
    const secs = sectionsForTab('positioning');
    expect(secs.find((s) => s.id === 'pos-sub-chain')?.label).toMatch(/Book/i);
    expect(secs.find((s) => s.id === 'pos-sub-tools')?.label).toMatch(/Tools/i);
    expect(secs.find((s) => s.id === 'pos-sub-strategy')).toBeUndefined();
  });

  it('trade is Structure + PnL + Hedge (not 12 tool chips)', () => {
    const secs = sectionsForTab('desk');
    expect(secs.map((s) => s.id)).toEqual([
      'trade-sub-structure',
      'trade-sub-pnl',
      'trade-sub-risk',
    ]);
    expect(secs.find((s) => s.id === 'desk-ws-optionpnl')).toBeUndefined();
  });

  it('crypto exposes exactly six V2 workflows (no flag)', () => {
    const secs = sectionsForTab('crypto');
    expect(secs.map((s) => s.id)).toEqual([
      'crypto-v2-overview',
      'crypto-v2-volatility',
      'crypto-v2-positioning',
      'crypto-v2-flow',
      'crypto-v2-carry',
      'crypto-v2-trade-risk',
    ]);
    // Legacy 15-route crypto + Thalex Lab removed in Phase 9.
    expect(secs.find((s) => s.id === 'crypto-sub-overview')).toBeUndefined();
    expect(secs.find((s) => s.id === 'desk-ws-sim')).toBeUndefined();
  });

  it('finds section meta', () => {
    expect(findSectionMeta('rates-mode-funding', 'rates')?.label).toBe('Funding');
    expect(findSectionMeta('rates-mode-stir', 'rates')?.label).toMatch(/STIR/i);
    expect(findSectionMeta('vol-sub-smile', 'vol')?.label).toBe('Smile');
  });

  it('academy is education only — no Engineering, Design, or Positioning sections', () => {
    const secs = sectionsForTab('academy');
    const labels = secs.map((s) => s.label.toLowerCase());
    const ids = secs.map((s) => s.id);
    expect(labels.some((l) => /engineer|design|positioning/.test(l))).toBe(false);
    expect(ids).not.toContain('academy-sub-engineering');
    expect(ids).not.toContain('academy-sub-design');
    expect(ids).not.toContain('academy-sub-positioning');
    expect(ids).toEqual([
      'academy-sub-start',
      'academy-sub-options',
      'academy-sub-macro',
      'academy-sub-news',
      'academy-sub-glossary',
    ]);
  });
});

describe('jumpDeskSection', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="sec-macro"></div>
      <div id="sec-snapshot"></div>
      <div id="sec-stir"></div>
    `;
    Element.prototype.scrollIntoView = () => {};
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('jumps to next rates section via store', async () => {
    const { jumpDeskSection } = await import('./deskNav');
    const store = await import('../store/terminalStore');
    const useTerminalStore = store.useTerminalStore;
    useTerminalStore.setState({ activeTab: 'rates', deskSectionId: 'sec-macro' });
    const next = jumpDeskSection('rates', 1);
    expect(next).toBeTruthy();
    expect(useTerminalStore.getState().deskSectionId).toBe(next);
  });

  it('sets store section for vol-sub mode buttons when jumping', async () => {
    const { jumpDeskSection } = await import('./deskNav');
    const store = await import('../store/terminalStore');
    store.useTerminalStore.setState({ activeTab: 'vol', deskSectionId: 'vol-sub-surface' });
    const next = jumpDeskSection('vol', 1);
    expect(next).toBe('vol-sub-smile');
    expect(store.useTerminalStore.getState().deskSectionId).toBe('vol-sub-smile');
  });
});
