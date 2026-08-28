#!/usr/bin/env node
/**
 * Bundle baseline reporter — Phase 1.
 * Reads dist/assets/*.{js,css} and reports raw + gzip sizes, totals, and budgets.
 * Budgets are aspirational targets from UPGRADE_PLAN_V2 §E; Phase 1 only records baseline.
 */
import { readdirSync, statSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { gzipSync } from 'zlib';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distAssets = join(root, 'dist/assets');
const dist = join(root, 'dist');

if (!existsSync(distAssets)) {
  console.error(`No dist/assets found at ${distAssets}. Run npm run build first.`);
  process.exit(1);
}

const budgets = {
  totalInitialJsGzip: 250 * 1024,
  initialCssGzip: 35 * 1024,
  singleChunkGzip: 180 * 1024,
  cumulativeWorkflowGzip: 350 * 1024,
};

function kb(n) { return (n / 1024).toFixed(1); }

const files = readdirSync(distAssets).filter(f => f.endsWith('.js') || f.endsWith('.css')).sort();
let totalJsRaw = 0, totalJsGzip = 0, totalCssRaw = 0, totalCssGzip = 0;
let largest = { name: '', gzip: 0 };
const rows = [];

for (const f of files) {
  const p = join(distAssets, f);
  const raw = statSync(p).size;
  const buf = readFileSync(p);
  const gz = gzipSync(buf).length;
  rows.push({ name: f, raw, gz, isJs: f.endsWith('.js') });
  if (f.endsWith('.js')) { totalJsRaw += raw; totalJsGzip += gz; }
  else { totalCssRaw += raw; totalCssGzip += gz; }
  if (gz > largest.gzip) largest = { name: f, gzip: gz };
}

rows.sort((a, b) => b.gz - a.gz);

console.log('\n=== Bundle baseline (Phase 1) ===\n');
console.log(`dist: ${dist}`);
console.log(`assets: ${files.length} files\n`);
console.log(`Chunk                                     Raw (kB)   Gzip (kB)`);
console.log(`----------------------------------------------------------------`);
for (const r of rows) {
  const flag = r.gz > budgets.singleChunkGzip ? '  ⚠ >180kB gzip' : '';
  console.log(`${r.name.padEnd(42)} ${kb(r.raw).padStart(7)}   ${kb(r.gz).padStart(7)}${flag}`);
}
console.log(`----------------------------------------------------------------`);
console.log(`Total JS: ${kb(totalJsRaw)} kB raw / ${kb(totalJsGzip)} kB gzip`);
console.log(`Total CSS: ${kb(totalCssRaw)} kB raw / ${kb(totalCssGzip)} kB gzip`);
console.log(`Largest chunk: ${largest.name} (${kb(largest.gzip)} kB gzip)`);

// Vite index.html + top-level chunks count as "initial"
const initialCandidates = rows.filter(r => r.name.startsWith('index-') || r.name === 'index.js');
let initialGzip = 0;
for (const r of initialCandidates) initialGzip += r.gz;
console.log(`\nInitial app JS (index chunk): ${kb(initialGzip)} kB gzip (budget ≤250 kB: ${initialGzip <= budgets.totalInitialJsGzip ? 'PASS' : 'OVER'})`);
// Single-chunk budget applies to EVERY JavaScript chunk, including the initial index chunk.
const jsRows = rows.filter(r => r.isJs);
const overBudget = jsRows.filter(r => r.gz > budgets.singleChunkGzip);
console.log(`Per-chunk budget (≤180 kB gzip, EVERY chunk incl. index): ${overBudget.length === 0 ? 'PASS' : 'FAIL'} — largest ${kb(largest.gzip)} kB (${largest.name})`);
for (const r of overBudget) console.log(`  ⚠ OVER: ${r.name} ${kb(r.gz)} kB gzip`);

// Overall dist size

// Overall dist size
let distTotalRaw = 0;
function walkDir(d) {
  for (const ent of readdirSync(d)) {
    const full = join(d, ent);
    const st = statSync(full);
    if (st.isDirectory()) walkDir(full);
    else distTotalRaw += st.size;
  }
}
walkDir(dist);
console.log(`\nTotal dist size: ${kb(distTotalRaw)} kB raw (${(distTotalRaw/1024/1024).toFixed(2)} MB)`);

// Enforced gate summary — exit nonzero when any budget fails.
const failures = [];
if (initialGzip > budgets.totalInitialJsGzip) failures.push(`initial JS ${kb(initialGzip)} kB gzip > ${kb(budgets.totalInitialJsGzip)} kB`);
if (overBudget.length > 0) failures.push(`${overBudget.length} chunk(s) over ${kb(budgets.singleChunkGzip)} kB gzip`);
const gate = failures.length === 0 ? 'PASS' : 'FAIL';
console.log(`\nBundle gate: ${gate}`);
for (const f of failures) console.log(`  ✗ ${f}`);
console.log('');

// Optional JSON output for CI
if (process.argv.includes('--json')) {
  const idx = process.argv.indexOf('--json');
  const outPath = process.argv[idx + 1];
  if (outPath) {
    const json = {
      generated: new Date().toISOString(),
      files: rows,
      totals: { totalJsRaw, totalJsGzip, totalCssRaw, totalCssGzip, distTotalRaw },
      budgets,
      largest,
      initialGzip,
      gate,
      failures,
    };
    writeFileSync(outPath, JSON.stringify(json, null, 2));
    console.log(`JSON written to ${outPath}`);
  }
}

// Nonzero exit when any enforced budget fails (CI / orchestrator gates).
if (failures.length > 0) process.exit(1);
