import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCacheForTests } from '../../../api/upstreamCache.js';
import { buildServer } from '../../app.js';

const realFetch = global.fetch;

function responseFor(rawUrl) {
  const url = new URL(rawUrl);
  const method = url.pathname.split('/').pop() ?? '';
  const params = url.searchParams;
  let result;
  if (method.endsWith('get_instruments')) {
    result = [{
      instrument_name: 'BTC-PERPETUAL', base_currency: 'BTC', quote_currency: 'USD',
      settlement_currency: 'BTC', contract_size: 10, settlement_period: 'perpetual',
      kind: 'future', expiration_timestamp: 32503680000000, is_inverse: true, is_active: true,
    }];
  } else if (method.endsWith('get_book_summary_by_currency')) {
    result = params.get('kind') === 'future' ? [{
      instrument_name: 'BTC-PERPETUAL', mark_price: 60000, last: 60001,
      bid_price: 59999, ask_price: 60002, index_price: 60000,
      open_interest: 100, volume: 1000, funding_8h: 0.0001,
    }] : [];
  } else if (method.endsWith('ticker')) {
    result = {
      instrument_name: 'BTC-PERPETUAL', mark_price: 60000, last_price: 60001,
      best_bid_price: 59999, best_ask_price: 60002, index_price: 60000,
      open_interest: 100, funding_8h: 0.0001, timestamp: Date.now(),
    };
  } else if (method.endsWith('get_index_price')) {
    result = { index_price: 60000 };
  } else {
    throw new Error(`Unexpected Deribit method: ${method}`);
  }
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  clearCacheForTests();
  global.fetch = vi.fn(async (url) => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return responseFor(String(url));
  });
});

afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('Deribit route quota coalescing', () => {
  it('coalesces simultaneous v1 clients into one provider snapshot fill', async () => {
    const app = await buildServer();
    try {
      const responses = await Promise.all(Array.from({ length: 8 }, () => app.inject('/api/v1/market/crypto/BTC')));
      expect(responses.every((response) => response.statusCode === 200)).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(5);
      const methods = global.fetch.mock.calls.map(([url]) => new URL(String(url)).pathname.split('/').pop());
      expect(methods.filter((method) => method === 'get_instruments')).toHaveLength(1);
      expect(methods.filter((method) => method === 'get_index_price')).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
