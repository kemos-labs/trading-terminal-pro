import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { execFile } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { FMP_BASE, isFmpEndpointAllowed, buildSpyHistoryAsync, proxyFmp, fetchFmpQuoteShared } from './api/_shared.js';
import {
  getOrFetch,
  peek,
  cacheStats,
  TTL,
  budgetAllows,
  recordBudget,
  getBudgetUsed,
  getMonthBudgetUsed,
  FMP_FREE_DAILY,
  ALPHA_VANTAGE_FREE_DAILY,
  TRADINGVIEW_FREE_MONTHLY,
  FINNHUB_SOFT_DAILY,
  FLASHALPHA_FREE_DAILY,
} from './api/upstreamCache.js';
import {
  alphaVantageGlobalQuote,
  alphaVantageDaily,
  alphaVantageOverview,
  tradingViewSnapshot,
  providerKeysStatus,
} from './api/deskFeeds.js';
import { fetchKsaBoard, fetchKsaQuote, riyadhSessionSnapshot, sahmkBudgetStatus } from './api/ksaFeeds.js';
import { registerDeribitMarketRoutes } from './api/deribitMarketRoutes.js';
import { registerStripeBilling, gateInfoForRequest } from './api/stripeBilling.js';
import { registerStripeAuth } from './api/authRoutes.js';

// Load root .env into process.env (no dotenv dependency; keys never shipped to browser).
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
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (k && process.env[k] == null) process.env[k] = v;
    }
  } catch {
    /* ignore */
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvFile(join(__dirname, '.env'));

// The FMP key must come from the environment — no hardcoded fallback.
// If absent, equity enrichment falls back to yfinance only (never synthetic market data).
const FMP_API_KEY = process.env.FMP_API_KEY || null;
if (!FMP_API_KEY) {
  console.warn('WARN: FMP_API_KEY not set — FMP enrichment endpoints will return 503.');
}

// Finnhub free-tier key (news + earnings + quote). Server-only; fail-closed if missing.
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || null;
if (!FINNHUB_API_KEY) {
  console.warn('WARN: FINNHUB_API_KEY not set — Finnhub news/earnings/quote will return 503.');
}
if (!(process.env.ALPHA_VANTAGE_API_KEY || process.env.ALPHAVANTAGE_API_KEY)) {
  console.warn('WARN: ALPHA_VANTAGE_API_KEY not set — Alpha Vantage desk feeds disabled.');
}
if (!(process.env.RAPIDAPI_KEY || process.env.X_RAPIDAPI_KEY)) {
  console.warn('WARN: RAPIDAPI_KEY not set — TradingView RapidAPI desk feeds disabled.');
}

const PORT = parseInt(process.env.PORT || '3001', 10);
const FINNHUB_BASE = 'https://finnhub.io/api/v1';
/** Desk symbols always kept warm for all visitors (shared board). */
const DESK_WARM_SYMBOLS = ['SPY'];
const DESK_WARM_CRYPTO = ['BTC'];

// Restrict CORS to an explicit allowlist (comma-separated CORS_ORIGIN env var).
// Defaults to localhost dev origins. Production: set CORS_ORIGIN and/or rely on
// RAILWAY_PUBLIC_DOMAIN exact match — never a wildcard on *.up.railway.app.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:3000,http://localhost:3001,http://localhost:3200,http://localhost:3201')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    // Exact Railway / Render public host only (module scripts are CORS-mode)
    const pub = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL || process.env.RENDER_EXTERNAL_URL || '';
    if (pub) {
      const host = pub.replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (origin === `https://${host}` || origin === `http://${host}` || origin === host) {
        return true;
      }
    }
  } catch { /* ignore */ }
  return false;
}

const DERIBIT_BASE = 'https://www.deribit.com/api/v2/public';
// MacroVol FastAPI (FRED rates / macro). Localhost only — never an open SSRF relay.
function resolveMacrovolBase() {
  const raw = (process.env.MACROVOL_API_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
  try {
    const u = new URL(raw);
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
      return raw;
    }
    console.warn(
      `WARN: MACROVOL_API_URL host "${u.hostname}" is not local — forcing http://127.0.0.1:8765`,
    );
  } catch {
    console.warn('WARN: MACROVOL_API_URL invalid — forcing http://127.0.0.1:8765');
  }
  return 'http://127.0.0.1:8765';
}
const MACROVOL_API_URL = resolveMacrovolBase();

// Behind Render/Railway the TCP peer is the edge proxy: without trustProxy,
// request.ip collapses every visitor into ONE rate-limit bucket (11 bad
// logins/min would lock out all authentication site-wide). Opt in explicitly
// — trusting XFF on a directly-exposed dev box would let clients spoof it.
// Set TRUST_PROXY=1 in production (single proxy hop).
const TRUST_PROXY = ['1', 'true'].includes(String(process.env.TRUST_PROXY || '').toLowerCase());
const fastify = Fastify({ logger: false, trustProxy: TRUST_PROXY });

await fastify.register(cors, {
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'), false);
  },
});

// Basic hardening headers (edge TLS still owns HSTS in production).
fastify.addHook('onSend', async (_request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'SAMEORIGIN');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return payload;
});

// Rate limiting (sync caps with src/config/constants.ts rateLimit).
// Global SPA traffic needs headroom; key-bearing / scarce upstreams are tighter.
// yfinance/options stay moderate — low caps 429 the live chain (fail-closed empty surface).
const RL_GLOBAL = 600;
const RL_UPSTREAM = 120; // FMP, Finnhub, Massive, macrovol, options, yf
const RL_SCARCE = 30; // Alpha Vantage, TradingView free quotas

function rateLimitClassForUrl(url) {
  const u = url || '';
  if (u.startsWith('/api/alphavantage') || u.startsWith('/api/tradingview')) return 'scarce';
  if (
    u.startsWith('/api/fmp') ||
    u.startsWith('/api/finnhub') ||
    u.startsWith('/api/massive') ||
    u.startsWith('/api/flashalpha') ||
    u.startsWith('/api/desk') ||
    u.startsWith('/api/macrovol') ||
    u.startsWith('/api/backtest') ||
    u.startsWith('/api/options') ||
    u.startsWith('/api/yf') ||
    u.startsWith('/api/deribit') ||
    u.startsWith('/api/ksa') ||
    u.startsWith('/api/history')
  ) {
    return 'upstream';
  }
  return 'global';
}

function rateLimitMaxForUrl(url) {
  const u = url || '';
  if (u.startsWith('/api/alphavantage') || u.startsWith('/api/tradingview')) return RL_SCARCE;
  if (
    u.startsWith('/api/fmp') ||
    u.startsWith('/api/finnhub') ||
    u.startsWith('/api/massive') ||
    u.startsWith('/api/flashalpha') ||
    u.startsWith('/api/desk') ||
    u.startsWith('/api/macrovol') ||
    u.startsWith('/api/backtest') ||
    u.startsWith('/api/options') ||
    u.startsWith('/api/yf') ||
    u.startsWith('/api/deribit') ||
    u.startsWith('/api/ksa') ||
    u.startsWith('/api/history')
  ) {
    return RL_UPSTREAM;
  }
  return RL_GLOBAL;
}

await fastify.register(rateLimit, {
  max: (request) => rateLimitMaxForUrl(request.url),
  timeWindow: '1 minute',
  // Key per (URL class, client IP): without the class prefix, a single shared
  // counter lets cheap /api/health traffic exhaust the scarce-upstream budget.
  keyGenerator: (request) => `${rateLimitClassForUrl(request.url)}:${request.ip}`,
  // Never throttle static SPA assets — browsers load many chunks in parallel.
  allowList: (request) => {
    const u = request.url || '';
    return (
      u.startsWith('/assets/') ||
      u === '/favicon.svg' ||
      u === '/favicon.ico' ||
      u === '/' ||
      (!u.startsWith('/api/') && !u.includes('.'))
    );
  },
  // Must return an Error (plugin THROWS it) with statusCode set — returning a
  // plain object makes Fastify answer 500 instead of 429. Block context exposes
  // ttl in MILLISECONDS only (no ttlInSeconds), so convert here.
  errorResponseBuilder: (_request, context) => {
    const seconds = Math.max(1, Math.ceil((context.ttl || 0) / 1000));
    const err = new Error(`Rate limit exceeded, try again in ${seconds} seconds`);
    err.statusCode = context.statusCode || 429;
    err.error = 'Too Many Requests';
    return err;
  },
});

// Input validation helper — equities + short crypto aliases + yfinance forms (BTC-USD)
function validateSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') {
    return null;
  }
  const sanitized = symbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,11}$/.test(sanitized)) {
    return null;
  }
  return sanitized;
}

// ── Desk paywall gate ─────────────────────────────────────────
// When billing is configured, gated desks (BILLING_GATED_DESKS, default "ksa")
// 402 for callers without an active subscription. Unconfigured ⇒ fully open.
function requireDeskAccess(request, reply) {
  // Gated desk responses depend on the session cookie — mark them uncacheable
  // so a misconfigured fronting CDN can never serve one user's entitled data
  // to another.
  reply.header('cache-control', 'private, no-store');
  reply.header('vary', 'Cookie');
  const gate = gateInfoForRequest(request);
  if (gate.enabled && !gate.entitled) {
    reply.code(402);
    reply.header('cache-control', 'no-store');
    return {
      error: 'subscription_required',
      code: 'SUBSCRIPTION_REQUIRED',
      message: 'This desk requires an active VOLATERM subscription.',
      gatedDesks: gate.gatedDesks,
    };
  }
  return null;
}

// Public liveness only — do not disclose which API keys are configured.
fastify.get('/api/health', async () => ({
  status: 'ok',
  timestamp: Date.now(),
}));

/** Shared cache stats + free-tier budgets (all visitors share one board). */
fastify.get('/api/cache/status', async () => ({
  status: 'ok',
  ...cacheStats(),
  fmpDailyBudget: { used: getBudgetUsed('fmp'), cap: FMP_FREE_DAILY },
  alphavantageDailyBudget: {
    used: getBudgetUsed('alphavantage'),
    cap: ALPHA_VANTAGE_FREE_DAILY,
  },
  finnhubDailyBudget: {
    used: getBudgetUsed('finnhub'),
    capSoft: FINNHUB_SOFT_DAILY,
  },
  tradingviewMonthlyBudget: {
    used: getMonthBudgetUsed('tradingview'),
    cap: TRADINGVIEW_FREE_MONTHLY,
  },
  // Boolean presence only when explicitly enabled (ops); default off to avoid recon.
  ...(process.env.EXPOSE_KEY_STATUS === '1' ? { keys: providerKeysStatus() } : {}),
  desk: { equities: DESK_WARM_SYMBOLS, crypto: DESK_WARM_CRYPTO },
  ttlsMs: TTL,
  note: 'Shared desk: browsers never call Finnhub/AV/TV directly. Railway Node owns keys + refresh.',
}));

/**
 * Boot briefing: lightweight rates + macro for the first-open UI.
 * Served from shared cache so N visitors do not N× FRED.
 */
