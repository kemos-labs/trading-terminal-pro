import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Serve repo docs/ at /docs/* so Academy works without the API proxy. */
function serveAcademyDocs(): Plugin {
  const docsRoot = path.resolve(__dirname, 'docs');
  const mime: Record<string, string> = {
    '.md': 'text/markdown; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  return {
    name: 'serve-academy-docs',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/docs/')) return next();
        const raw = decodeURIComponent(req.url.slice('/docs/'.length).split('?')[0] || '');
        if (!raw || raw.includes('..')) return next();
        const file = path.resolve(docsRoot, raw);
        if (!file.startsWith(docsRoot + path.sep) && file !== docsRoot) return next();
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
        const ext = path.extname(file).toLowerCase();
        res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

function appVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', timeout: 5000 }).trim() || 'dev';
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serveAcademyDocs()],
  // Build stamp: lets any open tab prove which code it runs (stale-tab diagnosis).
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  server: {
    port: Number(process.env.VITE_PORT) || 3000,
    proxy: {
      '/api': process.env.API_TARGET || 'http://localhost:3001',
      // /docs is served from local docs/ via serveAcademyDocs (fresh index + figures)
    },
  },
  build: {
    outDir: 'dist',
  },
});
