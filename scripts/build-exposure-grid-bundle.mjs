/**
 * Build the portable server runtime bundle of the accepted shared exposure-grid
 * engine (work/exposure-grid-cycle, REF-03/04 prerequisite).
 *
 * The plain-Node server cannot import TypeScript sources. This script bundles
 * `src/lib/options/exposureGrid.ts` (+ its audited math deps, resolved
 * transitively by esbuild — no hand-written digest scope) into a single ESM
 * file the server imports at runtime. No hand-duplicated pricing formulas.
 *
 * Modes:
 *   generate (default): bundle in memory, then write outfile.
 *     node scripts/build-exposure-grid-bundle.mjs [--cwd DIR] [--outfile PATH]
 *   check (read-only): bundle in memory with write:false, byte-compare against
 *     the actual on-disk bundle (committed or untracked — works on dirty
 *     checkouts), fail closed if missing/different. Never mutates the target.
 *     node scripts/build-exposure-grid-bundle.mjs --check [--cwd DIR] [--outfile PATH]
 *
 * Any transitive source change invalidates the check because esbuild follows
 * the full import graph automatically. Timestamps and git diff are never used
 * as freshness proof (untracked files falsely pass git diff; mtimes are not
 * content proof).
 */
import { buildSync } from '../node_modules/esbuild/lib/main.js';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultRoot = join(scriptDir, '..');
const BANNER =
  '// GENERATED — do not edit. Source: src/lib/options/exposureGrid.ts + src/lib/math/*. Regenerate: node scripts/build-exposure-grid-bundle.mjs';

const args = process.argv.slice(2);
const checkMode = args.includes('--check');
function flagValue(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

const cwd = resolve(flagValue('--cwd') ?? defaultRoot);
const outfileArg = flagValue('--outfile') ?? join('server', 'services', 'exposureGrid.bundle.js');
const outfile = isAbsolute(outfileArg) ? outfileArg : join(cwd, outfileArg);
const entry = join(cwd, 'src', 'lib', 'options', 'exposureGrid.ts');

function buildText() {
  const result = buildSync({
    absWorkingDir: cwd,
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: { js: BANNER },
  });
  const out = result.outputFiles?.[0]?.text;
  if (typeof out !== 'string' || out.length === 0) {
    console.error('exposure-grid bundle build produced no output');
    process.exit(1);
  }
  return out;
}

if (checkMode) {
  if (!existsSync(outfile)) {
    console.error(`exposure-grid bundle STALE: missing ${outfile}`);
    process.exit(1);
  }
  const expected = buildText();
  const actual = readFileSync(outfile, 'utf8');
  if (actual === expected) {
    console.log('exposure-grid bundle fresh: on-disk bytes match in-memory build');
  } else {
    console.error(
      'exposure-grid bundle STALE: on-disk bytes differ from in-memory build. ' +
        'Regenerate: node scripts/build-exposure-grid-bundle.mjs',
    );
    process.exit(1);
  }
} else {
  const text = buildText();
  mkdirSync(dirname(outfile), { recursive: true });
  writeFileSync(outfile, text);
  console.log(`exposure-grid bundle written: ${outfile}`);
}
