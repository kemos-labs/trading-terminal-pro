/**
 * Real Fastify + built-browser gate with deterministic server-side adapter
 * fixtures (E2E_FIXTURE_SCENARIO=success via providerBoundaryFixtures).
 * No browser page.route() interception: the browser traverses the built UI and
 * real Fastify routes, but provider data comes from recorded deterministic
 * fixtures stubbed at the provider boundary — not live upstreams.
 * Fixture success is deterministic state evidence, not live-provider evidence.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';

const registry = JSON.parse(
  readFileSync(new URL('../packages/contracts/src/workflows.json', import.meta.url), 'utf8'),
) as {
  workflows: Array<{ id: string; deepLink: string }>;
};
const EVIDENCE_HEAD = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const EVIDENCE_FULL_HEAD = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
// Deterministic fixture clock shared by providerBoundaryFixtures (FIXED_NOW).
const FIXTURE_CLOCK = new Date(Date.UTC(2026, 8, 1, 1, 30)).toISOString();
const EVIDENCE_DIR = new URL('./screenshots/', import.meta.url);
mkdirSync(EVIDENCE_DIR, { recursive: true });

const EXPECTED_WORKFLOWS = 27;
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

const PRIMARY_VISUAL: Record<string, string> = {
  home: '[data-testid="home-briefing"]',
  'vol-sub-surface': '[data-testid="vol-surface-matrix"]',
  'vol-sub-smile': '[data-testid="vol-smile-view"]',
  'vol-sub-term': '[data-testid="vol-term-view"]',
  'vol-sub-greeks': '[data-testid="vol-greeks10-view"]',
  'vol-sub-quality': '[data-testid="vol-surface-quality"]',
  'pos-sub-chain': '[data-testid="positioning-view"]',
  'pos-sub-tools': '[data-testid="positioning-view"]',
  'trade-sub-structure': '[data-testid="trade-structure-workflow"]',
  'trade-sub-pnl': '[data-testid="trade-pnl-workflow"]',
  'trade-sub-risk': '[data-testid="trade-hedge-workflow"]',
  'crypto-v2-overview': '[data-testid="overview-workstation"]',
  'crypto-v2-volatility': '[data-testid="volatility-workstation"]',
  'crypto-v2-positioning': '[data-testid="positioning-workstation"]',
  'crypto-v2-flow': '[data-testid="flow-workstation"]',
  'crypto-v2-carry': '[data-testid="carry-workstation"]',
  'crypto-v2-trade-risk': '[data-testid="trade-risk-workstation"]',
  'rates-mode-funding': '#sec-mm-strip',
  'rates-mode-ust': '#sec-ust-data',
  'rates-mode-stir': '[data-testid="sofr-futures-curve"]',
  'rates-mode-world': '#sec-global',
  'ksa-sub-board': '[data-testid="ksa-view"]',
  'academy-sub-start': '[data-testid="academy-root"]',
  'academy-sub-options': '[data-testid="academy-root"]',
  'academy-sub-macro': '[data-testid="academy-root"]',
  'academy-sub-news': '[data-testid="academy-root"]',
  'academy-sub-glossary': '[data-testid="academy-root"]',
};

test('runtime contracts are served by the real Fastify process', async ({ request }) => {
  const health = await request.get('/api/v1/system/health');
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toMatchObject({ schemaVersion: 1, data: { status: 'ok' } });

  const workflows = await request.get('/api/v1/workflows');
  expect(workflows.status()).toBe(200);
  const workflowBody = await workflows.json();
  expect(workflowBody.data.workflows).toHaveLength(EXPECTED_WORKFLOWS);
  expect(workflowBody.data.desks).toHaveLength(8);

  const openapi = await request.get('/api/openapi.json');
  expect(openapi.status()).toBe(200);
  const openapiBody = await openapi.json();
  expect(openapiBody).toMatchObject({ openapi: '3.1.0' });
  expect(Object.keys(openapiBody.paths).length).toBeGreaterThanOrEqual(55);

  const academy = await request.get('/docs/index.json');
  expect(academy.status()).toBe(200);
  expect(academy.headers()['content-type']).toContain('application/json');
});

test('Academy local-content success path renders without browser mocks', async ({ page }) => {
  const missingRoutes: string[] = [];
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    if ((pathname.startsWith('/api/') || pathname.startsWith('/docs/')) && response.status() === 404) {
      missingRoutes.push(pathname);
    }
  });

  await page.goto('/?desk=academy&sec=academy-sub-options', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('academy-root')).toBeVisible();
  await expect(page.getByText(/Options/i).first()).toBeVisible();
  expect(missingRoutes).toEqual([]);
});

for (const viewport of VIEWPORTS) {
  test(`all registry workflows render from successful server fixtures at ${viewport.name}`, async ({ page }) => {
    test.slow();
    await page.setViewportSize(viewport);
    const failedRoutes: string[] = [];
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('response', (response) => {
      const pathname = new URL(response.url()).pathname;
      if ((pathname.startsWith('/api/') || pathname.startsWith('/docs/')) && response.status() >= 400) {
        failedRoutes.push(`${response.status()} ${response.request().method()} ${pathname}`);
      }
    });

    for (const workflow of registry.workflows) {
      await test.step(`${workflow.id} -> ${workflow.deepLink}`, async () => {
        await page.goto(workflow.deepLink, { waitUntil: 'domcontentloaded' });
        const root = page.getByTestId(`workflow-root-${workflow.id}`);
        await expect(root).toBeVisible({ timeout: 15_000 });
        await expect(root).toHaveAttribute('data-workflow-id', workflow.id);
        await expect(page.locator(PRIMARY_VISUAL[workflow.id]).last()).toBeVisible({ timeout: 15_000 });
        const diagnostics = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          text: document.body.innerText,
        }));
        expect(diagnostics.overflow, `${workflow.id} horizontal overflow`).toBeLessThanOrEqual(1);
        expect(diagnostics.text, `${workflow.id} leaked non-finite output`).not.toMatch(/\b(?:NaN|Infinity)\b/);
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(
          axe.violations,
          `${workflow.id} WCAG violations: ${JSON.stringify(axe.violations.map((item) => item.id))}`,
        ).toEqual([]);
        const shotName = `real-${EVIDENCE_HEAD}-success-${viewport.name}-${workflow.id}.png`;
        await page.screenshot({
          path: new URL(shotName, EVIDENCE_DIR).pathname,
          fullPage: true,
        });
        // Machine-readable sidecar: exact commit, scenario, viewport, workflow,
        // provider mode, and fixture/live status travel with every screenshot.
        // Event/fetch times live in-app (provenance badges); the deterministic
        // fixture clock is recorded here so fixture evidence is never
        // mistaken for live-provider evidence.
        writeFileSync(
          new URL(`${shotName}.json`, EVIDENCE_DIR),
          JSON.stringify(
            {
              screenshot: shotName,
              commit: EVIDENCE_FULL_HEAD,
              commitShort: EVIDENCE_HEAD,
              scenario: 'success',
              viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
              workflow: workflow.id,
              deepLink: workflow.deepLink,
              providerMode: 'fixture',
              providerDetail: 'E2E_FIXTURE_SCENARIO=success stubbed at the server provider boundary; no live upstreams',
              live: false,
              fixtureClock: FIXTURE_CLOCK,
              capturedAt: new Date().toISOString(),
              checks: {
                horizontalOverflowPx: diagnostics.overflow,
                nonFiniteLeak: false,
                axeViolations: axe.violations.map((item) => item.id),
                failedRoutesSoFar: failedRoutes.length,
                pageErrorsSoFar: pageErrors.length,
                consoleErrorsSoFar: consoleErrors.length,
              },
            },
            null,
            2,
          ),
        );
      });
    }

    expect(failedRoutes).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}
