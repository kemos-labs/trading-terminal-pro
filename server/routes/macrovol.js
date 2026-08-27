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
      const target = `${MACROVOL_API_URL}/api${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
      const light = request.method === 'GET' && isMacroLightPath(suffix);
      const greeksPath = (suffix.split('?')[0] || '').replace(/\/$/, '');
      const greeksHeavy = request.method === 'GET' && (greeksPath.startsWith('/greeks/') || greeksPath.startsWith('/surface/'));
      try {
        const cacheIf2xx = (d) => d && d.status >= 200 && d.status < 300;
        const loader = async () => {
          const res = await fetch(target, {
            method: request.method === 'OPTIONS' ? 'GET' : request.method,
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(90_000),
          });
          const text = await res.text();
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
