import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const providerMod = await import('./provider');
const fmpClient = await import('./fmpClient');
const yahoo = await import('../options/yahoo');

// Realistic ATM-centered strikes for SPY @ 500 so IV solve / intrinsic checks pass.
const SPOT = 500;
const STRIKES = [460, 480, 490, 500, 510, 520, 540];
// Live expiry ~120 days out — never hardcode a date (snapshot builders drop
// expired slices, so literal dates become time bombs).
const EXPIRY = new Date(Date.now() + 120 * 24 * 3600 * 1000).toISOString().slice(0, 10);

/** Rough BS-ish mid so quotes clear intrinsic + liquidity filters. */
function roughMid(type: 'call' | 'put', strike: number): number {
  const intrinsic = type === 'call' ? Math.max(SPOT - strike, 0) : Math.max(strike - SPOT, 0);
  return Math.max(0.5, intrinsic + 8);
}

// Helper to build a minimal valid FMP option chain payload.
function fmpChain() {
  const mk = (type: 'call' | 'put', strike: number) => {
    const mid = roughMid(type, strike);
    return {
      optionType: type, strike,
      bid: mid * 0.95, ask: mid * 1.05, last: mid,
      openInterest: 10, volume: 5, impliedVolatility: 0.2, expirationDate: EXPIRY,
    };
  };
  const data = [];
  for (const s of STRIKES) {
    data.push(mk('call', s));
    data.push(mk('put', s));
  }
  return [{ expirationDate: EXPIRY, data }];
}
function yfChain() {
  const quotes = [];
  for (const s of STRIKES) {
    for (const type of ['call', 'put'] as const) {
      const mid = roughMid(type, s);
      quotes.push({
        strike: s, expiry: EXPIRY, type,
        bid: mid * 0.95, ask: mid * 1.05, last: mid,
        iv: 0.2, volume: 5, openInterest: 10,
      });
    }
  }
  return { symbol: 'SPY', spot: SPOT, expirations: [EXPIRY], quotes, timestamp: 0 };
}
function quote(price: number = SPOT) {
  return res([{ symbol: 'SPY', price }]);
}
function res(body: unknown, ok = true) {
  return { ok, text: () => Promise.resolve(JSON.stringify(body)), json: () => Promise.resolve(body) };
}

const provider = new providerMod.LiveProvider();

describe('LiveProvider auto chain source', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fmpClient.invalidateFmpCache();
    yahoo.invalidateYahooChainCache();
  });

  it('auto mode prefers yfinance chain when available', async () => {
    // FMP quote ok (spot), yfinance /api/options returns a chain, FMP options 403.
    mockFetch
      .mockResolvedValueOnce(quote(500)) // FMP quote
      .mockResolvedValueOnce(res({ schemaVersion: 1, asOf: new Date().toISOString(), data: {
        symbol: 'SPY', spot: SPOT, expirations: [EXPIRY],
        quotes: yfChain().quotes.map((q) => ({ ...q, right: q.type, markIv: q.iv })),
      } })) // /api/v1/market/options (canonical yfinance adapter)
      .mockResolvedValueOnce(res({ 'Error Message': 'Subscription does not include this endpoint' }, false)); // FMP options

    const snap = await provider.getSnapshot('SPY', { chainMode: 'auto' });
    expect(snap).not.toBeNull();
    expect(provider.lastChainSource).toBe('yfinance');
    expect(provider.lastChainAvailable).toBe(true);
    expect(snap!.spot).toBe(500);
  });

  it('auto mode falls back to FMP chain when yfinance is down', async () => {
    mockFetch
      .mockResolvedValueOnce(quote(500)) // FMP quote
      .mockRejectedValueOnce(new Error('yfinance unavailable')) // canonical options route fails
      .mockResolvedValueOnce(res(fmpChain())); // FMP options ok

    const snap = await provider.getSnapshot('SPY', { chainMode: 'auto' });
    expect(snap).not.toBeNull();
    expect(provider.lastChainSource).toBe('fmp');
    expect(provider.lastChainAvailable).toBe(true);
  });

  it('auto mode fails closed (null) when neither chain source is available', async () => {
    mockFetch
      .mockResolvedValueOnce(quote(500)) // FMP quote
      .mockRejectedValueOnce(new Error('yfinance unavailable'))
      .mockResolvedValueOnce(res({ 'Error Message': 'Subscription does not include this endpoint' }, false)); // FMP options

    const snap = await provider.getSnapshot('SPY', { chainMode: 'auto' });
    // LIVE is fail-closed: no synthetic smile under live mode.
    expect(snap).toBeNull();
    expect(provider.lastChainSource).toBe('synthetic');
    expect(provider.lastChainAvailable).toBe(false);
  });

  it('explicit fmp mode only uses FMP options', async () => {
    mockFetch
      .mockResolvedValueOnce(quote(500))
      .mockResolvedValueOnce(res(fmpChain()));
    const snap = await provider.getSnapshot('SPY', { chainMode: 'fmp' });
    expect(provider.lastChainSource).toBe('fmp');
    expect(snap!.spot).toBe(500);
  });

  it('auto: yfinance chain request is issued without awaiting optional spot (concurrency ordering)', async () => {
    const callOrder: string[] = [];
    let resolveFmp: (v: unknown) => void = () => {};
    const fmpDeferred = new Promise<unknown>((res) => { resolveFmp = res as never; });
    const fmpSpy = vi.spyOn(fmpClient, 'fmpGet').mockImplementation(async () => {
      callOrder.push('fmpGet');
      await fmpDeferred;
      return { json: null, cached: false, stale: false } as never;
    });
    const yfSpy = vi.spyOn(yahoo, 'fetchYahooSnapshot').mockImplementation(async () => {
      callOrder.push('fetchYahooSnapshot');
      const raw = yfChain();
      const { buildYahooSnapshot } = await import('../options/yahoo');
      return buildYahooSnapshot({ symbol: 'SPY', spot: SPOT, expirations: [EXPIRY], quotes: raw.quotes as never, timestamp: Date.now() }, 0.05, 0, { maxExpiries: 12 });
    });
    const p = provider.getSnapshot('SPY', { chainMode: 'auto' });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));
    // yfinance chain must have been kicked off before FMP spot resolves
    expect(yfSpy).toHaveBeenCalled();
    expect(callOrder).toContain('fetchYahooSnapshot');
    // Unblock provider so test can finish cleanly (chain already built, spot adoption will read null)
    resolveFmp(null);
    // Also unblock secondary YF fallbacks inside spotPromise (history/info) if needed
    vi.spyOn(await import('../data/yfinanceClient'), 'fetchYfHistory').mockResolvedValueOnce(null as never);
    const snap = await p;
    expect(snap).not.toBeNull();
    fmpSpy.mockRestore();
    yfSpy.mockRestore();
    vi.restoreAllMocks();
  });
});

describe('DataProvider seam (PR-07)', () => {
  it('getProvider remains the store entry and serves snapshots', async () => {
    const demo = providerMod.getProvider('demo');
    expect(demo.id).toBe('demo');
    const snap = await demo.getSnapshot('SPY');
    expect(snap).not.toBeNull();
    expect(snap!.symbol).toBe('SPY');
    expect(providerMod.isStreamingProvider(demo)).toBe(false);
  });

  it('HttpSnapshotTransport returns null on failed fetch', async () => {
    const transport = new providerMod.HttpSnapshotTransport(async () => {
      throw new Error('network');
    });
    expect(await transport.getJson('http://x')).toBeNull();
  });
});
