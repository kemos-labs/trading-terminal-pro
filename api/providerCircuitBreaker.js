/**
 * Bounded provider circuit breaker.
 *
 * Circuit identity is deliberately a fixed provider name. Callers must not
 * pass symbols, URLs, query strings, or user-controlled values as a key.
 */

export const PROVIDER_CIRCUITS = Object.freeze({
  DERIBIT: 'deribit',
  BINANCE_FUTURES: 'binance-futures',
  BYBIT_LINEAR: 'bybit-linear',
  BYBIT_OPTIONS: 'bybit-options',
  OKX_OPTIONS: 'okx-options',
});

export const CIRCUIT_FAILURE_THRESHOLD = 3;
export const CIRCUIT_COOLDOWN_MS = 30_000;

const allowedProviders = new Set(Object.values(PROVIDER_CIRCUITS));
const statusProviders = Object.freeze([
  PROVIDER_CIRCUITS.DERIBIT,
  PROVIDER_CIRCUITS.BINANCE_FUTURES,
  PROVIDER_CIRCUITS.BYBIT_LINEAR,
  PROVIDER_CIRCUITS.BYBIT_OPTIONS,
  PROVIDER_CIRCUITS.OKX_OPTIONS,
]);
const circuits = new Map();

function assertProvider(provider) {
  if (!allowedProviders.has(provider)) {
    throw new TypeError('provider circuit must use a fixed provider identifier');
  }
}

function stateFor(provider) {
  let state = circuits.get(provider);
  if (!state) {
    state = { status: 'closed', failures: 0, openedAt: null, probeInFlight: false };
    circuits.set(provider, state);
  }
  return state;
}

function openError() {
  return Object.assign(new Error('Provider temporarily unavailable'), {
    code: 'provider_unavailable',
    status: 503,
  });
}

/** Execute one provider-owned operation through its circuit. */
export async function withProviderCircuit(provider, operation) {
  assertProvider(provider);
  if (typeof operation !== 'function') throw new TypeError('circuit operation must be a function');
  const state = stateFor(provider);
  const startedStatus = state.status;
  let isHalfOpenProbe = false;
  const now = Date.now();

  if (state.status === 'open') {
    if (state.openedAt == null || now - state.openedAt < CIRCUIT_COOLDOWN_MS) throw openError();
    state.status = 'half-open';
    state.probeInFlight = false;
  }
  if (state.status === 'half-open') {
    if (state.probeInFlight) throw openError();
    state.probeInFlight = true;
    isHalfOpenProbe = true;
  }

  try {
    const result = await operation();
    // A success from work that was already in flight must not close a circuit
    // opened by a concurrent failure. Only a closed request or the single
    // half-open probe may transition the circuit to closed.
    if (isHalfOpenProbe || (startedStatus === 'closed' && state.status === 'closed')) {
      state.status = 'closed';
      state.failures = 0;
      state.openedAt = null;
    }
    return result;
  } catch (error) {
    if (isHalfOpenProbe) {
      state.status = 'open';
      state.openedAt = Date.now();
      state.failures = CIRCUIT_FAILURE_THRESHOLD;
    } else if (startedStatus !== 'closed' || state.status !== 'closed') {
      // Another in-flight operation already opened the circuit; preserve its
      // cooldown origin and do not extend the failure count.
    } else {
      state.failures += 1;
      if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
        state.status = 'open';
        state.openedAt = Date.now();
      }
    }
    throw error;
  } finally {
    if (isHalfOpenProbe) state.probeInFlight = false;
  }
}

/** Safe operational snapshot for tests/diagnostics; no provider details. */
export function providerCircuitState(provider) {
  assertProvider(provider);
  const state = stateFor(provider);
  return { status: state.status, failures: state.failures, openedAt: state.openedAt, probeInFlight: state.probeInFlight };
}

/** Return the bounded public status projection for every supported provider. */
export function providerCircuitStatuses() {
  const now = Date.now();
  return statusProviders.map((provider) => {
    const state = stateFor(provider);
    const cooldownRemainingMs = state.status === 'open' && state.openedAt != null
      ? Math.max(0, CIRCUIT_COOLDOWN_MS - Math.max(0, now - state.openedAt))
      : 0;
    return {
      provider,
      status: state.status,
      failures: Number.isSafeInteger(state.failures) && state.failures >= 0 ? state.failures : 0,
      cooldownRemainingMs: Math.trunc(cooldownRemainingMs),
      probeInFlight: Boolean(state.probeInFlight),
    };
  });
}

export function resetProviderCircuitsForTests() {
  circuits.clear();
}
