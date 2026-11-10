/**
 * Read-only MCP server (Phase 11) — stdio JSON-RPC over the SAME domain
 * services/cache/quota as the REST API. Never calls providers independently;
 * never exposes trading/order/account/Stripe/secret tools.
 *
 * Protocol subset (MCP 2025-11-25): initialize → tools/list → tools/call.
 * Input/output schemas are explicit JSON Schema; outputs carry structured
 * content with source/timestamp/units/coverage/provenance/warnings.
 */
import contracts from '../packages/contracts/src/v1-contracts.schema.json' with { type: 'json' };
import { assertContract } from '../packages/contracts/src/runtime.js';

/** Shared JSON fetch against the local REST API (single cache/broker on that side). */
async function api(pathname, timeoutMs = 15_000) {
  const port = process.env.PORT || '3001';
  const url = `http://127.0.0.1:${port}${pathname}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  const body = await res.json().catch(() => ({ error: 'non-json', status: res.status }));
  return { status: res.status, body };
}

/** Shared JSON POST against the local REST API (same cache/broker on that side). */
async function apiPost(pathname, body, timeoutMs = 30_000) {
  const port = process.env.PORT || '3001';
  const url = `http://127.0.0.1:${port}${pathname}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const parsed = await res.json().catch(() => ({ error: 'non-json', status: res.status }));
  return { status: res.status, body: parsed };
}

function assertJsonSafe(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('MCP output contains a non-finite number');
  if (Array.isArray(value)) value.forEach(assertJsonSafe);
  else if (value && typeof value === 'object') Object.values(value).forEach(assertJsonSafe);
}

function okContract(content, contractNames) {
  assertJsonSafe(content);
  const names = Array.isArray(contractNames) ? contractNames : [contractNames];
  const accepted = names.some((name) => {
    try { assertContract(name, content); return true; } catch { return false; }
  });
  if (!accepted) throw new Error(`MCP structuredContent failed contract: ${names.join(' | ')}`);
  const text = JSON.stringify(content, null, 2);
  return { content: [{ type: 'text', text }], structuredContent: content, isError: false };
}

function err(code, detail) {
  return {
    content: [{ type: 'text', text: `error: ${code} — ${detail}` }],
    isError: true,
  };
}

function contractOutputSchema(contractNames) {
  const names = Array.isArray(contractNames) ? contractNames : [contractNames];
  return {
    $schema: contracts.$schema,
    ...(names.length === 1
      ? { $ref: `#/$defs/${names[0]}` }
      : { anyOf: names.map((name) => ({ $ref: `#/$defs/${name}` })) }),
    $defs: contracts.$defs,
  };
}

function validateArgs(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
  const properties = schema.properties ?? {};
  for (const key of schema.required ?? []) if (!(key in args)) return `missing required property: ${key}`;
  if (schema.additionalProperties === false) for (const key of Object.keys(args)) if (!(key in properties)) return `additional property not allowed: ${key}`;
  for (const [key, rule] of Object.entries(properties)) if (key in args) {
    const err = validateValue(rule, args[key], key);
    if (err) return err;
  }
  for (const [key, dependencies] of Object.entries(schema.dependentRequired ?? {})) {
    if (key in args) for (const dependency of dependencies) if (!(dependency in args)) return `${dependency} is required with ${key}`;
  }
  return null;
}

function isEmptySchema(rule) {
  return !rule || (typeof rule === 'object' && Object.keys(rule).length === 0);
}

