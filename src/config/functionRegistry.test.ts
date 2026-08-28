import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resolveFunctionId,
  searchFunctions,
  openFunction,
  listFunctions,
} from './functionRegistry';
import { DESK_JUMP_KEY } from '../lib/market/deskJump';

vi.mock('../store/terminalStore', () => {
  const state = {
    setActiveTab: vi.fn(),
    setSymbol: vi.fn(),
    setDeskContext: vi.fn(),
    setDeskSection: vi.fn(),
  };
  return {
    useTerminalStore: Object.assign(() => state, {
      getState: () => state,
    }),
  };
});

describe('functionRegistry', () => {
  beforeEach(() => {
    sessionStorage.clear();
    try { localStorage.clear(); } catch { /* ignore */ }
    vi.clearAllMocks();
  });

  it('HOME and LPAD resolve to the home launchpad desk (not Vol)', async () => {
    expect(resolveFunctionId('HOME')?.functionId).toBe('home');
    expect(resolveFunctionId('LPAD')?.functionId).toBe('home');
    expect(resolveFunctionId('home')?.functionId).toBe('home');
    const { useTerminalStore } = await import('../store/terminalStore');
    openFunction('HOME');
    expect(useTerminalStore.getState().setActiveTab).toHaveBeenCalledWith('home');
    openFunction('LPAD');
    expect(useTerminalStore.getState().setActiveTab).toHaveBeenCalledWith('home');
    // Launchpad grid tiles stay on Home (no section jump)
    expect(sessionStorage.getItem(DESK_JUMP_KEY)).toBeNull();
  });

  it('maps GEX and SOFR codes to exact functionIds', () => {
    expect(resolveFunctionId('GEX')?.functionId).toBe('positioning:pos-sub-chain');
    expect(resolveFunctionId('SOFR')?.functionId).toBe('rates:sec-stir');
    expect(resolveFunctionId('SMILE')?.functionId).toBe('vol:vol-sub-smile');
    // 3D is mesh theme on Vol · Greeks
    expect(resolveFunctionId('3D')?.functionId).toBe('vol:vol-sub-greeks');
    // Full Greeks single home = Vol
    expect(resolveFunctionId('VGRK')?.functionId).toBe('vol:vol-sub-greeks');
    expect(resolveFunctionId('GRK')?.functionId).toBe('vol:vol-sub-greeks');
    // Thalex-class Trade lab codes
    expect(resolveFunctionId('SIM')?.functionId).toBe('desk:desk-ws-sim');
    expect(resolveFunctionId('COMBO')?.functionId).toBe('desk:desk-ws-combo');
    expect(resolveFunctionId('HDG')?.functionId).toBe('desk:desk-ws-hedge');
    expect(resolveFunctionId('DESK')?.functionId).toBe('desk:desk-ws-sim');
  });

  it('openFunction writes desk.jump and setActiveTab', async () => {
    const { useTerminalStore } = await import('../store/terminalStore');
    const r = openFunction('GEX');
    expect(r.ok).toBe(true);
    expect(sessionStorage.getItem(DESK_JUMP_KEY)).toBe('pos-sub-chain');
    expect(useTerminalStore.getState().setActiveTab).toHaveBeenCalledWith('positioning');
    expect(useTerminalStore.getState().setDeskSection).toHaveBeenCalledWith('pos-sub-chain');
  });

  it('openFunction 3D sets mesh theme and Vol · Greeks', async () => {
    const { useTerminalStore } = await import('../store/terminalStore');
    const r = openFunction('3D');
    expect(r.ok).toBe(true);
    expect(localStorage.getItem('ui.greeks.surfaceTheme')).toBe('mesh');
    expect(sessionStorage.getItem(DESK_JUMP_KEY)).toBe('vol-sub-greeks');
    expect(useTerminalStore.getState().setActiveTab).toHaveBeenCalledWith('vol');
    expect(useTerminalStore.getState().setDeskSection).toHaveBeenCalledWith('vol-sub-greeks');
  });

  it('searchFunctions finds SOFR', () => {
    const hits = searchFunctions('sofr');
    expect(hits.some((h) => h.codes.includes('SOFR'))).toBe(true);
  });

  it('listFunctions includes all tabs', () => {
    const ids = listFunctions().map((f) => f.functionId);
    expect(ids).toContain('vol');
    expect(ids).toContain('rates');
    expect(ids).toContain('positioning:pos-sub-tools');
  });

  it('resolves study aliases to the same functionId as primaries', () => {
    expect(resolveFunctionId('OMON')?.functionId).toBe(resolveFunctionId('CHAIN')?.functionId);
    expect(resolveFunctionId('OMON')?.functionId).toBe('positioning:pos-sub-chain');
    expect(resolveFunctionId('OVDV')?.functionId).toBe(resolveFunctionId('SURF')?.functionId);
    expect(resolveFunctionId('OVDV')?.functionId).toBe('vol:vol-sub-surface');
    expect(resolveFunctionId('SKEW')?.functionId).toBe(resolveFunctionId('SMILE')?.functionId);
    expect(resolveFunctionId('SKEW')?.functionId).toBe('vol:vol-sub-smile');
    expect(resolveFunctionId('OVME')?.functionId).toBe('positioning:pos-sub-tools');
    expect(resolveFunctionId('DES')?.functionId).toBe('vol');
    expect(resolveFunctionId('HIVG')?.functionId).toBe('vol:vol-sub-term');
    expect(resolveFunctionId('HVT')?.functionId).toBe('vol');
    // Primaries stay authoritative (first code)
    expect(resolveFunctionId('OMON')?.codes[0]).toBe('CHAIN');
    expect(resolveFunctionId('OVDV')?.codes[0]).toBe('SURF');
    expect(resolveFunctionId('SKEW')?.codes[0]).toBe('SMILE');
  });

  it('openFunction resolves aliases to the correct desk + section', async () => {
    const { useTerminalStore } = await import('../store/terminalStore');
    openFunction('OMON');
    expect(useTerminalStore.getState().setActiveTab).toHaveBeenCalledWith('positioning');
    expect(sessionStorage.getItem(DESK_JUMP_KEY)).toBe('pos-sub-chain');

    openFunction('OVDV');
    expect(useTerminalStore.getState().setActiveTab).toHaveBeenCalledWith('vol');
    expect(sessionStorage.getItem(DESK_JUMP_KEY)).toBe('vol-sub-surface');

    openFunction('SKEW');
    expect(useTerminalStore.getState().setActiveTab).toHaveBeenCalledWith('vol');
    expect(sessionStorage.getItem(DESK_JUMP_KEY)).toBe('vol-sub-smile');

    openFunction('OVME');
    expect(useTerminalStore.getState().setActiveTab).toHaveBeenCalledWith('positioning');
    expect(sessionStorage.getItem(DESK_JUMP_KEY)).toBe('pos-sub-tools');

    openFunction('DES');
    expect(useTerminalStore.getState().setActiveTab).toHaveBeenCalledWith('vol');
  });

  it('searchFunctions finds OVDV/OMON study-alias queries', () => {
    expect(searchFunctions('ovdv').some((h) => h.functionId === 'vol:vol-sub-surface')).toBe(true);
    expect(searchFunctions('omon').some((h) => h.functionId === 'positioning:pos-sub-chain')).toBe(true);
    expect(searchFunctions('skew').some((h) => h.functionId === 'vol:vol-sub-smile')).toBe(true);
    expect(searchFunctions('historical').some((h) => h.functionId === 'vol:vol-sub-term')).toBe(true);
  });
});