fastify.get('/api/boot/briefing', async (request, reply) => {
  try {
    const { data, fromCache, ageMs } = await getOrFetch(
      'boot:briefing',
      TTL.BRIEFING_MS,
      async () => {
        const base = MACROVOL_API_URL;
        // One shared FRED batch for rates + macro + stress — N visitors share this key.
        const [ratesRes, macroRes, stressRes] = await Promise.all([
          fetch(`${base}/api/rates/summary`, { signal: AbortSignal.timeout(20_000) }),
          fetch(`${base}/api/macro/summary`, { signal: AbortSignal.timeout(25_000) }),
          fetch(`${base}/api/macro/stress`, { signal: AbortSignal.timeout(25_000) }),
        ]);
        const rates = ratesRes.ok ? await ratesRes.json() : null;
        const macro = macroRes.ok ? await macroRes.json() : null;
        const stress = stressRes.ok ? await stressRes.json() : null;
        return {
          rates,
          macro,
          stress,
          as_of: new Date().toISOString(),
          source: 'macrovol+fred',
          note: 'Shared board · FRED stress pack included · not per-visitor upstream.',
        };
      },
      { allowStaleOnError: true },
    );
    return { ...data, fromCache, ageMs };
  } catch (err) {
    reply.code(502);
    return { error: 'Briefing unavailable', detail: err.message };
  }
});

fastify.get('/api/options/:symbol', async (request, reply) => {
  const { symbol: rawSymbol } = request.params;
  const symbol = validateSymbol(rawSymbol);
  if (!symbol) {
    reply.code(400);
    return { error: 'Invalid symbol' };
  }
  const { probe, max: maxStr } = request.query;
  const isProbe = probe === '1' || probe === 'true';
  const max = parseInt(maxStr, 10);
  const maxArg = Number.isFinite(max) && max > 0 ? max : null;
  const cacheKey = `options:${symbol}:${maxArg || 'full'}`;

  try {
    // Stale shared chain still serves while a refresh is in flight (stale-while-revalidate).
    const stale = peek(cacheKey);
    if (stale && Date.now() - stale.timestamp < TTL.OPTIONS_MS) {
      if (isProbe) {
        const contracts = Array.isArray(stale.data?.quotes) ? stale.data.quotes.length : 0;
        return { available: true, contracts, fromCache: true };
      }
      return { ...stale.data, _cache: { hit: true, ageMs: Date.now() - stale.timestamp } };
    }

    const { data: result, fromCache, ageMs } = await getOrFetch(
      cacheKey,
      isProbe ? TTL.OPTIONS_PROBE_MS : TTL.OPTIONS_MS,
      () => new Promise((resolve, reject) => {
        const args = [join(__dirname, 'fetch_options.py'), symbol];
        if (maxArg) args.push(String(maxArg));
        // yfinance often needs 45–90s for multi-expiry equity chains.
        execFile('python3', args, { timeout: isProbe ? 20000 : 90000 }, (err, stdout, stderr) => {
          const tryParse = (raw) => {
            if (!raw) return null;
            try {
              const data = JSON.parse(String(raw).trim().split('\n').filter(Boolean).pop());
              if (data && !data.error && Array.isArray(data.quotes)) return data;
              if (data?.error) return { __err: data.error };
            } catch { /* fall through */ }
            return null;
          };
          const parsed = tryParse(stdout);
          if (parsed && !parsed.__err) return resolve(parsed);
          if (err) {
            console.error('Python script error:', err);
            const detail = parsed?.__err || stderr || stdout?.slice(0, 500) || err.message;
            return reject(new Error(detail));
          }
          if (parsed?.__err) return reject(new Error(parsed.__err));
          reject(new Error('Invalid response from data fetcher'));
        });
      }),
      { allowStaleOnError: true },
    );

    const contracts = Array.isArray(result.quotes) ? result.quotes.length : 0;
    if (isProbe) return { available: contracts >= 10, contracts, fromCache };

    return { ...result, _cache: { hit: fromCache, ageMs } };
  } catch (err) {
    console.error('API endpoint error:', err);
    reply.code(502);
    return { error: 'Failed to fetch data', detail: err.message };
  }
});

// ── yfinance enrichment (history + fundamentals) ──────────────
// Secondary source that backs the Quote tab when FMP is unavailable or
// rate-limited. Docker/Node only (needs a Python runtime).

function runYf(symbol, mode) {
  return new Promise((resolve, reject) => {
    execFile('python3', [join(__dirname, 'fetch_yf.py'), symbol, mode], { timeout: 60000 }, (err, stdout, stderr) => {
      // Accept JSON even if yfinance wrote rate-limit noise to stderr.
      try {
        const line = String(stdout || '').trim().split('\n').filter(Boolean).pop();
        if (line) {
          const data = JSON.parse(line);
          if (!data.error) return resolve(data);
          return reject(new Error(data.error));
        }
      } catch { /* fall through to err */ }
      if (err) {
        const detail = stderr || stdout?.slice(0, 500) || err.message;
        return reject(new Error(detail));
      }
      reject(new Error('Invalid response from yfinance fetcher'));
    });
  });
}

fastify.get('/api/yf/history/:symbol', async (request, reply) => {
  const symbol = validateSymbol(request.params.symbol);
  if (!symbol) {
    reply.code(400);
    return { error: 'Invalid symbol' };
  }
  const cacheKey = `yf:history:${symbol}`;
  try {
    const { data } = await getOrFetch(
      cacheKey,
      TTL.YF_ENRICH_MS,
      () => runYf(symbol, 'history'),
      { allowStaleOnError: true },
    );
    return data;
  } catch (err) {
    reply.code(502);
    return { error: 'Failed to fetch yfinance history', detail: err.message };
  }
});

fastify.get('/api/yf/info/:symbol', async (request, reply) => {
  const symbol = validateSymbol(request.params.symbol);
  if (!symbol) {
    reply.code(400);
    return { error: 'Invalid symbol' };
  }
  const cacheKey = `yf:info:${symbol}`;
  try {
    const { data } = await getOrFetch(
      cacheKey,
      TTL.YF_ENRICH_MS,
      () => runYf(symbol, 'info'),
      { allowStaleOnError: true },
    );
    return data;
  } catch (err) {
    reply.code(502);
    return { error: 'Failed to fetch yfinance info', detail: err.message };
  }
});

// The seeded, memoized SPY history now lives in api/_shared.js and is shared
// with the Vercel serverless deployment.

fastify.get('/api/history/spy', async (request, reply) => {
  // Real market history only: FMP (key) → yfinance. Never silent synthetic.
  const fmp = await buildSpyHistoryAsync(FMP_API_KEY, FMP_BASE, { allowSynthetic: false });
  if (fmp?.source === 'fmp' && Array.isArray(fmp.data) && fmp.data.length >= 50) {
    return fmp;
  }
  try {
    const yf = await runYf('SPY', 'history');
    const bars = Array.isArray(yf?.bars) ? yf.bars : [];
    const sorted = bars
      .map((b) => ({ date: String(b.date ?? ''), close: Number(b.close) }))
      .filter((b) => b.date && isFinite(b.close) && b.close > 0)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (sorted.length < 20) {
      reply.code(502);
      return { error: 'No live SPY history (FMP/yfinance)', symbol: 'SPY', data: [], source: 'none' };
    }
    // Same shape as barsToSpyHistoryPayload: close + ret + RV20 (not VIX).
    const data = [];
    for (let i = 0; i < sorted.length; i++) {
      const close = sorted[i].close;
      const prev = i > 0 ? sorted[i - 1].close : close;
      const ret = prev > 0 ? (close - prev) / prev : 0;
      let rv_20d_pct = 18;
      if (i >= 20) {
        let sum = 0;
        let sum2 = 0;
        for (let j = i - 19; j <= i; j++) {
          const p0 = sorted[j - 1] ? sorted[j - 1].close : sorted[j].close;
          const r = p0 > 0 ? Math.log(sorted[j].close / p0) : 0;
          sum += r;
          sum2 += r * r;
        }
        const mean = sum / 20;
        const var_ = Math.max(0, sum2 / 20 - mean * mean);
        rv_20d_pct = Math.min(80, Math.max(8, Math.sqrt(var_ * 252) * 100));
      }
      data.push({
        date: sorted[i].date,
        close: Math.round(close * 100) / 100,
        return: Math.round(ret * 100000) / 100000,
        logReturn: Math.round(Math.log(1 + ret) * 100000) / 100000,
        rv_20d_pct: Math.round(rv_20d_pct * 10) / 10,
      });
    }
    return { symbol: 'SPY', data, source: 'yfinance' };
  } catch (err) {
    reply.code(502);
    return {
      error: 'Failed to fetch live SPY history',
      detail: err.message,
      symbol: 'SPY',
      data: [],
      source: 'none',
    };
  }
});

