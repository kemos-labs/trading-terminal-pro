import { defineConfig, devices } from '@playwright/test';

/**
 * No browser interception is permitted in this project. The built application
 * and the real Fastify composition root are served from one local process.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'real-server.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3101',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && NODE_ENV=test LOG_LEVEL=silent PORT=3101 node server.js',
    url: 'http://127.0.0.1:3101/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
