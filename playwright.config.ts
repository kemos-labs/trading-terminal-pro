import { defineConfig } from '@playwright/test';

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || 3101);

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PLAYWRIGHT_PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npm run build && PORT=${PLAYWRIGHT_PORT} node server.js`,
    url: `http://localhost:${PLAYWRIGHT_PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