// ── Deribit public market data (no API key) ───────────────────
async function deribitFetch(pathWithQuery) {
  const url = `${DERIBIT_BASE}/${pathWithQuery}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Deribit ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error.message || JSON.stringify(json.error));
  }
  return json.result;
}

fastify.get('/api/deribit/index/:name', async (request, reply) => {
  const name = String(request.params.name || '').toLowerCase();
  if (!/^(btc|eth)_usd$/.test(name)) {
    reply.code(400);
    return { error: 'Invalid index (use btc_usd or eth_usd)' };
  }
  const cacheKey = `deribit:index:${name}`;
  try {
    const { data } = await getOrFetch(
      cacheKey,
      8_000,
      async () => {
        const result = await deribitFetch(`get_index_price?index_name=${name}`);
        return {
          index_price: result.index_price,
          estimated_delivery_price: result.estimated_delivery_price,
          timestamp: Date.now(),
        };
      },
      { allowStaleOnError: true },
    );
    return data;
  } catch (err) {
    reply.code(502);
    return { error: 'Deribit index failed', detail: err.message };
  }
});

fastify.get('/api/deribit/options/:currency', async (request, reply) => {
  const currency = String(request.params.currency || '').toUpperCase();
  if (currency !== 'BTC' && currency !== 'ETH') {
    reply.code(400);
    return { error: 'currency must be BTC or ETH' };
  }
  const cacheKey = `deribit:options:${currency}`;
  try {
    // Options book: short TTL (hundreds of instruments — don't hammer Deribit)
    const { data } = await getOrFetch(
      cacheKey,
      20_000,
      async () => {
        const result = await deribitFetch(
          `get_book_summary_by_currency?currency=${currency}&kind=option`,
        );
        return {
          currency,
          options: Array.isArray(result) ? result : [],
          count: Array.isArray(result) ? result.length : 0,
          timestamp: Date.now(),
        };
      },
      { allowStaleOnError: true },
    );
    return data;
  } catch (err) {
    reply.code(502);
    return { error: 'Deribit options failed', detail: err.message };
  }
});

fastify.get('/api/deribit/futures/:currency', async (request, reply) => {
  const currency = String(request.params.currency || 'BTC').toUpperCase();
  if (currency !== 'BTC' && currency !== 'ETH') {
    reply.code(400);
    return { error: 'currency must be BTC or ETH' };
  }
  const cacheKey = `deribit:futures:${currency}`;
  try {
    const { data } = await getOrFetch(
      cacheKey,
      15_000,
      async () => {
        const result = await deribitFetch(
          `get_book_summary_by_currency?currency=${currency}&kind=future`,
        );
        return { futures: Array.isArray(result) ? result : [], currency, fetchedAt: Date.now() };
      },
      { allowStaleOnError: true },
    );
    return data;
  } catch (err) {
    reply.code(502);
    return { error: 'Deribit futures fetch failed', detail: err.message };
  }
});

fastify.get('/api/deribit/ticker/:instrument', async (request, reply) => {
  const instrument = String(request.params.instrument || '').toUpperCase();
  if (!/^(BTC|ETH)-PERPETUAL$/.test(instrument)) {
    reply.code(400);
    return { error: 'instrument must be BTC-PERPETUAL or ETH-PERPETUAL' };
  }
  const cacheKey = `deribit:ticker:${instrument}`;
  try {
    const { data } = await getOrFetch(
      cacheKey,
      8_000,
      async () => {
        const result = await deribitFetch(`ticker?instrument_name=${instrument}`);
        return {
          instrument_name: result.instrument_name,
          index_price: result.index_price,
          mark_price: result.mark_price,
          last_price: result.last_price ?? null,
          current_funding: result.current_funding ?? 0,
          funding_8h: result.funding_8h ?? 0,
          open_interest: result.open_interest ?? 0,
          best_bid_price: result.best_bid_price ?? null,
          best_ask_price: result.best_ask_price ?? null,
          timestamp: Date.now(),
        };
      },
      { allowStaleOnError: true },
    );
    return data;
  } catch (err) {
    reply.code(502);
    return { error: 'Deribit ticker failed', detail: err.message };
  }
});

/** Convenience bundle for the BTC desk */
fastify.get('/api/deribit/market/:currency', async (request, reply) => {
  const currency = String(request.params.currency || 'BTC').toUpperCase();
  if (currency !== 'BTC' && currency !== 'ETH') {
    reply.code(400);
    return { error: 'currency must be BTC or ETH' };
  }
  const cacheKey = `deribit:market:${currency}`;
  try {
    const { data } = await getOrFetch(
      cacheKey,
      TTL.DERIBIT_MS,
      async () => {
        const indexName = currency === 'BTC' ? 'btc_usd' : 'eth_usd';
        const perpName = `${currency}-PERPETUAL`;
        const [index, options, perp, futures] = await Promise.all([
          deribitFetch(`get_index_price?index_name=${indexName}`),
          deribitFetch(`get_book_summary_by_currency?currency=${currency}&kind=option`),
          deribitFetch(`ticker?instrument_name=${perpName}`),
          deribitFetch(`get_book_summary_by_currency?currency=${currency}&kind=future`),
        ]);
        const funding_8h = perp?.funding_8h ?? 0;
        return {
          currency,
          indexPrice: index?.index_price ?? perp?.index_price,
          options: Array.isArray(options) ? options : [],
          futures: Array.isArray(futures) ? futures : [],
          perp: perp
            ? {
                instrument_name: perp.instrument_name,
                index_price: perp.index_price,
                mark_price: perp.mark_price,
                last_price: perp.last_price ?? null,
                current_funding: perp.current_funding ?? 0,
                funding_8h,
                open_interest: perp.open_interest ?? 0,
                best_bid_price: perp.best_bid_price ?? null,
                best_ask_price: perp.best_ask_price ?? null,
              }
            : null,
          fundingAnn: isFinite(funding_8h) ? funding_8h * 3 * 365 : null,
          fetchedAt: Date.now(),
          source: 'deribit',
        };
      },
      { allowStaleOnError: true },
    );
    return data;
  } catch (err) {
    reply.code(502);
    return { error: 'Deribit market bundle failed', detail: err.message };
  }
});

/** Recent public options trades for the Crypto Flow desk. */
fastify.get('/api/deribit/trades/:currency', async (request, reply) => {
  const currency = String(request.params.currency || 'BTC').toUpperCase();
  if (currency !== 'BTC' && currency !== 'ETH') {
    reply.code(400);
    return { error: 'currency must be BTC or ETH' };
  }
  const requestedHours = Number(request.query.hours ?? 24);
  const hours = [1, 4, 24].includes(requestedHours) ? requestedHours : 24;
  const requestedCount = Number(request.query.count ?? 500);
  const count = Math.min(1000, Math.max(50, Number.isFinite(requestedCount) ? Math.floor(requestedCount) : 500));
  const cacheKey = `deribit:trades:${currency}:${hours}:${count}`;
  try {
    const { data } = await getOrFetch(
      cacheKey,
      5_000,
      async () => {
        const start = Date.now() - hours * 3_600_000;
        const result = await deribitFetch(
          `get_last_trades_by_currency_and_time?currency=${currency}&kind=option&start_timestamp=${start}&count=${count}&sorting=desc`,
        );
        const trades = Array.isArray(result?.trades) ? result.trades : [];
        return { currency, hours, trades, count: trades.length, hasMore: Boolean(result?.has_more), fetchedAt: Date.now(), source: 'deribit' };
      },
      { allowStaleOnError: true },
    );
    return data;
  } catch (err) {
    reply.code(502);
    return { error: 'Deribit trades failed', detail: err.message };
  }
});

/** DVOL + Deribit realized-volatility index history for the Vol & Skew desk. */
fastify.get('/api/deribit/volhistory/:currency', async (request, reply) => {
  const currency = String(request.params.currency || 'BTC').toUpperCase();
  if (currency !== 'BTC' && currency !== 'ETH') {
    reply.code(400);
    return { error: 'currency must be BTC or ETH' };
  }
  const requestedDays = Number(request.query.days ?? 90);
  const days = [7, 30, 90, 180, 365].includes(requestedDays) ? requestedDays : 90;
  const cacheKey = `deribit:volhistory:${currency}:${days}`;
  try {
    const { data } = await getOrFetch(
      cacheKey,
      60_000,
      async () => {
        const end = Date.now();
        const start = end - days * 86_400_000;
        // DVOL candles (implied) + historical volatility index (30d realized, annualized %)
        const [dvolRes, rvRes] = await Promise.all([
          deribitFetch(
            `get_volatility_index_data?currency=${currency}&start_timestamp=${start}&end_timestamp=${end}&resolution=86400`,
          ),
          deribitFetch(
            `get_historical_volatility?currency=${currency}&start_timestamp=${start}&end_timestamp=${end}`,
          ),
        ]);
        const dvolRaw = Array.isArray(dvolRes?.data) ? dvolRes.data : [];
        const rvRaw = Array.isArray(rvRes?.data) ? rvRes.data : [];
        const dvol = dvolRaw
          .map((row) => ({ t: Number(row?.[0]), close: Number(row?.[4]) }))
          .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.close));
        const realized = rvRaw
          .map((row) => ({ t: Number(row?.[0]), vol: Number(row?.[1]) }))
          .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.vol));
        return { currency, days, dvol, realized, fetchedAt: Date.now(), source: 'deribit' };
      },
      { allowStaleOnError: true },
    );
    return data;
  } catch (err) {
    reply.code(502);
    return { error: 'Deribit volatility history failed', detail: err.message };
  }
});

// ── Multi-venue options aggregation (public endpoints, no keys) ─
const OKX_BASE = 'https://www.okx.com';
const BYBIT_BASE = 'https://api.bybit.com';

/** Sum OKX option tickers for one underlying family. */
async function okxOptionsSummary(ccy) {
  try {
    const res = await fetch(`${OKX_BASE}/api/v5/market/tickers?instType=OPTION&instFamily=${ccy}-USD`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const list = Array.isArray(json?.data) ? json.data : [];
    if (!list.length) return null;
    let volCcy = 0, volUsd = 0, openIntCcy = 0, instruments = 0;
    for (const t of list) {
      instruments += 1;
      volCcy += Number(t.volCcy24h) || 0; // base-ccy notional
      volUsd += Number(t.volUsd24h) || 0;
      openIntCcy += Number(t.openInt) || 0; // contracts (1 contract = 0.01 ccy on OKX)
    }
    // OKX OI lives on a separate public endpoint (per-instrument rows)
    try {
      const oiRes = await fetch(`${OKX_BASE}/api/v5/public/open-interest?instType=OPTION&instFamily=${ccy}-USD`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (oiRes.ok) {
        const oiJson = await oiRes.json();
        const oiRows = Array.isArray(oiJson?.data) ? oiJson.data : [];
        let oiCcySum = 0;
        for (const r of oiRows) oiCcySum += Number(r.oiCcy) || 0;
        if (oiCcySum > 0) openIntCcy = oiCcySum;
      }
    } catch { /* tickers fallback already applied */ }
    return { venue: 'OKX', instruments, volCcy24h: volCcy, volUsd24h: volUsd, openIntContracts: openIntCcy, fetchedAt: Date.now() };
  } catch {
    return null;
  }
}

/** Sum Bybit option tickers for one base coin. */
async function bybitOptionsSummary(ccy) {
  try {
    const res = await fetch(`${BYBIT_BASE}/v5/market/tickers?category=option&baseCoin=${ccy}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const list = Array.isArray(json?.result?.list) ? json.result.list : [];
    if (!list.length) return null;
    let volCcy = 0, volUsd = 0, openIntCcy = 0, instruments = 0;
    for (const t of list) {
      instruments += 1;
      volCcy += Number(t.volume24h) || 0; // base-ccy contracts (1 = 1 ccy on Bybit)
      openIntCcy += Number(t.openInterest) || 0; // base-ccy notional per Bybit option tickers
    }
    return { venue: 'Bybit', instruments, volCcy24h: volCcy, openIntCcy, fetchedAt: Date.now() };
  } catch {
    return null;
  }
}

/** Deribit totals from the book summary (base-ccy volume + USD OI). */
async function deribitOptionsSummary(ccy) {
  try {
    const result = await deribitFetch(`get_book_summary_by_currency?currency=${ccy}&kind=option`);
    const list = Array.isArray(result) ? result : [];
    if (!list.length) return null;
    let volCcy = 0, volUsd = 0, openIntCcy = 0, instruments = 0;
    for (const s of list) {
      instruments += 1;
      volCcy += Number(s.volume) || 0;
      volUsd += Number(s.volume_usd) || 0;
      openIntCcy += Number(s.open_interest) || 0; // contracts (Deribit summary field)
    }
    return { venue: 'Deribit', instruments, volCcy24h: volCcy, volUsd24h: volUsd, openIntContracts: openIntCcy, fetchedAt: Date.now() };
  } catch {
    return null;
  }
}

fastify.get('/api/venues/options/:currency', async (request, reply) => {
  const currency = String(request.params.currency || 'BTC').toUpperCase();
  if (currency !== 'BTC' && currency !== 'ETH') {
    reply.code(400);
    return { error: 'currency must be BTC or ETH' };
  }
  const cacheKey = `venues:options:${currency}`;
  try {
    const { data } = await getOrFetch(
      cacheKey,
      30_000,
      async () => {
        const venues = (await Promise.all([
          deribitOptionsSummary(currency),
          okxOptionsSummary(currency),
          bybitOptionsSummary(currency),
        ])).filter(Boolean);
        return { currency, venues, fetchedAt: Date.now() };
      },
      { allowStaleOnError: true },
    );
    return data;
  } catch (err) {
    reply.code(502);
    return { error: 'Venue aggregation failed', detail: err.message };
  }
});

// ── KSA / Tadawul (SAHMK) ──────────────────────────────────────
// Browser reads the shared Node cache only. Upstream calls are gated by the
// daily soft budget in api/ksaFeeds.js (charge-on-success, warmer owns board).
// Without SAHMK_API_KEY the board fails closed with configured:false — never
// synthetic numbers.

