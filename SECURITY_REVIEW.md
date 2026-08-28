# Security Review — trading-terminal-pro

Reviewed: full stack — Fastify server (`server.js`), Node API helpers (`api/`), FastAPI macro service (`macrovol-api/`), Python fetchers, config files, and git history.

Overall the code is **better than average**, but there are two concrete issues worth fixing.

---

## Bounty-hunt pass (2026-08) — post billing/auth build

Adversarial re-review (3 parallel static audits + live exploitation against a local
configured instance). Everything below was **found AND fixed** unless marked residual.

### Fixed — High
| Finding | Where | Fix |
|---|---|---|
| FMP allowlist bypass via dot-segments: `/api/fmp/stable/quote/../../stable/<any paid endpoint>` reached any FMP route under our key | `api/_shared.js` `isFmpEndpointAllowed` | reject `%2e`/`.`/`..` segments before prefix matching |
| Unauthenticated Customer Portal takeover by email: portal URL minted for any Stripe customer | `api/stripeBilling.js` portal-session | session required; email forced to caller's session; body identity ignored |
| Checkout could bind payments to arbitrary `customerId` | checkout-session | customerId honored only if it belongs to the session email |
| Rate-limit buckets collapsed behind edge proxy → 11 req/min globally locked out ALL auth; cross-class poisoning (cheap routes exhausting scarce quotas) | `server.js` Fastify init + rate-limit registration | `TRUST_PROXY=1` opt-in + per-URL-class keyGenerator |
| Webhook replay resurrected canceled entitlements (stale redelivery flips canceled→active) | webhook handler | stale-event guard: events older than record `updatedAt` skipped + audited |

