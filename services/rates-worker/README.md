# rates-worker (private, loopback-only)

FastAPI backend: **FRED** macro/rates + **yfinance** Greeks/IV surface/STIR.
Private implementation worker for `services/rates-worker`; the Node Fastify process is the sole public HTTP surface and proxies this worker over loopback only.

## Run

```bash
# Preferred: put key in services/rates-worker/.env
# FRED_API_KEY=...   https://fred.stlouisfed.org/docs/api/api_key.html

# From repo root
npm run rates-worker
# or
python3 -m uvicorn main:app --app-dir services/rates-worker --host 127.0.0.1 --port 8765
# Legacy alias `npm run macrovol-api` still resolves to `rates-worker`.
```

`ALLOW_STIR_FALLBACK=0` (default) — never mix stale SR3/ZQ fallbacks with live quotes.

## Proxy

Node `server/routes/macrovol.js`: `/api/macrovol/*` → `MACROVOL_API_URL` (default `http://127.0.0.1:8765`) `/api/*`.
No wildcard CORS — loopback only. Set `RATES_WORKER_CORS_ORIGINS` explicitly only for local browser dev.

## Data quality notes

| Topic | Rule |
|-------|------|
| Short Tsy curve | `DGS1MO` / `DGS3MO` / `DGS6MO` (not `DGS1M`) |
| Spreads T10Y2Y / T10Y3M | FRED **percentage points** (×100 = bps) |
| Risk-free `r` | Defaults to **live SOFR/100** for surface & greeks |
| Source labels | `FRED` vs `FRED+fallback` — no silent fake “live” |
| GEX | Naive call+/put− dealer convention; not inventory |
| Charm | Per calendar day; exposure = charm × OI × 100 × S |

## Key routes

- `GET /api/rates/summary|plumbing|curve|basis|correlations|curve-history`
- `GET /api/rates/shape` — curve shape + sparklines (2s10s, 5s30s, fly)
- `GET /api/rates/dv01` — generic par-Treasury DV01 book + key-rate scenario
- `GET /api/rates/term-structure?T=` — interpolated r(T) decimal
- `GET /api/macro/summary` · `/api/macro/series/{id}`
- `GET /api/macro/stress` — FRED risk pack (VIXCLS, credit, BEI, …)
- `GET /api/macro/primary` — keyless OFR BGCR/TGCR/SOFR + ECB DFR (1h TTL)
- `GET /api/greeks/{ticker}` · `/api/greeks/{ticker}/history` (default r = term structure)
- `GET /api/surface/{ticker}` (default r = term structure)
- `GET /api/stir/strip` — strip + path chart vs SOFR

## Optional QuantLib oracle (dev/CI only)

```bash
pip install QuantLib   # or QuantLib-Python
python3 services/test_quantlib_oracle.py
```

Does **not** run in production. Compares our BS greeks to QuantLib AnalyticEuropeanEngine.
Do **not** install `gs-quant` for market data — Marquee credentials required (institutional).
