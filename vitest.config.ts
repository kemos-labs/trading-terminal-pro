import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * React 19 only exports `act` from the *development* CJS build.
 * react/index.js switches on process.env.NODE_ENV === 'production' and loads
 * react.production.js (no act) vs react.development.js (has act).
 *
 * If the shell/CI has NODE_ENV=production, or Vite inlines the production
 * graph, every RTL component test dies with "React.act is not a function".
 * Force a non-production env for the entire test graph so both Node require
 * and Vite-transformed deps always get development React.
 */
const TEST_NODE_ENV = 'test';

export default defineConfig({
  plugins: [react()],
  // Replace process.env.NODE_ENV in transformed/inlined deps (react/index.js).
  define: {
    'process.env.NODE_ENV': JSON.stringify(TEST_NODE_ENV),
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', 'playwright-report/**', 'test-results/**', '.opencode/**'],
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // Runtime env for non-transformed Node requires of react.
    env: {
      NODE_ENV: TEST_NODE_ENV,
    },
    // Single React / RTL graph under Vite's dep transform so define applies.
    server: {
      deps: {
        inline: ['react', 'react-dom', 'react-dom/test-utils', '@testing-library/react'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'e2e/**',
        'playwright-report/**',
        'test-results/**',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
      ],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // Prefer development condition when packages expose it.
    conditions: ['development', 'browser', 'module', 'import', 'default'],
  },
});
