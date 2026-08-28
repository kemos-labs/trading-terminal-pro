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
  { method: ['GET'], re: /^\/health\/?$/ },
  { method: ['GET'], re: /^\/api\/rates\/sofr\/?$/ },
  { method: ['GET'], re: /^\/api\/rates\/summary\/?$/ },
  { method: ['GET'], re: /^\/api\/rates\/curve\/?$/ },
  { method: ['GET'], re: /^\/api\/rates\/shape\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/api\/rates\/term-structure\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/api\/rates\/plumbing\/?$/ },
  { method: ['GET'], re: /^\/api\/rates\/basis\/?$/ },
  { method: ['GET'], re: /^\/api\/rates\/basis-history\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/api\/rates\/curve-history\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/api\/rates\/correlations\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/api\/rates\/jgb-curve\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/api\/rates\/fx\/?$/ },
  { method: ['GET'], re: /^\/api\/rates\/auctions\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/api\/rates\/global-yields\/?$/ },
  { method: ['GET'], re: /^\/api\/rates\/global-yields\/[^\/]+\/?$/ },
  { method: ['GET'], re: /^\/api\/crypto\/spot\/?$/ },
  { method: ['GET'], re: /^\/api\/perp\/basis\/?$/ },
  { method: ['GET'], re: /^\/api\/sec\/context\/[^\/]+\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/api\/macro\/summary\/?$/ },
  { method: ['GET'], re: /^\/api\/macro\/series\/[^\/]+\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/api\/macro\/stress\/?$/ },
  { method: ['GET'], re: /^\/api\/macro\/primary\/?$/ },
  { method: ['GET'], re: /^\/api\/stir\/strip\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/api\/feed\/[^\/]+\/?$/ },
  { method: ['GET'], re: /^\/api\/surface\/[^\/]+\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/api\/surface\/[^\/]+\/preview\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/api\/greeks\/[^\/]+\/?(\?.*)?$/ },
  { method: ['GET'], re: /^\/api\/greeks\/history\/[^\/]+\/?(\?.*)?$/ },
];

function isMacroAllowed(suffix, method) {
  const path = (suffix.split('?')[0] || '').replace(/\/$/, '') || '/';
  // Allow with or without /api prefix already stripped? suffix includes /api/... after replace
  const full = path.startsWith('/api') ? path : `/api${path}`;
  // Normalize: suffix already includes /api/... because we do `/api${suffix}`
  const check = suffix.split('?')[0] || '';
  // Try both forms
  for (const rule of ALLOWED_MACROVOL) {
    if (!rule.method.includes(method) && !rule.method.includes('GET') && method !== 'GET') continue;
    if (rule.re.test(check) || rule.re.test(full)) return true;
  }
  return false;
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
      // P0 Fix: explicit allowlist, no wildcard. Reject unknown suffixes with 404.
      if (!isMacroAllowed(suffix, request.method)) {
        reply.code(404);
        return { error: 'Endpoint not allowed', hint: 'Allowlisted /api/macrovol paths only' };
      }
      const target = `${MACROVOL_API_URL}/api${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
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
