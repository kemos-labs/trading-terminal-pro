import { describe, it, expect } from 'vitest';
import { normalizeDeribitOption, normalizeDeribitOi } from '../../../domain/market/adapters/deribit/normalize';

describe('deribit fixtures', () => {
  it('inverse BTC option premium coin units and OI', () => {
    const raw={
      instrument_name: 'BTC-27DEC24-80000-C',
      kind: 'option',
      base_currency: 'BTC',
      quote_currency: 'BTC',
      settlement_currency: 'BTC',
      contract_size: 1,
      strike: 80000,
      option_type: 'call',
      expiry: new Date('2024-12-27T08:00:00Z').getTime(),
      mark_price: 0.05, // BTC per BTC notional? coin
      mark_iv: 55,
      open_interest: 123.5, // BTC units
      last: 0.049,
      bid_price: 0.048,
      ask_price: 0.051,
    };
    const norm=normalizeDeribitOption(raw as any, 60000, Date.now());
    expect(norm.nativeCurrency).toBe('BTC');
    expect(norm.contractSize).toBe(1);
    expect(norm.openInterest).toBe(123.5);
    // OI must not be multiplied by 100
    expect(normalizeDeribitOi(raw as any)).toBe(123.5);
  });
  it('forward derived R = ln(F/X)/T', () => {
    const F=60500, X=60000, T=0.25;
    const R=Math.log(F/X)/T;
    expect(R).toBeCloseTo(Math.log(60500/60000)/0.25, 10);
  });
});