function validateValue(rule, value, path) {
  if (isEmptySchema(rule)) return null;
  // type union containing null (e.g. ["number","null"])
  let types = rule.type;
  if (Array.isArray(types)) {
    if (value === null) {
      return types.includes('null') ? null : `${path} must be a ${types.join(' or ')}`;
    }
    // filter out null for further checks
    const nonNull = types.filter((t) => t !== 'null');
    if (nonNull.length === 1) {
      return validateValue({ ...rule, type: nonNull[0] }, value, path);
    }
    // try each non-null type; if any passes, success
    for (const t of nonNull) {
      if (!validateValue({ ...rule, type: t }, value, path)) return null;
    }
    return `${path} must be a ${types.join(' or ')}`;
  }
  if (rule.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return `${path} must be an object`;
    const props = rule.properties ?? {};
    for (const k of rule.required ?? []) if (!(k in value)) return `${path}.${k}: missing required property: ${k}`;
    if (rule.additionalProperties === false) {
      for (const k of Object.keys(value)) if (!(k in props)) return `${path}.${k}: additional property not allowed: ${k}`;
    }
    for (const [k, sub] of Object.entries(props)) if (k in value) {
      const e = validateValue(sub, value[k], `${path}.${k}`);
      if (e) return e;
    }
    return null;
  }
  if (rule.type === 'array') {
    if (!Array.isArray(value)) return `${path} must be an array`;
    if (rule.minItems != null && value.length < rule.minItems) return `${path} must have at least ${rule.minItems} items`;
    if (rule.maxItems != null && value.length > rule.maxItems) return `${path} must have at most ${rule.maxItems} items`;
    if (rule.items && !isEmptySchema(rule.items)) {
      for (let i = 0; i < value.length; i++) {
        const e = validateValue(rule.items, value[i], `${path}[${i}]`);
        if (e) return e;
      }
    }
    return null;
  }
  if (rule.type === 'string') {
    if (typeof value !== 'string') return `${path} must be a string`;
    if (rule.minLength != null && value.length < rule.minLength) return `${path} is too short`;
    if (rule.maxLength != null && value.length > rule.maxLength) return `${path} is too long`;
    if (rule.enum && !rule.enum.includes(value)) return `${path} must be one of: ${rule.enum.join(', ')}`;
    if (rule.pattern && !(new RegExp(rule.pattern).test(value))) return `${path} has invalid format`;
    if (rule.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${path} has invalid format`;
    if (rule.format === 'date') {
      const d = new Date(`${value}T00:00:00.000Z`);
      if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) return `${path} has invalid format`;
    }
    return null;
  }
  if (rule.type === 'number' || rule.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${path} must be a finite number`;
    if (rule.type === 'integer' && !Number.isInteger(value)) return `${path} must be an integer`;
    if (rule.exclusiveMinimum != null && value <= rule.exclusiveMinimum) return `${path} must be > ${rule.exclusiveMinimum}`;
    if (rule.exclusiveMaximum != null && value >= rule.exclusiveMaximum) return `${path} must be < ${rule.exclusiveMaximum}`;
    if (rule.minimum != null && value < rule.minimum) return `${path} must be >= ${rule.minimum}`;
    if (rule.maximum != null && value > rule.maximum) return `${path} must be <= ${rule.maximum}`;
    return null;
  }
  if (rule.type === 'boolean') {
    if (typeof value !== 'boolean') return `${path} must be a boolean`;
    return null;
  }
  return null;
}

function analyticsQuery({ riskFreeRate, carryRate, maxRows }) {
  const params = new URLSearchParams();
  if (riskFreeRate != null) params.set('riskFreeRate', String(riskFreeRate));
  if (carryRate != null) params.set('carryRate', String(carryRate));
  if (maxRows != null) params.set('maxRows', String(maxRows));
  if (params.size === 0) return '';
  return `?${params.toString()}`;
}

function requireSymbol(args, def = null) {
  const raw = args.symbol ?? def;
  if (raw == null) return null;
  const v = String(raw).toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,11}$/.test(v) ? v : null;
}