/** Shared KSA board — polled by the browser at KSA_BOARD_POLL_MS (5 min). */
fastify.get('/api/ksa/board', async (request, reply) => {
  const blocked = requireDeskAccess(request, reply);
  if (blocked) return blocked;
  const forceWarm = request.query.force === '1' || request.query.force === 'true';
  try {
    const data = await fetchKsaBoard({ forceWarm });
    const unusable = data?.unusable === true || data?.configured === false;
    if (unusable && data?.code === 'BUDGET') {
      reply.code(429);
    } else if (unusable && data?.code !== 'NO_KEY') {
      reply.code(502);
    }
    if (data?.configured === false) reply.code(503);
    return data;
  } catch (err) {
    reply.code(502);
    return { error: 'KSA board failed', detail: err.message || String(err), code: 'UPSTREAM' };
  }
});

/** Symbol detail — resolved from the shared board; no per-symbol fan-out. */
fastify.get('/api/ksa/quote/:symbol', async (request, reply) => {
  const blocked = requireDeskAccess(request, reply);
  if (blocked) return blocked;
  const symbol = String(request.params.symbol || '').trim();
  if (!/^[0-9]{1,6}$/.test(symbol)) {
    reply.code(400);
    return { error: 'Invalid symbol', code: 'INVALID', hint: 'Use numeric Tadawul codes e.g. 2222' };
  }
  return fetchKsaQuote(symbol);
});

/** Riyadh session state — lightweight, no upstream call. Gated like the rest
 *  of the desk so the paywall pattern stays airtight as endpoints evolve. */
fastify.get('/api/ksa/session', async (request, reply) => {
  const blocked = requireDeskAccess(request, reply);
  if (blocked) return blocked;
  return {
    ...riyadhSessionSnapshot(),
    source: 'sahmk',
  };
});

/** Ops: KSA budget readout (no key material). */
fastify.get('/api/ksa/budget', async (request, reply) => {
  const blocked = requireDeskAccess(request, reply);
  if (blocked) return blocked;
  return sahmkBudgetStatus();
});

// ── SSE spot stream ────────────────────────────────────────────
// Pushes FMP quote ticks to the browser so spot updates without a full poll.
// Interval is session-aware (faster in RTH). Clients reconnect automatically.
fastify.get('/api/stream/quote/:symbol', async (request, reply) => {
  const symbol = validateSymbol(request.params.symbol);
  if (!symbol) {
    reply.code(400);
    return { error: 'Invalid symbol' };
  }
  const origin = request.headers.origin;
  const allowOrigin =
    !origin || ALLOWED_ORIGINS.includes(origin) ? (origin || ALLOWED_ORIGINS[0]) : null;
  if (origin && !allowOrigin) {
    reply.code(403);
    return { error: 'Not allowed by CORS' };
  }

  reply.hijack();
  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
  if (allowOrigin) {
    headers['Access-Control-Allow-Origin'] = allowOrigin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  reply.raw.writeHead(200, headers);
  reply.raw.write(': connected\n\n');

  let closed = false;
  let lastGoodTickAt = 0;
  let consecutiveFailures = 0;
  // If no good tick for this long, emit stale + end stream so client SSE chip drops.
  const STALE_MS = 90_000;
  /** Cached data older than this is a replay, not a live tick. */
  const STALE_DATA_MS = 90_000;
  const MAX_FAILURES = 5;

  let timer = null;
  let retune = null;
  let watchdog = null;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    if (retune) clearInterval(retune);
    if (watchdog) clearInterval(watchdog);
    try { reply.raw.end(); } catch { /* ignore */ }
  };

  const writeTick = async () => {
    if (closed) return;
    try {
      // Shared, budget-gated quote: same cache entry as /api/fmp/stable/* —
      // N stream clients share one upstream call per TTL (the previous direct
      // proxyFmp call burned ~60 unbudgeted calls/hour per open tab).
      const { quote, ageMs, stale, error } = await fetchFmpQuoteShared(symbol, FMP_API_KEY, FMP_BASE);
      if (error === 'no_api_key') {
        reply.raw.write(`data: ${JSON.stringify({ error: 'no_api_key', timestamp: Date.now() })}\n\n`);
        reply.raw.write(`data: ${JSON.stringify({ error: 'stream_stale', timestamp: Date.now() })}\n\n`);
        cleanup();
        return;
      }
      if (quote && quote.price > 0) {
        const payload = {
          symbol: quote.symbol || symbol,
          price: quote.price,
          change: quote.change,
          changePercentage: quote.changePercentage,
          /** Cache age of this tick — lets the UI show honest freshness. */
          ageMs,
          stale: !!stale || ageMs > STALE_DATA_MS,
          timestamp: Date.now(),
          source: 'fmp',
        };
        // A tick only counts as "good" when its data is actually fresh; a
        // stale-cache replay must not keep a dead stream alive forever.
        if (!stale && ageMs <= STALE_DATA_MS) {
          lastGoodTickAt = Date.now();
          consecutiveFailures = 0;
        }
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
        if (stale || ageMs > STALE_DATA_MS) {
          consecutiveFailures += 1;
          if (consecutiveFailures >= MAX_FAILURES) {
            reply.raw.write(`data: ${JSON.stringify({ error: 'stream_stale', timestamp: Date.now() })}\n\n`);
            cleanup();
          }
        }
      } else if (error === 'budget_exhausted') {
        // Budget gone: emit one honest error, then end so the client falls
        // back to polling / shows the stale chip. Never spin on retries.
        consecutiveFailures += 1;
        reply.raw.write(`data: ${JSON.stringify({ error: 'fmp_budget_exhausted', timestamp: Date.now() })}\n\n`);
        if (consecutiveFailures >= 2) {
          reply.raw.write(`data: ${JSON.stringify({ error: 'stream_stale', timestamp: Date.now() })}\n\n`);
          cleanup();
        }
      } else {
        consecutiveFailures += 1;
        const errCode = error || 'tick_failed';
        reply.raw.write(`data: ${JSON.stringify({ error: errCode, timestamp: Date.now(), consecutiveFailures })}\n\n`);
        if (
          consecutiveFailures >= MAX_FAILURES
          || (lastGoodTickAt > 0 && Date.now() - lastGoodTickAt > STALE_MS)
        ) {
          reply.raw.write(`data: ${JSON.stringify({ error: 'stream_stale', timestamp: Date.now() })}\n\n`);
          cleanup();
        }
      }
    } catch (err) {
      consecutiveFailures += 1;
      reply.raw.write(`data: ${JSON.stringify({ error: 'tick_failed', detail: String(err.message || err), timestamp: Date.now() })}\n\n`);
      if (consecutiveFailures >= MAX_FAILURES) cleanup();
    }
  };

  await writeTick();
  // 12s open / 60s closed — mirrors client LIVE_SPOT_* cadence without importing TS.
  const openMs = 12_000;
  const closedMs = 60_000;
  const pickInterval = () => {
    const et = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    // crude: if contains "Sat"/"Sun" use closed; else check hour roughly
    if (/\bSat\b|\bSun\b/.test(et)) return closedMs;
    const hm = et.match(/(\d{1,2}):(\d{2})/);
    if (!hm) return openMs;
    let h = Number(hm[1]);
    const m = Number(hm[2]);
    if (h === 24) h = 0;
    const mins = h * 60 + m;
    if (mins >= 9 * 60 + 30 && mins < 16 * 60) return openMs;
    return closedMs;
  };

  timer = setInterval(writeTick, pickInterval());
  retune = setInterval(() => {
    clearInterval(timer);
    timer = setInterval(writeTick, pickInterval());
  }, 60_000);

  // Watchdog: end stream if last good tick is too old (FMP dead but no throw).
  watchdog = setInterval(() => {
    if (closed) return;
    if (lastGoodTickAt > 0 && Date.now() - lastGoodTickAt > STALE_MS) {
      try {
        reply.raw.write(`data: ${JSON.stringify({ error: 'stream_stale', timestamp: Date.now() })}\n\n`);
      } catch { /* ignore */ }
      cleanup();
    }
  }, 15_000);

  request.raw.on('close', cleanup);
  request.raw.on('error', cleanup);
});

// ── FMP API Proxy ──────────────────────────────────────────────
// Forwards /api/fmp/stable/* to financialmodelingprep.com/stable/*
// keeping the API key server-side.

