export type Freshness = 'live' | 'delayed' | 'stale' | 'unavailable';

export interface Coverage {
  numerator: number;
  denominator: number;
  state: 'complete' | 'partial' | 'unavailable';
  missing: string[];
}

export interface MarketEnvelope<T> {
  schemaVersion: 1;
  requestId: string;
  asOf: string;
  fetchedAt: string;
  source: string[];
  provenanceByField: Record<string, string>;
  unitsByField: Record<string, string>;
  freshness: Freshness;
  coverage: Coverage;
  assumptions: string[];
  warnings: string[];
  data: T;
}

export interface ErrorEnvelope {
  schemaVersion: 1;
  requestId: string;
  asOf: string;
  error: {
    code:
      | 'INVALID_REQUEST'
      | 'INVALID_SYMBOL'
      | 'UNSUPPORTED_CURRENCY'
      | 'PROVIDER_UNAVAILABLE'
      | 'INSUFFICIENT_COVERAGE'
      | 'RATE_LIMITED'
      | 'ENTITLEMENT_MISSING'
      | 'INTERNAL_CONTRACT_ERROR';
    message: string;
    retryable: boolean;
    provider?: string;
    detail?: string;
  };
}
