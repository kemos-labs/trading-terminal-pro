# VOLATERM Orchestration — Bloomberg Research + Home Upgrade + Dual-Agent Plan

| Field | Value |
|-------|--------|
| **Date** | 2026-07-12 |
| **Orchestrator** | Grok (this session) — Bloomberg UX research, product IA, gap map, task briefs |
| **Implementer** | Claude Code + **Tencent Hy3** (295B MoE, 21B active, ~256–262K ctx) |
| **Product** | VOLATERM — `the repository root` |
| **Related** | `docs/BLOOMBERG_SHELL_REDESIGN.md`, `DESIGN.md`, `UI_UX_PLAN.md` |

---

## 1. Roles (do not invert)

### Orchestrator (Grok / this agent)

- Master **Bloomberg-like** UX principles from public manuals, university guides, screenshots/threads, and official product pages (not a licensed BBG clone).
- Map BBG *mental models* → VOLATERM desks/functions/APIs.
- Write **scoped task packs** for Hy3; review diffs; decide sequence.
- Keep data honesty: LIVE / DELAYED / STALE; never fake BBG-quality feeds.
- Prefer surgical product IA over greenfield rewrites.

### Implementer (Claude Code + Hy3)

- Execute one task pack at a time with tests.
- Strong at multi-file coding, tool use, grounded implementation.
- **Do not** invent Bloomberg product claims, licensed mnemonics as product names, or fake live multi-symbol BBO.
- Use **our** function codes (`SURF`, `GEX`, `GRK`, …) — BBG names only in comments/docs as *inspiration*.
- After each pack: report files touched, test commands, residual risks.

### Why Hy3 for implement work

Public specs (OpenRouter / Tencent Hy3, mid-2026):

| Trait | Implication for tasks |
|-------|------------------------|
| 295B MoE, ~21B active | Cheap high-volume coding vs frontier closed models |
| ~256–262K context | Good for large file slices + AGENTS.md + task pack |
| Configurable think / no-think | Use **high think** for multi-file refactors; no-think for tiny CSS |
| Agentic / tool-call focus | Good for “read, edit, run vitest” loops |
| Anti-hallucination positioning | Still require **tests + orchestrator review** for finance math |
| Coding vs Claude Sonnet/Opus | Hy3 often trails pure coding benchmarks slightly; **decompose** tasks; keep math in small PRs with goldens |

**Rule:** Hy3 implements UI/shell/home wiring. Orchestrator (or a second pass) owns Greeks unit goldens, surface math, and Bloomberg product truth.

---

## 2. Greeks chrome fix (shipped this session)

**Problem:** Greeks desk showed a full chip row (`SPY QQQ AAPL… Custom…`) plus `Follow terminal: SPY` and a long “Computing Greeks…” line even when the terminal header already owned the symbol.

**Fix:** `Greeks10View.tsx` — default follow remains on; compact one-line chrome (`SPY · terminal · chain…` + **Change**); chips only when expanded; no banner essay while loading.

**Verify:** Open Greeks with header symbol SPY → no chip wall until Change.

---

## 3. Bloomberg 101 — mental model (from public sources)

Sources consulted (public): Bloomberg Professional product page; student Getting Started PDF; NYU/Columbia/CFI/Wall Street Oasis function lists; @TheTerminal / community threads (e.g. Hampton OVDV/ANR); Bloomberg UX essay on concealing complexity (tabbed panels, Launchpad).

### 3.1 Interaction grammar

| BBG concept | Behavior | VOLATERM today | Target |
|-------------|----------|----------------|--------|
| **Security load** | Ticker + yellow sector key (EQUITY/INDEX/…) | Header symbol + sanitize | Keep single global underlier; optional desk override only on demand |
| **Mnemonic + GO** | Short code then Enter/GO | `CommandLine` / palette + `functionRegistry` | Deepen codes; document in Help |
| **Yellow keys** | Market sector | N/A (options-first product) | Map only equity/index options + rates/crypto we support |
| **Green GO / Red Cancel** | Commit / abort | Enter in command line; Esc overlays | Keep; never fake BBG keyboard chrome |
| **Panels / Launchpad** | Multi-panel workspace; LLP monitors | LaunchpadGrid + single live desk | Honest “workspace memory” tiles (see shell redesign) — not dual-live v1 |
| **IB / News** | Collaboration + TOP/CN | Finnhub + SEC strip | Thin news only; no fake IB |
| **Help F1** | Contextual help | HELP function / glossary | Expand glossary for desk sections |