fastify.get('/api/fmp/stable/*', async (request, reply) => {
  const url = request.url.replace('/api/fmp/stable/', '');
  const endpoint = url.split(/[?#]/)[0];

  // Reject anything not in the allowlist before spending a request with our key.
  if (!isFmpEndpointAllowed(endpoint)) {
    reply.code(403);
    return { error: 'Endpoint not allowed' };
  }

  // Shared cache + daily budget so many users don't burn FMP free tier (250/day).
  const fmpKey = `fmp:${url}`;
  const isQuote = endpoint.startsWith('quote');
  const ttl = isQuote ? TTL.FMP_QUOTE_MS : TTL.FMP_HEAVY_MS;
  try {
    const stale = peek(fmpKey);
    if (stale && Date.now() - stale.timestamp < ttl) {
      reply.header('X-Cache', 'HIT');
      return stale.data;
    }
    if (!budgetAllows('fmp', FMP_FREE_DAILY) && stale) {
      reply.header('X-Cache', 'STALE-BUDGET');
      return stale.data;
    }
    if (!FMP_API_KEY) {
      reply.code(503);
      return { error: 'FMP_API_KEY not configured' };
    }
    if (!budgetAllows('fmp', FMP_FREE_DAILY)) {
      reply.code(429);
      return {
        error: 'FMP daily budget exhausted',
        used: getBudgetUsed('fmp'),
        cap: FMP_FREE_DAILY,
      };
    }
    const { data, fromCache } = await getOrFetch(fmpKey, ttl, async () => {
      recordBudget('fmp', 1);
      const { status, body } = await proxyFmp(url, FMP_API_KEY, FMP_BASE);
      if (status >= 400) {
        const err = new Error(body?.error || `FMP ${status}`);
        err.status = status;
        err.body = body;
        throw err;
      }
      return body;
    }, { allowStaleOnError: true });
    reply.header('X-Cache', fromCache ? 'HIT' : 'MISS');
    return data;
  } catch (err) {
    if (err.body) {
      reply.code(err.status || 502);
      return err.body;
    }
    reply.code(502);
    return { error: 'FMP proxy failed', detail: err.message };
  }
});

// ── Finnhub (news + earnings calendar) ─────────────────────────
// Key stays server-side. Fail-closed empty arrays when missing/errors.

function finnhubDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

async function finnhubGet(path, params = {}) {
  if (!FINNHUB_API_KEY) {
    const err = new Error('FINNHUB_API_KEY not configured');
    err.code = 'no_api_key';
    throw err;
  }
  const u = new URL(`${FINNHUB_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') u.searchParams.set(k, String(v));
  }
  u.searchParams.set('token', FINNHUB_API_KEY);
  const res = await fetch(u.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  recordBudget('finnhub', 1);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Finnhub HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Company + general news strip for Home. */
fastify.get('/api/finnhub/news', async (request, reply) => {
  const raw = String(request.query.symbol || 'SPY').toUpperCase();
  const symbol = validateSymbol(raw) || 'SPY';
  const limit = Math.min(30, Math.max(1, parseInt(String(request.query.limit || '12'), 10) || 12));
  const cacheKey = `finnhub:news:${symbol}:${limit}`;
  try {
    const { data, fromCache, ageMs } = await getOrFetch(
      cacheKey,
      TTL.FINNHUB_NEWS_MS,
      async () => {
        const to = new Date();
        const from = new Date(to.getTime() - 14 * 24 * 3600 * 1000);
        let company = [];
        try {
          const rows = await finnhubGet('/company-news', {
            symbol,
            from: finnhubDate(from),
            to: finnhubDate(to),
          });
          company = Array.isArray(rows) ? rows : [];
        } catch {
          company = [];
        }
        let general = [];
        try {
          const rows = await finnhubGet('/news', { category: 'general' });
          general = Array.isArray(rows) ? rows : [];
        } catch {
          general = [];
        }
        const mapItem = (n, related) => ({
          id: n.id ?? `${n.datetime}-${n.headline}`,
          datetime: n.datetime ?? null,
          headline: n.headline || '',
          summary: n.summary || '',
          source: n.source || '',
          url: n.url || null,
          related: related || n.related || '',
          category: n.category || '',
        });
        const items = [
          ...company.slice(0, limit).map((n) => mapItem(n, symbol)),
          ...general.slice(0, Math.max(0, limit - Math.min(company.length, limit))).map((n) => mapItem(n, 'MARKET')),
        ]
          .filter((n) => n.headline)
          .slice(0, limit);
        return {
          symbol,
          items,
          count: items.length,
          as_of: new Date().toISOString(),
          source: 'Finnhub',
          note: items.length
            ? 'Company + general headlines. Not trade advice.'
            : 'No headlines returned (rate limit or empty).',
          error: items.length ? null : 'empty',
        };
      },
      { allowStaleOnError: true },
    );
    return { ...data, fromCache, ageMs };
  } catch (err) {
    if (err?.code === 'no_api_key' || String(err?.message || '').includes('not configured')) {
      reply.code(503);
      return {
        symbol,
        items: [],
        error: 'no_api_key',
        source: 'Finnhub',
        note: 'Set FINNHUB_API_KEY in server .env. Fail-closed — no demo headlines.',
      };
    }
    reply.code(502);
    return {
      symbol,
      items: [],
      error: err.message,
      source: 'Finnhub',
      note: 'Finnhub news failed. No synthetic headlines.',
    };
  }
});

/** Next earnings window for active symbol. */
fastify.get('/api/finnhub/earnings', async (request, reply) => {
  const raw = String(request.query.symbol || 'SPY').toUpperCase();
  const symbol = validateSymbol(raw) || 'SPY';
  const cacheKey = `finnhub:earnings:${symbol}`;
  try {
    const { data, fromCache, ageMs } = await getOrFetch(
      cacheKey,
      TTL.FINNHUB_EARNINGS_MS,
      async () => {
        const from = new Date();
        const to = new Date(from.getTime() + 120 * 24 * 3600 * 1000);
        let rows = [];
        try {
          const payload = await finnhubGet('/calendar/earnings', {
            symbol,
            from: finnhubDate(from),
            to: finnhubDate(to),
          });
          rows = Array.isArray(payload?.earningsCalendar) ? payload.earningsCalendar : [];
        } catch {
          // Fallback: historical earnings estimate endpoint
          try {
            const hist = await finnhubGet('/stock/earnings', { symbol, limit: 4 });
            rows = Array.isArray(hist) ? hist.map((h) => ({
              symbol,
              date: h.period || null,
              epsActual: h.actual,
              epsEstimate: h.estimate,
              hour: null,
              quarter: h.quarter,
              year: h.year,
            })) : [];
          } catch {
            rows = [];
          }
        }
        const normalized = rows.map((r) => ({
          symbol: r.symbol || symbol,
          date: r.date || null,
          hour: r.hour || null,
          eps_estimate: r.epsEstimate ?? r.eps_estimate ?? null,
          eps_actual: r.epsActual ?? r.eps_actual ?? null,
          revenue_estimate: r.revenueEstimate ?? null,
          revenue_actual: r.revenueActual ?? null,
          quarter: r.quarter ?? null,
          year: r.year ?? null,
        }));
        // Prefer upcoming (date >= today)
        const today = finnhubDate();
        const upcoming = normalized
          .filter((r) => r.date && r.date >= today)
          .sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const next = upcoming[0] || normalized[0] || null;
        return {
          symbol,
          next,
          upcoming: upcoming.slice(0, 6),
          recent: normalized.slice(0, 6),
          as_of: new Date().toISOString(),
          source: 'Finnhub',
          note: next
            ? 'Next report from Finnhub earnings calendar (when available).'
            : 'No earnings date returned for symbol.',
          error: next ? null : 'empty',
        };
      },
      { allowStaleOnError: true },
    );
    return { ...data, fromCache, ageMs };
  } catch (err) {
    if (err?.code === 'no_api_key' || String(err?.message || '').includes('not configured')) {
      reply.code(503);
      return {
        symbol,
        next: null,
        upcoming: [],
        error: 'no_api_key',
        source: 'Finnhub',
        note: 'Set FINNHUB_API_KEY in server .env.',
      };
    }
    reply.code(502);
    return {
      symbol,
      next: null,
      upcoming: [],
      error: err.message,
      source: 'Finnhub',
      note: 'Finnhub earnings failed. No synthetic date.',
    };
  }
});

// ── Finnhub quote (shared desk tape) ───────────────────────────
fastify.get('/api/finnhub/quote', async (request, reply) => {
  const raw = String(request.query.symbol || 'SPY').toUpperCase();
  const symbol = validateSymbol(raw) || 'SPY';
  const cacheKey = `finnhub:quote:${symbol}`;
  try {
    const { data, fromCache, ageMs } = await getOrFetch(
      cacheKey,
      TTL.FINNHUB_QUOTE_MS,
      async () => {
        const q = await finnhubGet('/quote', { symbol });
        const price = Number(q?.c);
        return {
          symbol,
          price: price > 0 ? price : null,
          change: q?.d != null ? Number(q.d) : null,
          change_pct: q?.dp != null ? Number(q.dp) : null,
          high: q?.h != null ? Number(q.h) : null,
          low: q?.l != null ? Number(q.l) : null,
          open: q?.o != null ? Number(q.o) : null,
          previous_close: q?.pc != null ? Number(q.pc) : null,
          as_of: new Date().toISOString(),
          source: 'Finnhub',
          error: price > 0 ? null : 'empty',
          note: 'Shared desk quote · server budget · not per-visitor.',
        };
      },
      { allowStaleOnError: true },
    );
    return { ...data, fromCache, ageMs };
  } catch (err) {
    if (err?.code === 'no_api_key' || String(err?.message || '').includes('not configured')) {
      reply.code(503);
      return {
        symbol,
        price: null,
        error: 'no_api_key',
        source: 'Finnhub',
        note: 'Set FINNHUB_API_KEY. Fail-closed.',
      };
    }
    reply.code(502);
    return {
      symbol,
      price: null,
      error: err.message,
      source: 'Finnhub',
      note: 'Finnhub quote failed. No synthetic price.',
    };
  }
});

/**
 * Economic calendar — free-tier Finnhub when available.
 * Shared 6h cache: one upstream pull for all website visitors.
 */
fastify.get('/api/finnhub/economic-calendar', async (request, reply) => {
  // Strict date format: these flow into the upstream URL AND the cache key —
  // free-form strings would mint unlimited cache entries (each a real call).
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const fromRaw = String(request.query.from || '');
  const toRaw = String(request.query.to || '');
  if ((fromRaw && !DATE_RE.test(fromRaw)) || (toRaw && !DATE_RE.test(toRaw))) {
    reply.code(400);
    return { error: 'from/to must be YYYY-MM-DD' };
  }
  const fromQ = fromRaw;
  const toQ = toRaw;
  const today = finnhubDate();
  const from = fromQ || today;
  const toDefault = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 14);
    return finnhubDate(d);
  })();
  const to = toQ || toDefault;
  // FINNHUB_SOFT_DAILY was previously displayed but never enforced — every
  // cache-miss here is a real Finnhub call on the shared key.
  if (!budgetAllows('finnhub', FINNHUB_SOFT_DAILY, 0.9)) {
    reply.code(429);
    return { error: 'Finnhub daily soft budget exhausted', code: 'BUDGET' };
  }
  const cacheKey = `finnhub:eco:${from}:${to}`;
  try {
    const { data, fromCache, ageMs } = await getOrFetch(
      cacheKey,
      TTL.FINNHUB_ECO_MS,
      async () => {
        let payload = null;
        try {
          payload = await finnhubGet('/calendar/economic', { from, to });
        } catch (e) {
          // Some free plans return 403 — fail-closed with empty list
          return {
            from,
            to,
            events: [],
            count: 0,
            as_of: new Date().toISOString(),
            source: 'Finnhub',
            error: e?.message || 'unavailable',
            note: 'Economic calendar unavailable on this Finnhub plan. Fail-closed.',
          };
        }
        const rows = Array.isArray(payload?.economicCalendar)
          ? payload.economicCalendar
          : Array.isArray(payload)
            ? payload
            : [];
        const events = rows.slice(0, 40).map((r, i) => ({
          id: r?.event ? `${r.event}-${r.time || r.date || i}` : `eco-${i}`,
          country: r?.country || null,
          event: r?.event || r?.name || null,
          time: r?.time || r?.date || null,
          impact: r?.impact || r?.importance || null,
          actual: r?.actual ?? null,
          estimate: r?.estimate ?? r?.consensus ?? null,
          prev: r?.prev ?? r?.previous ?? null,
          unit: r?.unit || null,
        })).filter((e) => e.event);
        return {
          from,
          to,
          events,
          count: events.length,
          as_of: new Date().toISOString(),
          source: 'Finnhub',
          error: events.length ? null : 'empty',
          note: 'Shared economic calendar · 6h TTL · one pull for all clients.',
        };
      },
      { allowStaleOnError: true },
    );
    return { ...data, fromCache, ageMs };
  } catch (err) {
    if (err?.code === 'no_api_key' || String(err?.message || '').includes('not configured')) {
      reply.code(503);
      return { events: [], error: 'no_api_key', source: 'Finnhub', note: 'Set FINNHUB_API_KEY.' };
    }
    reply.code(502);
    return { events: [], error: err.message, source: 'Finnhub', note: 'Eco calendar failed. Fail-closed.' };
  }
});

/** Analyst recommendation trends — free Finnhub; 24h shared cache. */
fastify.get('/api/finnhub/recommendation', async (request, reply) => {
  const symbol = validateSymbol(String(request.query.symbol || 'SPY')) || 'SPY';
  const cacheKey = `finnhub:rec:${symbol}`;
  try {
    const { data, fromCache, ageMs } = await getOrFetch(
      cacheKey,
      TTL.FINNHUB_META_MS,
      async () => {
        const rows = await finnhubGet('/stock/recommendation', { symbol });
        const list = Array.isArray(rows) ? rows : [];
        const latest = list[0] || null;
        return {
          symbol,
          latest: latest
            ? {
                period: latest.period || null,
                strongBuy: latest.strongBuy ?? null,
                buy: latest.buy ?? null,
                hold: latest.hold ?? null,
                sell: latest.sell ?? null,
                strongSell: latest.strongSell ?? null,
              }
            : null,
          history_count: list.length,
          as_of: new Date().toISOString(),
          source: 'Finnhub',
          error: latest ? null : 'empty',
          note: 'Shared recommendation pack · 24h TTL · context only, not a signal.',
        };
      },
      { allowStaleOnError: true },
    );
    return { ...data, fromCache, ageMs };
  } catch (err) {
    if (err?.code === 'no_api_key' || String(err?.message || '').includes('not configured')) {
      reply.code(503);
      return { symbol, latest: null, error: 'no_api_key', source: 'Finnhub' };
    }
    reply.code(502);
    return { symbol, latest: null, error: err.message, source: 'Finnhub', note: 'Fail-closed.' };
  }
});

/** Company peers — free Finnhub; 24h shared cache. */
fastify.get('/api/finnhub/peers', async (request, reply) => {
  const symbol = validateSymbol(String(request.query.symbol || 'SPY')) || 'SPY';
  const cacheKey = `finnhub:peers:${symbol}`;
  try {
    const { data, fromCache, ageMs } = await getOrFetch(
      cacheKey,
      TTL.FINNHUB_META_MS,
      async () => {
        const rows = await finnhubGet('/stock/peers', { symbol });
        const peers = (Array.isArray(rows) ? rows : [])
          .map((p) => String(p || '').toUpperCase())
          .filter((p) => p && p !== symbol)
          .slice(0, 12);
        return {
          symbol,
          peers,
          count: peers.length,
          as_of: new Date().toISOString(),
          source: 'Finnhub',
          error: peers.length ? null : 'empty',
          note: 'Shared peers · 24h TTL · one pull for all clients.',
        };
      },
      { allowStaleOnError: true },
    );
    return { ...data, fromCache, ageMs };
  } catch (err) {
    if (err?.code === 'no_api_key' || String(err?.message || '').includes('not configured')) {
      reply.code(503);
      return { symbol, peers: [], error: 'no_api_key', source: 'Finnhub' };
    }
    reply.code(502);
    return { symbol, peers: [], error: err.message, source: 'Finnhub', note: 'Fail-closed.' };
  }
});

/**
 * Massive (Polygon-compatible) previous daily bar — free-tier stock backup.
 * Shared 1h cache. Used only when FMP/YF history path is empty (optional).
 */
fastify.get('/api/massive/prev/:symbol', async (request, reply) => {
  const symbol = validateSymbol(request.params.symbol);
  if (!symbol) {
    reply.code(400);
    return { error: 'Invalid symbol' };
  }
  const key = process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || null;
  if (!key) {
    reply.code(503);
    return {
      symbol,
      error: 'no_api_key',
      source: 'Massive',
      note: 'Set MASSIVE_API_KEY for free prev-bar backup. Fail-closed.',
    };
  }
  try {
    const { data, fromCache, ageMs } = await getOrFetch(
      `massive:prev:${symbol}`,
      TTL.MASSIVE_PREV_MS,
      async () => {
        const url = new URL(`https://api.massive.com/v2/aggs/ticker/${symbol}/prev`);
        url.searchParams.set('adjusted', 'true');
        url.searchParams.set('apiKey', key);
        let res = await fetch(url.toString(), {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(15_000),
        });
        // Polygon-compatible host fallback
        if (!res.ok) {
          const u2 = new URL(`https://api.polygon.io/v2/aggs/ticker/${symbol}/prev`);
          u2.searchParams.set('adjusted', 'true');
          u2.searchParams.set('apiKey', key);
          res = await fetch(u2.toString(), {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(15_000),
          });
        }
        if (!res.ok) {
          throw new Error(`Massive HTTP ${res.status}`);
        }
        const json = await res.json();
        const row = Array.isArray(json?.results) ? json.results[0] : null;
        const close = row?.c != null ? Number(row.c) : null;
        return {
          symbol,
          open: row?.o != null ? Number(row.o) : null,
          high: row?.h != null ? Number(row.h) : null,
          low: row?.l != null ? Number(row.l) : null,
          close: close > 0 ? close : null,
          volume: row?.v != null ? Number(row.v) : null,
          vwap: row?.vw != null ? Number(row.vw) : null,
          ts: row?.t != null ? Number(row.t) : null,
          as_of: new Date().toISOString(),
          source: 'Massive',
          error: close > 0 ? null : 'empty',
          note: 'Shared prev bar · free stock backup · not OPRA live.',
        };
      },
      { allowStaleOnError: true },
    );
    return { ...data, fromCache, ageMs };
  } catch (err) {
    reply.code(502);
    return { symbol, error: err.message, source: 'Massive', note: 'Fail-closed. No synthetic bar.' };
  }
});

