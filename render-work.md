# Render Deployment — Kemos Research

> **Generated**: 2026-07-28
> **Last updated**: 2026-07-28 08:25 UTC+3
> **Status**: Live at https://kemos-research.onrender.com

---

## Architecture

Single Docker container running:
- **Node.js (Fastify)** — SPA + API proxy (port 3001, Render injects `PORT`)
- **Python MacroVol API** — FRED rates/macro/stress (uvicorn on `127.0.0.1:8765`)
- **Python Crypto Backtest API** — optional (uvicorn on `127.0.0.1:8766`)
- All started by `scripts/start-production.sh`

## Service Details

| Property | Value |
|---|---|
| **URL** | https://kemos-research.onrender.com |
| **Dashboard** | https://dashboard.render.com/web/srv-d9k3ll3m8hqs73bip0s0 |
| **Service ID** | `srv-d9k3ll3m8hqs73bip0s0` |
| **Workspace** | Kemos-labs (`tea-d90oe3laeets73e9at5g`) |
| **GitHub repo** | https://github.com/kemos-labs/volaterm |
| **Region** | Oregon (free tier) |
| **Plan** | Free |
| **Runtime** | Docker |
| **Dockerfile** | `./Dockerfile` (Node 22-slim + Python3) |
| **Health check** | `/api/health` |
| **Auto-deploy** | Yes — on push to `master` branch |

## Environment Variables Set

### Non-secret (set via CLI create)
| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MACROVOL_API_URL` | `http://127.0.0.1:8765` |
| `ALLOW_STIR_FALLBACK` | `0` |
| `RAPIDAPI_TV_HOST` | `tradingview-data1.p.rapidapi.com` |

### Secrets (set via Render dashboard / API — never written in this file)

| Key | Source |
|---|---|
| `FRED_API_KEY` | `macrovol-api/.env` |
| `FINNHUB_API_KEY` | root `.env` |
| `ALPHA_VANTAGE_API_KEY` | root `.env` |
| `RAPIDAPI_KEY` | root `.env` |
| `SAHMK_API_KEY` | root `.env` |
| `MASSIVE_API_KEY` | root `.env` |
| `FLASHALPHA_API_KEY` | root `.env` |

> **2026-08-22 incident note:** an earlier revision of this file listed the live key
> values in plaintext and was pushed to the public repo. All keys must be rotated
> (done via provider dashboards) and history scrubbed. Never paste key material
> into docs, issues, or chat — server `.env` / platform env vars only.

### Missing
| Key | Reason |
|---|---|
| `FMP_API_KEY` | Never configured (placeholder in `.env.example`). App falls back to yfinance gracefully. If needed, add via Render dashboard → Environment. |

## Endpoint Status (2026-07-28)

| Endpoint | Status | Notes |
|---|---|---|
| `GET /api/health` | ✅ Working | Health check OK |
| `GET /api/boot/briefing` | ✅ Working | Rates, macro, stress all available (Python MacroVol running) |
| `GET /api/yf/history/:symbol` | ✅ Working | 251 bars for SPY via yfinance |
| `GET /api/history/spy` | ✅ Working | 251 data points via yfinance fallback |
| `GET /api/deribit/index/:name` | ✅ Working | BTC ~$63,418 |
| `GET /api/deribit/market/:currency` | ✅ Working | Full Deribit options/futures/perps |
| `GET /api/finnhub/news` | ✅ Working | 12 items returned |
| `GET /api/finnhub/quote` | ✅ Working | Shared desk quote |
| `GET /api/finnhub/earnings` | ✅ Working | Earnings calendar |
| `GET /api/macrovol/*` | ✅ Working | Rates, macro, stress, STIR strips |
| `GET /api/cache/status` | ✅ Working | Cache + budget stats |
| `GET /api/yf/info/:symbol` | ⚠️ Degraded | Returns null fields for SPY (yfinance data gap, not a bug) |
| `GET /api/options/:symbol` | ❌ Rate limited | yfinance 429 from Render IP — needs pacing (0.8s delay added between chain requests, but Yahoo rate-limits aggressively on shared IPs) |
| `GET /api/macrovol/crypto/spot` | ❌ Rate limited | CoinGecko 429 from shared Render IP — error cached for 60s to avoid hammering |
| `GET /api/fmp/stable/*` | ❌ No key | FMP_API_KEY not configured (falls back to yfinance) |
| `GET /api/finnhub/economic-calendar` | ⚠️ May 403 | Depends on Finnhub plan level |
| `GET /api/stream/quote/:symbol` | ⚠️ Needs FMP key | SSE stream requires FMP key