### 3.2 Core function map (inspiration → ours)

| BBG-ish function | What pros use it for | VOLATERM equivalent / gap |
|------------------|----------------------|---------------------------|
| **DES** | Security description / overview | Partial: Home regime banner + quote — **no full DES card** |
| **BQ** | Quote + fundamentals snapshot | FMP quote strip — **thin** |
| **HP / GP / GIP** | Hist price table / chart / intraday | FMP history spark on Home — **upgrade: denser GP panel** |
| **CN / TOP / N** | Company / top news | `NewsStrip` — Home orphan; not TOP categories |
| **OMON** | Option monitor (chain) | Positioning chain — **good** |
| **OVDV** | Vol surface | Vol Structure Surface + MacroVol IV — **core strength** |
| **SKEW** | Smile / skew | SmileView — **good** |
| **HIVG / HVT** | Hist IV / hist vol | IV rank from frames + RV from FMP — **upgrade IV history panel** |
| **OVME / OSA** | Multi-leg pricer / scenarios | StrategyBuilderStrip + desk — **partial** |
| **G / GPC** | Multi-security charts | Missing multi-compare |
| **WEI** | World equity indices | Missing (could be delayed indices via free APIs) |
| **FA / ANR / ERN** | Fundamentals / analysts / earnings | Out of scope unless FMP fundamentals free tier |
| **WACC / DV** | Corp finance | Out of scope |
| **IRSB / GC** rates | Curves, money markets | Rates desk MacroVol FRED/STIR/FX/JGB — **strong free stack** |
| **ECO** | Economic calendar | Partial macro summary — **calendar pack gap** |
| **LLP Launchpad** | Custom monitors | LaunchpadGrid codes — **expand presets** |
| **Portfolio / RISK** | Book risk | portfolio Greeks analytics — **single-name book only** |

### 3.3 Visual / density principles (what “feels BBG”)

1. **Information density first** — more numbers per viewport; less marketing whitespace.
2. **Persistent quote context** — underlier always in chrome (we have header).
3. **Function codes as language** — muscle memory over nested menus.
4. **Monochrome graphite + semantic color** — up/down/warn only for data, not decoration.
5. **Conceal complexity** — advanced tools behind modes/sections, not 12 chrome rows.
6. **Honesty over cosplay** — delayed free data is fine if labeled; never imply OPRA full depth.

---

## 4. Full app review (upgrade candidates)

### 4.1 Home (DashboardView) — priority P0

| Issue | Severity | Direction |
|-------|----------|-----------|
| Vertical scroll farm: regime + GEX strip + feed health + launchpad + nav chips + collapsible feeds + many panels | High | **Launchpad-first briefing**: one “desk state” band, 6–8 function tiles with live badges, collapse secondary charts |
| Duplicate nav (launchpad + quick buttons + function bar) | Med | Kill quick button row; rely on FunctionMenuBar + Launchpad |
| Watchlist/news only when feeds open | Med | Optional thin shell strips (already in shell prefs) — default on for pro density |
| No DES-like identity block | Med | Compact DES: name, spot, day%, ATM IV, IVR, GEX sign, next exp, data age |
| Action chips good but buried | Med | Promote top 3 actions into regime band |
| Charts (OI bars, area) compete with decision row | Low | Move to “Detail” collapsible |

### 4.2 Shell chrome

| Item | Status | Next |
|------|--------|------|
| FunctionMenuBar 7 desks | Shipped | Ensure active desk matches BBG “yellow focus” density |
| Global playback removed | Shipped | Vol-only playback stays |
| Command palette | Present | Add more aliases (OMON→CHAIN, OVDV→SURF as *aliases* in keywords only) |
| StatusBar freshness | Present | Always show source chain age |

### 4.3 Desks

| Desk | Strength | Upgrade |
|------|----------|---------|
| **Vol** | Surface/smile/term | HIVG-style hist IV strip; term label consistency |
| **Positioning** | GEX/chain | OMON density; wall labels like BBG monitor columns |
| **Greeks** | MacroVol + mesh | Symbol chrome fixed; mesh=Plotly when MacroVol grid |
| **MM Desk** | Edge/strategy | Scenario ladder (OVME-lite) without fake fills |
| **Crypto** | Perp basis | Keep delayed badges |
| **Rates** | FRED/STIR/FX/JGB | ECO-lite calendar; WEI-lite global tape delayed |

