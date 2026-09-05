import { describe, it, expect } from 'vitest';
import { UI_COPY } from './uiCopy';

describe('UI_COPY', () => {
  it('exposes LIVE-only load strings', () => {
    expect(UI_COPY.load.chain).toBe('Building chain surface…');
    expect(UI_COPY.load.surface).toBe('Fitting surface…');
    expect(UI_COPY.load.rates).toBe('Loading rates… FRED · NYFed');
    expect(UI_COPY.load.crypto).toBe('Loading crypto books… Deribit');
    expect(UI_COPY.load.view).toBe('Loading view…');
    expect(UI_COPY.load.greeks).toBe('Loading Greeks 1.0…');
    expect(UI_COPY.load.surfaceModule).toBe('Loading surface module…');
  });

  it('exposes LIVE-only empty strings without demo CTAs', () => {
    expect(UI_COPY.empty.chain).toMatch(/yfinance/);
    expect(UI_COPY.empty.chain).toMatch(/Deribit/);
    expect(UI_COPY.empty.chain).toMatch(/Fail-closed|synthetic/i);
    expect(UI_COPY.empty.macro).toMatch(/FRED|rates/i);
    expect(UI_COPY.empty.demo).toMatch(/Refresh LIVE feeds/);
    expect(UI_COPY.empty.apiDown).toMatch(/FRED|rates/i);
    // MacroVol is an internal pipe name — never a market vendor in UI copy.
    expect(Object.values(UI_COPY).flatMap((g) => Object.values(g)).join(' ')).not.toMatch(/MacroVol/i);
    const joined = Object.values(UI_COPY.empty).join(' ');
    expect(joined.toLowerCase()).not.toMatch(/switch.*demo|toggle live for real/i);
  });
});
