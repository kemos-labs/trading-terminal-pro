/**
 * Required-artifact post-capture evidence gate (failure-states representative gate).
 *
 * Usage:
 *   node scripts/verify-capture-evidence.mjs [--dir e2e/screenshots] [--identity e2e/.capture-run.json] [--coverage e2e/capture-coverage.json]
 *
 * Fails (exit 1) on ANY of:
 *   - missing/unreadable identity file, or source digest changed since --write
 *   - missing screenshots directory, or zero expected pairs
 *   - a missing expected PNG+sidecar pair (expectations come ONLY from the
 *     declared coverage file — never from observed artifact counts and never
 *     from a generated manifest)
 *   - duplicate files for one expected pair
 *   - sidecar with wrong run (runId/commit mismatch) or wrong source digest
 *   - sidecar shape violation, non-finite leak, horizontal overflow > 1px,
 *     or any Axe violation recorded in the sidecar
 *
 * Archival captures from older runs (different commitShort in the filename)
 * are ignored — never retrofitted, never counted toward this run.
 * Ordinary unit tests must NOT invoke this gate; see
 * server/testing/sidecarSchema.test.js (skips on-disk scan unless
 * CAPTURE_EVIDENCE_REQUIRED=1).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeSourceDigest, DEFAULT_IDENTITY_PATH } from './capture-identity.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DEFAULT_DIR = join(ROOT, 'e2e', 'screenshots');
const DEFAULT_COVERAGE = join(ROOT, 'e2e', 'capture-coverage.json');

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const isIsoUtc = (v) => typeof v === 'string' && ISO_UTC_RE.test(v) && !Number.isNaN(Date.parse(v));

/** Shape rules mirror server/testing/sidecarSchema.test.js validateSidecar. */
export function validateSidecarStrict(sidecar) {
  const errors = [];
  if (typeof sidecar.screenshot !== 'string' || !sidecar.screenshot.endsWith('.png')) errors.push('screenshot');
  if (typeof sidecar.commit !== 'string' || !/^[0-9a-f]{40}$/.test(sidecar.commit)) errors.push('commit');
  if (typeof sidecar.commitShort !== 'string' || !/^[0-9a-f]{4,40}$/.test(sidecar.commitShort)) errors.push('commitShort');
  if (typeof sidecar.workflow !== 'string' || sidecar.workflow.length === 0) errors.push('workflow');
  if (typeof sidecar.deepLink !== 'string' || sidecar.deepLink.length === 0 || !sidecar.deepLink.startsWith('/')) errors.push('deepLink');
  if (
    !sidecar.viewport ||
    typeof sidecar.viewport.name !== 'string' ||
    sidecar.viewport.name.length === 0 ||
    !Number.isInteger(sidecar.viewport.width) ||
    sidecar.viewport.width <= 0 ||
    !Number.isInteger(sidecar.viewport.height) ||
    sidecar.viewport.height <= 0
  ) errors.push('viewport');
  if (typeof sidecar.scenario !== 'string' || sidecar.scenario.length === 0) errors.push('scenario');
  if (typeof sidecar.live !== 'boolean') errors.push('live');
  if (sidecar.live !== false) errors.push('live-must-be-false-for-fixture-capture');
  if (!isIsoUtc(sidecar.capturedAt)) errors.push('capturedAt');
  if (
    !sidecar.checks ||
    typeof sidecar.checks.horizontalOverflowPx !== 'number' ||
    !Number.isFinite(sidecar.checks.horizontalOverflowPx) ||
    typeof sidecar.checks.nonFiniteLeak !== 'boolean' ||
    !Array.isArray(sidecar.checks.axeViolations) ||
    !sidecar.checks.axeViolations.every((v) => typeof v === 'string')
  ) errors.push('checks');
  // Run/source identity is REQUIRED here (post-capture gate). The unit-test
  // schema guard keeps these optional so ordinary tests never need captures.
  if (typeof sidecar.runId !== 'string' || sidecar.runId.length === 0) errors.push('runId');
  if (typeof sidecar.sourceDigest !== 'string' || !/^[0-9a-f]{64}$/.test(sidecar.sourceDigest)) errors.push('sourceDigest');
  return errors;
}

/** Expected pair basenames from DECLARED coverage (steps x viewports). */
export function buildExpectedPairs(coverage, shortHead) {
  const pairs = [];
  for (const step of coverage.failureSteps) {
    for (const viewport of coverage.viewports) {
      const base = `fail-${shortHead}-${step.scenario}-${viewport.name}-${step.desk}`;
      pairs.push({ base, scenario: step.scenario, desk: step.desk, workflow: step.workflow, viewport: viewport.name });
    }
  }
  return pairs;
}

