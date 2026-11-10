/**
 * MCP contract tests (Phase 11) — generic MCP client over stdio (2025-11-25).
 * Assertions: 15 read-only tools; strict input/output schemas with
 * additionalProperties:false; no trading/order/account/Stripe/secret tools;
 * structured content; tool failures typed; oversized/malformed inputs rejected.
 */
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buildServer } from '../server/app.js';
import { resolveRatesWorkerUrl } from '../server/ratesWorkerUrl.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = import.meta.dirname;

class McpClient {
  proc: ChildProcess;
  buf = '';
  pending = new Map<number, { resolve: (m: unknown) => void; reject: (e: Error) => void }>();
  lines: unknown[] = [];
  nextId = 1;

  constructor(port: number) {
    this.proc = spawn(process.execPath, [join(ROOT, 'mcp-server.js')], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (d) => { (this as unknown as { _err: string })._err = String(d); });
    this.proc.on('error', (e) => { this._spawnError = String(e); });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => {
      this.buf += chunk;
      let idx;
      while ((idx = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + 1);
        if (!line.trim()) continue;
        let msg: { id: number; result?: unknown; error?: { message?: string } };
        try { msg = JSON.parse(line); } catch { continue; }
        this.lines.push(msg);
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        }
      }
    });
  }

  async waitLine(predicate: (line: any) => boolean): Promise<any> {
    const found = this.lines.find(predicate);
    if (found) return found;
    return new Promise(resolve => {
      const timer = setInterval(() => {
        const line = this.lines.find(predicate);
        if (line) { clearInterval(timer); resolve(line); }
      }, 5);
    });
  }

  async batch(calls: { method: string; params: unknown }[]): Promise<unknown[]> {
    const requests = calls.map(({ method, params }) => {
      const id = this.nextId++;
      const p = new Promise((resolve, reject) => this.pending.set(id, { resolve: resolve as (m: unknown) => void, reject }));
      return { id, method, params, p };
    });
    this.proc.stdin.write(requests.map(({ id, method, params }) => JSON.stringify({ jsonrpc: '2.0', id, method, params })).join('\n') + '\n');
    return Promise.all(requests.map(({ p }) => p));
  }

  send(text: string) { this.proc.stdin.write(text); }

  async call(method: string, params: unknown, expectError = false): Promise<unknown> {
    const id = this.nextId++;
    const p = new Promise((resolve, reject) => this.pending.set(id, { resolve: resolve as (m: unknown) => void, reject }));
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    const out = (await p) as { error?: unknown };
    if (expectError) {
      expect(out?.error ?? null, `expected error for ${method}`).toBeTruthy();
      return out;
    }
    if (out && 'error' in out) throw new Error(`unexpected error: ${JSON.stringify(out.error)}`);
    return out;
  }

  async close() {
    this.proc.stdin.end();
    this.proc.kill();
    await Promise.race([once(this.proc, 'exit'), new Promise((r) => setTimeout(r, 500))]);
  }
}

const FORBIDDEN = ['order', 'trade-', 'place_order', 'account', 'withdraw', 'payment', 'stripe', 'password', 'reset', 'secret', 'key'];
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const REAL_FETCH = global.fetch;

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

vi.mock('../server/routes/equityFeeds.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../server/routes/equityFeeds.js')>();
  return {
    ...original,
    getOptionChainSnapshot: async (symbol: string, opts?: unknown) => {
      if (String(symbol).toUpperCase() === 'TESTCAL') {
        return {
          symbol: 'TESTCAL',
          spot: 100,
          timestamp: '2026-01-05T12:00:00.000Z',
          quotes: [
            { strike: 100, expiry: '2026-01-06', right: 'call', bid: 5, ask: 5.2, markIv: 0.25, openInterest: 50 },
            { strike: 100, expiry: '2030-12-18', right: 'put', bid: 4, ask: 4.2, markIv: 0.25, openInterest: 40 },
          ],
        };
      }
      return (original as unknown as { getOptionChainSnapshot: (s: string, o?: unknown) => Promise<unknown> }).getOptionChainSnapshot(symbol, opts);
    },
  };
});