### 4.4 API inventory (honest delayed OK)

| Source | Use | Latency class |
|--------|-----|----------------|
| Yahoo / yfinance (MacroVol) | Chains, Greeks, IV | DELAYED |
| FMP | Quote, history | DELAYED / key |
| Finnhub | News | DELAYED / key |
| FRED | Rates/macro | Official, not tick |
| NY Fed / FiscalData | Plumbing/auctions | Daily |
| CoinGecko / Bybit public | Crypto spot/basis | Near-real public |
| Deribit | Crypto options path | Public |
| SEC EDGAR | Filings context | Event |

**Do not add:** Fake Level-2, fake IB chat, fake “Bloomberg News” branding.

---

## 5. Phased delivery plan

### Phase A — Home density (Hy3 task pack 1) — **next**

- Redesign `DashboardView` layout: regime DES band → action chips → Launchpad with live badges → collapsible analytics.
- Remove redundant quick-nav row.
- Preserve all data hooks; no math changes.
- Tests: `DashboardView.test.tsx` update selectors; no snapshot brittleness.

### Phase B — Function registry aliases (Hy3 pack 2)

- Keywords: OMON→CHAIN, OVDV→SURF, SKEW→SMILE, HIVG→TERM/vol hist if built.
- Help overlay lists codes in BBG-study table (ours only as codes).

### Phase C — DES + GP panels (Pack 3) — **done**

- Compact security DES card on Home; GP-lite from FMP path.

### Phase D — Hist IV / HIVG-lite (Pack 4)

- ATM IV series from `historicalFrames` (front min-DTE atmIV per frame).
- Dense spark + IV high/low/rank on Home (always visible, not buried in Analytics).
- Reuse `ivRank` / existing high-low logic; no MacroVol new endpoints required for v1.

### Phase E — Rates ECO-lite + WEI-lite (optional)

- Macro calendar from existing MacroVol if endpoints exist; else skip.
- Global yields board already exists — surface on Home rates strip.

### Phase F — Shell tiles dogfood (from BLOOMBERG_SHELL_REDESIGN)

- Only after A–C; single live mount rule remains.

---

## 6. Task queue for Hy3 (copy one pack at a time)

See **§8 Prompt** for the system role. Below are implementation packs.

### Pack 1 — Home briefing layout

**Goal:** Home feels like a Bloomberg Launchpad + security summary, not a long blog.

**Do:**

1. Read `DashboardView.tsx`, `LaunchpadGrid.tsx`, `BootBriefing.tsx`, `UI_COPY`, `functionRegistry`.
2. Restructure JSX order: Regime/DES band → top 3 action chips → LaunchpadGrid → GexLevelsStrip → FeedHealth → collapsible “Analytics” (charts, portfolio greeks, strategy, etc.).
3. Delete the duplicate `Quick nav` button row (FunctionMenuBar + Launchpad cover it).
4. Keep all computations; only layout/visibility.
5. Run `npx vitest run src/components/views/DashboardView.test.tsx` (and related).
6. Match existing Tailwind density tokens (`text-type-xs`, `font-mono`, borders).

**Do not:** Change store shape, APIs, math, add new dependencies, rename desks.

### Pack 2 — Registry aliases + Help table

**Goal:** Command language closer to what pros type; palette finds BBG-study synonyms without claiming BBG product.

**Do:**

1. Read `functionRegistry.ts`, `functionRegistry.test.ts`, `CommandPalette.tsx`, `CommandLine.tsx`, `ShortcutsOverlay.tsx`.
2. Add **secondary codes and/or keywords** (prefer codes only when they do not collide with ours):
   - `OMON` → chain (`positioning:pos-sub-chain` / CHAIN)
   - `OVDV` → surface (`vol:vol-sub-surface` / SURF)
   - `SKEW` → smile (`vol:vol-sub-smile` / SMILE)
   - `HIVG` or `HVT` → term / vol hist path if section exists, else `vol` + keywords `historical iv`
   - `OVME` → strategy (`positioning:pos-sub-strategy` / STRAT) if present
   - Optional: `DES` → home (keywords only is fine)
3. `resolveFunctionId('OMON')` etc. must open the right desk+section (same as primary codes).
4. Extend `ShortcutsOverlay` (HELP/`?`) with a short **Function codes** section listing primary codes + study aliases in mono dense text. Label clearly: “VOLATERM codes (BBG-study aliases in palette only)”.
5. Tests in `functionRegistry.test.ts` for each new resolve path + one `searchFunctions('omondv'/'ovdv')` style hit.
6. **Do not** brand UI as Bloomberg; do not rename primary codes (SURF stays SURF).

