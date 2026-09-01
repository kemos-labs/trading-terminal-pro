import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import contracts from './v1-contracts.schema.json' with { type: 'json' };

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
});
addFormats(ajv);
ajv.addSchema(contracts);

const validators = new Map();

export class ContractValidationError extends Error {
  constructor(contractName, errors) {
    super(`Response failed ${contractName}: ${ajv.errorsText(errors, { separator: '; ' })}`);
    this.name = 'ContractValidationError';
    this.contractName = contractName;
    this.validationErrors = errors ?? [];
  }
}

export function validateContract(contractName, value) {
  let validate = validators.get(contractName);
  if (!validate) {
    validate = ajv.compile({ $ref: `${contracts.$id}#/$defs/${contractName}` });
    validators.set(contractName, validate);
  }
  const valid = validate(value);
  return { valid: Boolean(valid), errors: validate.errors ?? [] };
}

export function assertContract(contractName, value) {
  const result = validateContract(contractName, value);
  if (!result.valid) throw new ContractValidationError(contractName, result.errors);
  return value;
}

export function isoFrom(value, fallback = new Date()) {
  const date = value instanceof Date
    ? value
    : typeof value === 'number'
      ? new Date(value)
      : typeof value === 'string'
        ? new Date(value)
        : fallback;
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback.toISOString();
}

export function createEnvelope({
  requestId,
  asOf,
  fetchedAt,
  source,
  provenanceByField = {},
  unitsByField = {},
  freshness,
  coverage,
  cache = { state: 'unavailable', hit: false, ageMs: null, stale: false, coalesced: false, providerError: null },
  assumptions = [],
  warnings = [],
  data,
}) {
  return {
    schemaVersion: 1,
    requestId: String(requestId),
    asOf: isoFrom(asOf),
    fetchedAt: isoFrom(fetchedAt),
    source: [...new Set(source.map(String))],
    provenanceByField,
    unitsByField,
    freshness,
    coverage,
    cache,
    assumptions: [...new Set(assumptions.map(String))],
    warnings: [...new Set(warnings.map(String))],
    data,
  };
}

export function createErrorEnvelope({ requestId, code, message, retryable, provider, detail }) {
  const error = {
    code,
    message: String(message).slice(0, 500),
    retryable: Boolean(retryable),
  };
  if (provider) error.provider = String(provider).slice(0, 80);
  if (detail) error.detail = String(detail).slice(0, 500);
  return assertContract('errorResponse', {
    schemaVersion: 1,
    requestId: String(requestId),
    asOf: new Date().toISOString(),
    error,
  });
}
