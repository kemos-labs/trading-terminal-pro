import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** Browser-fixture visual/state matrix. Kept separate from real-server E2E. */
export default defineConfig({
  ...base,
  testMatch: ['app.spec.ts', 'crypto.spec.ts'],
  reporter: [['line']],
});