**Do not:** Touch DashboardView, Greeks, math, APIs.

### Pack 3 — DES card (+ optional GP spark)

**Goal:** Always-visible security identity block so Home feels complete even with Analytics collapsed (Pack 1 residual).

**Do:**

1. Create `src/components/common/SecurityDesCard.tsx` — dense mono card, props only (no store imports if easy; ok to use store if matching other strips).
   Fields when data present: **symbol**, **spot**, **day chg %**, **ATM IV front**, **IV rank %**, **GEX short label**, **next DTE / nearest expiry**, **source/chain age or label** (reuse existing freshness helpers if any — no fake “live OPRA”).
2. Mount on Home **between regime band and top action chips** (or directly under chips if regime already repeats everything — prefer **replace redundancy**: if DES duplicates the entire regime band, thin the regime band *only* if needed; prefer DES as structured 2-row grid under regime without deleting regime).
3. Optional: small 60d close spark from `fmpHistory` (already in DashboardView as `quotePath`) — denser than Analytics Spot panel; skip if no history.
4. Unit test: `SecurityDesCard.test.tsx` with fixture props; DashboardView test asserts DES presence without expanding Analytics.
5. No new deps; no math/API changes; surgical.

**Do not:** Full FA/ANR fundamentals, Bloomberg branding, SidePanel wiring (defer).

### Pack 4 — HIVG-lite (hist ATM IV strip)

**Goal:** Always-visible front ATM IV history (session / ring buffer) so HIVG study path is real UI, not only Analytics MiniStats.

**Do:**

1. Add `src/components/common/HistIvStrip.tsx` (props-only preferred):
   - Build or accept `series: number[]` of front (min-DTE) `atmIV` per `historicalFrames` entry (same logic as DashboardView `ivHighLow` loop).
   - Dense mono strip: label **HIVG** (VOLATERM code path; caption “hist ATM IV”), sparkline, **now / high / low**, optional **IV rank %** prop.
   - If `series.length < 2`, render compact “HIVG · need ≥2 frames” or hide spark but still show current ATM if provided — no dummy series.
2. Mount on Home **under DES card, before action chips** (always visible; not inside Analytics).
3. Optional: small “Open TERM →” that calls existing `go('vol', 'vol-sub-term')` / `openFunction` — keep one line.
4. Tests: `HistIvStrip.test.tsx` + DashboardView asserts strip (or data-testid) without expandAnalytics when frames ≥ 2 (seedLiveDashboard already has 8 frames).
5. Extract shared “front atmIV from frame” helper only if it avoids duplicating the loop thrice — optional pure fn in `analytics.ts` or local to strip. No API/store/math formula changes to IV rank.

**Do not:** New MacroVol endpoints, recharts heavy chart, touch Greeks, rename codes, Bloomberg branding.

### Pack 5 — Home density dogfood (recommended next)

**Goal:** After Packs 1–4, landing is correct but **vertical chrome is thick again** (regime + DES + HIVG + chips + Launchpad + GEX + FeedHealth). Conceal complexity: one denser briefing block.

**Do (pick implementation that keeps tests green):**

1. Visually merge **DES + HIVG** into a single card with two rows (DES stats row + HIVG spark row) OR nest HIVG inside SecurityDesCard as optional props — keep both `data-testid`s if tests rely on them.
2. Cap landing bands: **regime → combined DES/HIVG → chips (3) → Launchpad → GEX → FeedHealth** — no new strips.
3. Optionally demote FeedHealth to a single-line status inside regime or Launchpad footer (only if tests allow).
4. No new features, no rates ECO, no math.

**Alternate Pack 5B (only if human prefers more data):** ECO-lite — thin auctions strip from `macrovolApi.ratesAuctions` inside Analytics only (not landing).

---

## 7. Orchestrator checklist after each Hy3 pack

- [ ] Diff is surgical (no drive-by refactors)
- [ ] Tests green
- [ ] No fake live claims in copy
- [ ] Keyboard shortcuts still work
- [ ] Greeks still follow terminal symbol without chip wall
- [ ] Update this doc status if phase completes

---

## 8. Prompt to paste into Claude Code (Hy3)

Copy everything in the block below as the **first message** to your Hy3 / Claude Code session.

