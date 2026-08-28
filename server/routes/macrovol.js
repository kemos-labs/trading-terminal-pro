/**
 * MacroVol proxy routes — forwards /api/macrovol/* → local FastAPI on :8766.
 * Loopback-only, SSRF-safe. Lightweight paths are shared-cached.
 */
import { getOrFetch, TTL } from '../../api/upstreamCache.js';

const MACRO_LIGHT_TTL_MS = TTL.BRIEFING_MS;
const MACRO_LIGHT_PREFIXES = [
  '/rates/summary', '/macro/summary', '/macro/stress', '/macro/primary',
  '/rates/curve', '/rates/shape', '/rates/basis', '/rates/basis-history',
  '/rates/curve-history', '/rates/plumbing', '/rates/fx', '/rates/auctions',
  '/rates/correlations', '/crypto/spot', '/rates/global-yields', '/stir/strip',
];

// P0 Fix: explicit allowlisted endpoints — no wildcard forwarding. Ownership: Greeks/surface/stir are computed in Python as private workers; Node is thin proxy with schema-bounded cache.
const ALLOWED_MACROVOL = [
  { method: ['GET'], re: new RegExp('^/health/?$') },
  { method: ['GET'], re: new RegExp('^/api/rates/sofr/?$') },
  { method: ['GET'], re: new RegExp('^/api/rates/summary/?$') },
  { method: ['GET'], re: new RegExp('^/api/rates/curve/?$') },
  { method: ['GET'], re: new RegExp('^/api/rates/shape/?(\\?.*)?$') },
  { method: ['GET'], re: new RegExp('^/api/rates/term-structure/?(\\?.*)?$') },
  { method: ['GET'], re: new RegExp('^/api/rates/plumbing/?$') },
  { method: ['GET'], re: new RegExp('^/api/rates/basis/?$') },
  { method: ['GET'], re: new RegExp('^/api/rates/basis-history/?(\\?.*)?$') },
  { method: ['GET'], re: new RegExp('^/api/rates/curve-history/?(\\?.*)?$') },
  { method: ['GET'], re: new RegExp('^/api/rates/correlations/?$') },
  { method: ['GET'], re: new RegExp('^/api/rates/jgb-curve/?(\\?.*)?$') },
  { method: ['GET'], re: new RegExp('^/api/rates/fx/?$') },
  { method: ['GET'], re: new RegExp('^/api/rates/auctions/?(\\?.*)?$') },
  { method: ['GET'], re: new RegExp('^/api/rates/global-yields/?$') },
  { method: ['GET'], re: new RegExp('^/api/rates/global-yields/[^/]+/?$') },
  { method: ['GET'], re: new RegExp('^/api/crypto/spot/?$') },
  { method: ['GET'], re: new RegExp('^/api/perp/basis/?$') },
  { method: ['GET'], re: new RegExp('^/api/sec/context/[^/]+/?(\\?.*)?$') },
  { method: ['GET'], re: new RegExp('^/api/macro/summary/?$') },
  { method: ['GET'], re: new RegExp('^/api/macro/series/[^/]+/?(\\?.*)?$') },
  { method: ['GET'], re: new RegExp('^/api/macro/stress/?$') },
  { method: ['GET'], re: new RegExp('^/api/macro/primary/?$') },
  { method: ['GET'], re: new RegExp('^/api/stir/strip/?(\\?.*)?$') },
  { method: ['GET'], re: new RegExp('^/api/feed/[^/]+/?$') },
  { method: ['GET'], re: new RegExp('^/api/surface/[^/]+/?(\\?.*)?$') },
  { method: ['GET'], re: new RegExp('^/api/surface/[^/]+/preview/?(\\?.*)?$') },
  { method: ['GET'], re: new RegExp('^/api/greeks/[^/]+/?(\\?.*)?$') },
  { method: ['GET'], re: new RegExp('^/api/greeks/history/[^/]+/?(\\?.*)?$') },
];

function isMacroAllowed(suffix, method) {
  const check = (suffix.split('?')[0] || '').replace(/\/$/, '') || '/';
  const pathForFull = check.startsWith('/api') ? check : `/api${check}`;
  for (const rule of ALLOWED_MACROVOL) {
    if (!rule.method.includes(method)) continue;
    if (rule.re.test(check) || rule.re.test(pathForFull)) return true;
  }
  return false;
}

/** Validate query params are bounded — prevent unbounded cache keys */
function validateMacroQuery(suffix) {
  const qIdx = suffix.indexOf('?');
  if (qIdx === -1) return null;
  const qs = suffix.slice(qIdx + 1);
  const params = new URLSearchParams(qs);
  // Bound common params: ticker 1-16 alnum, period enum, limit 1-50, history 10-260, etc.
  for (const [k, v] of params) {
    if (v.length > 32) return `param ${k} too long`;
    if (k === 'ticker' || k === 'symbol') {
      if (!/^[A-Za-z0-9.\-=^]{1,16}$/.test(v)) return `invalid ticker ${v}`;
    }
    if (k === 'limit') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 2000) return `limit out of bounds`;
    }
    if (k === 'history') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 10 || n > 260) return `history out of bounds`;
    }
    if (k === 'strike_range') {
      const n = Number(v);
      if (!isFinite(n) || n <= 0 || n > 1) return `strike_range out of bounds`;
    }
    if (k === 'r' || k === 'q') {
      const n = Number(v);
      if (!isFinite(n) || n < -0.5 || n > 2) return `rate out of bounds`;
    }
  }
  return null;
}

