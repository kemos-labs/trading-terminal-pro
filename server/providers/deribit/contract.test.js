import { describe, it, expect } from 'vitest';
import { normalizeTicker, normalizeInstrument } from './normalize.js';
import { DeribitStream } from './stream.js';

describe('Deribit adapter contract', () => {
  it('preserves bid/ask/mark/trade separation', () => {
    const raw = {
      instrument_name: 'BTC-27DEC24-80000-C',
      kind: 'option',
      base_currency: 'BTC',
      quote_currency: 'BTC',
      settlement_currency: 'BTC',
      contract_size: 1,
      strike: 80000,
      bid_price: 0.048,
      ask_price: 0.051,
      mark_price: 0.05,
      last_price: 0.049,
      bid_iv: 55,
      ask_iv: 57,
      mark_iv: 56,
      open_interest: 123,
      timestamp: Date.now(),
    };
    const n = normalizeTicker(raw);
    expect(n.bidPrice).toBe(0.048);
    expect(n.askPrice).toBe(0.051);
    expect(n.markPrice).toBe(0.05);
    expect(n.lastPrice).toBe(0.049);
    expect(n.bidIv).toBe(55);
    expect(n.askIv).toBe(57);
    expect(n.markIv).toBe(56);
  });

  it('OI in underlying units without 100x', () => {
    const raw = { instrument_name: 'BTC-27DEC24-80000-C', open_interest: 12.5, contract_size: 1, settlement_currency: 'BTC', base_currency: 'BTC', kind: 'option' };
    expect(normalizeTicker(raw).openInterest).toBe(12.5);
  });

  it('contract metadata preserved', () => {
    const raw = { instrument_name: 'BTC-27DEC24-80000-C', base_currency: 'BTC', quote_currency: 'BTC', settlement_currency: 'BTC', contract_size: 1, kind: 'option', strike: 80000, expiration_timestamp: 1735286400000 };
    const m = normalizeInstrument(raw);
    expect(m.contractSize).toBe(1);
    expect(m.strike).toBe(80000);
    expect(m.isInverse).toBe(true);
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
});