// ── Alpha Vantage (shared, daily budget ~25) ───────────────────
fastify.get('/api/alphavantage/quote', async (request, reply) => {
  const raw = String(request.query.symbol || 'SPY').toUpperCase();
  const symbol = validateSymbol(raw) || 'SPY';
  try {
    const { data, fromCache, ageMs } = await getOrFetch(
      `av:quote:${symbol}`,
      TTL.ALPHA_VANTAGE_MS,
      () => alphaVantageGlobalQuote(symbol),
      { allowStaleOnError: true },
    );
    return { ...data, fromCache, ageMs };
  } catch (err) {
    const code = err?.code === 'no_api_key' || err?.code === 'budget_exhausted' ? 503 : 502;
    reply.code(code);
    return {
      symbol,
      price: null,
      error: err?.code || err.message,
      source: 'Alpha Vantage',
      note: 'Fail-closed. Existing yfinance/FMP paths unchanged.',
    };
  }
});

fastify.get('/api/alphavantage/daily', async (request, reply) => {
  const raw = String(request.query.symbol || 'SPY').toUpperCase();
  const symbol = validateSymbol(raw) || 'SPY';
  const limit = Math.min(100, Math.max(10, parseInt(String(request.query.limit || '60'), 10) || 60));
  try {
    const { data, fromCache, ageMs } = await getOrFetch(
      `av:daily:${symbol}:${limit}`,
      TTL.ALPHA_VANTAGE_MS,
      () => alphaVantageDaily(symbol, limit),
      { allowStaleOnError: true },
    );
    return { ...data, fromCache, ageMs };
  } catch (err) {
    const code = err?.code === 'no_api_key' || err?.code === 'budget_exhausted' ? 503 : 502;
    reply.code(code);
    return {
      symbol,
      bars: [],
      error: err?.code || err.message,
      source: 'Alpha Vantage',
      note: 'Fail-closed. No synthetic bars.',
    };
  }
});

fastify.get('/api/alphavantage/overview', async (request, reply) => {
  const raw = String(request.query.symbol || 'SPY').toUpperCase();
  const symbol = validateSymbol(raw) || 'SPY';
  try {
    const { data, fromCache, ageMs } = await getOrFetch(
      `av:overview:${symbol}`,
      TTL.ALPHA_VANTAGE_MS,
      () => alphaVantageOverview(symbol),
      { allowStaleOnError: true },
    );
    return { ...data, fromCache, ageMs };
  } catch (err) {
    const code = err?.code === 'no_api_key' || err?.code === 'budget_exhausted' ? 503 : 502;
    reply.code(code);
    return {
      symbol,
      overview: null,
      error: err?.code || err.message,
      source: 'Alpha Vantage',
      note: 'Fail-closed.',
    };
  }
});

// ── TradingView RapidAPI (scarce monthly budget — SPY/BTC only) ─
// NOT used for SOFR/EFFR (NY Fed + FRED already better + free).
fastify.get('/api/tradingview/snapshot', async (request, reply) => {
  const raw = String(request.query.symbol || 'SPY').toUpperCase();
  const allowed = new Set(['SPY', 'BTC', 'BTCUSD', 'ETH', 'ETHUSD']);
  const symbol = allowed.has(raw) ? raw : 'SPY';
  try {
    const { data, fromCache, ageMs } = await getOrFetch(
      `tv:snap:${symbol}`,
      TTL.TRADINGVIEW_MS,
      () => tradingViewSnapshot(symbol),
      { allowStaleOnError: true },
    );
    return { ...data, fromCache, ageMs };
  } catch (err) {
    const code = err?.code === 'no_api_key' || err?.code === 'budget_exhausted' ? 503 : 502;
    reply.code(code);
    return {
      symbol,
      price: null,
      bars: [],
      error: err?.code || err.message,
      source: 'TradingView RapidAPI',
      note: 'Fail-closed. Does not replace Deribit/yfinance/FRED.',
    };
  }
});

/** Realized vol (ann. %) from daily closes — zero extra API calls. */
function realizedVolFromBars(bars, window = 20) {
  if (!Array.isArray(bars) || bars.length < window + 1) return null;
  const closes = bars
    .map((b) => (b?.close != null ? Number(b.close) : null))
    .filter((c) => c != null && c > 0);
  if (closes.length < window + 1) return null;
  const slice = closes.slice(-window - 1);
  const rets = [];
  for (let i = 1; i < slice.length; i++) {
    rets.push(Math.log(slice[i] / slice[i - 1]));
  }
  if (!rets.length) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const var_ = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length;
  const daily = Math.sqrt(var_);
  const ann = daily * Math.sqrt(252) * 100;
  return Number.isFinite(ann) ? Math.round(ann * 100) / 100 : null;
}

/** Combined shared desk pack for Home — prefer cache; never stampede scarce APIs. */
fastify.get('/api/desk/pack', async (request, reply) => {
  const symbol = validateSymbol(String(request.query.symbol || 'SPY')) || 'SPY';
  try {
    const base = `http://127.0.0.1:${PORT}`;
    // AV/TV: serve from cache when present; warmer owns scarce fills.
    const avQuotePeek = peek(`av:quote:${symbol}`);
    const avDailyPeek = peek(`av:daily:${symbol}:40`) || peek(`av:daily:${symbol}:60`);
    const avOverviewPeek = peek(`av:overview:${symbol}`);
    const tvPeek = peek(`tv:snap:${symbol}`) || peek('tv:snap:SPY');

    const [fhQuote, fhNews, fhEco, fhRec, fhPeers, cache] = await Promise.all([
      fetch(`${base}/api/finnhub/quote?symbol=${symbol}`).then((r) => r.json()).catch((e) => ({ error: e.message })),
      fetch(`${base}/api/finnhub/news?symbol=${symbol}&limit=6`).then((r) => r.json()).catch((e) => ({ error: e.message })),
      fetch(`${base}/api/finnhub/economic-calendar`).then((r) => r.json()).catch((e) => ({ error: e.message, events: [] })),
      fetch(`${base}/api/finnhub/recommendation?symbol=${symbol}`).then((r) => r.json()).catch((e) => ({ error: e.message })),
      fetch(`${base}/api/finnhub/peers?symbol=${symbol}`).then((r) => r.json()).catch((e) => ({ error: e.message, peers: [] })),
      fetch(`${base}/api/cache/status`).then((r) => r.json()).catch(() => null),
    ]);

    let avQuote = avQuotePeek
      ? { ...avQuotePeek.data, fromCache: true, ageMs: Date.now() - avQuotePeek.timestamp }
      : null;
    let avDaily = avDailyPeek
      ? { ...avDailyPeek.data, fromCache: true, ageMs: Date.now() - avDailyPeek.timestamp }
      : null;
    let avOverview = avOverviewPeek
      ? { ...avOverviewPeek.data, fromCache: true, ageMs: Date.now() - avOverviewPeek.timestamp }
      : null;
    let tv = tvPeek
      ? { ...tvPeek.data, fromCache: true, ageMs: Date.now() - tvPeek.timestamp }
      : null;

    // Optional fill only if warmer has not yet run and budget remains (1 AV call max here).
    if (!avQuote && budgetAllows('alphavantage', ALPHA_VANTAGE_FREE_DAILY, 0.85)) {
      avQuote = await fetch(`${base}/api/alphavantage/quote?symbol=${symbol}`)
        .then((r) => r.json())
        .catch((e) => ({ error: e.message, source: 'Alpha Vantage' }));
    }
    if (!tv && process.env.RAPIDAPI_KEY) {
      tv = {
        price: null,
        error: 'awaiting_warmer',
        note: 'TradingView fills on server warmer (~few times/day). Not used for rates.',
        source: 'TradingView RapidAPI',
      };
    }

    const bars = avDaily?.bars || [];
    const realized_vol_20d = realizedVolFromBars(bars, 20);

    return {
      symbol,
      finnhub_quote: fhQuote,
      alphavantage_quote: avQuote,
      alphavantage_daily: avDaily,
      alphavantage_overview: avOverview,
      finnhub_news: fhNews,
      finnhub_economic_calendar: fhEco,
      finnhub_recommendation: fhRec,
      finnhub_peers: fhPeers,
      derived: {
        realized_vol_20d_pct: realized_vol_20d,
        realized_vol_note: realized_vol_20d != null
          ? '20d log-return ann. vol from shared AV daily bars · zero extra API calls'
          : 'Need warmer AV daily bars',
      },
      tradingview: tv,
      budgets: cache?.budgets || null,
      keys: process.env.EXPOSE_KEY_STATUS === '1' ? (cache?.keys || providerKeysStatus()) : null,
      as_of: new Date().toISOString(),
      note: 'Shared desk pack · free APIs · server-owned refresh · browsers only read cache.',
    };
  } catch (err) {
    reply.code(502);
    return { error: err.message, note: 'Desk pack failed.' };
  }
});

