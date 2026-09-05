/**
 * LIVE-only empty / loading copy catalog.
 * Named work strings — never silent zeros, never demo CTAs.
 */
export const UI_COPY = {
  load: {
    chain: 'Building chain surface…',
    surface: 'Fitting surface…',
    rates: 'Loading rates… FRED · NYFed',
    crypto: 'Loading crypto books… Deribit',
    view: 'Loading view…',
    greeks: 'Loading Greeks 1.0…',
    surfaceModule: 'Loading surface module…',
  },
  empty: {
    chain:
      'No live option chain loaded. Equities use yfinance (delayed CBOE/OPRA via Yahoo) or FMP if keyed; BTC/ETH use Deribit. Fail-closed — no synthetic chain.',
    macro: 'Rates service unreachable (local FRED/NYFed pipe)',
    demo: 'Synthetic fallback — not market prices. Refresh LIVE feeds.',
    apiDown: 'Rates service unreachable. Check FRED/NYFed pipe (local :8765) or network / keys.',
  },
} as const;

export type UiCopy = typeof UI_COPY;
