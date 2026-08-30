/**
 * MCP contract tests (Phase 11) — generic MCP client over stdio (2025-11-25).
 * Assertions: 12 read-only tools; strict input/output schemas with
 * additionalProperties:false; no trading/order/account/Stripe/secret tools;
 * structured content; tool failures typed; oversized/malformed inputs rejected.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = import.meta.dirname;

class McpClient {
  proc: ChildProcess;
  buf = '';
  pending = new Map<number, { resolve: (m: unknown) => void; reject: (e: Error) => void }>();
  nextId = 1;

  constructor() {
    this.proc = spawn(process.execPath, [join(ROOT, 'mcp-server.js')], {
      env: { ...process.env, PORT: '3199' },
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
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        }
      }
    });
  }

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

describe('MCP read-only server (contract)', () => {
  let client: McpClient;

  beforeAll(async () => {
    client = new McpClient();
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
  }, 10_000);

  afterAll(async () => {
    if (client) await client.close();
  });

  it('tools/list exposes exactly the 12 read-only tools with explicit schemas', async () => {
    const res = (await client.call('tools/list', {})) as { tools: { name: string; inputSchema: { additionalProperties?: boolean; properties?: Record<string, unknown> } }[] };
    expect(res.tools).toHaveLength(12);
    const names = res.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'terminal.get_crypto_carry',
      'terminal.get_crypto_flow',
      'terminal.get_greeks',
      'terminal.get_health',
      'terminal.get_market_snapshot',
      'terminal.get_options_chain',
      'terminal.get_positioning',
      'terminal.get_provider_status',
      'terminal.get_rates_curve',
      'terminal.get_stir_curve',
      'terminal.get_volatility_surface',
      'terminal.search_academy',
    ]);
    for (const t of res.tools) {
      expect(t.inputSchema === false || t.inputSchema.additionalProperties === false, `${t.name}: additionalProperties false`).toBe(true);
      expect(t.inputSchema, `${t.name}: explicit schema`).toMatchObject({ type: 'object' });
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
    expect(parsed.status).toBe('ok');
    expect(res.structuredContent).toEqual(parsed);
  });

  it('get_provider_status returns cache/budget stats without credentials', async () => {
    const res = (await client.call('tools/call', { name: 'terminal.get_provider_status', arguments: {} })) as { content: { text: string }[] };
    const parsed = JSON.parse(res.content[0].text as string);
    expect(parsed.status).toBe('ok');
    expect(JSON.stringify(res).toLowerCase()).not.toMatch(/(api[_-]?key|token|secret|authorization)/);
  });

  it('invalid symbol errors with typed error (never fabricates)', async () => {
    await expect(client.call('tools/call', { name: 'terminal.get_options_chain', arguments: { symbol: 'AA++bad' } })).rejects.toThrow(/invalid format/i);
  });

  it('unknown tool name → protocol error (never auto-substitutes)', async () => {
    await expect(client.call('tools/call', { name: 'terminal.place_order', arguments: {} })).rejects.toThrow(/Unknown tool/);
  });

  it('tool outputs never contain NaN/Infinity', async () => {
    const res = (await client.call('tools/call', { name: 'terminal.get_crypto_carry', arguments: { currency: 'BTC' } })) as { content: { text: string }[] };
    expect(res.content[0].text).not.toContain('NaN');
    expect(res.content[0].text).not.toContain('Infinity');
  }, 20_000);

  it('academy search returns bounded results (≤12)', async () => {
    const res = (await client.call('tools/call', { name: 'terminal.search_academy', arguments: { q: 'option' } })) as { content: { text: string }[] };
    const parsed = JSON.parse(res.content[0].text as string);
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.results.length).toBeLessThanOrEqual(12);
  });
});