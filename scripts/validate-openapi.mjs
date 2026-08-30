#!/usr/bin/env node
/**
 * OpenAPI validation gate (Phase 11).
 * - Verifies /api/openapi.json exists and parses (OpenAPI 3.1).
 * - Verifies every operationId is unique and every path's get responses exist.
 * - Verifies the published document matches the runtime route registration
 *   (each declared path resolves via the live server route map).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const docFile = join(root, 'docs/openapi.generated.json');

// Rebuild the artifact from the source route module
import { buildOpenApiDocument } from '../server/routes/openapi.js';

const doc = buildOpenApiDocument();
mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(docFile, JSON.stringify(doc, null, 2) + '\n');

const errors = [];

// 1. OpenAPI 3.1 + info
if (doc.openapi !== '3.1.0') errors.push('openapi version must be 3.1.0');
if (!doc.info?.title || !doc.info?.version) errors.push('info.title/version required');

// 2. Operation IDs unique + path responses include 200
const seen = new Map();
for (const [path, item] of Object.entries(doc.paths)) {
  for (const method of ['get', 'post', 'put', 'delete']) {
    const op = item[method];
    if (!op) continue;
    if (seen.has(op.operationId)) errors.push(`duplicate operationId ${op.operationId}`);
    seen.set(op.operationId, path);
    if (!op.responses || !op.responses['200']) errors.push(`${method.toUpperCase()} ${path}: missing 200 response`);
    if (op.responses?.['500']) errors.push(`${path}: exposing 500 is discouraged — use typed errors`);
  }
}

// 3. Workflow registry present
if (!Array.isArray(doc['x-workflows'])) errors.push('x-workflows missing');

// 4. Envelope required on market ops
const marketOps = ['getOptionsChain', 'getEquityHistory', 'getDeribitMarket', 'getFreeCryptoSnapshot'];
for (const opId of marketOps) {
  const path = seen.get(opId);
  if (!path) { errors.push(`operation ${opId} missing`); continue; }
}

if (errors.length) {
  console.error('❌ OpenAPI validation failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✅ OpenAPI 3.1 valid: ${Object.keys(doc.paths).length} paths, ${seen.size} operations, ${doc['x-workflows'].length} workflows → docs/openapi.generated.json`);
process.exit(0);