const TOOLS = [
  {
    name: 'terminal.get_health',
    description: 'Read-only liveness of the terminal API.',
    inputSchema: {
      type: 'object', additionalProperties: false, properties: {},
    },
    outputContracts: ['healthResponse'],
    handler: async () => {
      const { status, body } = await api('/api/v1/system/health');
      return status === 200 ? okContract(body, 'healthResponse') : err('PROVIDER_UNAVAILABLE', `health ${status}`);
    },
  },
  {
    name: 'terminal.get_provider_status',
    description: 'Provider budgets, cache stats, freshness — never credentials or query history.',
    inputSchema: {
      type: 'object', additionalProperties: false, properties: {},
    },
    outputContracts: ['providerStatusResponse'],
    handler: async () => {
      const { status, body } = await api('/api/v1/provider/status');
      return status === 200 ? okContract(body, 'providerStatusResponse') : err('PROVIDER_UNAVAILABLE', `provider/status ${status}`);
    },
  },
  {
    name: 'terminal.get_market_snapshot',
    description: 'Observed market snapshot for a symbol: spot, chain-derived metrics, provenance, freshness. Equity: US symbols. Crypto: BTC/ETH via Deribit.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        symbol: { type: 'string', pattern: '^[A-Z][A-Z0-9.\\-]{0,11}$' },
      },
      required: ['symbol'],
    },
    outputContracts: ['optionsResponse', 'cryptoMarketResponse'],
    handler: async ({ symbol }) => {
      const sym = requireSymbol({ symbol });
      const upper = String(symbol).toUpperCase();
      if (upper === 'BTC' || upper === 'ETH') {
        const { status, body } = await api(`/api/v1/market/crypto/${upper}`);
        return status === 200 ? okContract(body, 'cryptoMarketResponse') : err('PROVIDER_UNAVAILABLE', `deribit ${status}`);
      }
      const { status, body } = await api(`/api/v1/market/options/${encodeURIComponent(sym)}`);
      return status === 200 ? okContract(body, 'optionsResponse') : err('PROVIDER_UNAVAILABLE', `options ${status}`);
    },
  },
  {
    name: 'terminal.get_options_chain',
    description: 'Observed option chain (delayed for equities; Deribit for crypto). Missing sides stay null.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        symbol: { type: 'string', pattern: '^[A-Z][A-Z0-9.-]{0,11}$' },
      },
      required: ['symbol'],
    },
    outputContracts: ['optionsResponse', 'cryptoMarketResponse'],
    handler: async ({ symbol }) => {
      const sym = requireSymbol({ symbol });
      if (!sym) return err('INVALID_SYMBOL', String(symbol));
      const suffix = sym === 'BTC' || sym === 'ETH' ? `/api/v1/market/crypto/${sym}` : `/api/v1/market/options/${encodeURIComponent(sym)}`;
      const { status, body } = await api(suffix);
      const contract = sym === 'BTC' || sym === 'ETH' ? 'cryptoMarketResponse' : 'optionsResponse';
      return status === 200 ? okContract(body, contract) : err('PROVIDER_UNAVAILABLE', `${suffix} ${status}`);
    },
  },
  {
    name: 'terminal.get_volatility_surface',
    description: 'Volatility surface — observed IV nodes with an explicitly unavailable model layer. Never fabricates missing cells.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        symbol: { type: 'string', pattern: '^[A-Z][A-Z0-9.-]{0,11}$' },
        maxRows: { type: 'integer', minimum: 1, maximum: 5_000 },
      },
      required: ['symbol'],
    },
    outputContracts: ['volatilitySurfaceResponse'],
    handler: async ({ symbol, maxRows }) => {
      const sym = requireSymbol({ symbol });
      if (!sym) return err('INVALID_SYMBOL', String(symbol));
      const path = `/api/v1/analytics/volatility-surface/${encodeURIComponent(sym)}${analyticsQuery({ maxRows })}`;
      const { status, body } = await api(path);
      if (status !== 200) return err('PROVIDER_UNAVAILABLE', `options ${status}`);
      return okContract(body, 'volatilitySurfaceResponse');
    },
  },
  {
    name: 'terminal.get_greeks',
    description: 'Greeks for a symbol chain (observed IV + canonical BS greeks). Read-only, no pricing of trades.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        symbol: { type: 'string', pattern: '^[A-Z][A-Z0-9.-]{0,11}$' },
        riskFreeRate: { type: 'number', minimum: -0.25, maximum: 1 },
        carryRate: { type: 'number', minimum: -0.25, maximum: 1 },
        maxRows: { type: 'integer', minimum: 1, maximum: 5_000 },
      },
      required: ['symbol'],
      dependentRequired: { riskFreeRate: ['carryRate'], carryRate: ['riskFreeRate'] },
    },
    outputContracts: ['greeksResponse'],
    handler: async ({ symbol, riskFreeRate, carryRate, maxRows }) => {
      const sym = requireSymbol({ symbol });
      if (!sym) return err('INVALID_SYMBOL', String(symbol));
      const path = `/api/v1/analytics/greeks/${encodeURIComponent(sym)}${analyticsQuery({ riskFreeRate, carryRate, maxRows })}`;
      const { status, body } = await api(path);
      return status === 200 ? okContract(body, 'greeksResponse') : err('PROVIDER_UNAVAILABLE', `greeks ${status}`);
    },
  },
  {
    name: 'terminal.get_positioning',
    description: 'Positioning — OI-weighted GEX/DEX/Vanna/Charm proxy (mixed per-metric signed-Greek OI convention: GEX +call/−put gamma, DEX/Vanna/Charm signed model Greek). Assumption-driven, never dealer inventory.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        symbol: { type: 'string', pattern: '^[A-Z][A-Z0-9.-]{0,11}$' },
        riskFreeRate: { type: 'number', minimum: -0.25, maximum: 1 },
        carryRate: { type: 'number', minimum: -0.25, maximum: 1 },
        maxRows: { type: 'integer', minimum: 1, maximum: 5_000 },
      },
      required: ['symbol'],
      dependentRequired: { riskFreeRate: ['carryRate'], carryRate: ['riskFreeRate'] },
    },
    outputContracts: ['positioningResponse'],
    handler: async ({ symbol, riskFreeRate, carryRate, maxRows }) => {
      const sym = requireSymbol({ symbol });
      if (!sym) return err('INVALID_SYMBOL', String(symbol));
      const path = `/api/v1/analytics/positioning/${encodeURIComponent(sym)}${analyticsQuery({ riskFreeRate, carryRate, maxRows })}`;
      const { status, body } = await api(path);
      return status === 200 ? okContract(body, 'positioningResponse') : err('PROVIDER_UNAVAILABLE', `positioning ${status}`);
    },
  },
  {
    name: 'terminal.get_forward_vol_matrix',
    description: 'Forward-volatility matrix for a symbol chain: pairwise upper-triangle forwards from ATM legs on a total-variance basis (DTE/365, annualized). Negative implied forward variance is unavailable, never clamped zero; diagonal/lower triangle structurally blank. Equity date-only expiries map to 20:00:00.000Z solely as model-time approximation ref06-equity-date-20utc-v1 (not observed/settlement/cutoff; no venue/DST/holiday adjustment); crypto keeps provider expiryMs instants ref06-crypto-provider-instant-v1. DTE is fractional elapsed time from envelope asOf divided by 86,400,000 ms; T=DTE/365, unrounded. Equity legs derived-solved-mid, crypto legs observed-mark. Read-only.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        symbol: { type: 'string', pattern: '^[A-Z][A-Z0-9.-]{0,11}$' },
        maxRows: { type: 'integer', minimum: 1, maximum: 5_000 },
      },
      required: ['symbol'],
    },
    outputContracts: ['forwardVolMatrixResponse'],
    handler: async ({ symbol, maxRows }) => {
      const sym = requireSymbol({ symbol });
      if (!sym) return err('INVALID_SYMBOL', String(symbol));
      const path = `/api/v1/analytics/forward-vol-matrix/${encodeURIComponent(sym)}${analyticsQuery({ maxRows })}`;
      const { status, body } = await api(path);
      return status === 200 ? okContract(body, 'forwardVolMatrixResponse') : err('PROVIDER_UNAVAILABLE', `forward-vol-matrix ${status}`);
    },
  },
  {
    name: 'terminal.get_exposure_grid',
    description: 'Hypothetical price × time signed exposure scenario grid (gex/charm/dex) from the shared engine over the canonical snapshot. DEX is signed kernel delta × S × OI × mult ($Δ notional, no side negation). Equity date-only expiries need explicit scenario expiryOverrides + model + rates; crypto futures-style options report unsupported-model. Read-only.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        symbol: { type: 'string', pattern: '^[A-Z][A-Z0-9.-]{0,11}$' },
        metric: { type: 'string', enum: ['gex', 'charm', 'dex'] },
        prices: { type: 'array', minItems: 2, maxItems: 150, items: { type: 'number', exclusiveMinimum: 0 } },
        times: { type: 'array', minItems: 1, maxItems: 150, items: {}, description: 'Strict UTC instants only: Z-suffixed ISO-8601 or finite safe-integer epoch ms; date-only/timezone-less/rollover rejected (400)' },
        maxRows: { type: 'integer', minimum: 1, maximum: 5000 },
        scenario: {
          type: 'object', additionalProperties: false,
          properties: {
            riskFreeRate: { type: 'number', minimum: -0.25, maximum: 1 },
            carryRate: { type: 'number', minimum: -0.25, maximum: 1 },
            model: { type: 'string', enum: ['spot-european'], description: 'Equity-only; not applicable on crypto snapshots' },
            multiplier: { type: 'number', exclusiveMinimum: 0, maximum: 100000, description: 'Explicit caller-supplied scenario contract multiplier; labelled scenario, never observed' },
            expiryOverrides: { type: 'object', additionalProperties: { type: 'string' }, description: 'Equity-only YYYY-MM-DD to strict UTC instant; not applicable on crypto snapshots' },
          },
        },
      },
      required: ['symbol', 'metric', 'prices', 'times'],
    },
    outputContracts: ['exposureGridResponse'],
    handler: async ({ symbol, metric, prices, times, maxRows, scenario }) => {
      const sym = requireSymbol({ symbol });
      if (!sym) return err('INVALID_SYMBOL', String(symbol));
      if (metric !== 'gex' && metric !== 'charm' && metric !== 'dex') return err('INVALID_REQUEST', 'metric must be gex|charm|dex');
      const { status, body } = await apiPost('/api/v1/analytics/positioning/exposure-grid', {
        symbol: sym, metric, prices, times, maxRows, scenario,
      });
      return status === 200 ? okContract(body, 'exposureGridResponse') : err(status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'INVALID_REQUEST', `exposure-grid ${status}`);
    },
  },
  {
    name: 'terminal.get_positioning_workbench',
    description: 'Linked positioning workbench: strike profile plus gamma, DEX delta-pressure ($Δ notional), and charm grids from one snapshot frame. Explicit scenario (rates, spot-european model, multiplier, expiry instants) required; nothing prefilled as observed. Read-only.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        symbol: { type: 'string', pattern: '^[A-Z][A-Z0-9.-]{0,11}$' },
        prices: { type: 'array', minItems: 2, maxItems: 150, items: { type: 'number', exclusiveMinimum: 0 } },
        times: { type: 'array', minItems: 1, maxItems: 150, items: {}, description: 'Strict UTC instants only; 8-digit date-like numerics rejected (400)' },
        referenceTime: { description: 'Strict UTC instant equal to one of times' },
        expiryFilter: { type: 'string', maxLength: 10 },
        zeroDteOnly: { type: 'boolean' },
        maxRows: { type: 'integer', minimum: 1, maximum: 5000 },
        calendar: {
          type: 'object', additionalProperties: false,
          required: ['dates'],
          properties: {
            dates: { type: 'array', minItems: 1, maxItems: 150, items: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }, description: 'Calendar dates; each maps to the reference instant UTC clock, first date must equal the reference UTC date' },
          },
        },
        scenario: {
          type: 'object', additionalProperties: false,
          required: ['riskFreeRate', 'carryRate', 'model', 'multiplier'],
          properties: {
            riskFreeRate: { type: 'number', minimum: -0.25, maximum: 1 },
            carryRate: { type: 'number', minimum: -0.25, maximum: 1 },
            model: { type: 'string', enum: ['spot-european'] },
            multiplier: { type: 'number', exclusiveMinimum: 0, maximum: 100000 },
            expiryOverrides: { type: 'object', additionalProperties: { type: 'string' } },
          },
        },
      },
      required: ['symbol', 'prices', 'times', 'referenceTime', 'scenario'],
    },
    outputContracts: ['exposureWorkbenchResponse'],
    handler: async ({ symbol, prices, times, referenceTime, expiryFilter, zeroDteOnly, maxRows, scenario, calendar }) => {
      const sym = requireSymbol({ symbol });
      if (!sym) return err('INVALID_SYMBOL', String(symbol));
      const { status, body } = await apiPost('/api/v1/analytics/positioning/workbench', {
        symbol: sym, prices, times, referenceTime, expiryFilter, zeroDteOnly, maxRows, scenario,
        ...(calendar != null ? { calendar } : {}),
      });
      return status === 200 ? okContract(body, 'exposureWorkbenchResponse') : err(status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'INVALID_REQUEST', `workbench ${status}`);
    },
  },
  {
    name: 'terminal.get_rates_curve',
    description: 'Rates curve — FRED/OFR summary via the private rates worker (SOFR/EFFR/UST).',
    inputSchema: {
      type: 'object', additionalProperties: false, properties: {},
    },
    outputContracts: ['ratesTermStructureResponse'],
    handler: async () => {
      const { status, body } = await api('/api/v1/rates/term-structure');
      return status === 200 ? okContract(body, 'ratesTermStructureResponse') : err('PROVIDER_UNAVAILABLE', `rates/term-structure ${status}`);
    },
  },
  {
    name: 'terminal.get_stir_curve',
    description: 'STIR curve — SR1/SR3/SERFF strip (implied rates, basis spreads).',
    inputSchema: {
      type: 'object', additionalProperties: false, properties: {},
    },
    outputContracts: ['ratesStirResponse'],
    handler: async () => {
      const { status, body } = await api('/api/v1/rates/stir');
      return status === 200 ? okContract(body, 'ratesStirResponse') : err('PROVIDER_UNAVAILABLE', `rates/stir ${status}`);
    },
  },
  {
    name: 'terminal.get_policy_scenario',
    description: 'Policy scenario calculator (REF-08/N3c math only): explicit meeting stepBps inputs over caller-supplied observed SOFR fixings with SR3/SR1 predicted-vs-current rows. stepBps is scenario input, never an inferred midpoint; target bounds are display metadata. Predicted values after the last observed fixing are scenario, never observed. Current rates observed only with explicit source/date; missing is Unavailable/null. Rates percent-100; differences basis points. Read-only; no calculator UI.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['fixings'],
      properties: {
        fixings: {
          type: 'array', minItems: 1, maxItems: 500,
          items: {
            type: 'object', additionalProperties: false, required: ['date', 'value'],
            properties: {
              date: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', format: 'date' },
              value: { type: 'number', minimum: -5, maximum: 30 },
            },
          },
        },
        meetings: {
          type: 'array', maxItems: 50,
          items: {
            type: 'object', additionalProperties: false, required: ['date'],
            properties: {
              date: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', format: 'date' },
              stepBps: { type: 'number', minimum: -500, maximum: 500 },
              targetLower: { type: 'number', minimum: -5, maximum: 30 },
              targetUpper: { type: 'number', minimum: -5, maximum: 30 },
            },
          },
        },
        sr3: {
          type: 'object', additionalProperties: false, required: ['windowStart', 'windowEnd'],
          properties: {
            windowStart: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', format: 'date' },
            windowEnd: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', format: 'date' },
            currentRate: { type: ['number', 'null'], minimum: -5, maximum: 30 },
            currentSource: { type: 'string' },
            currentDate: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', format: 'date' },
          },
        },
        sr1: {
          type: 'object', additionalProperties: false, required: ['windowStart', 'windowEnd'],
          properties: {
            windowStart: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', format: 'date' },
            windowEnd: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', format: 'date' },
            currentRate: { type: ['number', 'null'], minimum: -5, maximum: 30 },
            currentSource: { type: 'string' },
            currentDate: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', format: 'date' },
          },
        },
        policySpreadBps: { type: ['number', 'null'], minimum: -2000, maximum: 2000 },
        deriveStepFromMidpoint: { type: 'boolean' },
      },
    },
    outputContracts: ['policyScenarioResponse'],
    handler: async ({ fixings, meetings, sr3, sr1, policySpreadBps, deriveStepFromMidpoint }) => {
      if (!Array.isArray(fixings) || fixings.length < 1 || fixings.length > 500) return err('INVALID_REQUEST', 'fixings must be an array of 1 to 500 rows');
      // No MCP-side calculator: the REST route owns validation and the shared worker owns the math.
      const { status, body } = await apiPost('/api/v1/rates/policy-scenario', {
        fixings, ...(meetings !== undefined ? { meetings } : {}), ...(sr3 !== undefined ? { sr3 } : {}),
        ...(sr1 !== undefined ? { sr1 } : {}), ...(policySpreadBps !== undefined ? { policySpreadBps } : {}),
        ...(deriveStepFromMidpoint !== undefined ? { deriveStepFromMidpoint } : {}),
      });
      return status === 200 ? okContract(body, 'policyScenarioResponse') : err(status === 400 ? 'INVALID_REQUEST' : 'PROVIDER_UNAVAILABLE', `policy-scenario ${status}`);
    },
  },
  {
    name: 'terminal.get_crypto_carry',
    description: 'Crypto carry — perp funding + dated futures basis for BTC/ETH.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { currency: { type: 'string', enum: ['BTC', 'ETH'] } },
      required: ['currency'],
    },
    outputContracts: ['cryptoCarryResponse'],
    handler: async ({ currency }) => {
      const c = String(currency).toUpperCase();
      if (!['BTC', 'ETH'].includes(c)) return err('INVALID_SYMBOL', currency);
      const { status, body } = await api(`/api/v1/crypto/carry/${c}`);
      return status === 200 ? okContract(body, 'cryptoCarryResponse') : err('PROVIDER_UNAVAILABLE', `crypto carry ${status}`);
    },
  },
  {
    name: 'terminal.get_crypto_flow',
    description: 'Crypto flow — recent Deribit option trades (taker side) + free multi-venue snapshot.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { currency: { type: 'string', enum: ['BTC', 'ETH'] } },
      required: ['currency'],
    },
    outputContracts: ['cryptoFlowResponse'],
    handler: async ({ currency }) => {
      const c = String(currency).toUpperCase();
      if (!['BTC', 'ETH'].includes(c)) return err('INVALID_SYMBOL', currency);
      const { status, body } = await api(`/api/v1/crypto/flow/${c}?hours=24&count=200`);
      return status === 200 ? okContract(body, 'cryptoFlowResponse') : err('PROVIDER_UNAVAILABLE', `crypto flow ${status}`);
    },
  },
  {
    name: 'terminal.search_academy',
    description: 'Search Academy publication index by query (title/source/tags). Untrusted display content.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { q: { type: 'string', minLength: 1, maxLength: 120 } },
      required: ['q'],
    },
    outputContracts: ['academyIndexResponse'],
    handler: async ({ q }) => {
      const ql = String(q).toLowerCase();
      const { status, body } = await api('/api/v1/academy/index');
      if (status !== 200) return err('PROVIDER_UNAVAILABLE', `academy/index ${status}`);
      const matches = (body.data?.children ?? []).filter((item) => {
        const haystack = [item.title, item.source, item.categoryLabel, ...(item.tags ?? [])].join(' ').toLowerCase();
        return haystack.includes(ql);
      }).slice(0, 12);
      const result = {
        ...body,
        coverage: { numerator: matches.length, denominator: body.data?.children?.length ?? 0, state: matches.length > 0 ? 'partial' : 'unavailable', missing: [] },
        warnings: [...(body.warnings ?? []), 'Index-level search only; article bodies are untrusted display content.'],
        data: { title: `Academy search: ${String(q)}`, children: matches },
      };
      return okContract(result, 'academyIndexResponse');
    },
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

