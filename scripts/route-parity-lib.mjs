/**
 * Pure helpers for method-aware route parity (shared with route-parity.mjs and
 * its vitest regression tests).
 */

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function routeRegex(route) {
  const bare = route.split('?')[0];
  const parts = bare.split('/').map((segment) => {
    if (segment === '*') return '.*';
    if (segment.startsWith(':')) return '[^/]+';
    return escapeRegex(segment);
  });
  return new RegExp(`^${parts.join('/')}/?$`);
}

/** Parse an annotation into { method, path }. Bare annotations have no
 * method authority; callers may choose GET only for an options-less fetch. */
export function parsePattern(pattern) {
  const trimmed = pattern.trim();
  const m = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/.*)$/i.exec(trimmed);
  return m ? { method: m[1].toUpperCase(), path: m[2] } : { method: null, path: trimmed };
}

export function clientSample(pattern) {
  const bare = pattern.split('?')[0];
  return bare
    .replace(/\$\{[^}]+\}/g, 'X')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, 'X');
}

/** Build a method-aware compiled table from runtime (method, url) pairs. */
export function compileRuntimeRoutes(routes) {
  const out = [];
  for (const route of routes) {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      const m = String(method).toUpperCase();
      out.push({ method: m, route: route.url, regex: routeRegex(route.url) });
    }
  }
  return out;
}

/** True when `path` with `method` resolves against the compiled runtime table. */
export function resolves(compiled, pattern, explicitMethod = null) {
  const { method: patMethod, path } = parsePattern(pattern);
  const wantMethod = (explicitMethod ?? patMethod ?? 'GET').toUpperCase();
  const sample = clientSample(path);
  return compiled.some(({ method: m, regex }) => m === wantMethod && regex.test(sample));
}