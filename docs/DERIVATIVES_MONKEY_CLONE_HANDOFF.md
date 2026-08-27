# Derivatives Monkey → VOLATERM UI Rebuild Handoff

## User intent

Rebuild the Crypto desk in `/home/kalde/trading-terminal-pro` using the visible product at:

- <https://www.derivativesmonkey.com/btc/dashboard>

The requested outcome is a highly faithful visual and functional recreation inside VOLATERM. Use a **clean-room implementation**: inspect the rendered UI, routes, interactions, and public network responses, then recreate them with VOLATERM code, branding, and data providers. Do not copy unavailable proprietary source, logos, copyrighted assets, or provider credentials.

## Project

- Root: `/home/kalde/trading-terminal-pro`
- Frontend: React 19, TypeScript, Vite, Tailwind v4, Zustand, Recharts, Plotly, Three.js
- Node API: Fastify in `server.js`
- Primary live crypto provider: public Deribit API through server-side `/api/deribit/*` routes
- Local frontend currently: `http://127.0.0.1:3204/?crypto=BTC`
- Local API: `http://127.0.0.1:3001`
- Read `/home/kalde/trading-terminal-pro/AGENTS.md` before editing.
- For visual work, read `/home/kalde/.pi/agent/skills/design/SKILL.md` completely.

## User feedback to honor

Earlier work was rejected because it added features inside the existing terminal UI rather than closely reproducing the reference’s rendered visual system. The next implementation should prioritize visible fidelity:

1. Overall page frame and proportions
2. Left grouped navigation
3. Black/teal visual system
4. Header and asset controls
5. Typography, spacing, borders, and card geometry
6. Page-specific chart/table composition
7. Responsive behavior
8. Then feature depth

Do not present a small dashboard card update as a full clone.

## Live reference research already completed

The live site was opened with Playwright at 1536×960 and inspected. Its primary BTC routes include:

### Dashboard

- `/btc/dashboard`
- `/btc/custom`
- `/btc/strike-insight`

### Volatility

- `/btc/vol-index`
- `/btc/iv-percentile`
- `/btc/term`
- `/btc/iv-rv-vrp`
- `/btc/surfaces`
- `/btc/vol-regime`
- `/btc/skew`

### Greeks

- `/btc/levels`
- `/btc/greeks`
- `/btc/greek-exposure`
- `/btc/heatmaps`
- `/btc/thermography`
- `/btc/tail-strike`

### Flow

- `/btc/tape`
- `/btc/order-flow`
- `/btc/volume-flow`
- `/btc/open-interest`
- `/btc/scanner`

### Other groups

- `/btc/block-rfq/aggregated`
- `/btc/block-rfq/derive`
- `/btc/block-rfq/deribit`
- `/btc/divergence`
- `/btc/lead-lag`
- `/btc/basis`
- `/btc/premium`
- `/btc/futures/basis`
- `/btc/futures/term-structure`
- `/btc/futures/funding`
- `/btc/futures/history`
- `/btc/futures/oi-profile`
- `/btc/strategy`
- `/btc/strategy/scan`
- `/btc/calculator`
- `/btc/arb-guide`
- `/btc/stats`
- `/btc/docs`

## Reference visual DNA

Observed directly from screenshots/rendered pages:

- Near-black page background (`#020303`–`#070909` range)
- Left rail around 240px at a 1536px viewport
- Top header about 56px high
- Teal/cyan accent around `#12c7b5` / `#20d4c2`
- Muted borders around `#202526`
- Cards use subtle 5–7px rounding, not large SaaS radii
- Compact monospaced uppercase navigation
- White titles with italic teal emphasis on selected words
- Content canvas generally maxes around 1020–1100px on many detail pages
- Generous vertical gaps between major analytical sections
- Dense tables inside spacious page composition
- Active sidebar item: dark gray fill plus bright teal left edge
- Group headings: uppercase, tracked, muted white/gray
- Positive values: teal/green
- Negative values: red
- Warning/neutral structural values: amber/white
- Minimal shadows; separation comes from borders and surface contrast
- Desktop sidebar is persistent; mobile navigation must become horizontal/drawer navigation

## Reference page anatomy

### Dashboard

1. Global header
2. Five top metric cards
3. Market summary block
4. Multi-asset vol-index cards
5. Options chain
6. Spot section
7. Term structure and IV/RV
8. GEX and max pain
9. Flow sections

### Greek Exposure

- Left grouped sidebar
- Metric tabs: Gamma / Charm / Vanna
- Expiry filters: All / 0DTE / 7D / EOW / EOM
- Source selector
- Appearance/log-scale controls
- Large central exposure projection/chart
- Right context rail with spot, dealer regime, and key levels
- Net exposure summary cards
- Per-strike exposure table

