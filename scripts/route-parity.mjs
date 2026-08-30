#!/usr/bin/env node
/**
 * API contract gate (Phase 11) — frontend-call → backend-route parity.
 * Scans src/** for fetch("/api/...) calls and asserts each resolves to a
 * registered route pattern (pure source analysis).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const srcDir = join(root, 'src');

function walk(dir, acc = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (!['node_modules', 'test', '__tests__'].includes(f)) walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx')) {
      acc.push(p);
    }
  }
  return acc;
}

const REGISTERED = [
  '/api/health', '/api/cache/status', '/api/workflows', '/api/openapi.json',
  '/api/home/briefing', '/api/options/', '/api/yf/history/', '/api/yf/info/',
  '/api/history/spy', '/api/finnhub/quote', '/api/finnhub/news',
  '/api/alphavantage/quote', '/api/tradingview/snapshot', '/api/desk/pack',
  '/api/venues/options/', '/api/deribit/market/', '/api/deribit/instruments',
  '/api/deribit/trades/', '/api/deribit/index/', '/api/deribit/funding-history',
  '/api/deribit-market/index-price', '/api/deribit-market/instruments',
  '/api/deribit-market/tickers', '/api/deribit/', '/api/deribit-market/', '/api/free-crypto/market/',
  '/api/fmp/stable/', '/api/flashalpha/exposure/', '/api/ksa/board',
  '/api/ksa/quote/', '/api/ksa/session', '/api/macrovol/',
  '/api/boot/briefing', '/api/opra/status', '/api/opra/chain/',
  '/api/stream/quote/', '/api/auth/me', '/api/auth/login', '/api/auth/logout',
  '/api/auth/register', '/api/auth/reset-request', '/api/auth/reset-confirm',
  '/api/billing/config', '/api/billing/gate', '/api/billing/status',
  '/api/billing/checkout-session', '/api/billing/portal-session',
  '/api/stripe/webhook', '/docs/index.json', '/docs/',
];

const errors = [];
let fetches = 0;

function checkPath(path) {
  // 1. Strip query string.
  let bare = path.split('?')[0];
  // 2. Expand template-literal segments (${...}) and :params to a sample token.
  bare = bare.replace(/\$\{[^}]+\}/g, 'X').replace(/:\w+/g, 'X');
  // 3. Decode percent-encoded leftovers.
  try { bare = decodeURIComponent(bare); } catch { /* keep raw */ }
  // 4. Match: exact prefix-or-exact against any registered route.
  //    A registered route "/api/options/" matches "/api/options/X...".
  return REGISTERED.some((r) => bare === r || bare.startsWith(r));
}

for (const file of walk(srcDir)) {
  const text = readFileSync(file, 'utf8');
  const re = /fetch\([`"'`]([^`"'`]+)[`"'`]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const url = m[1];
    if (!url.startsWith('/api') && !url.startsWith('/docs')) continue;
    fetches += 1;
    if (!checkPath(url)) {
      errors.push(`${file.replace(root + '/', '')}: ${url}`);
    }
  }
}

if (errors.length) {
  console.error(`Route parity FAIL: ${errors.length} frontend fetches without a registered route (of ${fetches} scanned):`);
  for (const e of errors.slice(0, 25)) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Route parity PASS: ${fetches} frontend /api,/docs fetches all resolve to a registered route (${REGISTERED.length} routes in manifest).`);
process.exit(0);