#!/usr/bin/env node
/**
 * Fail if any Academy-listed post exceeds ~900 words (2–3 page budget).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAcademyIndex } from '../api/academyCatalog.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = join(root, 'docs');
const MAX = 900;
const idx = buildAcademyIndex(docsRoot);
const overs = [];

for (const c of idx.categories) {
  for (const f of c.files ?? []) {
    const abs = join(root, f.path);
    if (!existsSync(abs)) {
      overs.push({ path: f.path, err: 'missing file' });
      continue;
    }
    const w = readFileSync(abs, 'utf8').trim().split(/\s+/).filter(Boolean).length;
    if (w > MAX) overs.push({ path: f.path, words: w, title: f.title });
  }
}

if (overs.length) {
  console.error('Academy posts over word budget or missing:');
  for (const o of overs) console.error(o);
  process.exit(1);
}
console.log('OK: all listed Academy posts ≤', MAX, 'words');