### Heatmaps

- Strike footprint
- OI concentration by expiry × strike
- GEX domain map
- VEX domain map
- Teal/red diverging colors

### Exposure Heatmap

- Greek selector: gamma, vanna, vega, OI, volume
- Net/calls/puts views
- Strike × expiry matrix
- Spot/ATM marker
- Total row
- Max concentration, skew direction, and data coverage summaries

### Options Order Flow

- Page title and explanatory paragraph
- Large spot-vs-strike bubble map
- Lookback/source/min-notional controls
- Calls bought/sold and puts bought/sold filters
- Premium-weighted flow aggregator
- Expiry aggregation
- Top trades
- Moneyness buckets

### Open Interest

- OI by strike
- Max-pain overlay
- Call/put totals and P/C ratio
- OI concentration heatmap
- Fresh positioning (volume/OI)
- Historical OI change
- Calls and puts by expiry
- Near-expiry/0DTE table and strike profile

### Skew Analytics

- IV smile
- 25-delta RR by maturity
- RR history
- Constant-maturity skew comparison
- Skew vs spot
- Active maturity history
- Wing-richness matrix by delta bucket
- Wing callouts

## Public reference API patterns observed

These describe visible product behavior; do not depend on the reference API in production.

- `/api/market/market-summary`
- `/api/market/term-structure`
- `/api/market/chain-latest`
- `/api/market/expiries-all`
- `/api/market/greek-exposure-projection`
- `/api/market/thermography`
- `/api/market/gamma-flip`
- `/api/market/skew-by-maturity`
- `/api/market/rr-history`
- `/api/market/iv-smile`
- `/api/market/atm-vs-rv`
- `/api/market/flow-summary`
- `/api/market/flow-agg`
- `/api/market/trades/aggregate`
- `/api/market/oi-profile`
- `/api/market/fresh-positioning-by-strike`
- `/api/market/oi-change`
- `/api/market/oi-by-expiry`
- `/api/market/zdte-distribution`

VOLATERM must use its own Node/Deribit/provider layer rather than depending on those endpoints.

## Current implementation state

### Shell parity (Phase 1 — DONE)

- `TerminalLayout.tsx` hides the global VOLATERM header/red bar when `activeTab === 'crypto'`.
- `CryptoDeskShell.tsx` renders the full reference-style shell:
  - black top header: brand, BTC/ETH selector, spot, DERIBIT LIVE chip, section count, EXIT TERMINAL
  - grouped left rail: Dashboard / Greeks / Flow / Volatility / Tools
  - horizontal mobile nav under `lg`
  - footer spot + live status
- Scoped teal theme in `src/index.css` under `.crypto-reference-shell`.

### Page-header anatomy (Phase 2 — DONE)

- `crypto/CryptoPageHeader.tsx` — white title + italic teal highlight + muted description + actions.
- Applied to Overview, Greek Exposure, Options Flow, Key Levels, Open Interest, Vol & Skew.

### Pages (all live-Deribit backed)

| Page | File | Content |
|------|------|---------|
| Overview | `CryptoDashboardView.tsx` | KPI strip, market summary, BTC/ETH vol monitor, term structure, GEX profile, expiry ladder |
| Greek Exposure | `CryptoHeatmapView.tsx` | GEX/DEX/VEX/CHARM tabs, weight + strike-range controls, strike × expiry canvas heatmap, strike profile, expiry concentration, per-strike OI + exposure table |
| Key Levels | `CryptoLevelsView.tsx` | GEX flip / net GEX / max pain / spot cards, level ladder with strength bars, regime notes |
| Options Order Flow | `CryptoFlowView.tsx` | SVG bubble flow map (strike offset × premium, size = notional, filled = buy / outlined = sell), flow-class cards, moneyness flow table, premium by expiry, largest prints, live tape |
| Open Interest | `CryptoOiView.tsx` | Max pain / call OI / put OI / P:C cards, OI by strike (put-left call-right), OI by expiry, expiry ladder with avg IVs |
| Vol & Skew | `CryptoVolSkewView.tsx` | ATM term structure, 25Δ risk reversal per expiry (vp, tolerance-banded delta matching), wing matrix by delta bucket, skew callouts |

### Server / data

- `server.js`: `/api/deribit/trades/:currency` (1/4/24h windows, cached 5s).
- `deribitClient.ts`: `DeribitOptionTrade`, `fetchDeribitTrades`.
- `useCryptoDualBooks.ts`: `summarizeDeribitTape` (nearest-30D ATM IV, OI, volume) + `atmIv30d` on the dual tape.

## Current shortcomings

