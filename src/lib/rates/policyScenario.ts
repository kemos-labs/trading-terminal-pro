/**
 * REF-08 policy-scenario typed client (UI slice only).
 *
 * Single canonical call: POST /api/v1/rates/policy-scenario.
 * No financial math lives here — the rates worker owns compounding;
 * this module only types the exact request/response contract and throws
 * typed errors for 400 (INVALID_REQUEST) and 502 (PROVIDER_UNAVAILABLE).
 */

export interface PolicyFixingInput {
  date: string;
  value: number;
}

export interface PolicyMeetingInput {
  date: string;
  stepBps?: number | null;
  targetLower?: number | null;
  targetUpper?: number | null;
}

export interface PolicyWindowInput {
  windowStart: string;
  windowEnd: string;
  currentRate?: number | null;
  currentSource?: string;
  currentDate?: string;
}

export interface PolicyScenarioRequest {
  fixings: PolicyFixingInput[];
  meetings?: PolicyMeetingInput[];
  sr3?: PolicyWindowInput | null;
  sr1?: PolicyWindowInput | null;
  policySpreadBps?: number | null;
  deriveStepFromMidpoint?: boolean;
}

export interface PolicyFixingPoint {
  date: string | null;
  observedValue: number | null;
  scenarioValue: number | null;
  cumulativeStepBps: number | null;
  provenance: 'observed' | 'scenario';
}

export interface PolicyWindowRow {
  windowStart: string | null;
  windowEnd: string | null;
  currentRate: number | null;
  currentSource: string | null;
  currentDate: string | null;
  currentProvenance: string;
  predictedRate: number | null;
  predictedProvenance: string;
  differenceBps: number | null;
  status: 'ok' | 'unavailable';
  warnings: string[];
}

export interface PolicyScenarioData {
  fixingLine: PolicyFixingPoint[];
  sr3: PolicyWindowRow | null;
  sr1: PolicyWindowRow | null;
  policySpreadBps: number | null;
  policySpreadProvenance: string;
  lastObservedDate: string | null;
}

export interface PolicyScenarioEnvelope {
  asOf?: string;
  fetchedAt?: number | null;
  source?: string[];
  freshness?: string;
  coverage?: { fulfilled?: number; requested?: number; missing?: string[] } | null;
  provenanceByField?: Record<string, string>;
  unitsByField?: Record<string, string>;
  assumptions?: string[];
  warnings?: string[];
  data: PolicyScenarioData;
}

export const POLICY_SCENARIO_PATH = '/api/v1/rates/policy-scenario';

export class PolicyScenarioError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'PolicyScenarioError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function readErrorBody(body: unknown, status: number): { code: string; message: string } {
  if (body && typeof body === 'object') {
    const err = (body as { error?: unknown }).error;
    if (err && typeof err === 'object') {
      const code = (err as { code?: unknown }).code;
      const message = (err as { message?: unknown }).message;
      return {
        code: typeof code === 'string' && code ? code : status === 502 ? 'PROVIDER_UNAVAILABLE' : 'INVALID_REQUEST',
        message: typeof message === 'string' && message ? message : `Request failed with HTTP ${status}.`,
      };
    }
    const code = (body as { code?: unknown }).code;
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && message) {
      return {
        code: typeof code === 'string' && code ? code : status === 502 ? 'PROVIDER_UNAVAILABLE' : 'INVALID_REQUEST',
        message,
      };
    }
  }
  return {
    code: status === 502 ? 'PROVIDER_UNAVAILABLE' : 'INVALID_REQUEST',
    message: `Request failed with HTTP ${status}.`,
  };
}

/** Exact-path POST of the caller-built request body. Never invents fields. */
export async function postPolicyScenario(
  body: PolicyScenarioRequest,
): Promise<PolicyScenarioEnvelope> {
  const res = await fetch(POLICY_SCENARIO_PATH, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const { code, message } = readErrorBody(data, res.status);
    throw new PolicyScenarioError(
      res.status,
      code,
      message,
      res.status === 502 || res.status === 429 || res.status >= 500,
    );
  }
  return data as PolicyScenarioEnvelope;
}
