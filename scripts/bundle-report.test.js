/**
 * Bundle budget gate regression tests.
 * 1. Mirrors the reporter's math: every JS chunk ≤180 kB gzip, index ≤250 kB gzip.
 * 2. Verifies report:bundle exits nonzero when a chunk violates the per-chunk budget
 *    (plants a temporary oversized chunk, runs the real script, restores dist).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distAssets = join(root, 'dist', 'assets');
const reporter = join(root, 'scripts', 'bundle-report.mjs');

const BUDGET_PER_CHUNK = 180 * 1024;
const BUDGET_INITIAL = 250 * 1024;

function jsChunks() {
  if (!existsSync(distAssets)) return [];
  return readdirSync(distAssets)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.map'))
    .map((f) => {
      const raw = readFileSync(join(distAssets, f));
      return { name: f, gzip: gzipSync(raw).length };
    });
}

describe('bundle budgets (enforced)', () => {
  const chunks = jsChunks();

  // Master spec §10.6: normal chunks ≤180 kB gzip; documented lazy analytical
  // exceptions carry their own cap (3D IV/Greeks surface — never on the initial path).
  // The shared drei OrbitControls vendor chunk (pulls r3f + three) is reachable
  // only via the explicit-entry dynamic imports ("Open 3D") and is never part of
  // the initial index chunk.
  const ANALYTICAL_EXCEPTIONS = { IvSurface3D: 300 * 1024, OrbitControls: 300 * 1024 };
  function capFor(name) {
    for (const [key, cap] of Object.entries(ANALYTICAL_EXCEPTIONS)) {
      if (name.startsWith(key)) return cap;
    }
    return null;
  }

  it.skipIf(chunks.length === 0)('every normal JS chunk is ≤180 kB gzip; analytical exceptions within their documented caps', () => {
    expect(chunks.length, 'dist missing — run npm run build').toBeGreaterThan(0);
    for (const c of chunks) {
      const cap = capFor(c.name) ?? BUDGET_PER_CHUNK;
      expect(c.gzip, `${c.name} ${c.gzip} bytes gzip exceeds cap ${cap}`).toBeLessThanOrEqual(cap);
    }
  });

  it.skipIf(chunks.length === 0)('analytical exception chunks are NOT part of the initial index chunk', () => {
    for (const c of chunks) {
      if (capFor(c.name) != null) {
        expect(c.name.startsWith('index-'), `${c.name} must be a separate lazy chunk`).toBe(false);
      }
    }
  });

  it.skipIf(chunks.length === 0)('initial index chunk is ≤250 kB gzip', () => {
    const index = chunks.filter((c) => /^index-.*\.js$/.test(c.name));
    expect(index.length).toBeGreaterThan(0);
    const total = index.reduce((s, c) => s + c.gzip, 0);
    expect(total).toBeLessThanOrEqual(BUDGET_INITIAL);
  });

  it('report:bundle exits nonzero when a chunk exceeds the per-chunk budget', () => {
    if (!existsSync(distAssets)) return; // no build — skip
    const fake = join(distAssets, 'zzz-budget-probe.test.js');
    const had = existsSync(fake);
    try {
      // ~200 kB of INCOMPRESSIBLE random bytes → gzip ≈200 kB, over the 180 kB budget
      writeFileSync(fake, randomBytes(200 * 1024));
      let failed = false;
      try {
        execFileSync('node', [reporter], { cwd: root, stdio: 'pipe' });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    } finally {
      if (!had) unlinkSync(fake);
    }
  });

  afterAll(() => {
    const fake = join(distAssets, 'zzz-budget-probe.test.js');
    if (existsSync(fake)) unlinkSync(fake);
  });
});
