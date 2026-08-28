/**
 * Server composition root — wires plugins, routes, and static serving.
 * Routes live in server/routes/*; providers in server/providers/*; config in server/config.js.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { registerSecurityHeaders } from '../api/securityHeaders.js';
import { registerDeribitMarketRoutes } from './routes/deribitMarket.js';
import { registerMacrovolRoutes } from './routes/macrovol.js';
import { registerSseRoutes } from './routes/sse.js';
import { registerStripeBilling, gateInfoForRequest } from '../api/stripeBilling.js';
import { registerStripeAuth } from '../api/authRoutes.js';
import { resolveProxyTrust } from '../api/proxyTrust.js';
import { normalizeIP } from '@fastify/rate-limit';
import {
  getOrFetch, peek, cacheStats, TTL, budgetAllows, recordBudget,
  getBudgetUsed, FMP_FREE_DAILY, FLASHALPHA_FREE_DAILY,
} from '../api/upstreamCache.js';
import { FMP_BASE, isFmpEndpointAllowed, proxyFmp } from '../api/_shared.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load root .env into process.env (no dotenv dependency).
function loadEnvFile(filePath) {
  try {
    if (!existsSync(filePath)) return;
    const text = readFileSync(filePath, 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (k && process.env[k] == null) process.env[k] = v;
    }
  } catch { /* ignore */ }
}

loadEnvFile(join(__dirname, '../.env'));

const FMP_API_KEY = process.env.FMP_API_KEY || null;
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:3000,http://localhost:3001').split(',').map(o => o.trim()).filter(Boolean);
function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    const pub = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RENDER_EXTERNAL_URL || '';
    if (pub) { const host = pub.replace(/^https?:\/\//, '').replace(/\/$/, ''); if (origin === `https://${host}` || origin === `http://${host}`) return true; }
  } catch { /* ignore */ }
  return false;
}

const proxyTrust = resolveProxyTrust();

// ── Rate limit classes ───────────────────────────────────────
const RL_GLOBAL = 600, RL_UPSTREAM = 120, RL_SCARCE = 30;
function rateLimitClassForUrl(url) {
  if (url.startsWith('/api/alphavantage') || url.startsWith('/api/tradingview')) return 'scarce';
  if (url.startsWith('/api/fmp') || url.startsWith('/api/finnhub') || url.startsWith('/api/massive') || url.startsWith('/api/flashalpha') || url.startsWith('/api/desk') || url.startsWith('/api/macrovol') || url.startsWith('/api/backtest') || url.startsWith('/api/options') || url.startsWith('/api/yf') || url.startsWith('/api/deribit') || url.startsWith('/api/ksa') || url.startsWith('/api/history')) return 'upstream';
  return 'global';
}
function rateLimitMaxForUrl(url) {
  const c = rateLimitClassForUrl(url);
  return c === 'scarce' ? RL_SCARCE : c === 'upstream' ? RL_UPSTREAM : RL_GLOBAL;
}

