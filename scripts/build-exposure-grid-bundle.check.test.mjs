/**
 * Freshness-check tests for scripts/build-exposure-grid-bundle.mjs.
 * Run: node --test scripts/build-exposure-grid-bundle.check.test.mjs
 *
 * All mutation attacks run in temp fixture trees via --cwd/--outfile; the
 * real app source is never mutated (fresh/read-only assertions only).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const script = join(scriptDir, 'build-exposure-grid-bundle.mjs');
const repoRoot = join(scriptDir, '..');
const node = process.execPath;

function run(args, cwd) {
  // Pass --cwd explicitly: the script pins esbuild absWorkingDir to it, so
  // output bytes are deterministic regardless of the invoking process cwd.
  const full = cwd === repoRoot ? args : [...args, '--cwd', cwd];
  try {
    const out = execFileSync(node, [script, ...full], { cwd: repoRoot, encoding: 'utf8' });
    return { exit: 0, out };
  } catch (err) {
    return { exit: err.status ?? 1, out: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'eg-bundle-'));
  mkdirSync(join(dir, 'src', 'lib', 'options'), { recursive: true });
  mkdirSync(join(dir, 'src', 'lib', 'math'), { recursive: true });
  writeFileSync(join(dir, 'src', 'lib', 'math', 'helper.ts'), 'export function helper(x: number): number { return x * 2; }\n');
  writeFileSync(
    join(dir, 'src', 'lib', 'options', 'exposureGrid.ts'),
    "import { helper } from '../math/helper.js';\nexport function buildExposureGrid(x: number): number { return helper(x); }\n",
  );
  return dir;
}

const bundleRel = join('server', 'services', 'exposureGrid.bundle.js');

describe('exposure-grid bundle --check', () => {
  it('fresh fixture passes and --check leaves bytes/mtime unchanged', () => {
    const dir = makeFixture();
    try {
      assert.equal(run([], dir).exit, 0);
      assert.equal(run(['--check'], dir).exit, 0);
      const target = join(dir, bundleRel);
      const before = readFileSync(target, 'utf8');
      const mtime = statSync(target).mtimeMs;
      assert.equal(run(['--check'], dir).exit, 0);
      assert.equal(readFileSync(target, 'utf8'), before);
      assert.equal(statSync(target).mtimeMs, mtime);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('mutating a transitive helper fails; regeneration restores validity', () => {
    const dir = makeFixture();
    try {
      assert.equal(run([], dir).exit, 0);
      assert.equal(run(['--check'], dir).exit, 0);
      writeFileSync(join(dir, 'src', 'lib', 'math', 'helper.ts'), 'export function helper(x: number): number { return x * 3; }\n');
      const stale = run(['--check'], dir);
      assert.equal(stale.exit, 1, `expected stale failure, got: ${stale.out}`);
      assert.equal(run([], dir).exit, 0);
      assert.equal(run(['--check'], dir).exit, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('mutating the entry fails; missing bundle fails', () => {
    const dir = makeFixture();
    try {
      assert.equal(run([], dir).exit, 0);
      writeFileSync(
        join(dir, 'src', 'lib', 'options', 'exposureGrid.ts'),
        "import { helper } from '../math/helper.js';\nexport function buildExposureGrid(x: number): number { return helper(x) + 1; }\n",
      );
      assert.equal(run(['--check'], dir).exit, 1);
      assert.equal(run([], dir).exit, 0);
      assert.equal(run(['--check'], dir).exit, 0);
      rmSync(join(dir, bundleRel));
      const missing = run(['--check'], dir);
      assert.equal(missing.exit, 1, `expected missing failure, got: ${missing.out}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('real tree: fresh passes read-only (no source mutation)', () => {
    const target = join(repoRoot, bundleRel);
    const before = readFileSync(target, 'utf8');
    const mtime = statSync(target).mtimeMs;
    assert.equal(run(['--check'], repoRoot).exit, 0);
    assert.equal(readFileSync(target, 'utf8'), before);
    assert.equal(statSync(target).mtimeMs, mtime);
  });
});
