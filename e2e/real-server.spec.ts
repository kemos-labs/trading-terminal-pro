/**
 * Genuine local-server smoke gate. No page.route(), request interception, or
 * provider fixture is used here. Populated provider-bound success coverage is
 * a separate recovery-plan requirement and must not be inferred from this file.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const registry = JSON.parse(
  readFileSync(new URL('../packages/contracts/src/workflows.json', import.meta.url), 'utf8'),
) as {
  workflows: Array<{ id: string; deepLink: string }>;
};

const EXPECTED_WORKFLOWS = 27;

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

test('all registry deep links resolve to their exact rendered workflow root', async ({ page }) => {
  const missingRoutes: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    if ((pathname.startsWith('/api/') || pathname.startsWith('/docs/')) && response.status() === 404) {
      missingRoutes.push(`${response.request().method()} ${pathname}`);
    }
  });

  for (const workflow of registry.workflows) {
    await test.step(`${workflow.id} -> ${workflow.deepLink}`, async () => {
      await page.goto(workflow.deepLink, { waitUntil: 'domcontentloaded' });
      const root = page.getByTestId(`workflow-root-${workflow.id}`);
      await expect(root).toBeVisible({ timeout: 15_000 });
      await expect(root).toHaveAttribute('data-workflow-id', workflow.id);
    });
  }

  expect(missingRoutes).toEqual([]);
  expect(pageErrors).toEqual([]);
});
