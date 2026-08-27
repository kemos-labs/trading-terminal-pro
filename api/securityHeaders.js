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
      connectSrc: ["'self'"],
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
  // Permissions-Policy: disable sensitive APIs — [] maps to `camera=()`
  permissionsPolicy: {
    features: {
      camera: [],
      microphone: [],
      geolocation: [],
      payment: [],
    },
  },
  // Match previous manual headers explicitly; helmet defaults cover most.
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-origin' },
};

export async function registerSecurityHeaders(fastify) {
  await fastify.register(helmet, { global: true, ...helmetOptions });
}
