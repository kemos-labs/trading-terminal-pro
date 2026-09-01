import helmet from '@fastify/helmet';

/**
 * Centralized security headers via @fastify/helmet.
 * Replaces the manual onSend hook that set a subset of headers.
 * CSP is intentionally minimal but compatible with Vite build + Google Fonts.
 */
export const helmetOptions = {
  // CSP: allow self, inline styles (Vite + index.html shell), Google Fonts
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // Vite injects <style> tags and index.html has inline <style> shell
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      // The document preconnects to the same two fixed Google Fonts origins
      // already allowlisted by styleSrc/fontSrc. Without these entries the
      // browser reports a CSP error before the stylesheet request.
      connectSrc: ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
      frameAncestors: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      // upgradeInsecureRequests handled by HSTS at TLS edge; don't force here
    },
  },
  // HSTS at TLS edge — Render/Railway terminate TLS; header ignored over HTTP per RFC 6797
  hsts: {
    maxAge: 15552000, // 180 days
    includeSubDomains: false,
    preload: false,
  },
  referrerPolicy: { policy: 'no-referrer' },
  // Permissions-Policy: helmet 8.x does not ship this middleware, so we set
  // it manually via onSend hook below. Keep options here for forwards-compat
  // when @fastify/helmet re-adds the middleware.
  // Match previous manual headers explicitly; helmet defaults cover most.
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-origin' },
};

export async function registerSecurityHeaders(fastify) {
  await fastify.register(helmet, { global: true, ...helmetOptions });
  // Helmet 8.x has no Permissions-Policy middleware — set it explicitly to
  // preserve the prior manual hardening (camera/microphone/geolocation off).
  fastify.addHook('onSend', async (_request, reply, payload) => {
    // Only set if not already present (allows tests to override per-route).
    if (!reply.hasHeader('permissions-policy')) {
      reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    }
    return payload;
  });
}
