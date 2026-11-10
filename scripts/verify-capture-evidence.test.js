/**
 * Focused negative tests for the required-artifact post-capture gate.
 * All cases use throwaway temp dirs (never e2e/screenshots, never the real
 * identity file), so ordinary unit runs need no browser captures.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  buildExpectedPairs,
  validateSidecarStrict,
  verifyEvidence,
} from './verify-capture-evidence.mjs';
import {
  computeSourceDigest,
  gitList,
  hashSortedEntries,
  isDigestRelevant,
} from './capture-identity.mjs';

const TINY_COVERAGE = {
  viewports: [{ name: 'desktop', width: 1440, height: 900 }],
  failureSteps: [
    { scenario: 'home-partial', desk: 'home', workflow: 'home', deepLink: '/?desk=home' },
    { scenario: 'vol-stale', desk: 'volatility', workflow: 'vol-sub-surface', deepLink: '/?desk=vol&sec=vol-sub-surface' },
  ],
};

const IDENTITY = {
  runId: 'abc123-20260910T120000Z-aa11bb',
  sourceDigest: 'a'.repeat(64),
  fullHead: 'a'.repeat(40),
  shortHead: 'abc123',
};

function goodSidecar(base, step, overrides = {}) {
  return {
    screenshot: `${base}.png`,
    commit: IDENTITY.fullHead,
    commitShort: IDENTITY.shortHead,
    runId: IDENTITY.runId,
    sourceDigest: IDENTITY.sourceDigest,
    workflow: step.workflow,
    scenario: step.scenario,
    deepLink: step.deepLink,
    viewport: { name: 'desktop', width: 1440, height: 900 },
    live: false,
    capturedAt: new Date().toISOString(),
    checks: { horizontalOverflowPx: 0, nonFiniteLeak: false, axeViolations: [] },
    ...overrides,
  };
}

function setupDir(mutator) {
  const dir = mkdtempSync(join(tmpdir(), 'capture-evidence-'));
  const expected = buildExpectedPairs(TINY_COVERAGE, IDENTITY.shortHead);
  for (const pair of expected) {
    const step = TINY_COVERAGE.failureSteps.find((s) => s.scenario === pair.scenario && s.desk === pair.desk);
    const sidecar = goodSidecar(pair.base, step);
    if (mutator) mutator(pair, sidecar);
    if (sidecar !== null) {
      writeFileSync(join(dir, `${pair.base}.png`), Buffer.from([137, 80, 78, 71]));
      writeFileSync(join(dir, `${pair.base}.png.json`), JSON.stringify(sidecar));
    }
  }
  return dir;
}

const verify = (dir, identity = IDENTITY) =>
  verifyEvidence({ dir, identity, coverage: TINY_COVERAGE, checkDigest: false });

describe('capture evidence gate', () => {
  it('derives 52 expected pairs from the declared representative coverage', async () => {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'e2e', 'capture-coverage.json'), 'utf8'));
    expect(raw.failureSteps).toHaveLength(13);
    expect(raw.viewports).toHaveLength(4);
    expect(buildExpectedPairs(raw, 'abc123')).toHaveLength(52);
  });

  it('passes a complete valid pair set', () => {
    const result = verify(setupDir());
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('fails a missing screenshots directory', () => {
    const result = verify(join(tmpdir(), 'capture-evidence-does-not-exist-xyz'));
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/directory missing/);
  });

  it('fails zero pairs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capture-evidence-empty-'));
    const result = verify(dir);
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/missing PNG/);
  });

  it('fails a missing expected pair', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capture-evidence-miss-'));
    // Only the first of two expected pairs is present.
    const pair = buildExpectedPairs(TINY_COVERAGE, IDENTITY.shortHead)[0];
    const step = TINY_COVERAGE.failureSteps[0];
    writeFileSync(join(dir, `${pair.base}.png`), Buffer.from([1]));
    writeFileSync(join(dir, `${pair.base}.png.json`), JSON.stringify(goodSidecar(pair.base, step)));
    const result = verify(dir);
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/missing PNG|missing sidecar/);
  });

  it('fails wrong runId and wrong sourceDigest', () => {
    const wrongRun = verify(setupDir((pair, sidecar) => {
      sidecar.runId = 'deadbeef-20200101T000000Z-000000';
    }));
    expect(wrongRun.ok).toBe(false);
    expect(wrongRun.failures.join('\n')).toMatch(/wrong runId/);

    const wrongDigest = verify(setupDir((pair, sidecar) => {
      sidecar.sourceDigest = 'b'.repeat(64);
    }));
    expect(wrongDigest.ok).toBe(false);
    expect(wrongDigest.failures.join('\n')).toMatch(/wrong sourceDigest/);
  });

  it('fails non-finite, overflow, and axe problems recorded in sidecars', () => {
    for (const [label, patch, pattern] of [
      ['nonfinite', { checks: { horizontalOverflowPx: 0, nonFiniteLeak: true, axeViolations: [] } }, /non-finite/],
      ['overflow', { checks: { horizontalOverflowPx: 12, nonFiniteLeak: false, axeViolations: [] } }, /overflow/],
      ['axe', { checks: { horizontalOverflowPx: 0, nonFiniteLeak: false, axeViolations: ['color-contrast'] } }, /axe/],
    ]) {
      const result = verify(setupDir((pair, sidecar) => Object.assign(sidecar, patch)));
      expect(result.ok, label).toBe(false);
      expect(result.failures.join('\n'), label).toMatch(pattern);
    }
  });

  it('fails sidecars missing run identity (historical artifacts are never accepted)', () => {
    const result = verify(setupDir((pair, sidecar) => {
      delete sidecar.runId;
      delete sidecar.sourceDigest;
    }));
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/runId|sourceDigest/);
  });

  it('fails duplicate sidecar references to one screenshot', () => {
    const dir = setupDir();
    const pair = buildExpectedPairs(TINY_COVERAGE, IDENTITY.shortHead)[0];
    const step = TINY_COVERAGE.failureSteps[0];
    writeFileSync(join(dir, `stray-copy.png.json`), JSON.stringify(goodSidecar(pair.base, step)));
    const result = verify(dir);
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/duplicate/);
  });

  it('strict shape rejects malformed sidecars', () => {
    expect(validateSidecarStrict({})).not.toEqual([]);
    expect(validateSidecarStrict(goodSidecar('fail-abc123-home-partial-desktop-home', TINY_COVERAGE.failureSteps[0]))).toEqual([]);
  });
});

describe('capture identity roundtrip', () => {
  it('write then check passes; tampered digest fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capture-identity-'));
    mkdirSync(dir, { recursive: true });
    const out = join(dir, 'run.json');
    execFileSync('node', ['scripts/capture-identity.mjs', '--write', '--out', out], { encoding: 'utf8' });
    const check = execFileSync('node', ['scripts/capture-identity.mjs', '--check', '--identity', out], { encoding: 'utf8' });
    expect(check).toMatch(/unchanged/);
    const tampered = { ...JSON.parse(readFileSync(out, 'utf8')), sourceDigest: 'f'.repeat(64) };
    writeFileSync(out, JSON.stringify(tampered));
    let failed = false;
    try {
      execFileSync('node', ['scripts/capture-identity.mjs', '--check', '--identity', out], { encoding: 'utf8', stdio: 'pipe' });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});

describe('capture identity digest scope (HIGH gap regression)', () => {
  it('covers capture/validation scripts, CI workflow, root backend and config inputs', () => {
    for (const p of [
      'scripts/capture-identity.mjs',
      'scripts/verify-capture-evidence.mjs',
      'scripts/verify-capture-evidence.test.js',
      '.github/workflows/ci.yml',
      'server.js',
      'api/health.js',
      'src/components/views/OptionChain.tsx',
      'server/testing/sidecarSchema.test.js',
      'e2e/capture-coverage.json',
      'package.json',
    ]) {
      expect(isDigestRelevant(p), p).toBe(true);
    }
  });

  it('never hashes secrets, generated outputs, screenshots, or run identity', () => {
    for (const p of [
      '.env',
      'server/.env.local',
      'api/stripeSecret-helper.js',
      'src/credential-store.js',
      'e2e/screenshots/fail-abc123-x.png',
      'e2e/.capture-run.json',
      'docs/notes.md',
      'work/report.md',
      'outputs/plan.md',
      'dist/bundle.js',
    ]) {
      expect(isDigestRelevant(p), p).toBe(false);
    }
  });

  it('distinguishes deleted files: tombstone digest differs from silent omission', () => {
    const content = Buffer.from('hello');
    const withFile = hashSortedEntries([{ rel: 'api/a.js', content }]);
    const omitted = hashSortedEntries([]);
    const deleted = hashSortedEntries([{ rel: 'api/a.js', content: null }]);
    expect(deleted.digest).not.toBe(withFile.digest);
    expect(deleted.digest).not.toBe(omitted.digest);
    expect(deleted.fileCount).toBe(1);
  });

  it('digests the capture/validation scripts regardless of git index state', () => {
    // Status-independent invariant (the old version asserted the writer scripts
    // were *untracked*, which was true only before they were committed — CI runs
    // them, so they are tracked now; the premise, not the digest, was wrong).
    // Re-derive the digest file set exactly as capture-identity.mjs does: union
    // of tracked + untracked, relevance-filtered. This must hold whether the
    // scripts are staged, committed, or freshly copied into a clean checkout.
    const tracked = gitList(['ls-files', '-z']);
    const untracked = gitList(['ls-files', '--others', '--exclude-standard', '-z']);
    const digested = [...new Set([...tracked, ...untracked])].filter(isDigestRelevant);
    for (const script of [
      'scripts/capture-identity.mjs',
      'scripts/verify-capture-evidence.mjs',
      'scripts/verify-capture-evidence.test.js',
    ]) {
      expect(digested, `${script} must be in the digest set`).toContain(script);
      expect(isDigestRelevant(script)).toBe(true);
    }
    // Untracked files that are digest-relevant (e.g. a new writer script copied
    // into a clean tree before git add) are digested too — that is the property
    // the original test was reaching for.
    expect(untracked.filter(isDigestRelevant).every((rel) => digested.includes(rel))).toBe(true);
    const { digest, fileCount } = computeSourceDigest();
    expect(/^[0-9a-f]{64}$/.test(digest)).toBe(true);
    expect(fileCount).toBeGreaterThan(465);
    expect(fileCount).toBe(digested.length);
  });

  it('verifyEvidence with checkDigest fails on stale identity digest (fail-closed)', () => {
    const dir = setupDir();
    const result = verifyEvidence({ dir, identity: IDENTITY, coverage: TINY_COVERAGE, checkDigest: true });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/source digest changed/);
  });
});
