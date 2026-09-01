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
    const value = args[key];
    if (rule.type === 'string' && typeof value !== 'string') return `${key} must be a string`;
    if (rule.type === 'string') {
      if (rule.minLength != null && value.length < rule.minLength) return `${key} is too short`;
      if (rule.maxLength != null && value.length > rule.maxLength) return `${key} is too long`;
      if (rule.enum && !rule.enum.includes(value)) return `${key} must be one of: ${rule.enum.join(', ')}`;
      if (rule.pattern && !(new RegExp(rule.pattern).test(value))) return `${key} has invalid format`;
    }
    if (rule.type === 'number' || rule.type === 'integer') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${key} must be a finite number`;
      if (rule.type === 'integer' && !Number.isInteger(value)) return `${key} must be an integer`;
      if (rule.minimum != null && value < rule.minimum) return `${key} must be >= ${rule.minimum}`;
      if (rule.maximum != null && value > rule.maximum) return `${key} must be <= ${rule.maximum}`;
    }
  }
  for (const [key, dependencies] of Object.entries(schema.dependentRequired ?? {})) {
    if (key in args) for (const dependency of dependencies) if (!(dependency in args)) return `${dependency} is required with ${key}`;
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
    description: 'Positioning — OI-weighted GEX/DEX/Vanna/Charm proxy from public chain data. Assumption-driven, never dealer inventory.',
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
