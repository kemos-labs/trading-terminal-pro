import { defineConfig, devices } from '@playwright/test';

/**
 * Representative failure-state gate: real Fastify + built frontend with
 * deterministic server-side fixtures switched at runtime
 * (POST /api/__test/fixtures/scenario). No page.route() interception.
 * See e2e/failure-states.spec.ts — representative, not the full C6 matrix.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'failure-states.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3102',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && NODE_ENV=test E2E_FIXTURE_SCENARIO=success LOG_LEVEL=silent PORT=3102 node server.js',
    url: 'http://127.0.0.1:3102/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
