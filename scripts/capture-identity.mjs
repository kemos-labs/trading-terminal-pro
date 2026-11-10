/**
 * Pre-capture run identity: unique run ID + actual source content digest.
 *
 * Usage:
 *   node scripts/capture-identity.mjs --write [--out <path>]
 *   node scripts/capture-identity.mjs --check [--identity <path>]
 *
 * --write snapshots HEAD + a content digest of the relevant working-tree
 * source/config/lockfiles (tracked AND untracked) into e2e/.capture-run.json
 * BEFORE the browser capture runs. The E2E specs stamp every new sidecar with
 * this runId/sourceDigest at capture time. The post-capture gate
 * (scripts/verify-capture-evidence.mjs) recomputes the digest and fails when
 * the source changed between identity capture and validation.
 *
 * Digest scope (deliberately narrow — no secrets, no output artifacts, no
 * run identity):
 *   allowlisted: src/**, server/**, server.js, api/**, e2e/**,
 *     packages/contracts/**, scripts/capture-identity.mjs,
 *     scripts/verify-capture-evidence.mjs(.test.js),
 *     .github/workflows/ci.yml, playwright.*.config.ts, package.json,
 *     package-lock.json, tsconfig*.json, vite/vitest configs.
 *   never hashed: .env* / *secret* / *credential*, e2e/screenshots/**,
 *     e2e/.capture-run.json itself, docs/**, work/**, outputs/**,
 *     dist/**, node_modules/**.
 * Hashing the capture/validation script *source* is not self-reference:
 * only the identity *output* (e2e/.capture-run.json) is excluded.
 *
 * Historical PNGs are never retrofitted: sidecars written without an
 * identity file simply carry no runId and fail the post-capture gate.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
export const DEFAULT_IDENTITY_PATH = join(ROOT, 'e2e', '.capture-run.json');

const ALLOW = [
  /^src\//,
  /^server\//,
  /^server\.js$/,
  /^api\//,
  /^e2e\//,
  /^packages\/contracts\//,
  /^scripts\/capture-identity\.mjs$/,
  /^scripts\/verify-capture-evidence\.mjs$/,
  /^scripts\/verify-capture-evidence\.test\.js$/,
  /^\.github\/workflows\/ci\.yml$/,
  /^playwright\.(config|failure-states|real-server|visual)\.config\.ts$/,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^tsconfig.*\.json$/,
  /^vite\.config\..*$/,
  /^vitest\.config\..*$/,
];
const DENY = [/^e2e\/screenshots\//, /^e2e\/\.capture-run\.json$/, /(^|\/)\.env(\.|$)/, /secret/i, /credential/i];

export function isDigestRelevant(path) {
  return ALLOW.some((re) => re.test(path)) && !DENY.some((re) => re.test(path));
}

export function gitList(args) {
  const out = execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
  return out.split('\0').filter((s) => s.length > 0);
}

/**
 * Hash helper over explicit entries. `content=null` marks an actually-deleted
 * file (listed by git but absent on disk) with a tombstone so deletion
 * changes the digest instead of silently vanishing. Throws on unreadable
 * content (fail closed) — callers must not silently hash incomplete state.
 */
export function hashSortedEntries(entries) {
  const sorted = [...entries].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const hash = createHash('sha256');
  let bytes = 0;
  for (const { rel, content } of sorted) {
    if (content === null) {
      hash.update(rel);
      hash.update('\0');
      hash.update('DELETED\0');
      continue;
    }
    hash.update(rel);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
    bytes += content.length;
  }
  return { digest: hash.digest('hex'), fileCount: sorted.length, bytes };
}

/**
 * Content digest of the relevant working-tree files (tracked + untracked).
 * Fail-closed: git enumeration errors and file-read errors throw so callers
 * fail the gate instead of hashing an incomplete file set. Files listed by
 * git but absent on disk are hashed as DELETED tombstones (distinguished
 * from never-listed files) so deletions invalidate the digest.
 */
export function computeSourceDigest() {
  const tracked = gitList(['ls-files', '-z']);
  const untracked = gitList(['ls-files', '--others', '--exclude-standard', '-z']);
  const files = [...new Set([...tracked, ...untracked])].filter(isDigestRelevant).sort();
  const entries = files.map((rel) => {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) return { rel, content: null };
    let content;
    try {
      content = readFileSync(abs);
    } catch (e) {
      throw new Error(`capture-identity: cannot read relevant file ${rel}: ${String(e)}`);
    }
    return { rel, content };
  });
  const { digest, bytes } = hashSortedEntries(entries);
  const deleted = entries.filter((e) => e.content === null).length;
  return { digest, fileCount: files.length, bytes, deleted };
}

export function gitHead() {
  const full = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const short = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  return { full, short };
}

export function makeRunId(shortHead) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  return `${shortHead}-${stamp}-${randomBytes(3).toString('hex')}`;
}

function parseArgs(argv) {
  let mode = null;
  let out = DEFAULT_IDENTITY_PATH;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--write') mode = 'write';
    else if (argv[i] === '--check') mode = 'check';
    else if (argv[i] === '--out') out = argv[++i] ?? out;
    else if (argv[i] === '--identity') out = argv[++i] ?? out;
    else {
      console.error(`capture-identity: unexpected argument ${argv[i]}`);
      process.exit(1);
    }
  }
  if (!mode) {
    console.error('capture-identity: specify --write or --check');
    process.exit(1);
  }
  return { mode, out };
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { mode, out } = parseArgs(process.argv.slice(2));
  if (mode === 'write') {
    let full, short, digest, fileCount, deleted;
    try {
      ({ full, short } = gitHead());
      ({ digest, fileCount, deleted } = computeSourceDigest());
    } catch (e) {
      console.error(`capture-identity --write FAIL: ${String(e)}`);
      process.exit(1);
    }
    const identity = {
      version: 1,
      runId: makeRunId(short),
      createdAt: new Date().toISOString(),
      fullHead: full,
      shortHead: short,
      sourceDigest: digest,
      fileCount,
    };
    writeFileSync(out, JSON.stringify(identity, null, 2));
    console.log(`capture identity: runId=${identity.runId} digest=${digest.slice(0, 12)}… files=${fileCount} -> ${out}`);
  } else {
    if (!existsSync(out)) {
      console.error(`capture-identity --check: missing identity file ${out} (run capture:identity --write before capture)`);
      process.exit(1);
    }
    const identity = JSON.parse(readFileSync(out, 'utf8'));
    let full, short, digest, deleted;
    try {
      ({ full, short } = gitHead());
      ({ digest, deleted } = computeSourceDigest());
    } catch (e) {
      console.error(`capture-identity --check FAIL: ${String(e)}`);
      process.exit(1);
    }
    const problems = [];
    if (identity.fullHead !== full) problems.push(`HEAD moved: identity ${identity.fullHead} vs now ${full}`);
    if (identity.shortHead !== short) problems.push(`short HEAD moved: identity ${identity.shortHead} vs now ${short}`);
    if (identity.sourceDigest !== digest) {
      problems.push(
        'source digest changed after identity capture (relevant src/server.js/server/api/e2e/scripts/.github/config/lockfiles differ' +
          (deleted ? `; ${deleted} relevant file(s) deleted)` : ')'),
      );
    }
    if (problems.length > 0) {
      for (const p of problems) console.error(`capture-identity --check FAIL: ${p}`);
      process.exit(1);
    }
    console.log(`capture identity unchanged: runId=${identity.runId}`);
  }
}