function installProviderBoundary() {
  const workerOrigin = new URL(resolveRatesWorkerUrl()).origin;
  const expiry = Date.UTC(2030, 11, 30, 8);
  const timestamp = Date.now();
  global.fetch = vi.fn(async (input) => {
    const url = new URL(String(input));
    const rpc = (result: unknown) => json({ jsonrpc: '2.0', result });
    // REF-08/N3c synthetic worker stand-in: shape-identical canned result so the
    // MCP tool test exercises the real REST route + contract without a live worker.
    if (url.origin === workerOrigin && url.pathname === '/api/rates/policy-scenario') {
      return json({
        fixingLine: [
          { date: '2026-01-05', observedValue: 5.0, scenarioValue: 5.0, cumulativeStepBps: 0.0, provenance: 'observed' },
          { date: '2026-01-08', observedValue: null, scenarioValue: 5.1, cumulativeStepBps: 10.0, provenance: 'scenario' },
        ],
        sr3: {
          windowStart: '2026-01-05', windowEnd: '2026-01-09',
          currentRate: 4.9, currentSource: 'synthetic-fixture', currentDate: '2026-01-05',
          currentProvenance: 'observed-explicit-source-date',
          predictedRate: 5.0261, predictedProvenance: 'scenario-compound-sofr-rate',
          differenceBps: 12.61, status: 'ok', warnings: [],
        },
        sr1: null,
        policySpreadBps: null,
        policySpreadProvenance: 'unavailable-not-supplied',
        lastObservedDate: '2026-01-05',
        warnings: ['policy spread omitted: stays null/Unavailable (no default).'],
        assumptions: ['synthetic-fixture assumption'],
        as_of: '2026-01-09T00:00:00.000Z',
        source: 'caller-supplied-fixings-plus-scenario-steps',
      });
    }
    if (url.hostname.includes('binance.com')) {
      if (url.pathname.includes('premiumIndex')) return json({ symbol: 'BTCUSDT', markPrice: '60001', indexPrice: '60000', lastFundingRate: '0.0001' });
      if (url.pathname.includes('openInterest')) return json({ symbol: 'BTCUSDT', openInterest: '100' });
      return json({ symbol: 'BTCUSDT', lastPrice: '60001', quoteVolume: '1000000', priceChangePercent: '0.5' });
    }
    if (url.hostname.includes('bybit.com')) return json({ retCode: 0, result: { list: [{ symbol: 'BTCUSDT', lastPrice: '60002', markPrice: '60001', indexPrice: '60000', fundingRate: '0.0001', openInterest: '90', turnover24h: '2000000', price24hPcnt: '0.005' }] } });
    if (url.pathname.endsWith('/get_instruments')) return rpc([
      { instrument_name: 'BTC-30DEC30-60000-C', kind: 'option', is_active: true, strike: 60000, expiration_timestamp: expiry, option_type: 'call', contract_size: 1, base_currency: 'BTC', quote_currency: 'USD', settlement_currency: 'BTC', is_inverse: true, tick_size: 0.0005, settlement_period: 'month', creation_timestamp: timestamp },
      { instrument_name: 'BTC-30DEC30', kind: 'future', is_active: true, expiration_timestamp: expiry, contract_size: 10, base_currency: 'BTC', quote_currency: 'USD', settlement_currency: 'BTC', is_inverse: true, tick_size: 0.5, settlement_period: 'month', creation_timestamp: timestamp },
      { instrument_name: 'BTC-PERPETUAL', kind: 'future', is_active: true, expiration_timestamp: Date.UTC(3000, 0, 1), contract_size: 10, base_currency: 'BTC', quote_currency: 'USD', settlement_currency: 'BTC', is_inverse: true, tick_size: 0.5, settlement_period: 'perpetual', creation_timestamp: timestamp },
    ]);
    if (url.pathname.endsWith('/get_book_summary_by_currency') && url.searchParams.get('kind') === 'option') return rpc([{ instrument_name: 'BTC-30DEC30-60000-C', mark_price: 0.05, bid_price: 0.049, ask_price: 0.051, mark_iv: 55, underlying_price: 60000, timestamp }]);
    if (url.pathname.endsWith('/get_book_summary_by_currency') && url.searchParams.get('kind') === 'future') return rpc([{ instrument_name: 'BTC-30DEC30', mark_price: 62000, bid_price: 61990, ask_price: 62010, underlying_price: 60000, timestamp }]);
    if (url.pathname.endsWith('/ticker')) return rpc({ instrument_name: 'BTC-PERPETUAL', mark_price: 60001, best_bid_price: 60000, best_ask_price: 60002, index_price: 60000, timestamp });
    if (url.pathname.endsWith('/get_index_price')) return rpc({ index_price: 60000 });
    if (url.pathname.endsWith('/get_funding_rate_history')) return rpc([{ timestamp, interest_8h: 0.0001, index_price: 60000 }]);
    return new Response(JSON.stringify({ error: 'unexpected provider request' }), { status: 404 });
  });
}