export function verifyEvidence({ dir, identity, coverage, checkDigest = true }) {
  const failures = [];
  if (!identity || typeof identity.runId !== 'string' || typeof identity.sourceDigest !== 'string') {
    return { ok: false, failures: ['identity file missing runId/sourceDigest (run capture:identity --write before capture)'], checked: 0 };
  }
  if (checkDigest) {
    let digest;
    try {
      ({ digest } = computeSourceDigest());
    } catch (e) {
      return { ok: false, failures: [`source digest enumeration failed (refusing pass on incomplete state): ${String(e)}`], checked: 0 };
    }
    if (digest !== identity.sourceDigest) {
      failures.push('source digest changed between pre-capture identity and post-capture validation');
    }
  }
  if (!existsSync(dir)) {
    failures.push(`screenshots directory missing: ${dir}`);
    return { ok: false, failures, checked: 0 };
  }
  const expected = buildExpectedPairs(coverage, identity.shortHead);
  if (expected.length === 0) {
    failures.push('declared coverage yields zero expected pairs (refusing vacuous pass)');
    return { ok: false, failures, checked: 0 };
  }
  let files = [];
  try {
    files = readdirSync(dir);
  } catch (e) {
    return { ok: false, failures: [`cannot list screenshots dir: ${String(e)}`], checked: 0 };
  }
  let checked = 0;
  for (const { base, scenario, desk } of expected) {
    const pngs = files.filter((f) => f === `${base}.png`);
    const jsons = files.filter((f) => f === `${base}.png.json`);
    if (pngs.length === 0) failures.push(`missing PNG: ${base}.png (scenario=${scenario} desk=${desk})`);
    if (jsons.length === 0) failures.push(`missing sidecar: ${base}.png.json (scenario=${scenario} desk=${desk})`);
    if (pngs.length > 1) failures.push(`duplicate PNGs for pair: ${base}`);
    if (jsons.length > 1) failures.push(`duplicate sidecars for pair: ${base}`);
    if (pngs.length !== 1 || jsons.length !== 1) continue;
    checked++;
    let sidecar;
    try {
      sidecar = JSON.parse(readFileSync(join(dir, `${base}.png.json`), 'utf8'));
    } catch {
      failures.push(`sidecar unparseable: ${base}.png.json`);
      continue;
    }
    const shape = validateSidecarStrict(sidecar);
    if (shape.length > 0) failures.push(`sidecar shape [${shape.join(',')}]: ${base}.png.json`);
    if (sidecar.screenshot !== `${base}.png`) failures.push(`sidecar screenshot mismatch: ${base}.png.json`);
    if (sidecar.runId !== identity.runId) failures.push(`wrong runId: ${base}.png.json (got ${String(sidecar.runId)} want ${identity.runId})`);
    if (sidecar.sourceDigest !== identity.sourceDigest) failures.push(`wrong sourceDigest: ${base}.png.json`);
    if (sidecar.commit !== identity.fullHead) failures.push(`wrong commit: ${base}.png.json`);
    if (sidecar.commitShort !== identity.shortHead) failures.push(`wrong commitShort: ${base}.png.json`);
    if (sidecar.scenario !== scenario) failures.push(`wrong scenario: ${base}.png.json`);
    if (sidecar.checks && sidecar.checks.nonFiniteLeak === true) failures.push(`non-finite leak recorded: ${base}.png.json`);
    if (sidecar.checks && Number.isFinite(sidecar.checks.horizontalOverflowPx) && sidecar.checks.horizontalOverflowPx > 1) {
      failures.push(`horizontal overflow ${sidecar.checks.horizontalOverflowPx}px: ${base}.png.json`);
    }
    if (sidecar.checks && Array.isArray(sidecar.checks.axeViolations) && sidecar.checks.axeViolations.length > 0) {
      failures.push(`axe violations [${sidecar.checks.axeViolations.join(',')}]: ${base}.png.json`);
    }
  }
  // Duplicate sweep across ALL sidecars in the dir (not just expected pairs):
  // two files claiming the same screenshot means the pair is ambiguous.
  // (Stray unparseable files are ignored here; expected sidecars that fail
  // to parse are already reported above.)
  const refCounts = new Map();
  for (const f of files.filter((f) => f.endsWith('.png.json'))) {
    try {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (typeof data.screenshot === 'string') refCounts.set(data.screenshot, (refCounts.get(data.screenshot) ?? 0) + 1);
    } catch { /* unparseable expected sidecars already reported above */ }
  }
  for (const [name, count] of [...refCounts].sort()) {
    if (count > 1) failures.push(`duplicate sidecar screenshot reference: ${name} x${count}`);
  }
  return { ok: failures.length === 0, failures, checked, expected: expected.length };
}

function parseArgs(argv) {
  let dir = DEFAULT_DIR;
  let identityPath = DEFAULT_IDENTITY_PATH;
  let coveragePath = DEFAULT_COVERAGE;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') dir = argv[++i] ?? dir;
    else if (argv[i] === '--identity') identityPath = argv[++i] ?? identityPath;
    else if (argv[i] === '--coverage') coveragePath = argv[++i] ?? coveragePath;
    else {
      console.error(`verify-capture-evidence: unexpected argument ${argv[i]}`);
      process.exit(1);
    }
  }
  return { dir, identityPath, coveragePath };
}

const invokedDirectly = process.argv[1] === new URL(import.meta.url).pathname;
if (invokedDirectly) {
  const { dir, identityPath, coveragePath } = parseArgs(process.argv.slice(2));
  if (!existsSync(identityPath)) {
    console.error(`verify-capture-evidence FAIL: missing identity ${identityPath} (run capture:identity --write before capture; historical artifacts without run identity are never accepted)`);
    process.exit(1);
  }
  let identity;
  try {
    identity = JSON.parse(readFileSync(identityPath, 'utf8'));
  } catch {
    console.error(`verify-capture-evidence FAIL: identity unparseable: ${identityPath}`);
    process.exit(1);
  }
  let coverage;
  try {
    coverage = JSON.parse(readFileSync(coveragePath, 'utf8'));
  } catch {
    console.error(`verify-capture-evidence FAIL: coverage unparseable: ${coveragePath}`);
    process.exit(1);
  }
  const result = verifyEvidence({ dir, identity, coverage, checkDigest: true });
  console.log(`capture evidence: runId=${identity.runId} checked=${result.checked}/${result.expected ?? '?'} failures=${result.failures.length}`);
  for (const f of result.failures.slice(0, 40)) console.log(`  FAIL: ${f}`);
  if (result.failures.length > 40) console.log(`  … and ${result.failures.length - 40} more`);
  process.exit(result.ok ? 0 : 1);
}
