/**
 * Genuine local-server smoke gate. No page.route(), request interception, or
 * provider fixture is used here. Populated provider-bound success coverage is
 * a separate recovery-plan requirement and must not be inferred from this file.
 */
import { test, expect } from '@playwright/test';

const EXPECTED_WORKFLOWS = 27;

test('runtime contracts are served by the real Fastify process', async ({ request }) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toMatchObject({ status: 'ok' });

  const workflows = await request.get('/api/workflows');
  expect(workflows.status()).toBe(200);
  const workflowBody = await workflows.json();
  expect(workflowBody.workflows).toHaveLength(EXPECTED_WORKFLOWS);
  expect(workflowBody.desks).toHaveLength(8);

  const openapi = await request.get('/api/openapi.json');
  expect(openapi.status()).toBe(200);
  await expect(openapi.json()).resolves.toMatchObject({ openapi: '3.1.0' });

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
