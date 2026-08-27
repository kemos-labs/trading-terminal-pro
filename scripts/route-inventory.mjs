#!/usr/bin/env node
/**
 * Route inventory generator — Phase 1 endpoint policy inventory.
 * Scans server.js and api routes for Fastify route registrations and emits
 * docs/engineering/ROUTE_INVENTORY.md with classification and rate-limit data.
 * Classification is derived from path conventions and requireDeskAccess usage.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function scanFile(relPath) {
  const full = join(root, relPath);
  if (!existsSync(full)) return [];
  const text = readFileSync(full, 'utf8');
  const lines = text.split('\n');
  const out = [];
  const re = /(?:fastify|instance|app)\s*\.\s*(get|post|put|delete|patch|all)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  // Also detect fastify.route({ method: ['GET','POST'], url: '...' })
  const reRoute = /(?:fastify|instance|app)\s*\.\s*route\s*\(\s*\{[^}]*?method:\s*\[?[\s\S]*?url:\s*['"`]([^'"`]+)['"`]/g;
  for (let i = 0; i < lines.length; i++) {
    let m;
    const line = lines[i];
    // reset regex lastIndex per line
    const re2 = new RegExp(re.source, 'g');
    while ((m = re2.exec(line)) !== null) {
      const method = m[1].toUpperCase();
      const path = m[2];
      if (!path.startsWith('/')) continue;
      out.push({ method, path, file: relPath, line: i + 1 });
    }
    // Detect fastify.route({ method: [...], url: '...' })
    const reRoute2 = new RegExp(reRoute.source, 'g');
    let m2;
    const block = lines.slice(i, Math.min(i + 8, lines.length)).join('\n');
    while ((m2 = reRoute2.exec(block)) !== null) {
      const path = m2[1];
      if (!path.startsWith('/')) continue;
      out.push({ method: 'MULTI', path, file: relPath, line: i + 1 });
    }
  }
  return out;
}

function classify(route) {
  const p = route.path;
  if (p === '/api/stripe/webhook' || p.includes('/stripe/webhook')) return 'webhook';
  if (p.startsWith('/api/auth/')) {
    if (p.includes('register') || p.includes('login') || p.includes('reset-request') || p.includes('reset-confirm')) return 'credential-public';
    return 'authenticated';
  }
  if (p.startsWith('/api/billing/')) return 'authenticated';
  if (p.startsWith('/api/ksa/')) return 'entitled (ksa desk)';
  if (p.startsWith('/api/health') || p.startsWith('/api/boot/')) return 'public (health)';
  if (p.startsWith('/api/stream/')) return 'public (SSE)';
  if (p.startsWith('/docs')) return 'public (academy docs, allowlist)';
  if (p.startsWith('/assets') || p === '/' ) return 'static';
  if (p.startsWith('/api/')) return 'public (market data)';
  return 'public';
}

function rateLimitClass(url) {
  if (url.startsWith('/api/alphavantage') || url.startsWith('/api/tradingview')) return 'scarce (30/min)';
  if (
    url.startsWith('/api/fmp') ||
    url.startsWith('/api/finnhub') ||
    url.startsWith('/api/massive') ||
    url.startsWith('/api/flashalpha') ||
    url.startsWith('/api/desk') ||
    url.startsWith('/api/macrovol') ||
    url.startsWith('/api/backtest') ||
    url.startsWith('/api/options') ||
    url.startsWith('/api/yf') ||
    url.startsWith('/api/deribit') ||
    url.startsWith('/api/ksa') ||
    url.startsWith('/api/history')
  ) return 'upstream (120/min)';
  if (url.startsWith('/api/')) return 'global (600/min) but route-specific override may apply';
  return 'allowList (static, no throttle)';
}

const filesToScan = [
  'server.js',
  'server/app.js',
  'api/authRoutes.js',
  'api/stripeBilling.js',
  'server/routes/deribitMarket.js',
  'api/health.js',
  'api/ksaFeeds.js',
  'api/deskFeeds.js',
  'api/_shared.js',
];

let routes = [];
for (const f of filesToScan) routes = routes.concat(scanFile(f));

// Also scan all api/**/*.js for completeness (excluding tests)
function walk(dir) {
  for (const ent of readdirSync(dir)) {
    const full = join(dir, ent);
    const rel = full.replace(root + '/', '');
    if (statSync(full).isDirectory()) walk(full);
    else if (ent.endsWith('.js') && !ent.includes('.test.') && !filesToScan.includes(rel)) {
      routes = routes.concat(scanFile(rel));
    }
  }
}
walk(join(root, 'api'));