// ── Local rates/greeks pipe proxy ──────────────────────────────
// Forwards /api/macrovol/* → local FastAPI on :8765 (FRED/NYFed/yfinance/… — not a market vendor).
// Lightweight rates/macro paths are shared-cached so page loads do not stampede FRED.

const MACRO_LIGHT_TTL_MS = TTL.BRIEFING_MS;
const MACRO_LIGHT_PREFIXES = [
  '/rates/summary',
  '/macro/summary',
  '/macro/stress',
  '/macro/primary',
  '/rates/curve',
  '/rates/shape',
  '/rates/basis',
  '/rates/basis-history',
  '/rates/curve-history',
  '/rates/plumbing',
  '/rates/fx',
  '/rates/auctions',
  '/rates/correlations',
  '/crypto/spot',
  '/rates/global-yields',
  // STIR is yfinance-heavy cold; cache shared so Rates tab is not 10s every visitor.
  '/stir/strip',
];

function isMacroLightPath(suffix) {
  const path = (suffix.split('?')[0] || '').replace(/\/$/, '') || '/';
  return MACRO_LIGHT_PREFIXES.some((p) => path === p || path.startsWith(`${p}?`));
}

/** Block debug/admin MacroVol paths at the public edge (never forward). */
function isMacroDebugPath(suffix) {
  const path = (suffix.split('?')[0] || '').replace(/\/$/, '') || '/';
  // fetch() normalizes dot segments upstream, so `/rates/../../debug/fred`
  // would slip past a literal `/debug` prefix check. Any dot segment is
  // illegitimate in this API surface — reject it outright.
  const lower = path.toLowerCase();
  if (lower.includes('%2e')) return true;
  if (lower.split('/').some((seg) => seg === '.' || seg === '..')) return true;
  return path === '/debug' || path.startsWith('/debug/');
}

fastify.route({
  method: ['GET', 'POST', 'OPTIONS'],
  url: '/api/macrovol/*',
  handler: async (request, reply) => {
    const raw = request.url || '';
    // /api/macrovol/rates/summary → /api/rates/summary
    const suffix = raw.replace(/^\/api\/macrovol/, '') || '/';
    if (isMacroDebugPath(suffix)) {
      reply.code(404);
      return { error: 'Not found' };
    }
    const target = `${MACROVOL_API_URL}/api${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
    const light = request.method === 'GET' && isMacroLightPath(suffix);
    // Greeks re-pull yfinance chain — share Node cache at OPTIONS_MS (same as equity chain).
    const greeksPath = (suffix.split('?')[0] || '').replace(/\/$/, '');
    const greeksHeavy = request.method === 'GET'
      && (greeksPath.startsWith('/greeks/') || greeksPath.startsWith('/surface/'));
    try {
      const cacheIf2xx = (d) => d && typeof d.status === 'number' && d.status >= 200 && d.status < 300;
      const loader = async () => {
        const res = await fetch(target, {
          method: request.method === 'OPTIONS' ? 'GET' : request.method,
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(90_000),
        });
        const text = await res.text();
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          body = { error: 'Invalid JSON from rates pipe', raw: text.slice(0, 300) };
        }
        // Do not treat 4xx/5xx as cacheable success — sticky error bodies freeze the desk.
        if (res.status < 200 || res.status >= 300) {
          const err = new Error(`MacroVol upstream ${res.status}`);
          err.status = res.status;
          err.body = body;
          throw err;
        }
        return { status: res.status, body };
      };

      const result = light
        ? await getOrFetch(`macrovol:${suffix}`, MACRO_LIGHT_TTL_MS, loader, {
            allowStaleOnError: true,
            cacheIf: cacheIf2xx,
          })
        : greeksHeavy
          ? await getOrFetch(`macrovol:${suffix}`, TTL.OPTIONS_MS, loader, {
              allowStaleOnError: true,
              cacheIf: cacheIf2xx,
            })
          : { data: await loader(), fromCache: false, ageMs: 0, stale: false };

      const { status, body } = result.data;
      reply.code(status);
      // Internal URL is for ops only — do not expose to every browser client.
      if (process.env.EXPOSE_KEY_STATUS === '1' || process.env.EXPOSE_MACROVOL_UPSTREAM === '1') {
        reply.header('X-MacroVol-Upstream', MACROVOL_API_URL);
      }
      if (light || greeksHeavy) {
        reply.header('X-Cache', result.fromCache ? 'HIT' : 'MISS');
        reply.header('X-Cache-Age-Ms', String(result.ageMs ?? 0));
        if (result.stale) reply.header('X-Cache-Stale', '1');
      }
      return body;
    } catch (err) {
      if (err && err.body != null && err.status) {
        reply.code(err.status);
        return err.body;
      }
      reply.code(502);
      return {
        error: 'Rates/greeks pipe unavailable',
        detail: err.message || String(err),
        hint: `Start local rates pipe on ${MACROVOL_API_URL} (FRED/NYFed/yfinance; e.g. npm run macrovol-api)`,
      };
    }
  },
});

// ── Crypto Backtest API proxy ──────────────────────────────
// Forwards /api/backtest/* → local FastAPI on :8766 (24h-rollout-effect analysis).
// Localhost only — never an open SSRF relay (mirrors resolveMacrovolBase).
function resolveBacktestBase() {
  const raw = (process.env.BACKTEST_API_URL || 'http://127.0.0.1:8766').replace(/\/$/, '');
  try {
    const u = new URL(raw);
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return raw;
    console.warn(
      `WARN: BACKTEST_API_URL host "${u.hostname}" is not local — forcing http://127.0.0.1:8766`,
    );
  } catch {
    console.warn('WARN: BACKTEST_API_URL invalid — forcing http://127.0.0.1:8766');
  }
  return 'http://127.0.0.1:8766';
}
const BACKTEST_API_URL = resolveBacktestBase();