1. Reference supports multiple venues (Derive, Binance, Bybit, OKX, Thalex, Paradex); VOLATERM wires Deribit primary + a live Deribit/OKX/Bybit venue-comparison strip on Open Interest (`/api/venues/options/:currency`). Derive/Thalex/Paradex still absent.
2. ~~IV/RV history chart not implemented~~ **DONE** — "IV vs RV History" in `CryptoVolSkewView` (Deribit DVOL vs realized-vol index, 7/30/90/180/365d, deep-linked `?hist=`).
3. Flow map is strike-offset × premium; the reference also plots time on one axis option.
4. ~~URL persists `?crypto=` only~~ **DONE (2026-08)** — `?crypto=` + `?page=` deep-links every section; per-view filters persist via `useUrlSearchParam`: Flow `?window=` (1/4/24h), Heatmaps `?greek=` (gex/dex/vex/charm), Funding `?fdays=` (1/7/30/90), Vol&Skew `?hist=` (7..365). Remaining filters (side, min-notional, weight, spot-band) are still session-local.
5. ~~Crypto pages are not lazy-loaded~~ **DONE** — all Crypto views are `React.lazy` chunks in `BtcView.tsx` (own dist chunks verified).
6. ~~Tail Strike, Scanner, Block RFQ, Divergence, Lead-Lag, Premium Matrix, and Futures pages are not implemented~~ — **DONE: Tail Strike, Scanner, Futures Basis/Term/Funding, Option Calculator** (all mounted in nav + shell groups). **Still missing: Block RFQ, Divergence, Lead-Lag, Premium Matrix** (Premium-matrix math exists in `premiumMath.ts`; no dedicated page yet).

## Recommended next implementation order

### Phase 6 — Depth & polish

1. ~~IV/RV time-series history~~ **DONE** (`CryptoVolSkewView` IV vs RV panel).
2. ~~Lazy-load Crypto views~~ **DONE** (`BtcView.tsx` React.lazy; chunk split verified in dist).
3. ~~Deep-link page + filters into the URL~~ **DONE for page + one filter per view** (`useUrlSearchParam`); remaining: side/min-notional/weight/spot-band.
4. Multi-venue expansion where public APIs exist — **partial**: Deribit/OKX/Bybit aggregation live (`/api/venues/options/:currency`, OI page strip); full per-venue pages not built.
5. ~~Tail Strike / Scanner pages~~ **DONE** (from existing exposure grids).

## Visual verification workflow

Use Playwright for both reference and local screenshots.

```bash
node - <<'NODE'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1536, height: 960 } });
  await page.goto('https://www.derivativesmonkey.com/btc/dashboard', {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await page.waitForTimeout(10000);
  await page.screenshot({ path: '/tmp/reference.png', fullPage: false });
  await browser.close();
})();
NODE
```

Local comparison:

```bash
node - <<'NODE'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1536, height: 960 } });
  await page.goto('http://127.0.0.1:3204/?crypto=BTC', { waitUntil: 'networkidle' });
  const enter = page.getByRole('button', { name: /enter/i }).first();
  if (await enter.count()) await enter.click();
  await page.keyboard.press('4');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/tmp/local.png', fullPage: false });
  await browser.close();
})();
NODE
```

Compare at:

- 1536×960
- 1440×1000
- 1280×800
- 375×812

Check:

- rail width
- header height
- content left edge
- card dimensions
- typography scale
- section gaps
- chart height
- table density
- active/hover/focus states
- no horizontal body overflow

## Local development

API:

```bash
node server.js
```

Frontend on a free port:

```bash
VITE_PORT=3204 API_TARGET=http://127.0.0.1:3001 npx vite --host 0.0.0.0
```

Verification:

```bash
npm run type-check
npm run lint
npm test -- --run
npm run build
```

Most recent successful checks before this handoff:

- TypeScript passed
- Lint clean
- Production build passed
- 115 test files passed
- 508 tests passed
- 375px body/document width matched viewport
- All six crypto pages verified visually at 1536×960 via Playwright screenshots

## Security constraints

- Never place provider keys in browser code.
- Keep keys only in server `.env`.
- Never print or commit secrets.
- Deribit public endpoints require no key.
- Do not proxy arbitrary user-provided URLs.
- Preserve Fastify route validation and rate limiting.

## Definition of done

The rebuild is done only when:

1. Crypto shell visually matches the reference composition at 1536×960.
2. Dashboard, Greek Exposure, Heatmaps, Flow, OI, Skew, IV/RV, and Levels have dedicated pages.
3. All displayed values come from VOLATERM providers or are clearly unavailable.
4. No proprietary reference assets/source are copied.
5. Keyboard focus, labels, contrast, and mobile navigation work.
6. URL reflects asset, page, and major filters.
7. Type-check, lint, tests, and production build pass.
8. Side-by-side screenshots are reviewed before claiming completion.
