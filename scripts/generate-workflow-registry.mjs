#!/usr/bin/env node
/**
 * Validate the canonical workflow registry and publish its deterministic docs
 * artifact. packages/contracts/src/workflows.json is the only data authority;
 * UI navigation, OpenAPI, MCP, and E2E must consume that file or this exact copy.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(root, 'packages', 'contracts', 'src', 'workflows.json');
const outputPath = join(root, 'docs', 'registry', 'workflows.json');
const checkOnly = process.argv.includes('--check');

function fail(message) {
  console.error(`workflow registry: ${message}`);
  process.exit(1);
}

let registry;
try {
  registry = JSON.parse(readFileSync(sourcePath, 'utf8'));
} catch (error) {
  fail(`cannot parse ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
}

if (registry.version !== 1) fail('version must be 1');
if (!Array.isArray(registry.desks) || registry.desks.length !== 8) {
  fail('desks must contain the eight top-level desks');
}
if (!Array.isArray(registry.workflows) || registry.workflows.length === 0) {
  fail('workflows must be a non-empty array');
}

const deskIds = new Set();
const hotkeys = new Set();
for (const desk of registry.desks) {
  for (const field of ['id', 'label', 'hotkey', 'defaultWorkflowId']) {
    if (typeof desk[field] !== 'string' || !desk[field].trim()) {
      fail(`desk ${JSON.stringify(desk)} has invalid ${field}`);
    }
  }
  if (deskIds.has(desk.id)) fail(`duplicate desk id ${desk.id}`);
  if (hotkeys.has(desk.hotkey)) fail(`duplicate desk hotkey ${desk.hotkey}`);
  deskIds.add(desk.id);
  hotkeys.add(desk.hotkey);
}

const workflowIds = new Set();
const deepLinks = new Set();
for (const workflow of registry.workflows) {
  for (const field of ['id', 'desk', 'title', 'purpose', 'deepLink', 'code']) {
    if (typeof workflow[field] !== 'string' || !workflow[field].trim()) {
      fail(`workflow ${JSON.stringify(workflow)} has invalid ${field}`);
    }
  }
  if (!deskIds.has(workflow.desk)) fail(`${workflow.id} references unknown desk ${workflow.desk}`);
  if (!Array.isArray(workflow.apiOps) || !workflow.apiOps.every((v) => typeof v === 'string')) {
    fail(`${workflow.id}.apiOps must be string[]`);
  }
  if (!Array.isArray(workflow.mcpTools) || !workflow.mcpTools.every((v) => typeof v === 'string')) {
    fail(`${workflow.id}.mcpTools must be string[]`);
  }
  if (workflowIds.has(workflow.id)) fail(`duplicate workflow id ${workflow.id}`);
  if (deepLinks.has(workflow.deepLink)) fail(`duplicate deep link ${workflow.deepLink}`);
  workflowIds.add(workflow.id);
  deepLinks.add(workflow.deepLink);

  let url;
  try {
    url = new URL(workflow.deepLink, 'http://terminal.local');
  } catch {
    fail(`${workflow.id} has invalid deep link ${workflow.deepLink}`);
  }
  if (url.origin !== 'http://terminal.local' || url.pathname !== '/') {
    fail(`${workflow.id} deep link must be an application-relative root URL`);
  }
  if (url.searchParams.get('desk') !== workflow.desk) {
    fail(`${workflow.id} deep link desk does not match ${workflow.desk}`);
  }
}

for (const desk of registry.desks) {
  const defaultWorkflow = registry.workflows.find((workflow) => workflow.id === desk.defaultWorkflowId);
  if (!defaultWorkflow || defaultWorkflow.desk !== desk.id) {
    fail(`${desk.id}.defaultWorkflowId must reference a workflow on the same desk`);
  }
}

const artifact = `${JSON.stringify({
  ...registry,
  generatedFrom: 'packages/contracts/src/workflows.json',
}, null, 2)}\n`;
const current = (() => {
  try { return readFileSync(outputPath, 'utf8'); } catch { return ''; }
})();

if (checkOnly) {
  if (current !== artifact) fail(`artifact is stale; run npm run generate:workflows`);
  console.log(`workflow registry: PASS (${registry.desks.length} desks, ${registry.workflows.length} workflows)`);
  process.exit(0);
}

mkdirSync(dirname(outputPath), { recursive: true });
if (current !== artifact) writeFileSync(outputPath, artifact);
console.log(`workflow registry: ${registry.workflows.length} entries → ${outputPath}`);
