/**
 * Academy docs delivery — fixed (Phase 1).
 * /docs/index.json previously fell through to the SPA HTML fallback, so the
 * Academy desk could never load its publication index. This module serves the
 * real index (built by api/academyCatalog.js) and allowlisted static assets
 * (markdown articles + figures) with correct content types.
 *
 * Security: path traversal blocked (resolved path must stay inside docs/);
 * extension allowlist; no directory listing; markdown is treated as untrusted
 * display content downstream.
 */
import { existsSync, statSync, createReadStream } from 'fs';
import { join, dirname, normalize, sep } from 'path';
import { fileURLToPath } from 'url';
import { academyIndexJson } from '../../api/academyCatalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = join(__dirname, '../../docs');

const MIME = {
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** Static subdirectories exposed under /docs (allowlist, no traversal). */
const STATIC_ALLOW = ['academy', 'markets', 'options', 'positioning', 'tools', 'macro'];

function safeDocsPath(raw) {
  // Decode percent-encoding first so %2e%2e cannot bypass the traversal check;
  // strip query; normalize; reject absolute/parent escapes and backslashes.
  let decoded = String(raw || '').split('?')[0];
  try { decoded = decodeURIComponent(decoded); } catch { return null; }
  const rel = decoded.replace(/^\/docs\/?/, '');
  // Reject parent-segments outright — stripping them after normalize would
  // silently allow /docs/../<target> to resolve inside docs.
  if (rel.includes('..')) return null;
  const cleaned = normalize(rel);
  if (!cleaned || cleaned.startsWith('.') || cleaned.includes('..') || cleaned.includes('\\')) return null;
  const abs = join(DOCS_ROOT, cleaned);
  if (!abs.startsWith(DOCS_ROOT + sep)) return null;
  return { rel: cleaned, abs };
}

export async function registerAcademyDocsRoutes(fastify) {
  // The one JSON contract the Academy desk boots from.
  fastify.get('/docs/index.json', async (request, reply) => {
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('cache-control', 'public, max-age=120');
    return academyIndexJson(DOCS_ROOT);
  });

  // Allowlisted static academy assets (markdown/figures) with honest content types.
  fastify.get('/docs/*', async (request, reply) => {
    const resolved = safeDocsPath(request.raw.url || '');
    if (!resolved) {
      reply.code(404);
      return { error: 'Not found' };
    }
    const top = resolved.rel.split(/[\\/]/)[0] || '';
    if (!STATIC_ALLOW.includes(top)) {
      reply.code(404);
      return { error: 'Not found' };
    }
    if (!existsSync(resolved.abs) || !statSync(resolved.abs).isFile()) {
      reply.code(404);
      return { error: 'Not found' };
    }
    const ext = resolved.abs.slice(resolved.abs.lastIndexOf('.')).toLowerCase();
    const mime = MIME[ext];
    if (!mime) {
      reply.code(415);
      return { error: 'Unsupported asset type' };
    }
    reply.header('content-type', mime);
    reply.header('cache-control', ext === '.md' ? 'public, max-age=300' : 'public, max-age=86400');
    reply.header('content-length', statSync(resolved.abs).size);
    return reply.send(createReadStream(resolved.abs));
  });
}