/** MCP 2025-11-25 stdio transport: parse one JSON-RPC message. */
function readMessage(buffer) {
  // Stream: split on newlines (one JSON per line is the common MCP stdio framing).
  const lines = buffer.split('\n');
  const messages = [];
  while (lines.length > 1) {
    messages.push(lines.shift());
  }
  return { messages, rest: lines.join('\n') };
}


export async function runMcpStdio() {
  const stdin = process.stdin;
  const stdout = process.stdout;
  let input = '';
  const write = (id, result, error) => stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) }) + '\n');
  const handle = async (msg) => {
    if (!msg || typeof msg !== 'object' || !Object.prototype.hasOwnProperty.call(msg, 'id')) return;
    const id = msg.id;
    if (msg.method === 'initialize') return write(id, { protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'terminal-readonly', version: '1.0.0' } });
    if (msg.method === 'tools/list') return write(id, { tools: TOOLS.map(({ name, description, inputSchema, outputContracts }) => ({ name, description, inputSchema, outputSchema: contractOutputSchema(outputContracts) })) });
    if (msg.method !== 'tools/call') return write(id, undefined, { code: -32601, message: `Method not found: ${msg.method}` });
    const tool = TOOL_MAP.get(msg.params?.name);
    if (!tool) return write(id, undefined, { code: -32602, message: `Unknown tool: ${msg.params?.name}` });
    const invalid = validateArgs(tool.inputSchema, msg.params?.arguments ?? {});
    if (invalid) return write(id, undefined, { code: -32602, message: invalid });
    try { write(id, await tool.handler(msg.params.arguments)); }
    catch (e) { write(id, undefined, { code: -32000, message: String(e?.message ?? e) }); }
  };
  stdin.setEncoding('utf8');
  stdin.on('data', (chunk) => {
    input += chunk;
    const { messages, rest } = readMessage(input);
    input = rest;
    for (const raw of messages) {
      if (!raw.trim()) continue;
      let msg;
      try { msg = JSON.parse(raw); } catch { write(null, undefined, { code: -32700, message: 'Parse error' }); continue; }
      void handle(msg);
    }
  });
  stdin.resume();
}

if (process.argv[1] && process.argv[1].endsWith('mcp-server.js')) {
  runMcpStdio().catch((e) => {
    process.stderr.write(String(e?.stack ?? e) + '\n');
    process.exit(1);
  });
}
