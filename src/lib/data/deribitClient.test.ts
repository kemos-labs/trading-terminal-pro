import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDeribitMarket, invalidateDeribitCache } from './deribitClient';

const REAL_FETCH = global.fetch;

afterEach(() => {
  global.fetch = REAL_FETCH;
  invalidateDeribitCache();
});

describe('canonical Deribit legacy adapter', () => {
  it('uses one market snapshot and preserves missing funding as null', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      currency: 'BTC',
      indexPrice: 60_000,
      funding8h: null,
      fetchedAt: 1_700_000_000_000,
      source: 'deribit',
      instruments: [
        {
          instrument: 'BTC-30DEC30-60000-C',
          kind: 'option',
          bidPrice: 0.04,
          askPrice: 0.05,
          markPrice: 0.045,
          lastPrice: 0.044,
          markIv: 0.55,
          indexPrice: 60_000,
          openInterest: 100,
          volume: 10,
          funding8h: null,
          timestamp: 1_700_000_000_000,
        },
        {
          instrument: 'BTC-PERPETUAL',
          kind: 'perp',
          bidPrice: 60_001,
          askPrice: 60_002,
          markPrice: 60_001.5,
          lastPrice: 60_001,
          markIv: null,
          indexPrice: 60_000,
          openInterest: null,
          volume: null,
          funding8h: null,
          timestamp: 1_700_000_000_000,
        },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const bundle = await fetchDeribitMarket('BTC');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('/api/deribit/market/BTC', expect.any(Object));
    expect(bundle?.options[0]).toMatchObject({
      instrument_name: 'BTC-30DEC30-60000-C',
      mark_iv: 0.55,
      mid_price: 0.045,
    });
    expect(bundle?.perp?.funding_8h).toBeNull();
    expect(bundle?.perp?.open_interest).toBeNull();
    expect(bundle?.fundingAnn).toBeNull();
  });
});