// ── FMP proxy ───────────────────────────────────────────────
function registerFmpRoutes(fastify) {
  fastify.get('/api/fmp/stable/*', async (request, reply) => {
    const url = request.url.replace('/api/fmp/stable/', '');
    const endpoint = url.split(/[?#]/)[0];
    if (!isFmpEndpointAllowed(endpoint)) { reply.code(403); return { error: 'Endpoint not allowed' }; }
    const fmpKey = `fmp:${url}`;
    const isQuote = endpoint.startsWith('quote');
    const ttl = isQuote ? TTL.FMP_QUOTE_MS : TTL.FMP_HEAVY_MS;
    try {
      const stale = peek(fmpKey);
      if (stale && Date.now() - stale.timestamp < ttl) { reply.header('X-Cache', 'HIT'); return stale.data; }
      if (!budgetAllows('fmp', FMP_FREE_DAILY) && stale) { reply.header('X-Cache', 'STALE-BUDGET'); return stale.data; }
      if (!FMP_API_KEY) { reply.code(503); return { error: 'FMP_API_KEY not configured' }; }
      if (!budgetAllows('fmp', FMP_FREE_DAILY)) { reply.code(429); return { error: 'FMP daily budget exhausted', used: getBudgetUsed('fmp'), cap: FMP_FREE_DAILY }; }
      const { data, fromCache } = await getOrFetch(fmpKey, ttl, async () => {
        recordBudget('fmp', 1);
        const { status, body } = await proxyFmp(url, FMP_API_KEY, FMP_BASE);
        if (status >= 400) { const err = new Error(body?.error || `FMP ${status}`); err.status = status; err.body = body; throw err; }
        return body;
      }, { allowStaleOnError: true });
      reply.header('X-Cache', fromCache ? 'HIT' : 'MISS');
      return data;
    } catch (err) {
      if (err.body) { reply.code(err.status || 502); return err.body; }
      reply.code(502); return { error: 'FMP proxy failed', detail: err.message };
    }
  });
}

// ── FlashAlpha routes ───────────────────────────────────────
function registerFlashalphaRoutes(fastify) {
  const FA_CACHE_TTL = 6 * 60 * 60_000;
  fastify.get('/api/flashalpha/exposure/:type/:symbol', async (request, reply) => {
    const { type, symbol: sym } = request.params;
    const symbol = sym.toUpperCase().replace(/[^A-Z0-9.-]/g, '') || 'AAPL';
    const FA_KEY = process.env.FLASHALPHA_API_KEY || null;
    if (!FA_KEY) { reply.code(503); return { error: 'FLASHALPHA_API_KEY not configured' }; }
    if (!budgetAllows('flashalpha', FLASHALPHA_FREE_DAILY, 0.80)) {
      const stale = peek(`fa:${type}:${symbol}`);
      if (stale) { reply.header('X-Cache', 'STALE-BUDGET'); return stale.data; }
      reply.code(429); return { error: 'FlashAlpha daily budget exhausted', cap: FLASHALPHA_FREE_DAILY, used: getBudgetUsed('flashalpha') };
    }
    try {
      const { data, fromCache } = await getOrFetch(`fa:${type}:${symbol}`, FA_CACHE_TTL, async () => {
        recordBudget('flashalpha', 1);
        const res = await fetch(`https://lab.flashalpha.com/v1/exposure/${type}/${symbol}`, { headers: { 'X-Api-Key': FA_KEY }, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) { const err = new Error(`FlashAlpha HTTP ${res.status}`); err.status = res.status; throw err; }
        return res.json();
      }, { allowStaleOnError: true });
      reply.header('X-Cache', fromCache ? 'HIT' : 'MISS');
      return data;
    } catch (err) {
      reply.code(err.status === 429 ? 429 : 502);
      return { error: 'FlashAlpha fetch failed', detail: err.message };
    }
  });
}

// ── Backtest proxy ──────────────────────────────────────────
// P0 Fix: explicit allowlist, loopback-only, bounded timeouts (25s), response contracts. Ownership: Node is SAAS billing/auth shell; Python is private compute worker (not public API).
const ALLOWED_BACKTEST = [
  { method: ['GET'], re: /^\/(status)?\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/status\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/binance\/exchange-info\/?(\?.*)?$/ },
  { method: ['POST', 'GET'], re: /^\/run\/?(\?.*)?$/ },
  { method: ['POST'], re: /^\/scan\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/baseline\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/placebo\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/tail-risk\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/equity-curve\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/walkforward\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/sweep\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/health\/?$/ },
];
function isBacktestAllowed(suffix, method) {
  const path = (suffix.split('?')[0] || '').replace(/\/$/, '') || '/';
  const clean = path.startsWith('/') ? path : `/${path}`;
  for (const rule of ALLOWED_BACKTEST) {
    if (!rule.method.includes(method)) continue;
    if (rule.re.test(clean) || rule.re.test(suffix.split('?')[0] || '')) return true;
  }
  return false;
}
function registerBacktestRoutes(fastify) {
  const rawBase = (process.env.BACKTEST_API_URL || 'http://127.0.0.1:8766').replace(/\/$/, '');
  // loopback-only
  let BACKTEST_BASE = rawBase;
  try { const u = new URL(rawBase); if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') BACKTEST_BASE = 'http://127.0.0.1:8766'; } catch { BACKTEST_BASE = 'http://127.0.0.1:8766'; }
  fastify.route({
    method: ['GET', 'POST', 'OPTIONS'],
    url: '/api/backtest/*',
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const suffix = (request.url || '').replace(/^\/api\/backtest/, '') || '/';
      if (!isBacktestAllowed(suffix, request.method)) { reply.code(404); return { error: 'Endpoint not allowed', hint: 'Allowlisted /api/backtest paths only' }; }
      // Block path traversal / encoding tricks
      if (suffix.toLowerCase().includes('%2e') || suffix.includes('..')) { reply.code(404); return { error: 'Not found' }; }
      const target = `${BACKTEST_BASE}/api/backtest${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
      try {
        const res = await fetch(target, { method: request.method === 'OPTIONS' ? 'GET' : request.method, headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(25_000) });
        const ct = res.headers.get('content-type') || '';
        const text = await res.text();
        if (text.length > 1_000_000) { reply.code(502); return { error: 'Upstream response too large' }; }
        let body; try { body = JSON.parse(text); } catch { body = { error: 'Invalid JSON from backtest pipe', raw: text.slice(0, 300) }; }
        if (!ct.includes('application/json') && res.ok) { reply.code(502); return { error: 'Upstream non-JSON', raw: text.slice(0, 200) }; }
        reply.code(res.status);
        return body;
      } catch (err) { reply.code(502); return { error: 'Crypto backtest pipe unavailable', detail: err.message }; }
    },
  });
}

// ── KSA routes ──────────────────────────────────────────────
function registerKsaRoutes(fastify) {
  fastify.get('/api/ksa/board', async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    reply.header('vary', 'Cookie');
    try {
      const { fetchKsaBoard } = await import('../api/ksaFeeds.js');
      const gate = gateInfoForRequest(request);
      if (gate.enabled && !gate.entitled) { reply.code(402); return { error: 'subscription_required', gatedDesks: gate.gatedDesks }; }
      return await fetchKsaBoard({ forceWarm: request.query.force === '1' });
    } catch (err) { reply.code(502); return { error: 'KSA board failed', detail: err.message }; }
  });
  fastify.get('/api/ksa/quote/:symbol', async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    reply.header('vary', 'Cookie');
    try {
      const { fetchKsaQuote } = await import('../api/ksaFeeds.js');
      const gate = gateInfoForRequest(request);
      if (gate.enabled && !gate.entitled) { reply.code(402); return { error: 'subscription_required', gatedDesks: gate.gatedDesks }; }
      return await fetchKsaQuote(request.params.symbol);
    } catch (err) { reply.code(502); return { error: 'KSA quote failed', detail: err.message }; }
  });
  fastify.get('/api/ksa/session', async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    reply.header('vary', 'Cookie');
    try {
      const { riyadhSessionSnapshot } = await import('../api/ksaFeeds.js');
      const gate = gateInfoForRequest(request);
      if (gate.enabled && !gate.entitled) { reply.code(402); return { error: 'subscription_required', gatedDesks: gate.gatedDesks }; }
      return { ...riyadhSessionSnapshot(), source: 'sahmk' };
    } catch (err) { reply.code(502); return { error: 'KSA session failed', detail: err.message }; }
  });
}

// ── Boot briefing ───────────────────────────────────────────
function registerBootRoutes(fastify) {
  const MACROVOL_BASE = (process.env.MACROVOL_API_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
  fastify.get('/api/boot/briefing', async (request, reply) => {
    try {
      const { data } = await getOrFetch('boot:briefing', TTL.BRIEFING_MS, async () => {
        const [ratesRes, macroRes, stressRes] = await Promise.all([
          fetch(`${MACROVOL_BASE}/api/rates/summary`, { signal: AbortSignal.timeout(20_000) }),
          fetch(`${MACROVOL_BASE}/api/macro/summary`, { signal: AbortSignal.timeout(25_000) }),
          fetch(`${MACROVOL_BASE}/api/macro/stress`, { signal: AbortSignal.timeout(25_000) }),
        ]);
        const rates = ratesRes.ok ? await ratesRes.json() : null;
        const macro = macroRes.ok ? await macroRes.json() : null;
        const stress = stressRes.ok ? await stressRes.json() : null;
        return { rates, macro, stress, as_of: new Date().toISOString() };
      }, { allowStaleOnError: true });
      return data;
    } catch (err) { reply.code(502); return { error: 'Boot briefing failed', detail: err.message }; }
  });
}

// ── OPRA skeleton ───────────────────────────────────────────
function registerOpraRoutes(fastify) {
  const OPRA_ENABLED = process.env.OPRA_ENABLED === '1' || process.env.OPRA_ENABLED === 'true';
  const OPRA_VENDOR = (process.env.OPRA_VENDOR || 'stub').toLowerCase();
  fastify.get('/api/opra/status', async () => ({
    enabled: OPRA_ENABLED, vendor: OPRA_VENDOR, mode: 'snapshot-only',
    ready: OPRA_ENABLED && OPRA_VENDOR !== 'stub',
    note: OPRA_ENABLED ? (OPRA_VENDOR === 'stub' ? 'OPRA_ENABLED but vendor=stub' : `Skeleton ready for vendor=${OPRA_VENDOR}`) : 'Set OPRA_ENABLED=1 after choosing a vendor',
    timestamp: Date.now(),
  }));
  fastify.get('/api/opra/chain/:symbol', async (request, reply) => {
    const symbol = String(request.params.symbol || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '') || 'SPY';
    if (!OPRA_ENABLED) { reply.code(503); return { error: 'opra_disabled', symbol }; }
    if (OPRA_VENDOR === 'stub') { reply.code(503); return { error: 'opra_stub', symbol, vendor: OPRA_VENDOR }; }
    reply.code(501); return { error: 'opra_not_implemented', symbol, vendor: OPRA_VENDOR, mode: 'snapshot' };
  });
}

// ── Main composition ────────────────────────────────────────
export async function buildServer() {
  const fastify = Fastify({
    logger: { level: process.env.LOG_LEVEL || 'info', redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-api-key"]', 'req.body.password', 'req.body.token', '*.password', '*.token', 'password', 'token', 'secret'], censor: '***' } },
    trustProxy: proxyTrust.trustProxy,
    bodyLimit: 1_048_576,
    connectionTimeout: 30_000,
    keepAliveTimeout: 72_000,
    requestTimeout: 30_000,
    routerOptions: { maxParamLength: 200 },
  });

  await registerSecurityHeaders(fastify);
  await fastify.register(cors, { origin: (origin, cb) => { if (isAllowedOrigin(origin)) return cb(null, true); return cb(new Error('Not allowed by CORS'), false); } });
  await fastify.register(rateLimit, {
    max: (request) => rateLimitMaxForUrl(request.url),
    timeWindow: '1 minute',
    ipv6Subnet: 64,
    keyGenerator: (request) => `${rateLimitClassForUrl(request.url)}:${normalizeIP(request.ip, 64)}`,
    allowList: (request) => { const u = request.url || ''; return u.startsWith('/assets/') || u === '/favicon.svg' || u === '/favicon.ico' || u === '/' || (!u.startsWith('/api/') && !u.includes('.')); },
    errorResponseBuilder: (_request, context) => {
      const seconds = Math.max(1, Math.ceil((context.ttl || 0) / 1000));
      const err = new Error(`Rate limit exceeded, try again in ${seconds} seconds`);
      err.statusCode = context.statusCode || 429;
      return err;
    },
  });

  // Health + cache status
  fastify.get('/api/health', async () => ({ status: 'ok', timestamp: Date.now() }));
  fastify.get('/api/cache/status', async () => ({ status: 'ok', ...cacheStats() }));

  // Routes
  registerBootRoutes(fastify);
  registerFmpRoutes(fastify);
  registerSseRoutes(fastify);
  await registerDeribitMarketRoutes(fastify);
  await registerMacrovolRoutes(fastify);
  registerBacktestRoutes(fastify);
  registerFlashalphaRoutes(fastify);
  registerKsaRoutes(fastify);
  registerOpraRoutes(fastify);

  // Billing/Auth always registered — endpoints fail closed (503/401) when keys absent.
  // This preserves BILLING_HANDOFF.md invariants: billing exists and is not
  // conditionally hidden, Stripe RAW parser stays scoped, no Connect.
  await registerStripeBilling(fastify);
  await registerStripeAuth(fastify);

  // Static
  try {
    await fastify.register(fastifyStatic, { root: join(__dirname, '../dist'), wildcard: false, maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0, immutable: true });
  } catch (err) { console.error('static register failed', err); }

  fastify.setNotFoundHandler((request, reply) => {
    const path = (request.url || '').split('?')[0];
    if (path.startsWith('/assets/') || path.startsWith('/api')) { reply.code(404).send({ error: 'Not found', path }); return; }
    return reply.sendFile('index.html');
  });

  return fastify;
}
