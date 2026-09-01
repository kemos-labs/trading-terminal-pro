import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROVIDER_CIRCUITS, providerCircuitState, resetProviderCircuitsForTests } from '../../../api/providerCircuitBreaker.js';
import { deribitFetch, resetDeribitClientState } from './client.js';

const realFetch = global.fetch;

describe('Deribit HTTP circuit ownership', () => {
  afterEach(() => {
    resetDeribitClientState();
    resetProviderCircuitsForTests();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('opens after three upstream failures and rejects later calls before fetch', async () => {
    const upstream = vi.fn(async () => { throw new Error('private upstream body'); });
    global.fetch = upstream;

    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(deribitFetch('ticker', { instrument_name: 'BTC-PERPETUAL' })).rejects.toThrow();
    }
    expect(upstream).toHaveBeenCalledTimes(3);
    await expect(deribitFetch('ticker')).rejects.toMatchObject({ code: 'provider_unavailable', status: 503 });
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it('rejects non-allowlisted methods before circuit accounting or HTTP', async () => {
    const upstream = vi.fn();
    global.fetch = upstream;

    await expect(deribitFetch('private/get_account_summary')).rejects.toMatchObject({ code: 'not_allowlisted' });
    expect(upstream).not.toHaveBeenCalled();
    expect(providerCircuitState(PROVIDER_CIRCUITS.DERIBIT)).toMatchObject({ status: 'closed', failures: 0 });
    await expect(deribitFetch('ticker')).rejects.toThrow();
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(providerCircuitState(PROVIDER_CIRCUITS.DERIBIT)).toMatchObject({ status: 'closed', failures: 1 });
  });
});
