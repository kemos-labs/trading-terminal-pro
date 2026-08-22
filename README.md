# VOLATERM

**Live demo (Railway):** → [https://volaterm-production-f082.up.railway.app](https://volaterm-production-f082.up.railway.app)

A browser-based **options trading terminal**. Open the link above to try it — no install.

### What it is (short)

VOLATERM is a multi-desk terminal for reading **equity options volatility**, **dealer positioning (GEX)**, **Greeks / MM tools**, **crypto options (Deribit)**, **rates / macros**, and a built-in **Academy** of desk notes.

| Desk | What you get |
|------|----------------|
| **Vol** | 3D IV surface, smile, term structure, wing-side controls |
| **Flow** | Option chain + GEX / key levels |
| **Trade** | Blotter-style tools, scenarios, Greeks |
| **Crypto** | BTC/ETH options tape (Deribit) |
| **Rates** | Curves, SOFR path, macro strip |
| **Academy** | Essays, glossary, news (education — not a trading desk) |
| **KSA** | Tadawul board — TASI/Nomu, movers, breadth (SAHMK) |

Full stack on Railway: React SPA + Node API + Yahoo/yfinance chains + MacroVol rates.

---

## Quick Start

```bash
npm run dev
```

Launches Vite (frontend), Fastify API (`server.js`), and MacroVol Python API concurrently.

Default ports: Vite `3000` (or `VITE_PORT`), API `3001` (or `PORT`), MacroVol `8765`.

### Production deploy (full stack only)

**Full product** = SPA + `server.js` + MacroVol + yfinance. Use **Docker** / Render blueprint (`render.yaml`) / Railway with `scripts/start-production.sh`.

| Path | What you get |
|------|----------------|
| `npm run dev` / Docker / Render | Full API: options, Deribit, FRED proxy, Finnhub board, FlashAlpha |
| **Vercel** (`vercel.json`) | **SPA only** + thin FMP/history serverless stubs — **not** a full terminal |

Do not expect live chains/rates from a Vercel-only deploy without a separate Node API host.

## Features

**Core desks (6 tabs)**

| Hotkey | Desk | Contents |
|--------|------|----------|
| **1** | **Vol** | 3D IV surface + smile/term (split), surface fit |
| **2** | **Flow** | Option chain + dealer GEX / γ-flip, key levels, parity edge |
| **3** | **Trade** | MM blotter tools, scenarios, hedging · **Analyze** = Greeks 1.0 |
| **4** | **Crypto** | Dual BTC/ETH Deribit tape; optional 2× thin charts |
| **5** | **Rates** | FRED/NYFed macro strip, STIR path, SERFF, UST curve |
| **6** | **Academy** | Desk essays / glossary / news (Substack-style reader) |
| **7** | **KSA** | Tadawul board — TASI/Nomu, movers, sectors, breadth (SAHMK, ~15m delayed) |

**Analytics & risk**
- Portfolio Greeks, scenario analysis, breakeven, expected move, max pain
- ATM IV from OTM-wing interpolation; dealer-style GEX; SVI readout / no-arb diagnostics

**Data sources** (LIVE-only product — market feeds; no demo mode switch)
- **Live equity chain** — Yahoo Finance (`yfinance` proxy `/api/options`) on Node/Docker
- **FMP enrichment** — spot, treasury, profile, news, earnings (`FMP_API_KEY`)
- **Deribit public** — BTC/ETH options + funding
- **MacroVol** — FRED / NY Fed / rates risk (`macrovol-api` on `:8765`)
- Fail-closed fallbacks may mark surfaces synthetic in provenance chips — never presented as a user-selectable “demo mode”

**UI system** (see `UI_UX_PLAN.md`, `DESIGN.md`)
- Density dense/readable (**D**), desk section jump **[** **]**, domain LIVE/DELAYED/STALE freshness (separate from MODE LIVE)
- Virtualized chain & STIR boards, CSV export, imply drawer, collapsible Rates sections

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite |
| 3D / 2D | Three.js + R3F · Recharts |
| State | Zustand |
| Styling | Tailwind CSS v4, terminal dark theme |
| Backend | Fastify, Python yfinance + MacroVol FastAPI |
| Virtualization | react-window v2 |

## Architecture

```
src/
├── components/
│   ├── terminal/     # Shell (Header, FunctionMenuBar, StatusBar, …)
│   ├── layout/       # TerminalLayout + SidePanel
│   ├── common/       # Freshness, VirtualRows, ImplyDrawer, CSV, …
│   ├── macrovol/     # RatesPanel, MacroPanel, ApiSources
│   └── views/        # Desk views (Home, Vol, Positioning, Greeks, Desk, Crypto, Rates)
├── config/           # deskNav, deskSections, functionRegistry, constants
├── hooks/            # keyboard, density, spot stream, …
├── store/            # terminalStore, toastStore
└── lib/
    ├── options/      # BS, greeks, SVI, analytics, Deribit/Yahoo/FMP chain builders
    ├── data/         # DataProvider (LIVE path + fail-closed fallbacks), clients, freshness
    └── macrovol/     # MacroVol HTTP client
```

Product & frontend architecture design: **[`DESIGN.md`](DESIGN.md)**.

## Keybindings

| Key | Action |
|-----|--------|
| `1`–`7` | Switch desks |
| `Tab` | Next desk |
| `[` `]` | Previous / next desk section |
| `D` | Toggle dense / readable density |
| `R` | Refresh data |
| `S` | Symbol search |
| `L` | Refresh LIVE feeds |
| `Space` | Play / pause playback |
| `←` `→` | Scrub historical frames (when board unfocused) |
| `↑` `↓` / `j` `k` | Board row focus (chain · SR3 · SERFF · calendars) |
| `y` | Copy focused cell |
| `c` | Focus option chain (Positioning desk) |
| `Esc` | Clear board focus / close overlays |
| `B` / `M` / `V` | Jump Crypto / MM / Vol |
| `?` | Shortcuts overlay |

Playback bar: scrub ~64 frames, speed 0.5×–4× when history is available.

## Environment Variables

See `.env.example`. Terminal boots LIVE-only; optional keys unlock enrichment and MacroVol.

Useful: `FMP_API_KEY`, `MACROVOL_API_URL`, `PORT`, `VITE_PORT`, `API_TARGET`.

Optional OPRA skeleton (server only, off by default): `OPRA_ENABLED`, `OPRA_VENDOR` — see `DESIGN.md` PR-10.

## Live app

**Try it now:** [https://volaterm-production-f082.up.railway.app](https://volaterm-production-f082.up.railway.app)

That is the only public production URL (Railway full stack). Health check: `/api/health` should return `{"status":"ok",...}`. The shell boots into a short briefing, then the Vol desk.

Repo: [github.com/xxxova2/volaterm](https://github.com/xxxova2/volaterm)

## Deployment

| Target | How | What works |
|--------|-----|------------|
| **Railway** | Docker (`Dockerfile` → `scripts/start-production.sh`) | Full stack: SPA + Yahoo chain + MacroVol. **Preferred live target.** |
| **Docker / Node** | `Dockerfile` → `node server.js` / `npm run start:prod` | Same image as Railway |
| **Vercel** | SPA + serverless `api/` | FMP enrichment only; no Python chain |

> Live Yahoo chain needs Python (`yfinance`). Prefer Railway/Docker for full chain fidelity.

### Black-screen checklist (post-deploy)

1. Build must succeed: `tsc -b && vite build` (assets under `dist/`).
2. Server must serve SPA: `fastify-static` + SPA fallback for non-`/api` routes.
3. CORS must allow the Railway origin (`.up.railway.app` is allow-listed in `server.js`).
4. `GET /api/health` → 200 JSON before trusting the UI.

## Credits

**Thalex Lab tools** (Crypto desk · Lab chrome) — real apps from [thalextech.github.io](https://thalextech.github.io) / [github.com/thalextech/thalextech.github.io](https://github.com/thalextech/thalextech.github.io). Embedded live via iframe so depth (simulator, combo PnL, backtest parquet, …) is Thalex’s, not a thin replica. Thank you **Thalex** for open tooling used by options traders. Their simple-quoter blog is a separate private-API perp bot and is not part of the lab suite.

## Merged From

| Source | Strengths |
|--------|-----------|
| iv surface (uivi) | Full Greeks, SVI, react-window chain |
| newiv | Shell, shortcuts, playback, Three.js surface |
| trader-terminal-app | Design predecessor |
| Thalex open tools | Crypto Lab depth (iframe embeds) |