```text
# ROLE
You are the IMPLEMENTER agent for VOLATERM (options trading terminal).
Grok is the ORCHESTRATOR: product IA, Bloomberg-inspired UX research, gap map, task sequencing, and review.
You do NOT redefine product direction. You execute ONE scoped task pack at a time.

# MODEL NOTES (Hy3)
You are running on Tencent Hy3 (or Claude Code with Hy3): strong multi-file agent loops, large context, configurable reasoning.
- Prefer grounded edits from files you read.
- For finance/UI copy: never invent data quality claims (no “real-time OPRA”, no Bloomberg branding).
- Use high reasoning for multi-file layout refactors; keep diffs surgical (Karpathy: no drive-by cleanup).
- After work: list files changed, commands run, residual risks. Do not commit unless the human asks.

# REPO
Workspace: the repository root
Stack: React 19, Vite, Zustand, Tailwind, Vitest; Node server.js; MacroVol FastAPI under macrovol-api/
Read first:
- docs/engineering/ORCHESTRATION_BBG_HOME.md (this plan)
- docs/BLOOMBERG_SHELL_REDESIGN.md (shell constraints)
- DESIGN.md (as-built)
- src/config/functionRegistry.ts
- src/components/views/DashboardView.tsx
- src/components/terminal/FunctionMenuBar.tsx
- src/components/views/Greeks10View.tsx (symbol chrome already fixed — follow terminal compact; do not reintroduce chip walls)

# BLOOMBERG RULES (inspiration only)
We imitate mental models: function codes, density, Launchpad, DES summary, OMON/OVDV/SKEW-like tools.
We do NOT ship licensed Bloomberg mnemonics as product names, fake news terminals, or multi-live fake panels.
Our codes: HOME VOL SURF SMILE TERM POS CHAIN GEX GRK RATES SOFR … (see functionRegistry).
Data may be delayed (Yahoo/FMP/FRED) — always preserve freshness labels.

# CURRENT TASK PACK
Execute ONLY Pack 1 from docs/engineering/ORCHESTRATION_BBG_HOME.md §6:

Home briefing layout:
1. Restructure DashboardView: Regime/DES band → top action chips (max 3 visible) → LaunchpadGrid → GexLevelsStrip → FeedHealth → collapsible Analytics for the rest.
2. Remove duplicate Quick nav button row.
3. No math/store/API changes.
4. Update/fix tests.
5. Match existing mono dense styles.

Success criteria:
- Home no longer opens with a long vertical wall of equal-weight panels.
- Launchpad + regime band dominate first screen.
- vitest for DashboardView passes.
- No new dependencies.

When Pack 1 is done, STOP and report. Wait for the next pack from the orchestrator / human.
Do not start Pack 2+ unless asked.

# CONSTRAINTS
- Surgical diffs only.
- Do not reverse Greeks compact symbol chrome.
- Do not reintroduce global playback on all desks.
- Prefer existing components (Panel, LaunchpadGrid, Explain, Freshness).
```

---

## 9. Immediate status

| Item | Status |
|------|--------|
| Greeks redundant symbol wall | **Fixed** |
| Bloomberg research baseline | **Documented** §3 |
| Home upgrade Pack 1 | **Accepted** 2026-07-13 |
| Pack 2 registry aliases | **Accepted** 2026-07-13 (10/10 tests; OMON/OVDV/SKEW/… resolve) |
| Pack 3 DES card | **Accepted** 2026-07-13 (8/8 tests; DES on landing) |
| Pack 4 HIVG-lite | **Accepted** 2026-07-13 (11/11 tests) |
| Pack 5 density dogfood | **Accepted** 2026-07-13 (14/14; DES+HIVG one card) |
| Pack train 1–5 | **Complete** — dogfood / commit next |
| Optional 5B ECO-lite | Deferred until human asks |
| Commit | Large WIP on master — ask before commit |

---

## 10. Reference links (public)

- https://professional.bloomberg.com/products/bloomberg-terminal/
- https://data.bloomberglp.com/professional/sites/10/Getting-Started-Guide-for-Students-English.pdf
- https://corporatefinanceinstitute.com/resources/equities/bloomberg-functions-shortcuts-list/
- https://guides.library.columbia.edu/bloomberg/basic
- https://guides.nyu.edu/bloombergguide/popular-commands
- https://www.bloomberg.com/company/stories/how-bloomberg-terminal-ux-designers-conceal-complexity/
- https://openrouter.ai/tencent/hy3:free (Hy3 model card)