### Fixed — Medium
- **invoice.paid merge-wipe**: `{status: undefined}` spread erased a fresh subscriber's active status (402 right after paying) and doubled as a remote revocation primitive. Patch now conditional.
- **Bare invoices minted entitlements**: `invoice.paid` created an ACTIVE record for unknown customers. Now refreshes known customers only.
- **One-time purchases never unlocked desks**: status `'paid'` wasn't recognized. Now grants access.
- **Price-catalog enforcement on webhooks**: entitlements now require a catalog priceId — stray Dashboard products can't unlock desks.
- **PII disclosure**: `/api/billing/status?email=` returned full records (customerId, priceId…) unauthenticated. Anonymous callers get `{active}` only; owner gets records.
- **Internal docs served publicly**: `/docs/engineering/BILLING_HANDOFF.md` etc. were reachable. Now only `/docs/index.json` + `/docs/academy/*`.
- **Key-presence regressions**: `/api/desk/pack` fell back to exposing all vendor-key booleans; `/api/cache/status` listed live cache keys (users' symbols). Both gated behind `EXPOSE_KEY_STATUS=1`.
- **Finnhub budget never enforced** + free-form `from/to` minting unlimited cache keys/upstream calls: date format validated, soft budget enforced.
- **Macrovol debug-block traversal**: `/rates/../../debug/fred` bypassed the literal-prefix check; dot segments rejected.
- **`.data/` baked into Docker builds**: added to `.dockerignore` (session-secret footgun).
- **Sensitive files 0644→0600**: users/sessions/reset-tokens/entitlements writes carry mode 600.

### Fixed — Low (continued, follow-up pass)
MacroVol yfinance endpoints validate ticker charset + period enum (`/api/greeks/*`, `/api/surface/*` — blocks cache-key/upstream hammering); MacroVol Python cache size-capped at 2000 entries with eviction; Python service CORS configurable via `MACROVOL_CORS_ORIGIN` (wildcard only when unset); macrovol dev `__main__` binds loopback by default; AcademyNews anchors only render http(s) URLs from third-party feeds.

Login timing oracle equalized with dummy scrypt; register response unchanged (product choice); Secure cookie flag set on Render/Railway even without NODE_ENV; gated KSA responses send `Cache-Control: private, no-store` + `Vary: Cookie`; `/api/ksa/session` gated like its siblings.

### Verified clean (negative results)
Paywall guards on all data-bearing KSA routes · HMAC sessions sound (timing-safe, server-side state, revocation works) · reset tokens 192-bit/single-use/1h · webhook signature + raw-body encapsulation correct · no command injection anywhere (execFile array args) · no path traversal in static/file endpoints (SPA fallback verified live) · no XSS sinks in frontend · no secrets in 608 tracked files or git history · FRED allowlist holds · Deribit/OKX inputs allowlisted · XFF spoofing does NOT bypass limits.

### Residual / accepted risks
1. Sessions & entitlements are file-backed single-instance — horizontal scaling needs a shared store.
2. Registration has no email verification: pre-registering someone else's email links their future subscription to that account (documented in BILLING_HANDOFF).
3. Password-reset delivery is operator-handoff until a mailer is wired.
4. `logger:false` means request.log output (e.g., reset tokens) goes nowhere — wire a logger before relying on it.
5. Webhook handling uses stale-event guards; full reconciliation against live Stripe state on every event would be the belt-and-braces upgrade.
6. Verbose upstream error detail still echoed on some market-data routes (vendor status text) — map to generic codes if that ever matters.

---

## Original review

## Critical / High

### 1. Unauthenticated debug endpoints reachable through the public proxy — **FIXED**
**Was:** Node catch-all `/api/macrovol/*` forwarded debug routes; FastAPI debug always on.

**Now:**
- Node rejects `/api/macrovol/debug/*` with 404 before proxy (`isMacroDebugPath` in `server.js`).
- FastAPI debug routes require `MACROVOL_DEBUG=1` (default off).
- Error hint no longer recommends `--host 0.0.0.0`.

### 2. Live API keys sitting in `.env` on disk
`.env` contains real keys (Finnhub, Alpha Vantage, RapidAPI, Massive, FlashAlpha). Good news: `.gitignore`/`.dockerignore` are correct and git history contains **none** of them (verified), and `.env.example` is clean. Risk is if the folder is copied, backed up, zipped, or `.gitignore` is ever removed — the keys could leak or be pushed.

**Fix:** rotate all five keys now (treat as exposed), and rely on the platform secret stores that are already wired (Render `sync:false`, Vercel env). Keep the real `.env` out of any archive. *(Ops action — not a code change.)*

---

## Medium

### 3. Broad CORS + key-presence disclosure — **FIXED**
- CORS no longer accepts arbitrary `*.up.railway.app`; only localhost, `CORS_ORIGIN` list, and exact `RAILWAY_PUBLIC_DOMAIN` / `RAILWAY_STATIC_URL`.
- `/api/health` no longer returns key status. `/api/cache/status` only includes `keys` when `EXPOSE_KEY_STATUS=1`.

---

## Low / Hygiene

### 4. FastAPI CORS `allow_origins=["*"]` (main.py:27)
Safe **only** because the service is meant to be localhost-only. The `0.0.0.0` hint (server.js:1281) is the footgun that would make this exploitable.

### 5. No security headers / HTTPS enforcement
Fastify sets no CSP, HSTS, or `X-Content-Type-Options`. Add an `onSend` hook, and enforce HTTPS at the edge (Vercel/Render).

### 6. Unbounded FRED series fetch
`/api/macro/series/{series_id}` (main.py) forwards any FRED series id. Public data, but unauthenticated + uncached — easy to hammer. Add an allowlist or cache.

---

## What's done well (keep it)

- **SSRF contained:** FMP proxy uses a strict endpoint allowlist (`api/_shared.js`, `FMP_ALLOWED_ENDPOINTS`); macrovol target host is fixed to `127.0.0.1`; `validateSymbol` regex in `server.js` constrains all symbol inputs. No path/URL injection to internal hosts.
- **No command injection:** Python fetchers are called via `execFile` with **array args** (`server.js:248,289`) and validated symbols — no shell.
- **No XSS sinks:** no `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`new Function` in the frontend; React escapes by default.
- **Fail-closed market data:** synthetics only injected when explicitly allowed; otherwise `null`/`503` (good for a finance app where fake numbers are dangerous).
- **Secrets handled correctly** in CI/deploy: `.env` excluded from git and Docker; Render/Vercel use dashboard secrets.

---

## Recommended priority order
1. ~~Gate/block the `debug/*` endpoints~~ **done** (proxy 404 + `MACROVOL_DEBUG=1`).
2. Rotate the five `.env` keys (ops — still required).
3. ~~Tighten CORS + remove key-presence from public health~~ **done** (`EXPOSE_KEY_STATUS=1` for ops cache status).
4. Add security headers; keep FastAPI on localhost only.
