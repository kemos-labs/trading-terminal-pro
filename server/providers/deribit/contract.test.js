/**
 * Deribit adapter contract tests — normalization invariants.
 * Full raw-fixture → endpoint → contract coverage lives in integration.test.js.
 */
import { describe, it, expect } from 'vitest';
import {
  catalogueKind,
  normalizeCatalogueEntry,
  normalizeQuote,
  joinCatalogueWithQuotes,
  normalizeTrade,
} from './normalize.js';
import { DeribitStream } from './stream.js';

describe('Deribit adapter contract', () => {
  it('preserves bid/ask/mark/trade separation and converts IV once', () => {
    const quote = normalizeQuote({
      instrument_name: 'BTC-27DEC24-80000-C',
      bid_price: 0.048,
      ask_price: 0.051,
      mark_price: 0.05,
      last_price: 0.049,
      bid_iv: 55,
      ask_iv: 57,
      mark_iv: 56,
      open_interest: 123,
      timestamp: Date.now(),
    });
    expect(quote.bidPrice).toBe(0.048);
    expect(quote.askPrice).toBe(0.051);
    expect(quote.markPrice).toBe(0.05);
    expect(quote.lastPrice).toBe(0.049);
    expect(quote.bidIv).toBeCloseTo(0.55, 8);
    expect(quote.askIv).toBeCloseTo(0.57, 8);
    expect(quote.markIv).toBeCloseTo(0.56, 8);
  });

  it('OI in underlying units without 100x', () => {
    const quote = normalizeQuote({ open_interest: 12.5 });
    expect(quote.openInterest).toBe(12.5);
  });

  it('contract metadata preserved from catalogue entry', () => {
    const m = normalizeCatalogueEntry({
      instrument_name: 'BTC-27DEC24-80000-C',
      kind: 'option',
      base_currency: 'BTC',
      quote_currency: 'USD',
      settlement_currency: 'BTC',
      contract_size: 1,
      strike: 80000,
      expiration_timestamp: 1735286400000,
      option_type: 'call',
      is_inverse: true,
      is_active: true,
    });
    expect(m.contractSize).toBe(1);
    expect(m.strike).toBe(80000);
    expect(m.optionType).toBe('call');
    expect(m.isInverse).toBe(true);
  });

  it('PERPETUAL catalogue rows normalize as kind=perp', () => {
    expect(catalogueKind({ instrument_name: 'BTC-PERPETUAL', kind: 'future', settlement_period: 'perpetual' })).toBe('perp');
    expect(catalogueKind({ instrument_name: 'BTC-27DEC24', kind: 'future', settlement_period: 'month' })).toBe('future');
  });

  it('join leaves missing metadata/quotes as null (no plausible defaults)', () => {
    const rows = joinCatalogueWithQuotes(
      [normalizeCatalogueEntry({ instrument_name: 'X-1', kind: 'option' })],
      [],
      1234,
    ).rows;
    expect(rows[0].contractSize).toBeNull();
    expect(rows[0].baseCurrency).toBeNull();
    expect(rows[0].markPrice).toBeNull();
    expect(rows[0].markIv).toBeNull();
  });

  it('sequence gap triggers resnapshot', () => {
    const gaps = [];
    const stream = new DeribitStream({ onGap: (e, g) => gaps.push([e, g]) });
    stream.seq = 10;
    const res = stream.handleMessage({ params: { data: { prev_change_id: 12, change_id: 12 } } });
    expect(res.resnapshot).toBe(true);
    expect(gaps.length).toBe(1);
  });

  it('10028 triggers jittered backoff, not browser storm', () => {
    const s = new DeribitStream();
    const first = s.handleRateLimit(10028);
    expect(first.shouldRetry).toBe(true);
    expect(first.backoff).toBeGreaterThan(0);
    const second = s.handleRateLimit(10028);
    expect(second.backoff).toBeGreaterThan(first.backoff);
  });

  it('trade premium is native settlement currency, IV decimal', () => {
    const t = normalizeTrade(
      { instrument_name: 'BTC-27DEC24-80000-C', price: 0.052, amount: 2.5, direction: 'buy', mark_iv: 56.1 },
      { settlementCurrency: 'BTC', contractSize: 1 },
    );
    expect(t.premiumNative).toBeCloseTo(0.13, 8);
    expect(t.nativeCurrency).toBe('BTC');
    expect(t.markIv).toBeCloseTo(0.561, 8);
  });
});