describe('MCP read-only server (contract)', () => {
  let client: McpClient;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    installProviderBoundary();
    app = await buildServer();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('MCP test server did not expose a TCP port');
    client = new McpClient(address.port);
    await client.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  }, 30_000);

  afterAll(async () => {
    if (client) {
      // diagnostic dump if hooks misbehave
      if ((client as unknown as { _err?: string })._err) {
        console.error('MCP stderr:', (client as unknown as { _err?: string })._err);
      }
      await client.close();
    }
    await app?.close();
    global.fetch = REAL_FETCH;
  }, 10_000);

  it('tools/list exposes exactly the 16 read-only tools with explicit schemas', async () => {
    const res = (await client.call('tools/list', {})) as { tools: { name: string; inputSchema: { additionalProperties?: boolean; properties?: Record<string, unknown> }; outputSchema?: { $ref?: string; anyOf?: unknown[]; $defs?: Record<string, unknown> } }[] };
    expect(res.tools).toHaveLength(16);
    const names = res.tools.map((t) => t.name).sort();
    expect(res.tools.every((tool) => tool.outputSchema?.$defs && (tool.outputSchema.$ref || tool.outputSchema.anyOf))).toBe(true);
    expect(names).toEqual([
      'terminal.get_crypto_carry',
      'terminal.get_crypto_flow',
      'terminal.get_exposure_grid',
      'terminal.get_forward_vol_matrix',
      'terminal.get_greeks',
      'terminal.get_health',
      'terminal.get_market_snapshot',
      'terminal.get_options_chain',
      'terminal.get_policy_scenario',
      'terminal.get_positioning',
      'terminal.get_positioning_workbench',
      'terminal.get_provider_status',
      'terminal.get_rates_curve',
      'terminal.get_stir_curve',
      'terminal.get_volatility_surface',
      'terminal.search_academy',
    ]);
    for (const t of res.tools) {
      expect(t.inputSchema === false || t.inputSchema.additionalProperties === false, `${t.name}: additionalProperties false`).toBe(true);
      expect(t.inputSchema, `${t.name}: explicit schema`).toMatchObject({ type: 'object' });
      expect(() => ajv.compile(t.outputSchema), `${t.name}: compilable output schema`).not.toThrow();
    }
  });

  it('no trading/order/account/Stripe/secret tools are exposed', async () => {
    const res = (await client.call('tools/list', {})) as { tools: { name: string; description: string }[] };
    const haystack = res.tools.map((t) => `${t.name} ${t.description}`).join(' ').toLowerCase();
    for (const f of FORBIDDEN) {
      expect(haystack, `forbidden tool word: ${f}`).not.toContain(f);
    }
  });

  it('get_health returns structured ok content', async () => {
    const res = (await client.call('tools/call', { name: 'terminal.get_health', arguments: {} })) as { content: { type: string; text: string }[]; structuredContent: unknown };
    expect(res.content[0].type).toBe('text');
    const parsed = JSON.parse(res.content[0].text as string);
    expect(parsed.data.status).toBe('ok');
    expect(res.structuredContent).toEqual(parsed);
    const listed = (await client.call('tools/list', {})) as { tools: { name: string; outputSchema: object }[] };
    const schema = listed.tools.find((tool) => tool.name === 'terminal.get_health')?.outputSchema;
    expect(ajv.compile(schema)(res.structuredContent), ajv.errorsText()).toBe(true);
  });

  it('get_provider_status returns cache/budget stats without credentials', async () => {
    const res = (await client.call('tools/call', { name: 'terminal.get_provider_status', arguments: {} })) as { content: { text: string }[] };
    const parsed = JSON.parse(res.content[0].text as string);
    expect(parsed.data.providerModes).toBeTypeOf('object');
    expect(JSON.stringify(res).toLowerCase()).not.toMatch(/(api[_-]?key|token|secret|authorization)/);
  });

  it('analytical tools return their own strict contracts rather than raw chains', async () => {
    const listed = (await client.call('tools/list', {})) as { tools: { name: string; outputSchema: object }[] };
    for (const [name, args, expectedField] of [
      ['terminal.get_volatility_surface', { symbol: 'BTC' }, 'observedNodes'],
      ['terminal.get_greeks', { symbol: 'BTC', riskFreeRate: 0.04, carryRate: 0 }, 'points'],
      ['terminal.get_positioning', { symbol: 'BTC', riskFreeRate: 0.04, carryRate: 0 }, 'points'],
    ] as const) {
      const result = (await client.call('tools/call', { name, arguments: args })) as { structuredContent: { data: Record<string, unknown> }; content: { text: string }[] };
      const schema = listed.tools.find((tool) => tool.name === name)?.outputSchema;
      expect(ajv.compile(schema)(result.structuredContent), `${name}: ${ajv.errorsText()}`).toBe(true);
      expect(result.structuredContent.data).toHaveProperty(expectedField);
      expect(result.structuredContent.data).not.toHaveProperty('instruments');
      expect(result.structuredContent.data).not.toHaveProperty('quotes');
      expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    }
  }, 30_000);

  it('get_forward_vol_matrix returns a validated triangular matrix (unavailable never zero)', async () => {
    const listed = (await client.call('tools/list', {})) as { tools: { name: string; outputSchema: object }[] };
    const schema = listed.tools.find((tool) => tool.name === 'terminal.get_forward_vol_matrix')?.outputSchema;
    expect(schema).toBeTruthy();
    const res = (await client.call('tools/call', { name: 'terminal.get_forward_vol_matrix', arguments: { symbol: 'TESTCAL' } })) as { content: { type: string; text: string }[]; structuredContent: { data: Record<string, unknown> }; isError?: boolean };
    expect(res.isError).toBeFalsy();
    expect(ajv.compile(schema)(res.structuredContent), ajv.errorsText()).toBe(true);
    expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent);
    const data = res.structuredContent.data as Record<string, unknown>;
    expect((data.origin as Record<string, unknown>).label).toBe('SPOT');
    expect(data.formula).toBe('fwdVol = sqrt((sigma2^2*T2 - sigma1^2*T1)/(T2-T1))');
    expect(data.yearFraction).toBe('DTE/365 calendar');
    expect(data.ivBasis).toBe('derived-solved-mid');
    const cells = data.cells as { startIndex: number; endIndex: number; value: number | null; structural: boolean; reason: string | null }[];
    for (const cell of cells) {
      if (cell.endIndex <= cell.startIndex) {
        expect(cell.structural).toBe(true);
        expect(cell.value).toBeNull();
        expect(cell.reason).toBe('structural');
      } else {
        expect(cell.value == null || (Number.isFinite(cell.value) && cell.value >= 0)).toBe(true);
      }
    }
    expect(res.content[0].text).not.toContain('NaN');
    expect(res.content[0].text).not.toContain('Infinity');
  }, 30_000);

  it('get_forward_vol_matrix rejects bad input without substitution', async () => {
    await expect(client.call('tools/call', { name: 'terminal.get_forward_vol_matrix', arguments: { symbol: 'AA++bad' } })).rejects.toThrow(/invalid format/i);
    await expect(client.call('tools/call', { name: 'terminal.get_forward_vol_matrix', arguments: {} })).rejects.toThrow(/missing required/i);
    await expect(client.call('tools/call', { name: 'terminal.get_forward_vol_matrix', arguments: { symbol: 'BTC', maxRows: 1.5 } })).rejects.toThrow(/integer/i);
    await expect(client.call('tools/call', { name: 'terminal.get_forward_vol_matrix', arguments: { symbol: 'BTC', extra: true } })).rejects.toThrow(/additional property/i);
  });

  it('get_policy_scenario returns the canonical REST contract as structuredContent', async () => {
    const listed = (await client.call('tools/list', {})) as { tools: { name: string; outputSchema: object }[] };
    const schema = listed.tools.find((tool) => tool.name === 'terminal.get_policy_scenario')?.outputSchema;
    expect(schema).toBeTruthy();
    const args = {
      fixings: [{ date: '2026-01-05', value: 5.0 }, { date: '2026-01-06', value: 5.0 }],
      meetings: [{ date: '2026-01-08', stepBps: 10 }],
      sr3: { windowStart: '2026-01-05', windowEnd: '2026-01-09', currentRate: 4.9, currentSource: 'synthetic-fixture', currentDate: '2026-01-05' },
    };
    const res = (await client.call('tools/call', { name: 'terminal.get_policy_scenario', arguments: args })) as { content: { type: string; text: string }[]; structuredContent: { data: Record<string, unknown> }; isError?: boolean };
    expect(res.isError).toBeFalsy();
    expect(ajv.compile(schema)(res.structuredContent), ajv.errorsText()).toBe(true);
    expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent);
    const data = res.structuredContent.data as Record<string, unknown>;
    const line = data.fixingLine as { date: string; observedValue: number | null; scenarioValue: number | null; provenance: string }[];
    expect(line.find((r) => r.date === '2026-01-05')?.provenance).toBe('observed');
    expect(line.find((r) => r.date === '2026-01-08')?.provenance).toBe('scenario');
    expect(data.policySpreadBps).toBeNull();
    expect(res.content[0].text).not.toContain('NaN');
    expect(res.content[0].text).not.toContain('Infinity');
  }, 30_000);

  it('get_policy_scenario rejects bad input without substitution', async () => {
    await expect(client.call('tools/call', { name: 'terminal.get_policy_scenario', arguments: {} })).rejects.toThrow(/missing required/i);
    await expect(client.call('tools/call', { name: 'terminal.get_policy_scenario', arguments: { fixings: [], extra: true } })).rejects.toThrow(/additional property/i);
  });

  it('policy scenario tools/list exposes nested strict schema', async () => {
    const res = (await client.call('tools/list', {})) as { tools: { name: string; inputSchema: Record<string, unknown> }[] };
    const tool = res.tools.find((t) => t.name === 'terminal.get_policy_scenario');
    expect(tool).toBeTruthy();
    const s = tool!.inputSchema as Record<string, unknown>;
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(['fixings']);
    const props = s.properties as Record<string, Record<string, unknown>>;
    // fixings
    expect(props.fixings).toMatchObject({ type: 'array', minItems: 1, maxItems: 500 });
    const fixItem = (props.fixings as Record<string, unknown>).items as Record<string, unknown>;
    expect(fixItem.additionalProperties).toBe(false);
    expect(fixItem.required).toEqual(['date', 'value']);
    expect((fixItem.properties as Record<string, unknown>).date).toBeTruthy();
    expect((fixItem.properties as Record<string, unknown>).value).toMatchObject({ minimum: -5, maximum: 30 });
    // meetings
    const meetItem = (props.meetings as Record<string, unknown>).items as Record<string, unknown>;
    expect(meetItem.additionalProperties).toBe(false);
    expect(meetItem.required).toEqual(['date']);
    expect((meetItem.properties as Record<string, unknown>).stepBps).toMatchObject({ minimum: -500, maximum: 500 });
    // sr3/sr1
    for (const k of ['sr3', 'sr1']) {
      const win = props[k] as Record<string, unknown>;
      expect(win.additionalProperties).toBe(false);
      expect(win.required).toEqual(['windowStart', 'windowEnd']);
      expect((win.properties as Record<string, unknown>).windowStart).toBeTruthy();
      expect((win.properties as Record<string, unknown>).currentRate).toBeTruthy();
    }
    // nullable + boolean
    expect((props.policySpreadBps as Record<string, unknown>).type).toEqual(['number', 'null']);
    expect(props.deriveStepFromMidpoint).toMatchObject({ type: 'boolean' });
  });

  it('policy scenario nested validation rejects extra keys, bad dates, non-finite/out-of-range, and missing window keys before fetch', async () => {
    const fetchSpy = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const before = (fetchSpy as unknown as { mock: { calls: unknown[] } })?.mock?.calls?.length ?? 0;
    const expectReject = async (args: unknown, pattern: RegExp) => {
      await expect(client.call('tools/call', { name: 'terminal.get_policy_scenario', arguments: args })).rejects.toThrow(pattern);
      expect(client.lines.at(-1)?.error?.code).toBe(-32602);
    };
    // extra key in fixing item
    await expectReject({ fixings: [{ date: '2026-01-05', value: 5, extra: 1 }] }, /additional property/i);
    // extra key in meeting item
    await expectReject({ fixings: [{ date: '2026-01-05', value: 5 }], meetings: [{ date: '2026-01-08', stepBps: 10, extra: 1 }] }, /additional property/i);
    // extra key in sr3
    await expectReject({ fixings: [{ date: '2026-01-05', value: 5 }], sr3: { windowStart: '2026-01-05', windowEnd: '2026-01-09', extra: 1 } }, /additional property/i);
    // extra key in sr1
    await expectReject({ fixings: [{ date: '2026-01-05', value: 5 }], sr1: { windowStart: '2026-01-05', windowEnd: '2026-01-09', extra: 1 } }, /additional property/i);
    // malformed date
    await expectReject({ fixings: [{ date: '2026-13-01', value: 5 }] }, /invalid format/i);
    await expectReject({ fixings: [{ date: '2026-01-05', value: 5 }], meetings: [{ date: 'bad-date' }] }, /invalid format/i);
    // non-finite nested number
    await expectReject({ fixings: [{ date: '2026-01-05', value: Infinity }] }, /finite number/i);
    // out-of-range nested numbers
    await expectReject({ fixings: [{ date: '2026-01-05', value: 99 }] }, /must be <=/i);
    await expectReject({ fixings: [{ date: '2026-01-05', value: 5 }], meetings: [{ date: '2026-01-08', stepBps: 1000 }] }, /must be <=/i);
    await expectReject({ fixings: [{ date: '2026-01-05', value: 5 }], sr3: { windowStart: '2026-01-05', windowEnd: '2026-01-09', currentRate: 99 } }, /must be <=/i);
    await expectReject({ fixings: [{ date: '2026-01-05', value: 5 }], policySpreadBps: 9999 }, /must be <=/i);
    // missing required nested window key
    await expectReject({ fixings: [{ date: '2026-01-05', value: 5 }], sr3: { windowStart: '2026-01-05' } }, /missing required/i);
    await expectReject({ fixings: [{ date: '2026-01-05', value: 5 }], sr1: { windowEnd: '2026-01-09' } }, /missing required/i);
    // no fetch should have been issued for any nested-invalid case
    const after = (fetchSpy as unknown as { mock: { calls: unknown[] } })?.mock?.calls?.length ?? before;
    expect(after).toBe(before);
  });

  it('policy scenario nullable fields are accepted when valid', async () => {
    const res1 = (await client.call('tools/call', { name: 'terminal.get_policy_scenario', arguments: { fixings: [{ date: '2026-01-05', value: 5 }], sr3: { windowStart: '2026-01-05', windowEnd: '2026-01-09', currentRate: null } } })) as { isError?: boolean; structuredContent: unknown };
    expect(res1.isError).toBeFalsy();
    const res2 = (await client.call('tools/call', { name: 'terminal.get_policy_scenario', arguments: { fixings: [{ date: '2026-01-05', value: 5 }], policySpreadBps: null } })) as { isError?: boolean; structuredContent: unknown };
    expect(res2.isError).toBeFalsy();
    const res3 = (await client.call('tools/call', { name: 'terminal.get_policy_scenario', arguments: { fixings: [{ date: '2026-01-05', value: 5 }], policySpreadBps: 0 } })) as { isError?: boolean };
    expect(res3.isError).toBeFalsy();
  });

  it('invalid symbol errors with typed error (never fabricates)', async () => {
    await expect(client.call('tools/call', { name: 'terminal.get_options_chain', arguments: { symbol: 'AA++bad' } })).rejects.toThrow(/invalid format/i);
  });

  it('unknown tool name → protocol error (never auto-substitutes)', async () => {
    await expect(client.call('tools/call', { name: 'terminal.place_order', arguments: {} })).rejects.toThrow(/Unknown tool/);
    expect(client.lines.at(-1)?.error?.code).toBe(-32602);
  });

  it('tool outputs never contain NaN/Infinity', async () => {
    const res = (await client.call('tools/call', { name: 'terminal.get_crypto_carry', arguments: { currency: 'BTC' } })) as { content: { text: string }[]; structuredContent?: unknown; isError?: boolean };
    expect(res.isError).toBe(false);
    expect(res.structuredContent).toBeTypeOf('object');
    expect(res.content[0].text).not.toContain('NaN');
    expect(res.content[0].text).not.toContain('Infinity');
  }, 20_000);

  it('protocol framing, notifications, concurrency, and malformed JSON are handled', async () => {
    const before = client.lines.length;
    client.send('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    await new Promise(r => setTimeout(r, 30)); expect(client.lines.length).toBe(before);
    const results = await client.batch([{ method: 'tools/call', params: { name: 'terminal.get_health', arguments: {} } }, { method: 'tools/call', params: { name: 'terminal.get_provider_status', arguments: {} } }]);
    expect(results).toHaveLength(2);
    client.send('{bad json}\n'); const parse = await client.waitLine(line => line?.error?.code === -32700); expect(parse.error.code).toBe(-32700);
    await expect(client.call('no/such/method', {})).rejects.toThrow();
    expect(client.lines.at(-1)?.error?.code).toBe(-32601);
  });

  it('rejects all strict schema violations and never substitutes SPY', async () => {
    await expect(client.call('tools/call', { name: 'terminal.search_academy', arguments: { q: '' } })).rejects.toThrow(/too short/i);
    await expect(client.call('tools/call', { name: 'terminal.search_academy', arguments: { q: 'x'.repeat(121) } })).rejects.toThrow(/too long/i);
    await expect(client.call('tools/call', { name: 'terminal.get_health', arguments: { extra: true } })).rejects.toThrow(/additional property/i);
    await expect(client.call('tools/call', { name: 'terminal.search_academy', arguments: {} })).rejects.toThrow(/missing required/i);
    await expect(client.call('tools/call', { name: 'terminal.get_crypto_carry', arguments: { currency: 'DOGE' } })).rejects.toThrow(/one of/i);
    await expect(client.call('tools/call', { name: 'terminal.get_options_chain', arguments: { symbol: 123 } })).rejects.toThrow(/string/i);
    await expect(client.call('tools/call', { name: 'terminal.get_market_snapshot', arguments: { symbol: '123' } })).rejects.toThrow(/invalid format/i);
    await expect(client.call('tools/call', { name: 'terminal.get_greeks', arguments: { symbol: 'BTC', riskFreeRate: 0.04 } })).rejects.toThrow(/carryRate is required/i);
    await expect(client.call('tools/call', { name: 'terminal.get_greeks', arguments: { symbol: 'BTC', riskFreeRate: Infinity, carryRate: 0 } })).rejects.toThrow(/finite number/i);
    await expect(client.call('tools/call', { name: 'terminal.get_positioning', arguments: { symbol: 'BTC', riskFreeRate: 2, carryRate: 0 } })).rejects.toThrow(/must be <= 1/i);
    await expect(client.call('tools/call', { name: 'terminal.get_volatility_surface', arguments: { symbol: 'BTC', maxRows: 1.5 } })).rejects.toThrow(/integer/i);
    expect(client.lines.at(-1)?.error?.code).toBe(-32602);
  });

  it('get_positioning_workbench with a calendar block returns a validated same-frame calendar surface', async () => {
    const T0 = '2026-01-05T12:00:00.000Z';
    const T1 = '2027-01-05T12:00:00.000Z';
    const listed = (await client.call('tools/list', {})) as { tools: { name: string; outputSchema: object }[] };
    const schema = listed.tools.find((tool) => tool.name === 'terminal.get_positioning_workbench')?.outputSchema;
    expect(schema).toBeTruthy();
    const res = (await client.call('tools/call', {
      name: 'terminal.get_positioning_workbench',
      arguments: {
        symbol: 'TESTCAL',
        prices: [95, 100, 105],
        times: [T0, T1],
        referenceTime: T0,
        calendar: { dates: ['2026-01-05', '2026-01-07', '2031-01-05'] },
        scenario: {
          riskFreeRate: 0.04,
          carryRate: 0.01,
          model: 'spot-european',
          multiplier: 100,
          expiryOverrides: {
            '2026-01-06': '2026-01-06T12:00:00.000Z',
            '2030-12-18': '2030-12-18T21:00:00.000Z',
          },
        },
      },
    })) as { content: { text: string }[]; structuredContent: { data: Record<string, unknown> }; isError?: boolean };
    expect(res.isError).toBeFalsy();
    // structuredContent validates against the tool's own output contract.
    expect(ajv.compile(schema)(res.structuredContent), ajv.errorsText()).toBe(true);
    expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent);
    const data = res.structuredContent.data as Record<string, unknown>;
    const cal = data.calendar as Record<string, unknown>;
    expect(cal).toBeTruthy();
    // Same snapshot frame: calendar proves the bound quote set, not a second fetch.
    expect(cal.snapshotIdentity).toBe(data.frameId);
    // Current/peak/domain/clock semantics with honest dollar units.
    const current = cal.current as Record<string, unknown>;
    expect(current.unit).toBe('$/1% move');
    expect(current.instant).toBe(T0);
    expect(cal.clock).toBe('12:00:00.000');
    expect((cal.instants as string[])[0]).toBe(T0);
    expect((cal.peak as Record<string, unknown>).value).toBeTypeOf('number');
    expect((cal.domain as Record<string, unknown>).symmetricAuto).toBe(false);
    // Null-not-zero: the fully-expired 2031 column is null with typed reasons.
    const cells = (cal.cells as { value: number | null; reasons: string[] }[][]).flat();
    expect(cells.length).toBe(9);
    const nulls = cells.filter((c) => c.value === null);
    expect(nulls.length).toBeGreaterThan(0);
    for (const c of nulls) expect(c.reasons.length).toBeGreaterThan(0);
    expect(JSON.stringify(res)).not.toContain('NaN');
  }, 30_000);

  it('get_exposure_grid accepts dex and rejects unknown metrics without substitution', async () => {
    const listed = (await client.call('tools/list', {})) as { tools: { name: string; inputSchema: { properties: { metric: { enum: string[] } } }; outputSchema: object }[] };
    const tool = listed.tools.find((t) => t.name === 'terminal.get_exposure_grid');
    expect(tool?.inputSchema.properties.metric.enum).toEqual(['gex', 'charm', 'dex']);
    // Unknown metrics stop at protocol-level validation (-32602), never substituted.
    await expect(client.call('tools/call', {
      name: 'terminal.get_exposure_grid',
      arguments: { symbol: 'BTC', metric: 'vanna', prices: [59000, 61000], times: ['2026-01-05T12:00:00.000Z'] },
    })).rejects.toThrow(/one of/i);
    const dex = (await client.call('tools/call', {
      name: 'terminal.get_exposure_grid',
      arguments: { symbol: 'BTC', metric: 'dex', prices: [59000, 61000], times: ['2026-01-05T12:00:00.000Z'] },
    })) as { content: { text: string }[]; structuredContent: { data: Record<string, unknown> }; isError?: boolean };
    expect(dex.isError).toBeFalsy();
    expect(dex.structuredContent.data).toMatchObject({ metric: 'dex', units: '$Δ notional' });
    expect(JSON.stringify(dex)).not.toContain('NaN');
  }, 30_000);

  it('academy search returns bounded results (≤12)', async () => {
    const res = (await client.call('tools/call', { name: 'terminal.search_academy', arguments: { q: 'option' } })) as { content: { text: string }[] };
    const parsed = JSON.parse(res.content[0].text as string);
    expect(Array.isArray(parsed.data.children)).toBe(true);
    expect(parsed.data.children.length).toBeLessThanOrEqual(12);
  });
});