function isMacroLightPath(suffix) {
  const path = (suffix.split('?')[0] || '').replace(/\/$/, '') || '/';
  return MACRO_LIGHT_PREFIXES.some((p) => path === p || path.startsWith(`${p}?`));
}

function isMacroDebugPath(suffix) {
  const path = (suffix.split('?')[0] || '').replace(/\/$/, '') || '/';
  const lower = path.toLowerCase();
  if (lower.includes('%2e')) return true;
  if (lower.split('/').some((seg) => seg === '.' || seg === '..')) return true;
  return path === '/debug' || path.startsWith('/debug/');
}

function resolveMacrovolBase() {
  const raw = (process.env.MACROVOL_API_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
  try {
    const u = new URL(raw);
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return raw;
  } catch { /* ignore */ }
  return 'http://127.0.0.1:8765';
}

export async function registerMacrovolRoutes(fastify) {
  const MACROVOL_API_URL = resolveMacrovolBase();

  fastify.route({
    method: ['GET', 'POST', 'OPTIONS'],
    url: '/api/macrovol/*',
    handler: async (request, reply) => {
      const raw = request.url || '';
      const suffix = raw.replace(/^\/api\/macrovol/, '') || '/';
      if (isMacroDebugPath(suffix)) { reply.code(404); return { error: 'Not found' }; }
      const qErr = validateMacroQuery(suffix);
      if (qErr) { reply.code(400); return { error: 'Bad query', detail: qErr }; }
      if (!isMacroAllowed(suffix, request.method)) {
        reply.code(404);
        return { error: 'Endpoint not allowed', hint: 'Allowlisted /api/macrovol paths only' };
      }
      const isHealth = (suffix.split('?')[0] || '').replace(/\/$/, '') === '/health';
      const target = isHealth
        ? `${MACROVOL_API_URL}/health`
        : `${MACROVOL_API_URL}/api${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
      const light = request.method === 'GET' && isMacroLightPath(suffix);
      const greeksPath = (suffix.split('?')[0] || '').replace(/\/$/, '');
      const greeksHeavy = request.method === 'GET' && (greeksPath.startsWith('/greeks/') || greeksPath.startsWith('/surface/'));
      try {
        const cacheIf2xx = (d) => d && d.status >= 200 && d.status < 300;
        // P0 Fix: bounded timeouts (20s light, 30s heavy), response contracts, abort.
        const timeoutMs = greeksHeavy ? 30_000 : light ? 20_000 : 25_000;
        const loader = async () => {
          const res = await fetch(target, {
            method: request.method === 'OPTIONS' ? 'GET' : request.method,
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(timeoutMs),
          });
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('application/json') && res.ok) {
            // Enforce JSON contract
            const t = await res.text();
            const err = new Error('Upstream non-JSON');
            err.status = 502;
            err.body = { error: 'Invalid JSON from rates pipe', raw: t.slice(0, 200) };
            throw err;
          }
          const text = await res.text();
          if (text.length > 500_000) {
            const err = new Error('Upstream response too large');
            err.status = 502;
            err.body = { error: 'Upstream response exceeds size cap' };
            throw err;
          }
          let body;
          try { body = JSON.parse(text); } catch { body = { error: 'Invalid JSON from rates pipe', raw: text.slice(0, 300) }; }
          if (res.status < 200 || res.status >= 300) {
            const err = new Error(`MacroVol upstream ${res.status}`);
            err.status = res.status;
            err.body = body;
            throw err;
          }
          return { status: res.status, body };
        };
        const result = light
          ? await getOrFetch(`macrovol:${suffix}`, MACRO_LIGHT_TTL_MS, loader, { allowStaleOnError: true, cacheIf: cacheIf2xx })
          : greeksHeavy
            ? await getOrFetch(`macrovol:${suffix}`, TTL.OPTIONS_MS, loader, { allowStaleOnError: true, cacheIf: cacheIf2xx })
            : { data: await loader(), fromCache: false, ageMs: 0, stale: false };
        const { status, body } = result.data;
        reply.code(status);
        if (light || greeksHeavy) {
          reply.header('X-Cache', result.fromCache ? 'HIT' : 'MISS');
          reply.header('X-Cache-Age-Ms', String(result.ageMs ?? 0));
          if (result.stale) reply.header('X-Cache-Stale', '1');
        }
        return body;
      } catch (err) {
        if (err?.body != null && err?.status) { reply.code(err.status); return err.body; }
        reply.code(502);
        return { error: 'Rates/greeks pipe unavailable', detail: err.message || String(err), hint: `Start local rates pipe on ${MACROVOL_API_URL}` };
      }
    },
  });
}