fastify.route({
  method: ['GET', 'POST', 'OPTIONS'],
  url: '/api/backtest/*',
  // Each POST fans out into pandas backtests + Binance fetches on the Python
  // side — far heavier than a normal proxy hop, so cap it tighter than the
  // generic upstream class (which still applies beneath this).
  config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  handler: async (request, reply) => {
    const raw = request.url || '';
    const suffix = raw.replace(/^\/api\/backtest/, '') || '/';
    const target = `${BACKTEST_API_URL}/api/backtest${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
    try {
      const res = await fetch(target, {
        method: request.method === 'OPTIONS' ? 'GET' : request.method,
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(120_000),
      });
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: 'Invalid JSON from backtest pipe', raw: text.slice(0, 300) };
      }
      if (res.status < 200 || res.status >= 300) {
        reply.code(res.status);
        return body;
      }
      reply.code(res.status);
      return body;
    } catch (err) {
      reply.code(502);
      return {
        error: 'Crypto backtest pipe unavailable',
        detail: err.message || String(err),
        hint: `Start backtest API: python3 -m uvicorn main:app --app-dir crypto-backtest-api --host 127.0.0.1 --port 8766`,
      };
    }
  },
});

// ── FlashAlpha Lab (GEX / levels) ───────────────────────────
// Free tier: ~5 calls/day TOTAL across all symbols (not per-symbol).
// Server-side cache ≥6h; never expose the api key to browser.
const FLASHALPHA_API_KEY = process.env.FLASHALPHA_API_KEY || null;
const FA_DAILY_CAP = FLASHALPHA_FREE_DAILY;
/** Global free-tier budget key — must not include symbol. */
const FA_BUDGET_KEY = 'flashalpha';
const FA_CACHE_TTL = 6 * 60 * 60_000; // 6h

if (!FLASHALPHA_API_KEY) {
  console.warn('WARN: FLASHALPHA_API_KEY not set — FlashAlpha GEX/levels disabled.');
}

fastify.get('/api/flashalpha/exposure/levels/:symbol', async (request, reply) => {
  const symbol = String(request.params.symbol || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '') || 'AAPL';
  if (!FLASHALPHA_API_KEY) {
    reply.code(503);
    return { error: 'FLASHALPHA_API_KEY not configured' };
  }
  // Cache hit never burns budget; only cold upstream does.
  if (!budgetAllows(FA_BUDGET_KEY, FA_DAILY_CAP, 0.80)) {
    const stale = peek(`fa:levels:${symbol}`);
    if (stale) {
      reply.header('X-Cache', 'STALE-BUDGET');
      return stale.data;
    }
    reply.code(429);
    return {
      error: 'FlashAlpha daily budget exhausted',
      cap: FA_DAILY_CAP,
      used: getBudgetUsed(FA_BUDGET_KEY),
      note: 'Global free-tier cap (all symbols share 5/day). Cache TTL 6h.',
    };
  }

  try {
    const { data, fromCache } = await getOrFetch(
      `fa:levels:${symbol}`,
      FA_CACHE_TTL,
      async () => {
        recordBudget(FA_BUDGET_KEY, 1);
        const res = await fetch(
          `https://lab.flashalpha.com/v1/exposure/levels/${symbol}`,
          { headers: { 'X-Api-Key': FLASHALPHA_API_KEY }, signal: AbortSignal.timeout(15_000) },
        );
        if (!res.ok) {
          const err = new Error(`FlashAlpha HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
        return res.json();
      },
      { allowStaleOnError: true },
    );
    reply.header('X-Cache', fromCache ? 'HIT' : 'MISS');
    return data;
  } catch (err) {
    reply.code(err.status === 429 ? 429 : 502);
    return { error: 'FlashAlpha fetch failed', detail: err.message };
  }
});

fastify.get('/api/flashalpha/exposure/gex/:symbol', async (request, reply) => {
  const symbol = String(request.params.symbol || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '') || 'AAPL';
  const expiration = String(request.query.expiration || '').replace(/[^0-9-]/g, '');
  if (!FLASHALPHA_API_KEY) {
    reply.code(503);
    return { error: 'FLASHALPHA_API_KEY not configured' };
  }
  if (!budgetAllows(FA_BUDGET_KEY, FA_DAILY_CAP, 0.80)) {
    const stale = peek(`fa:gex:${symbol}:${expiration}`);
    if (stale) {
      reply.header('X-Cache', 'STALE-BUDGET');
      return stale.data;
    }
    reply.code(429);
    return {
      error: 'FlashAlpha daily budget exhausted',
      cap: FA_DAILY_CAP,
      used: getBudgetUsed(FA_BUDGET_KEY),
      note: 'Global free-tier cap (all symbols share 5/day). Cache TTL 6h.',
    };
  }

  try {
    const { data, fromCache } = await getOrFetch(
      `fa:gex:${symbol}:${expiration}`,
      FA_CACHE_TTL,
      async () => {
        recordBudget(FA_BUDGET_KEY, 1);
        const url = new URL(`https://lab.flashalpha.com/v1/exposure/gex/${symbol}`);
        if (expiration) url.searchParams.set('expiration', expiration);
        const res = await fetch(url.toString(), {
          headers: { 'X-Api-Key': FLASHALPHA_API_KEY },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          const err = new Error(`FlashAlpha HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
        return res.json();
      },
      { allowStaleOnError: true },
    );
    reply.header('X-Cache', fromCache ? 'HIT' : 'MISS');
    return data;
  } catch (err) {
    reply.code(err.status === 429 ? 429 : 502);
    return { error: 'FlashAlpha fetch failed', detail: err.message };
  }
});

// ── OPRA skeleton (PR-10) ─────────────────────────────────────
// Disabled by default. No real vendor wiring until OPRA_VENDOR is chosen
// and credentials are provisioned. Snapshot-only; no browser→OPRA fan-out.
const OPRA_ENABLED = process.env.OPRA_ENABLED === '1' || process.env.OPRA_ENABLED === 'true';
const OPRA_VENDOR = (process.env.OPRA_VENDOR || 'stub').toLowerCase();

fastify.get('/api/opra/status', async () => ({
  enabled: OPRA_ENABLED,
  vendor: OPRA_VENDOR,
  mode: 'snapshot-only',
  ready: OPRA_ENABLED && OPRA_VENDOR !== 'stub',
  note: OPRA_ENABLED
    ? (OPRA_VENDOR === 'stub'
      ? 'OPRA_ENABLED but vendor=stub — set OPRA_VENDOR=polygon|livevol + credentials'
      : `Skeleton ready for vendor=${OPRA_VENDOR}; transport not connected`)
    : 'Set OPRA_ENABLED=1 and OPRA_VENDOR after commercial decision',
  timestamp: Date.now(),
}));

/**
 * Placeholder chain endpoint. Never proxies a live OPRA feed until vendor
 * credentials exist server-side. Returns 503 when disabled / stub.
 */
fastify.get('/api/opra/chain/:symbol', async (request, reply) => {
  const symbol = String(request.params.symbol || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '') || 'SPY';
  if (!OPRA_ENABLED) {
    reply.code(503);
    return {
      error: 'opra_disabled',
      symbol,
      hint: 'Set OPRA_ENABLED=1 after choosing a vendor (see DESIGN.md PR-10)',
    };
  }
  if (OPRA_VENDOR === 'stub') {
    reply.code(503);
    return {
      error: 'opra_stub',
      symbol,
      vendor: OPRA_VENDOR,
      hint: 'Configure OPRA_VENDOR + server-side credentials; no unauthenticated browser path',
    };
  }
  // Future: vendor-specific snapshot fetch. Deliberately not implemented.
  reply.code(501);
  return {
    error: 'opra_not_implemented',
    symbol,
    vendor: OPRA_VENDOR,
    mode: 'snapshot',
    message: `Vendor adapter for ${OPRA_VENDOR} not wired yet`,
  };
});

// ── Deribit Market (public futures + funding history, no keys) ─────
await registerDeribitMarketRoutes(fastify);

// ── Stripe Billing (Payments / Billing / Invoicing-ready) ─────
// Server-only. Warns when STRIPE_SECRET_KEY is absent; endpoints fail closed.
if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('WARN: STRIPE_SECRET_KEY not set — billing endpoints will return 503.');
}
await registerStripeBilling(fastify);
await registerStripeAuth(fastify);

// ── Static Files ──────────────────────────────────────────────
// Serve Vite build. Do not SPA-fallback /assets/* (broken JS → blank white page).
try {
  await fastify.register(fastifyStatic, {
    root: join(__dirname, 'dist'),
    wildcard: false,
    // Cache hashed assets aggressively
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
    immutable: true,
  });
} catch (err) {
  console.error('static register failed', err);
}

// Serve /docs/* from repo docs/ (Academy). Do not also put docs under public/
// — Vite would copy them into dist/ and @fastify/static would double-register
// routes (HEAD /docs/index.json → crash).
// SECURITY: only Academy content is public. Engineering/vendor docs
// (docs/engineering, docs/superpowers, …) describe internal architecture,
// billing state and vendor strategy — they must never serve.
try {
  const docsRoot = join(__dirname, 'docs');
  if (existsSync(docsRoot)) {
    await fastify.register(async function docsScope(instance) {
      instance.addHook('onRequest', async (request, reply) => {
        const path = (request.url || '').split('?')[0];
        const allowed =
          path === '/docs' ||
          path === '/docs/' ||
          path === '/docs/index.json' ||
          path.startsWith('/docs/academy/');
        if (!allowed) {
          reply.code(404).send({ error: 'Not found' });
          return reply;
        }
      });
      await instance.register(fastifyStatic, {
        root: docsRoot,
        prefix: '/docs/',
        decorateReply: false,
        // wildcard true: one catch-all instead of per-file routes that collide with dist
        wildcard: true,
        maxAge: 0,
      });
    });
  }
} catch (err) {
  console.warn('docs static failed', err?.message || err);
}

fastify.setNotFoundHandler((request, reply) => {
  const path = (request.url || '').split('?')[0];
  // Missing build assets must 404 (not return HTML) so the browser surfaces the real error
  if (path.startsWith('/assets/') || path.startsWith('/api')) {
    reply.code(404).send({ error: 'Not found', path });
    return;
  }
  return reply.sendFile('index.html');
});

/**
 * Background warmer — ONLY the server refreshes free APIs.
 * Browsers only read /api/* cache. Cadence respects free caps:
 *  - yfinance SPY chain / Deribit BTC: ~3 min
 *  - Finnhub news+quote: every warm cycle (TTL 2–5 min)
 *  - Macro briefing: every warm cycle (TTL 5 min)
 *  - Alpha Vantage: only when TTL expired (~90 min) + daily budget allows
 *  - TradingView: only when TTL expired (~6 h) + monthly budget allows
 */
let warmTick = 0;
async function warmSharedCaches(mode = 'fast') {
  const base = `http://127.0.0.1:${PORT}`;
  try {
    await fetch(`${base}/api/boot/briefing`).catch(() => null);
    await fetch(`${base}/api/options/SPY`).catch(() => null);
    // Warm greeks for SPY so Vol·GRK is not a cold yfinance re-fetch after chain.
    await fetch(`${base}/api/macrovol/greeks/SPY`).catch(() => null);
    await fetch(`${base}/api/deribit/market/BTC`).catch(() => null);
    // Light FRED core — first Rates tab paint should hit Node cache.
    await fetch(`${base}/api/macrovol/rates/summary`).catch(() => null);

    // Finnhub — high free allowance; keep SPY board warm for all users
    for (const sym of DESK_WARM_SYMBOLS) {
      await fetch(`${base}/api/finnhub/quote?symbol=${sym}`).catch(() => null);
      await fetch(`${base}/api/finnhub/news?symbol=${sym}&limit=8`).catch(() => null);
      // 24h-TTL meta: only every ~2h of warm ticks (tick ≈ 3 min → 40 ticks)
      if (warmTick % 40 === 0) {
        await fetch(`${base}/api/finnhub/recommendation?symbol=${sym}`).catch(() => null);
        await fetch(`${base}/api/finnhub/peers?symbol=${sym}`).catch(() => null);
      }
    }
    // Economic calendar once per slow cycle / ~6h (TTL owns the rest)
    if (mode === 'slow' || warmTick % 100 === 0) {
      await fetch(`${base}/api/finnhub/economic-calendar`).catch(() => null);
    }
    // Macro stress pack (FRED free) — light path already TTL'd via briefing
    if (mode === 'slow' || warmTick % 10 === 0) {
      await fetch(`${base}/api/macrovol/macro/stress`).catch(() => null);
      await fetch(`${base}/api/macrovol/macro/primary`).catch(() => null);
    }
    // STIR strip — cold yfinance ~10s; keep shared Node cache warm for Rates tab
    if (mode === 'slow' || warmTick % 20 === 0) {
      await fetch(`${base}/api/macrovol/stir/strip`).catch(() => null);
    }

    // Alpha Vantage — scarce daily + 5/min: one call per slow cycle, staggered
    // OPTIONS_MS ~3 min → every 30 ticks ≈ 90 min for quote; +15 ticks later for daily
    if (mode === 'slow' || warmTick % 30 === 0) {
      for (const sym of DESK_WARM_SYMBOLS) {
        if (budgetAllows('alphavantage', ALPHA_VANTAGE_FREE_DAILY, 0.85)) {
          await fetch(`${base}/api/alphavantage/quote?symbol=${sym}`).catch(() => null);
        }
      }
    } else if (warmTick % 30 === 15) {
      for (const sym of DESK_WARM_SYMBOLS) {
        if (budgetAllows('alphavantage', ALPHA_VANTAGE_FREE_DAILY, 0.85)) {
          await fetch(`${base}/api/alphavantage/daily?symbol=${sym}&limit=40`).catch(() => null);
        }
      }
    } else if (warmTick % 60 === 45) {
      for (const sym of DESK_WARM_SYMBOLS) {
        if (budgetAllows('alphavantage', ALPHA_VANTAGE_FREE_DAILY, 0.85)) {
          await fetch(`${base}/api/alphavantage/overview?symbol=${sym}`).catch(() => null);
        }
      }
    }

    // TradingView — very scarce monthly: SPY only first, then BTC alternate; ~every 6h
    if (mode === 'slow' || warmTick % 120 === 0) {
      const tvSym = warmTick % 240 === 0 ? 'BTC' : 'SPY';
      await fetch(`${base}/api/tradingview/snapshot?symbol=${tvSym}`).catch(() => null);
    }

    warmTick += 1;
    const stats = cacheStats();
    console.log(
      '[warm]',
      mode,
      'keys=',
      stats.entries,
      'av=',
      stats.budgets?.alphavantage?.used,
      'fh=',
      stats.budgets?.finnhub?.used,
      'tv_mo=',
      stats.budgets?.tradingview?.usedMonth,
    );
  } catch (err) {
    console.warn('[warm] skipped:', err?.message || err);
  }
}

await fastify.listen({ port: PORT, host: '0.0.0.0' });
console.log(`Server running at http://localhost:${PORT}${OPRA_ENABLED ? ` · OPRA skeleton (${OPRA_VENDOR})` : ''}`);
console.log('[desk] keys', providerKeysStatus());

// Warm shortly after boot, then on a cadence under free-tier limits.
setTimeout(() => { void warmSharedCaches('slow'); }, 2_000);
setInterval(() => { void warmSharedCaches('fast'); }, TTL.OPTIONS_MS);
