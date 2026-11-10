import { describe, expect, it } from 'vitest';

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function isIsoUtc(value) {
  return typeof value === 'string' && ISO_UTC_RE.test(value) && !Number.isNaN(Date.parse(value));
}

export function validateSidecar(sidecar) {
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
  if (!isIsoUtc(sidecar.capturedAt)) errors.push('capturedAt');
  if (
    !sidecar.checks ||
    typeof sidecar.checks.horizontalOverflowPx !== 'number' ||
    !Number.isFinite(sidecar.checks.horizontalOverflowPx) ||
    typeof sidecar.checks.nonFiniteLeak !== 'boolean' ||
    !Array.isArray(sidecar.checks.axeViolations) ||
    !sidecar.checks.axeViolations.every((v) => typeof v === 'string')
  ) errors.push('checks');
  // Optional provenance markers emitted by the e2e specs. Validated only when
  // present so older valid sidecars without them still pass.
  if ('providerMode' in sidecar && (typeof sidecar.providerMode !== 'string' || sidecar.providerMode.length === 0)) errors.push('providerMode');
  if ('mode' in sidecar && (typeof sidecar.mode !== 'string' || sidecar.mode.length === 0)) errors.push('mode');
  if ('fixtureClock' in sidecar && !isIsoUtc(sidecar.fixtureClock)) errors.push('fixtureClock');
  if ('providerState' in sidecar && (typeof sidecar.providerState !== 'string' || sidecar.providerState.length === 0)) errors.push('providerState');
  if ('providerDetail' in sidecar && (typeof sidecar.providerDetail !== 'string' || sidecar.providerDetail.length === 0)) errors.push('providerDetail');
  // Run/source identity is OPTIONAL here so ordinary unit runs never require
  // browser captures. New captures stamp these at capture time; the
  // required-artifact post-capture CLI (scripts/verify-capture-evidence.mjs)
  // enforces their presence, exact run match, and digest freshness.
  if ('runId' in sidecar && (typeof sidecar.runId !== 'string' || sidecar.runId.length === 0)) errors.push('runId');
  if ('sourceDigest' in sidecar && (typeof sidecar.sourceDigest !== 'string' || !/^[0-9a-f]{64}$/.test(sidecar.sourceDigest))) errors.push('sourceDigest');
  return errors;
}

describe('sidecar schema guard', () => {
  it('accepts a valid representative sidecar', () => {
    const ok = {
      screenshot: 'fail-abc123-vol-stale-desktop-volatility.png',
      commit: 'a'.repeat(40),
      commitShort: 'abc123',
      workflow: 'vol-sub-surface',
      deepLink: '/?desk=vol&sec=vol-sub-surface',
      viewport: { name: 'desktop', width: 1440, height: 900 },
      scenario: 'vol-stale',
      live: false,
      capturedAt: new Date().toISOString(),
      checks: { horizontalOverflowPx: 0, nonFiniteLeak: false, axeViolations: [] },
    };
    expect(validateSidecar(ok)).toEqual([]);
  });

  it('rejects missing live flag and malformed commit', () => {
    const bad = {
      screenshot: 'fail-abc123-vol-stale-desktop-volatility.png',
      commit: 'short',
      commitShort: 'abc123',
      workflow: 'vol-sub-surface',
      deepLink: '/?desk=vol',
      viewport: { name: 'desktop', width: 1440, height: 900 },
      scenario: 'vol-stale',
      capturedAt: new Date().toISOString(),
      checks: { horizontalOverflowPx: 0, nonFiniteLeak: false, axeViolations: [] },
    };
    const errs = validateSidecar(bad);
    expect(errs).toContain('commit');
    expect(errs).toContain('live');
  });

  it('validates every fail-/real- sidecar on disk when present', async () => {
    // Ordinary unit runs MUST NOT require browser captures: required-artifact
    // enforcement is the post-capture CLI (scripts/verify-capture-evidence.mjs),
    // ordered after the E2E capture in `test:e2e:*:evidence` npm scripts and CI.
    // This on-disk scan runs only with CAPTURE_EVIDENCE_REQUIRED=1, and then it
    // must fail on a missing directory or zero sidecars (no vacuous pass).
    if (process.env.CAPTURE_EVIDENCE_REQUIRED !== '1') return;
    const { readdirSync, readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(process.cwd(), 'e2e', 'screenshots');
    expect(existsSync(dir), 'post-capture gate requires the screenshots directory').toBe(true);
    const jsons = readdirSync(dir)
      .filter((f) => f.endsWith('.json') && (f.startsWith('fail-') || f.startsWith('real-')))
      .sort();
    expect(jsons.length, 'post-capture gate requires at least one fail-/real- sidecar').toBeGreaterThan(0);
    for (const file of jsons) {
      const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      const errs = validateSidecar(data);
      expect(errs, `${file} sidecar schema: ${errs.join(',')}`).toEqual([]);
      expect(`${data.screenshot}.json`, `${file} filename matches sidecar.screenshot`).toBe(file);
      expect(existsSync(join(dir, data.screenshot)), `${file} referenced PNG exists`).toBe(true);
      if (data.mode === 'fixture' || data.providerMode === 'fixture') {
        expect(data.live, `${file} live must be false for fixture`).toBe(false);
      }
    }
  });
});
