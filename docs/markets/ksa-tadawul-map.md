# KSA / Tadawul market map (desk primer)

Short map for the **KSA** desk in trading-terminal-pro. Not investment advice.

## Institutions

| Entity | Role |
|--------|------|
| **CMA** | Regulator |
| **Saudi Exchange (Tadawul)** | Listing, matching, indices, market data (MIC **XSAU**) |
| **Muqassa** | Clearing |
| **Edaa** | Depository / ownership registry |
| **WAMID** | Group tech / data arm |

## Segments

- **Main Market** → **TASI** (all-share)
- **Nomu** (parallel) → **NomuC**
- Funds / REITs / ETFs (ETF market-making framework from 2026)
- Sukuk & bonds
- Derivatives: **MT30** index futures, single-stock futures (SSF), single-stock options (SSO) — younger / thinner than US listed options

## Session

- **Week:** Sunday–Thursday  
- **Timezone:** Asia/Riyadh (UTC+3)  
- **Cash equities:** continuous roughly **10:00–15:20** (confirm on exchange rules)  
- **Settlement:** T+2  
- **Currency:** SAR (long USD peg ~3.75)

## Market makers

Exchange **members** with continuous two-sided quote obligations under Tadawul frameworks (cash, derivatives, ETFs). Directory is on the exchange site — do **not** invent MM identity from retail tape.

## Foreign ownership

EM index inclusion (MSCI/FTSE etc.) + ownership caps (commonly discussed ~49% aggregate foreign / ~10% single foreign, with exceptions). Caps create “room” metrics desks watch.

## Macro links

Oil, Aramco (2222), banks, SAMA/US rates via peg, PIF / Vision 2030 IPOs.

## Data in this terminal

- Provider: **SAHMK** (Tadawul-listed information provider)  
- Server routes: `GET /api/ksa/board`, `GET /api/ksa/quote/:symbol`, `GET /api/ksa/session`  
- Key: `SAHMK_API_KEY` (server-only)  
- Free tier: delayed, **100 req/day** — board uses shared **30m** cache, **6** upstream calls/miss  
- Function codes: **KSA**, **TASI**, **TADAWUL**, **NOMU** (hotkey **6**; Academy is **7**)

See also: `docs/engineering/KSA_DATA_PROVIDERS.md`
