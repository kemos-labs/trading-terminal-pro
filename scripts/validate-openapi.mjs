#!/usr/bin/env node
/** Complete runtime/OpenAPI parity and canonical-v1 contract gate. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../server/app.js';
import { buildOpenApiDocument } from '../server/routes/openapi.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docFile = join(root, 'docs/openapi.generated.json');
const methods = ['get', 'post', 'put', 'patch', 'delete'];
const openApiPath = (runtimePath) => runtimePath
  .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')
  .replace(/\*/g, '{wildcard}');

const app = await buildServer();
let doc;
let runtimeOperations;
try {
  await app.ready();
  runtimeOperations = app.runtimeRouteManifest
    .filter((route) => (String(route.url).startsWith('/api') || String(route.url).startsWith('/docs')) && methods.includes(String(route.method).toLowerCase()))
    .map((route) => ({ method: String(route.method).toLowerCase(), path: openApiPath(String(route.url)) }));
  doc = buildOpenApiDocument(undefined, app.runtimeRouteManifest);
} finally {
  await app.close();
}

mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(docFile, `${JSON.stringify(doc, null, 2)}\n`);

const errors = [];
if (doc.openapi !== '3.1.0') errors.push('openapi version must be 3.1.0');
if (!doc.info?.title || !doc.info?.version) errors.push('info.title/version required');
if (!Array.isArray(doc['x-workflows']) || doc['x-workflows'].length === 0) errors.push('x-workflows missing');
if (!doc.components?.schemas?.V1Contracts?.$defs) errors.push('shared v1 JSON Schema component missing');

const seen = new Map();
let operationCount = 0;
for (const [path, item] of Object.entries(doc.paths ?? {})) {
  for (const method of methods) {
    const operation = item[method];
    if (!operation) continue;
    operationCount += 1;
    if (!operation.operationId) errors.push(`${method.toUpperCase()} ${path}: operationId required`);
    else if (seen.has(operation.operationId)) errors.push(`duplicate operationId ${operation.operationId}`);
    else seen.set(operation.operationId, `${method.toUpperCase()} ${path}`);
    if (!operation.responses?.['200']) errors.push(`${method.toUpperCase()} ${path}: missing 200 response`);

    if (path.startsWith('/api/v1/')) {
      if (operation.deprecated) errors.push(`${method.toUpperCase()} ${path}: canonical operation marked deprecated`);
      if (!operation.tags?.includes('v1')) errors.push(`${method.toUpperCase()} ${path}: canonical operation missing v1 tag`);
      const schema = operation.responses?.['200']?.content?.['application/json']?.schema;
      if (!schema?.$ref?.startsWith('#/components/schemas/V1Contracts/$defs/')) {
        errors.push(`${method.toUpperCase()} ${path}: canonical 200 response must reference shared strict schema`);
      }
    }
  }
}

for (const route of runtimeOperations) {
  if (!doc.paths?.[route.path]?.[route.method]) {
    errors.push(`runtime route absent from OpenAPI: ${route.method.toUpperCase()} ${route.path}`);
  }
}

const requiredV1 = [
  'v1GetHealth',
  'v1GetWorkflows',
  'v1GetOptionsChain',
  'v1GetCryptoMarket',
  'v1GetCryptoFunding',
  'v1GetCryptoTrades',
  'v1GetProviderStatus', 'v1GetRatesStir', 'v1GetRatesTermStructure',
  'v1GetCryptoCarry', 'v1GetCryptoFlow', 'v1GetAcademyIndex', 'v1GetKsaBoard',
];
for (const operationId of requiredV1) {
  if (!seen.has(operationId)) errors.push(`canonical operation missing: ${operationId}`);
}

const strictDataDefs = [
  'healthData', 'workflowsData', 'optionsData', 'optionQuote',
  'cryptoMarketData', 'cryptoInstrument', 'cryptoFundingData', 'fundingPoint',
  'cryptoTradesData', 'cryptoTrade', 'errorResponse',
  'providerStatusData', 'ratesStirData', 'ratesTermStructureData',
  'cryptoCarryData', 'cryptoFlowData', 'academyIndexData', 'ksaBoardData',
];
const definitions = doc.components?.schemas?.V1Contracts?.$defs ?? {};
for (const name of strictDataDefs) {
  const schema = definitions[name];
  if (!schema) errors.push(`v1 schema definition missing: ${name}`);
  else if (schema.type === 'object' && schema.additionalProperties !== false) {
    errors.push(`v1 schema ${name} must set additionalProperties:false`);
  }
}

if (errors.length > 0) {
  console.error('❌ OpenAPI validation failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`✅ OpenAPI 3.1 runtime parity: ${Object.keys(doc.paths).length} paths, ${operationCount} operations, ${requiredV1.length} strict v1 operations, ${doc['x-workflows'].length} workflows → docs/openapi.generated.json`);
