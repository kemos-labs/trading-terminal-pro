/**
 * Read-only MCP server (Phase 11) — stdio JSON-RPC over the SAME domain
 * services/cache/quota as the REST API. Never calls providers independently;
 * never exposes trading/order/account/Stripe/secret tools.
 *
 * Protocol subset (MCP 2025-11-25): initialize → tools/list → tools/call.
 * Input/output schemas are explicit JSON Schema; outputs carry structured
 * content with source/timestamp/units/coverage/provenance/warnings.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function registry() {
  return JSON.parse(readFileSync(join(ROOT, 'docs/registry/workflows.json'), 'utf8'));
}

/** Shared JSON fetch against the local REST API (single cache/broker on that side). */
async function api(pathname, timeoutMs = 15_000) {
  const port = process.env.PORT || '3001';
  const url = `http://127.0.0.1:${port}${pathname}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  const body = await res.json().catch(() => ({ error: 'non-json', status: res.status }));
  return { status: res.status, body };
}

function ok(content) {
  const text = JSON.stringify(content, null, 2);
  return { content: [{ type: 'text', text }], structuredContent: content, isError: false };
}

function err(code, detail) {
  return {
    content: [{ type: 'text', text: `error: ${code} — ${detail}` }],
    structuredContent: { error: code, detail },
    isError: true,
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
  }
  return null;
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
    handler: async () => {
      const { status, body } = await api('/api/health');
      return status === 200 ? ok(body) : err('PROVIDER_UNAVAILABLE', `health ${status}`);
    },
  },
  {
    name: 'terminal.get_provider_status',
    description: 'Provider budgets, cache stats, freshness — never credentials or query history.',
    inputSchema: {
      type: 'object', additionalProperties: false, properties: {},
    },
    handler: async () => {
      const { status, body } = await api('/api/cache/status');
      return status === 200 ? ok(body) : err('PROVIDER_UNAVAILABLE', `cache/status ${status}`);
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
    handler: async ({ symbol }) => {
      const sym = requireSymbol({ symbol });
      const upper = String(symbol).toUpperCase();
      if (upper === 'BTC' || upper === 'ETH') {
        const { status, body } = await api(`/api/deribit/market/${upper}`);
        return status === 200 ? ok({ currency: upper, market: body }) : err('PROVIDER_UNAVAILABLE', `deribit ${status}`);
      }
      const { status, body } = await api(`/api/options/${encodeURIComponent(sym)}`);
      return status === 200 ? ok({ symbol: sym, chain: body }) : err('PROVIDER_UNAVAILABLE', `options ${status}`);
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
    handler: async ({ symbol }) => {
      const sym = requireSymbol({ symbol });
      if (!sym) return err('INVALID_SYMBOL', String(symbol));
      const suffix = sym === 'BTC' || sym === 'ETH' ? `/api/deribit/market/${sym}` : `/api/options/${encodeURIComponent(sym)}`;
      const { status, body } = await api(suffix);
      return status === 200 ? ok({ symbol: sym, data: body }) : err('PROVIDER_UNAVAILABLE', `${suffix} ${status}`);
    },
  },
  {
    name: 'terminal.get_volatility_surface',
    description: 'Volatility surface — observed matrix with a separately-labelled SVI model layer. Never fabricates missing cells.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        symbol: { type: 'string', pattern: '^[A-Z][A-Z0-9.-]{0,11}$' },
      },
      required: ['symbol'],
    },
    handler: async ({ symbol }) => {
      const sym = requireSymbol({ symbol });
      if (!sym) return err('INVALID_SYMBOL', String(symbol));
      const path = sym === 'BTC' || sym === 'ETH' ? `/api/deribit/market/${sym}` : `/api/options/${encodeURIComponent(sym)}`;
      const { status, body } = await api(path);
      if (status !== 200) return err('PROVIDER_UNAVAILABLE', `options ${status}`);
      return ok({
        symbol: sym,
        observation: body,
        note: 'Surface analytics are computed client-side from observed quotes; the observed matrix and SVI model layer remain separate. Model never fills observed cells.',
      });
    },
  },
  {
    name: 'terminal.get_greeks',
    description: 'Greeks for a symbol chain (observed IV + canonical BS greeks). Read-only, no pricing of trades.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        symbol: { type: 'string', pattern: '^[A-Z][A-Z0-9.-]{0,11}$' },
      },
      required: ['symbol'],
    },
    handler: async ({ symbol }) => {
      const sym = requireSymbol({ symbol });
      if (!sym) return err('INVALID_SYMBOL', String(symbol));
      const path = sym === 'BTC' || sym === 'ETH' ? `/api/deribit/market/${sym}` : `/api/options/${encodeURIComponent(sym)}`;
      const { status, body } = await api(path);
      return status === 200 ? ok({ symbol: sym, chain: body }) : err('PROVIDER_UNAVAILABLE', `options ${status}`);
    },
  },
  {
    name: 'terminal.get_positioning',
    description: 'Positioning — OI-weighted GEX/DEX/Vanna/Charm proxy from public chain data. Assumption-driven, never dealer inventory.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        symbol: { type: 'string', pattern: '^[A-Z][A-Z0-9.-]{0,11}$' },
      },
      required: ['symbol'],
    },
    handler: async ({ symbol }) => {
      const sym = requireSymbol({ symbol });
      if (!sym) return err('INVALID_SYMBOL', String(symbol));
      const path = sym === 'BTC' || sym === 'ETH' ? `/api/deribit/market/${sym}` : `/api/options/${encodeURIComponent(sym)}`;
      const { status, body } = await api(path);
      return status === 200 ? ok({ symbol: sym, chain: body, assumptions: ['OI-weight is a proxy, sign model calls +1/puts −1; not dealer inventory'] }) : err('PROVIDER_UNAVAILABLE', `options ${status}`);
    },
  },
  {
    name: 'terminal.get_rates_curve',
    description: 'Rates curve — FRED/OFR summary via the private rates worker (SOFR/EFFR/UST).',
    inputSchema: {
      type: 'object', additionalProperties: false, properties: {},
    },
    handler: async () => {
      const { status, body } = await api('/api/macrovol/rates/summary');
      return status === 200 ? ok(body) : err('PROVIDER_UNAVAILABLE', `rates/summary ${status}`);
    },
  },
  {
    name: 'terminal.get_stir_curve',
    description: 'STIR curve — SR1/SR3/SERFF strip (implied rates, basis spreads).',
    inputSchema: {
      type: 'object', additionalProperties: false, properties: {},
    },
    handler: async () => {
      const { status, body } = await api('/api/macrovol/stir/strip');
      return status === 200 ? ok(body) : err('PROVIDER_UNAVAILABLE', `stir/strip ${status}`);
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
    handler: async ({ currency }) => {
      const c = String(currency).toUpperCase();
      if (!['BTC', 'ETH'].includes(c)) return err('INVALID_SYMBOL', currency);
      const market = await api(`/api/deribit/market/${c}`);
      if (market.status !== 200) return err('PROVIDER_UNAVAILABLE', `deribit market ${market.status}`);
      const funding = await api(`/api/deribit/funding-history?currency=${c}&days=7`);
      return ok({
        currency: c,
        market: market.body,
        fundingHistory: funding.status === 200 ? funding.body : null,
      });
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
    handler: async ({ currency }) => {
      const c = String(currency).toUpperCase();
      if (!['BTC', 'ETH'].includes(c)) return err('INVALID_SYMBOL', currency);
      const [trades, free] = await Promise.all([
        api(`/api/deribit/trades/${c}?hours=24&count=200`), api(`/api/free-crypto/market/${c}`),
      ]);
      if (trades.status !== 200 && free.status !== 200) return err('PROVIDER_UNAVAILABLE', 'crypto flow unavailable');
      return ok({ currency: c, trades: trades.status === 200 ? trades.body : null, freeSnapshot: free.status === 200 ? free.body : null });
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
    handler: async ({ q }) => {
      const reg = registry();
      const ql = String(q).toLowerCase();
      const hits = reg.workflows
        .filter((w) => w.desk === 'academy' || w.code)
        .sort((a, b) => a.title.localeCompare(b.title));
      const pages = hits.filter((w) => w.title.toLowerCase().includes(ql) || w.purpose.toLowerCase().includes(ql));
      return ok({ query: q, results: pages.slice(0, 12), note: 'index-level search only; article text is untrusted display content' });
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
    if (msg.method === 'tools/list') return write(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
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