# KSA data providers (2026-07)

## Primary: SAHMK

- Site: https://www.sahmk.sa/en/developers  
- Listed Tadawul information provider  
- Auth: `X-API-Key` header  
- Base: `https://app.sahmk.sa/api/v1`  
- Free: 100 req/day, ~15m delayed, 10/min burst (soft local cap ~85)  
- Starter ~149 SAR/mo: history, batch quotes, financials  
- Pro ~499 SAR/mo: real-time WebSocket, depth (entitlement), alerts  

### Terminal wiring

| Item | Detail |
|------|--------|
| Env | `SAHMK_API_KEY` (server `.env` only) |
| Module | `api/ksaFeeds.js` |
| Routes | `/api/ksa/board`, `/api/ksa/quote/:symbol`, `/api/ksa/session` |
| Cache | `TTL.SAHMK_BOARD_MS` **30m**, `TTL.SAHMK_QUOTE_MS` 15m |
| Budget | `SAHMK_FREE_DAILY` 100, headroom 0.85; **atomic pack reserve** |
| UI | `KsaMarketView` · tab **KSA** · codes KSA/TASI/TADAWUL · hotkey **6** |

### Free board pack (6 upstream calls on cache miss)

1. TASI summary (critical — failure throws, no empty cache)  
2. Nomu summary  
3. Gainers  
4. Losers  
5. Volume leaders  
6. Sectors  

**No per-symbol mega quote fan-out.** Mega strip is derived from volume/gainers/losers.  
Value table reuses volume leaders (labeled “vol proxy”) to save a call.

**Math:** ~10 open-session refreshes/day at 30m TTL × 6 ≈ **60** ≤ soft cap **85**. Extra focus quotes only when board lacks bid/ask detail.

### Failure semantics

| Condition | Behavior |
|-----------|----------|
| Budget exhausted, last good board exists | Serve **stale** board + `error` + `stale: true` (HTTP 200) |
| Budget/upstream fail, no good board | `unusable: true`, HTTP **429** (budget) or **502** |
| Invalid symbol | HTTP **400**, `code: INVALID` |
| Empty/partial pack without TASI print | **Not cached** (`cacheIf: isUsableBoard`) |

### License note

Developer plans: internal tools / small apps. Public multi-user redistribution of real-time Saudi data may require Enterprise / exchange agreement. Do not scrape saudiexchange.sa HTML as production SoR.

## Secondary (not SoR)

| Source | Role |
|--------|------|
| Yahoo `2222.SR` | Unofficial prototype only |
| FMP / Twelve Data | Global EOD if already paid |
| ICE / Bloomberg | Institutional L1/L2 |

## Explicit non-goals (current phase)

- Full SSO option chain / GEX for TASI  
- Live MM presence detection  
- Browser-side SAHMK keys  
