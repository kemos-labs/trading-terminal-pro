# services/

Private implementation workers with no public network surface. The Fastify Node process in `server/` is the sole public HTTP boundary; workers are reachable only over loopback.

## rates-worker

- Location: `services/rates-worker/` (FastAPI, Python)
- Run: `npm run rates-worker` → `127.0.0.1:8765` (see `services/rates-worker/README.md`)
- Contract: Node proxies `/api/macrovol/*` → `http://127.0.0.1:8765/api/*` via `server/routes/macrovol.js`. Fastify owns auth, caching, timeouts, and response validation.
- No wildcard CORS. Set `RATES_WORKER_CORS_ORIGINS` only for explicit local browser dev; production remains loopback-only.
- Forbidden imports: workers must never import React, browser APIs, or Fastify internals. Node must never execute worker math directly.