// Deduplicate by method+path (keep first file)
const seen = new Map();
for (const r of routes) {
  const k = `${r.method} ${r.path}`;
  if (!seen.has(k)) seen.set(k, r);
}
routes = [...seen.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

// Detect requireDeskAccess usage for entitled marking override
const serverText = existsSync(join(root, 'server.js')) ? readFileSync(join(root, 'server.js'), 'utf8') : '';
const entitledPaths = new Set();
for (const r of routes) {
  if (serverText.includes(`'${r.path}'`) && serverText.includes('requireDeskAccess')) {
    // heuristic: if route path appears near requireDeskAccess, mark entitled
    // Simpler: all /api/ksa/* are entitled
    if (r.path.startsWith('/api/ksa')) entitledPaths.add(`${r.method} ${r.path}`);
  }
}

const outPath = join(root, 'docs/engineering/ROUTE_INVENTORY.md');
mkdirSync(dirname(outPath), { recursive: true });

let md = `# Route Inventory — Phase 1 Baseline\n\n`;
md += `Generated: ${new Date().toISOString().slice(0, 19)}Z\n\n`;
md += `Source scan: ${filesToScan.join(', ')} plus api/** (excluding tests).\n`;
md += `Total routes: ${routes.length}\n\n`;
md += `Classification: \`public\` | \`credential-public\` | \`authenticated\` | \`entitled\` | \`webhook\` | \`health\` | \`static\`. `;
// Default deny: unregistered paths should 404 via setNotFoundHandler.\n\n`;
md += `Default: unregistered paths → 404 via \`setNotFoundHandler\` (assets/api get JSON 404, else SPA fallback). `;
md += `Rate-limit classes are enforced via @fastify/rate-limit keyGenerator with ipv6Subnet=64.\n\n`;
md += `| Method | Path | File | Classification | Rate-limit class | Notes |\n`;
md += `|---|---|---|---|---|` + `\n`;
for (const r of routes) {
  const cls = entitledPaths.has(`${r.method} ${r.path}`) ? 'entitled (ksa desk)' : classify(r);
  const rl = rateLimitClass(r.path);
  // Special case: auth credential routes have per-route 10/min override
  const notes = r.path.startsWith('/api/auth/') && (r.path.includes('register') || r.path.includes('login') || r.path.includes('reset'))
    ? 'per-route 10/min + global'
    : r.path === '/api/stripe/webhook'
      ? 'rateLimit:false, RAW body scoped to child context'
      : '';
  md += `| ${r.method} | \`${r.path}\` | \`${r.file}:${r.line}\` | ${cls} | ${rl} | ${notes} |\n`;
}
md += `\n## Policy summary\n\n`;
md += `- **Static**: \`fastifyStatic\` serves \`dist/\` (wildcard:false) + \`/docs/*\` allowlist (academy only). Assets under \`/assets/\` and \`/\` are allowListed from rate-limit.\n`;
md += `- **Health**: \`/api/health*\` and \`/api/boot/briefing\` are public but rate-limited as global.\n`;
md += `- **Auth**: credential endpoints are 10/min per-route; session cookie \`vt_session\` is HttpOnly, SameSite=Lax, Secure in prod.\n`;
md += `- **Entitled**: \`/api/ksa/*\` require active subscription when billing configured; cache-control \`private, no-store\`.\n`;
md += `- **Webhook**: \`/api/stripe/webhook\` uses encapsulated RAW body parser; signature verified via STRIPE_WEBHOOK_SECRET; replay/idempotency via Stripe event id.\n`;
md += `- **Market data**: all \`/api/fmp/*\`, \`/api/finnhub/*\`, \`/api/deribit/*\`, \`/api/macrovol/*\` are server-proxied; provider keys never reach browser.\n`;
md += `- **SSE**: \`/api/stream/quote/:symbol\` uses hijacked text/event-stream; slow-client handling is Phase 8 scope.\n`;
md += `- **Schemas**: per-route JSON Schema validation is P1 follow-up (currently params/query/body bounds via manual validateSymbol etc; response allowlisting incremental).\n`;

writeFileSync(outPath, md);
console.log(`Route inventory written to ${outPath} (${routes.length} routes)`);
