/**
 * MacroVol proxy routes — forwards /api/macrovol/* → local FastAPI on :8766.
 * Loopback-only, SSRF-safe. Lightweight paths are shared-cached.
 */
import { getOrFetch, TTL } from '../../api/upstreamCache.js';
import { resolveRatesWorkerUrl } from '../ratesWorkerUrl.js';

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
  { method: ['GET'], re: new RegExp('^/api/crypto/perp-basis/?$') },
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
  { method: ['GET'], re: new RegExp('^/api/greeks/[^/]+/history/?(\\?.*)?$') },
];

export function isMacroAllowed(suffix, method) {
  const check = (suffix.split('?')[0] || '').replace(/\/$/, '') || '/';
  const pathForFull = check.startsWith('/api') ? check : `/api${check}`;
  for (const rule of ALLOWED_MACROVOL) {
    if (!rule.method.includes(method)) continue;
    if (rule.re.test(check) || rule.re.test(pathForFull)) return true;
  }
  return false;
}

/** Per-route allowed query keys — exactly matching FastAPI handlers (prevents cache-cardinality abuse). */
const ROUTE_QUERY_ALLOW = [
  { re: /^\/health\/?$/, allow: new Set() },
  { re: /^\/api\/rates\/sofr\/?$/, allow: new Set() },
  { re: /^\/api\/rates\/summary\/?$/, allow: new Set() },
  { re: /^\/api\/rates\/curve\/?$/, allow: new Set() },
  { re: /^\/api\/rates\/shape\/?$/, allow: new Set(['history']) },
  { re: /^\/api\/rates\/term-structure\/?$/, allow: new Set(['T']) },
  { re: /^\/api\/rates\/plumbing\/?$/, allow: new Set() },
  { re: /^\/api\/rates\/basis\/?$/, allow: new Set() },
  { re: /^\/api\/rates\/basis-history\/?$/, allow: new Set(['limit']) },
  { re: /^\/api\/rates\/curve-history\/?$/, allow: new Set(['periods']) },
  { re: /^\/api\/rates\/correlations\/?$/, allow: new Set(['window','period']) },
  { re: /^\/api\/rates\/jgb-curve\/?$/, allow: new Set(['compare_days']) },
  { re: /^\/api\/rates\/fx\/?$/, allow: new Set() },
  { re: /^\/api\/rates\/auctions\/?$/, allow: new Set(['limit']) },
  { re: /^\/api\/rates\/global-yields\/?$/, allow: new Set() },
  { re: /^\/api\/rates\/global-yields\/[^/]+\/?$/, allow: new Set() },
  { re: /^\/api\/crypto\/spot\/?$/, allow: new Set() },
  { re: /^\/api\/crypto\/perp-basis\/?$/, allow: new Set() },
  { re: /^\/api\/sec\/context\/[^/]+\/?$/, allow: new Set(['limit']) },
  { re: /^\/api\/macro\/summary\/?$/, allow: new Set() },
  { re: /^\/api\/macro\/series\/[^/]+\/?$/, allow: new Set(['limit']) },
  { re: /^\/api\/macro\/stress\/?$/, allow: new Set() },
  { re: /^\/api\/macro\/primary\/?$/, allow: new Set() },
  { re: /^\/api\/stir\/strip\/?$/, allow: new Set() },
  { re: /^\/api\/feed\/[^/]+\/?$/, allow: new Set() },
  { re: /^\/api\/surface\/[^/]+\/?$/, allow: new Set(['r','q','strike_range']) },
  { re: /^\/api\/surface\/[^/]+\/preview\/?$/, allow: new Set(['r','q']) },
  { re: /^\/api\/greeks\/[^/]+\/?$/, allow: new Set(['r','q']) },
  { re: /^\/api\/greeks\/[^/]+\/history\/?$/, allow: new Set(['period']) },
];
function allowedKeysForPath(path) {
  const clean = (path.split('?')[0] || '').replace(/\/$/, '') || '/';
  const full = clean.startsWith('/api') ? clean : `/api${clean}`;
  for (const { re, allow } of ROUTE_QUERY_ALLOW) if (re.test(clean) || re.test(full)) return allow;
  return null;
}
/** Validate query params are bounded — prevent unbounded cache keys. Returns null on ok, or { error, normalized } */
export function validateMacroQuery(suffix) {
  const qIdx = suffix.indexOf('?');
  if (qIdx === -1) return { error: null, normalized: suffix };
  const path = suffix.slice(0, qIdx);
  const qs = suffix.slice(qIdx + 1);
  // Catch malformed percent-encoding before URLSearchParams throws — return 400 not 500
  try { decodeURIComponent(qs); } catch { return { error: 'malformed percent encoding', normalized: null }; }
  const allow = allowedKeysForPath(path);
  if (allow === null) return { error: 'unknown route', normalized: null };
  // Duplicate-key detection: raw string search before URLSearchParams dedupes
  const rawPairs = qs.split('&').filter(Boolean);
  const seen = new Set();
  for (const pair of rawPairs) {
    let k;
    try { k = decodeURIComponent(pair.split('=')[0] || '').trim(); } catch { return { error: 'malformed percent encoding', normalized: null }; }
    if (!k) return { error: 'empty query key', normalized: null };
    if (seen.has(k)) return { error: `duplicate param ${k}`, normalized: null };
    seen.add(k);
    if (!allow.has(k)) return { error: `unknown param ${k}`, normalized: null };
  }
  let params;
  try { params = new URLSearchParams(qs); } catch { return { error: 'malformed percent encoding', normalized: null }; }
  for (const [k, v] of params) {
    if (v.length > 32) return { error: `param ${k} too long`, normalized: null };
    if (k === 'ticker' || k === 'symbol') {
      if (!/^[A-Za-z0-9.\-=^]{1,16}$/.test(v)) return { error: `invalid ticker ${v}`, normalized: null };
    }
    if (k === 'limit') {
      const n = Number(v);
      const max = path.includes('/auctions') ? 50 : path.includes('/sec/context') ? 20 : path.includes('/rates/basis-history') ? 400 : path.includes('/macro/series') ? 2000 : 2000;
      if (!Number.isInteger(n) || n < (path.includes('/rates/basis-history') ? 30 : 1) || n > max) return { error: 'limit out of bounds', normalized: null };
    }
    if (k === 'history') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 10 || n > 260) return { error: 'history out of bounds', normalized: null };
    }
    if (k === 'strike_range') {
      const n = Number(v);
      if (!isFinite(n) || n <= 0 || n > 1) return { error: 'strike_range out of bounds', normalized: null };
    }
    if (k === 'r' || k === 'q' || k === 'T' || k === 'strike_range') {
      const canonical = Number(v);
      if (!Number.isFinite(canonical)) return { error: `${k} out of bounds`, normalized: null };
    }
    if (k === 'r' || k === 'q') {
      const n = Number(v);
      if (!isFinite(n) || n < -0.5 || n > 2) return { error: 'rate out of bounds', normalized: null };
    }
    if (k === 'T') {
      const n = Number(v);
      if (!isFinite(n) || n < 0.01 || n > 40) return { error: 'T out of bounds', normalized: null };
    }
    if (k === 'window') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 5 || n > 252) return { error: 'window out of bounds', normalized: null };
    }
    if (k === 'compare_days') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 30 || n > 800) return { error: 'compare_days out of bounds', normalized: null };
    }
    if (k === 'period') {
      const ALLOWED_PERIODS = new Set(['1d','5d','1mo','3mo','6mo','1y','2y','5y','10y','ytd','max']);
      if (!ALLOWED_PERIODS.has(v)) return { error: `invalid period ${v}`, normalized: null };
    }
    if (k === 'periods') {
      // Curve-history: 1W/1M/3M/6M/1Y/2Y or Nd (7-800 days) — strict
      if (!/^(1W|1M|3M|6M|1Y|2Y)$/.test(v) && !/^(\d+)d$/i.test(v)) return { error: `invalid periods ${v}`, normalized: null };
      if (/^(\d+)d$/i.test(v)) {
        const n = parseInt(v, 10);
        if (!Number.isFinite(n) || n < 7 || n > 800) return { error: `periods out of bounds ${v}`, normalized: null };
      }
      if (v === 'garbage') return { error: `invalid periods ${v}`, normalized: null };
    }
  }
  // Normalize: sort keys alphabetically for stable cache key (prevents cardinality abuse via ordering)
  const sorted = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const canonicalEntries = sorted.map(([k, v]) => {
    if (['r','q','T','strike_range','limit','history','window','compare_days'].includes(k) && v.trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return [k, String(n)];
    }
    return [k, v];
  });
  const normalizedQs = new URLSearchParams(canonicalEntries).toString();
  const normalized = normalizedQs ? `${path}?${normalizedQs}` : path;
  return { error: null, normalized };
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
  // Deprecated alias path — canonical resolution lives in ratesWorkerUrl.js.
  return resolveRatesWorkerUrl();
}

export async function registerMacrovolRoutes(fastify) {
  const MACROVOL_API_URL = resolveMacrovolBase();

  fastify.route({
    method: ['GET', 'POST', 'OPTIONS'],
    url: '/api/macrovol/*',
    handler: async (request, reply) => {
      const raw = request.url || '';
      const rawSuffix = raw.replace(/^\/api\/macrovol/, '') || '/';
      if (isMacroDebugPath(rawSuffix)) { reply.code(404); return { error: 'Not found' }; }
      const v = validateMacroQuery(rawSuffix);
      if (v.error) { reply.code(400); return { error: 'Bad query', detail: v.error }; }
      const suffix = v.normalized || rawSuffix;
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