## Known Limitation: Free Tier Sleep

Render free plan spins down after **15 minutes of inactivity**. Wake takes 30-50 seconds.

### Fix: cron-job.org Ping (NOT SET UP YET)
1. Go to https://cron-job.org (free, no account needed)
2. Create a cron job:
   - **URL**: `https://kemos-research.onrender.com/api/health`
   - **Interval**: Every **5 minutes**
3. This keeps the container warm 24/7

Alternative: UptimeRobot free tier (50 monitors).

## Fixes Applied (2026-07-28)

| File | Change | Issue Fixed |
|---|---|---|
| `server.js` | Added `RENDER_EXTERNAL_URL` to CORS origin detection | Render CORS |
| `render.yaml` | Service name set to `kemos-research`, added cron-job note | Naming |
| `macrovol-api/main.py` | Cache CoinGecko errors for 60s to avoid hammering API during rate-limit windows | CoinGecko 429 loop |
| `fetch_yf.py` | Added `yf_retry()` with exponential backoff (3 retries) on 429/rate-limit errors | yfinance 429 |
| `fetch_options.py` | Added `yf_retry()` + 0.8s pacing delay between chain requests + initial 0.3s delay | Options yfinance 429 |

## Remaining Issues

1. **Options endpoint** still rate-limited by yfinance from Render's Oregon IP. The pacing delay (0.8s between chains) + retry logic should help once the IP's rate limit cools down. Options make 13+ requests per call (1 for expiry list + 12 for chains), so it's the most affected.
2. **CoinGecko** still 429. Error is cached for 60s. CoinGecko free tier rate limit is ~10-30 req/min. Should recover within a few minutes of no calls.
3. **FMP_API_KEY** not configured. All FMP endpoints gracefully return 503 and fall back to yfinance/Deribit.
4. **cron-job.org ping** not yet set up (needed to prevent Render 15-min idle sleep).

### Potential long-term fixes for yfinance/options
- Use a different options data source (e.g., Tradier free tier, ThetaData)
- Run a proxy/cache for yfinance data
- Set FMP_API_KEY (FMP has options data via `/stable/options`)

## CLI Setup (for future agent)

```bash
# Render CLI is installed at ~/.local/bin/render
# API key stored in ~/.render/cli.yaml
# Active workspace: Kemos-labs (tea-d90oe3laeets73e9at5g)
render whoami
render workspace current

# List services
render services list

# View deploys
render deploys list srv-d9k3ll3m8hqs73bip0s0

# Trigger a new deploy
render deploys create srv-d9k3ll3m8hqs73bip0s0

# View logs (not available via CLI, use dashboard)
# Dashboard: https://dashboard.render.com/web/srv-d9k3ll3m8hqs73bip0s0
```

## Env Var Management via API

The CLI `services update` doesn't support `--env-var`. Use the REST API directly:

```bash
TOKEN=$(grep 'key:' ~/.render/cli.yaml | awk '{print $2}')
SERVICE_ID="srv-d9k3ll3m8hqs73bip0s0"

# List current env vars
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.render.com/v1/services/$SERVICE_ID/env-vars"

# Update env vars (PUT replaces all; include existing ones too)
curl -s -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.render.com/v1/services/$SERVICE_ID/env-vars" \
  -d '[
    {"key": "KEY_NAME", "value": "key_value"}
  ]'
```

## render.yaml (Blueprint)

The `render.yaml` at repo root defines the service. Render Blueprint auto-detects it when connecting via Dashboard → New → Blueprint.
