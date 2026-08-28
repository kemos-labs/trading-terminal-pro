import { describe, expect, it } from 'vitest';
import { isMacroAllowed, validateMacroQuery } from './macrovol.js';

describe('MacroVol proxy route contract', () => {
  it('matches browser product paths and rejects wrong methods', () => {
    expect(isMacroAllowed('/crypto/perp-basis', 'GET')).toBe(true);
    expect(isMacroAllowed('/greeks/AAPL/history?period=1mo', 'GET')).toBe(true);
    expect(isMacroAllowed('/crypto/perp-basis', 'POST')).toBe(false);
    expect(isMacroAllowed('/greeks/AAPL/history', 'OPTIONS')).toBe(false);
  });

  it('rejects malformed, empty, duplicate and unknown keys', () => {
    expect(validateMacroQuery('/greeks/AAPL/history?period=%')).toMatchObject({ error: expect.any(String) });
    expect(validateMacroQuery('/greeks/AAPL/history?=1')).toMatchObject({ error: 'empty query key' });
    expect(validateMacroQuery('/greeks/AAPL/history?period=1mo&period=1y')).toMatchObject({ error: expect.stringContaining('duplicate') });
    expect(validateMacroQuery('/greeks/AAPL/history?nope=1')).toMatchObject({ error: expect.stringContaining('unknown') });
  });

  it('enforces FastAPI bounds and canonicalizes numeric cache keys', () => {
    expect(validateMacroQuery('/sec/context/AAPL?limit=20').error).toBeNull();
    expect(validateMacroQuery('/sec/context/AAPL?limit=21').error).toMatch(/bounds/);
    expect(validateMacroQuery('/rates/basis-history?limit=29').error).toMatch(/bounds/);
    expect(validateMacroQuery('/rates/basis-history?limit=30').error).toBeNull();
    expect(validateMacroQuery('/rates/term-structure?T=0.25').normalized).toBe(validateMacroQuery('/rates/term-structure?T=0.250').normalized);
  });
});
