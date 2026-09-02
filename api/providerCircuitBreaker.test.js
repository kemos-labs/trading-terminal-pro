import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CIRCUIT_COOLDOWN_MS,
  CIRCUIT_FAILURE_THRESHOLD,
  PROVIDER_CIRCUITS,
  providerCircuitStatuses,
  providerCircuitState,
  resetProviderCircuitsForTests,
  withProviderCircuit,
} from './providerCircuitBreaker.js';

describe('provider circuit breaker', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetProviderCircuitsForTests();
  });

  it('opens after threshold failures and fast-fails without invoking the provider', async () => {
    const provider = PROVIDER_CIRCUITS.DERIBIT;
    const operation = vi.fn(async () => { throw new Error('private upstream diagnostic'); });
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) await expect(withProviderCircuit(provider, operation)).rejects.toThrow();
    expect(providerCircuitState(provider).status).toBe('open');
    const calls = operation.mock.calls.length;
    await expect(withProviderCircuit(provider, operation)).rejects.toMatchObject({ code: 'provider_unavailable', status: 503 });
    expect(operation).toHaveBeenCalledTimes(calls);
  });

  it('permits exactly one half-open probe, closes on success, and reopens on failure', async () => {
    vi.useFakeTimers();
    const provider = PROVIDER_CIRCUITS.BINANCE_FUTURES;
    let release;
    const failing = async () => { throw new Error('failure'); };
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) await expect(withProviderCircuit(provider, failing)).rejects.toThrow();
    vi.advanceTimersByTime(CIRCUIT_COOLDOWN_MS);
    const probe = new Promise((resolve) => { release = resolve; });
    const first = withProviderCircuit(provider, () => probe.then(() => 'ok'));
    await expect(withProviderCircuit(provider, async () => 'unexpected')).rejects.toMatchObject({ code: 'provider_unavailable' });
    release();
    await expect(first).resolves.toBe('ok');
    expect(providerCircuitState(provider).status).toBe('closed');

    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) await expect(withProviderCircuit(provider, failing)).rejects.toThrow();
    vi.advanceTimersByTime(CIRCUIT_COOLDOWN_MS);
    await expect(withProviderCircuit(provider, failing)).rejects.toThrow('failure');
    expect(providerCircuitState(provider).status).toBe('open');
  });

  it('does not let an old closed-state request release or close a half-open probe', async () => {
    vi.useFakeTimers();
    const provider = PROVIDER_CIRCUITS.BYBIT_LINEAR;
    let releaseOld;
    const old = withProviderCircuit(provider, () => new Promise((resolve) => { releaseOld = resolve; }));
    const failing = async () => { throw new Error('failure'); };
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) await expect(withProviderCircuit(provider, failing)).rejects.toThrow();
    vi.advanceTimersByTime(CIRCUIT_COOLDOWN_MS);

    let releaseProbe;
    const probe = withProviderCircuit(provider, () => new Promise((resolve) => { releaseProbe = resolve; }));
    expect(providerCircuitState(provider)).toMatchObject({ status: 'half-open', probeInFlight: true });
    releaseOld('old-success');
    await expect(old).resolves.toBe('old-success');
    expect(providerCircuitState(provider)).toMatchObject({ status: 'half-open', probeInFlight: true });
    await expect(withProviderCircuit(provider, async () => 'second-probe')).rejects.toMatchObject({ code: 'provider_unavailable' });
    releaseProbe('probe-success');
    await expect(probe).resolves.toBe('probe-success');
    expect(providerCircuitState(provider).status).toBe('closed');
  });

  it('rejects query-derived and unknown circuit identifiers', async () => {
    await expect(withProviderCircuit('deribit:BTC', async () => null)).rejects.toThrow(/fixed provider identifier/);
    expect(() => providerCircuitState('provider-injected-secret')).toThrow(/fixed provider identifier/);
  });

  it('publishes exactly the bounded default status shape', () => {
    expect(providerCircuitStatuses()).toEqual([
      { provider: 'deribit', status: 'closed', failures: 0, cooldownRemainingMs: 0, probeInFlight: false },
      { provider: 'binance-futures', status: 'closed', failures: 0, cooldownRemainingMs: 0, probeInFlight: false },
      { provider: 'bybit-linear', status: 'closed', failures: 0, cooldownRemainingMs: 0, probeInFlight: false },
      { provider: 'bybit-options', status: 'closed', failures: 0, cooldownRemainingMs: 0, probeInFlight: false },
      { provider: 'okx-options', status: 'closed', failures: 0, cooldownRemainingMs: 0, probeInFlight: false },
    ]);
  });
});
