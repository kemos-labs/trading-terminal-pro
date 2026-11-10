/**
 * Representative real-server failure-state gate (release-candidate scope).
 *
 * Real Fastify process + built frontend; deterministic fixtures live at the
 * server/provider-adapter boundary and switch at runtime via
 * POST /api/__test/fixtures/scenario (registered only in fixture mode —
 * production never mounts /api/__test/*). No page.route() interception:
 * every byte the browser renders traverses real routes.
 *
 * Thirteen steps cover the seven required scenarios across all eight desks:
 * home-partial, vol-empty, pos-empty, trade-loading, rates-malformed,
 * crypto-partial, crypto-down, ksa-stale, ksa-entitlement, vol-stale, rates-stale, pos-stale, academy-empty.
 * (Vol + Positioning share the client chain, so chain-empty asserts both; vol-stale proves stale matrix.)
 *
 * This gate is representative, NOT the full C6 matrix: it does not cover
 * every workflow × scenario combination. That matrix remains scheduled.
 *
 * Fixture success here is deterministic state evidence, never live evidence.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';

const FULL_HEAD = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const EVIDENCE_HEAD = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const EVIDENCE_DIR = new URL('./screenshots/', import.meta.url);
mkdirSync(EVIDENCE_DIR, { recursive: true });

// Run/source identity stamped at capture time (never retrofitted).
// e2e/.capture-run.json is written by `npm run capture:identity` BEFORE the
// gate runs; the post-capture CLI (scripts/verify-capture-evidence.mjs)
// requires every new sidecar to carry this exact runId/sourceDigest.
function loadCaptureIdentity(): { runId: string | null; sourceDigest: string | null } {
  try {
    const raw = readFileSync(new URL('./.capture-run.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as { runId?: unknown; sourceDigest?: unknown };
    if (typeof parsed.runId === 'string' && typeof parsed.sourceDigest === 'string') {
      return { runId: parsed.runId, sourceDigest: parsed.sourceDigest };
    }
  } catch { /* no pre-capture identity: sidecars omit run identity and the post-capture gate fails closed */ }
  return { runId: null, sourceDigest: null };
}
const CAPTURE_IDENTITY = loadCaptureIdentity();

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

type Viewport = (typeof VIEWPORTS)[number];

interface StepContext {
  page: import('@playwright/test').Page;
  request: import('@playwright/test').APIRequestContext;
  viewport: Viewport;
  failedRoutes: string[];
  pageErrors: string[];
  consoleErrors: string[];
  requestFailed: { url: string; error: string }[];
}

async function setScenario(
  request: import('@playwright/test').APIRequestContext,
  body: Record<string, unknown>,
) {
  const res = await request.post('/api/__test/fixtures/scenario', { data: body });
  expect(res.status(), `scenario switch ${JSON.stringify(body)}`).toBe(200);
  return res.json();
}

interface CaptureOptions {
  ctx: StepContext;
  desk: string;
  workflow: string;
  scenario: string;
  deepLink: string;
  providerState: string;
  eventTime: string | null;
  fetchTime: string | null;
  axeTags?: string[];
  /** Narrow, documented console-error allowlist (fail-closed diagnostics only). */
  allowConsole?: RegExp[];
}

async function captureShot(options: CaptureOptions) {
  const { ctx, desk, workflow, scenario, deepLink, providerState, eventTime, fetchTime } = options;
  const shotName = `fail-${EVIDENCE_HEAD}-${scenario}-${ctx.viewport.name}-${desk}.png`;
  await ctx.page.screenshot({
    path: new URL(shotName, EVIDENCE_DIR).pathname,
    fullPage: true,
  });
  const axe = await new AxeBuilder({ page: ctx.page })
    .withTags(options.axeTags ?? ['wcag2a', 'wcag2aa'])
    .analyze();
  expect(
    axe.violations,
    `${scenario}/${desk} WCAG violations: ${JSON.stringify(axe.violations.map((v) => v.id))}`,
  ).toEqual([]);
  const diagnostics = await ctx.page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    text: document.body.innerText,
  }));
  expect(diagnostics.overflow, `${scenario}/${desk} horizontal overflow`).toBeLessThanOrEqual(1);
  expect(diagnostics.text, `${scenario}/${desk} leaked non-finite output`).not.toMatch(
    /\b(?:NaN|Infinity)\b/,
  );
  const allowed = options.allowConsole ?? [];
  // Per-step attribution: the listener accumulates across the whole viewport
  // test, so only messages logged since this step began count against it.
  const baseline = (ctx as unknown as { __consoleBaseline?: number }).__consoleBaseline ?? 0;
  // net::ERR_INTERNET_DISCONNECTED can only come from external hosts (the
  // Google Fonts CDN link in index.html; the sandbox has no internet and app
  // routes are localhost, which fails as CONNECTION_REFUSED instead). The
  // requestfailed audit below proves which external URLs actually failed.
  const externalDisconnect = /^Failed to load resource: net::ERR_INTERNET_DISCONNECTED/;
  const unexpectedConsole = ctx.consoleErrors.slice(baseline).filter(
    (m) => !allowed.some((re) => re.test(m)) && !externalDisconnect.test(m),
  );
  const externalFailed = ctx.requestFailed.filter((r) => {
    try {
      const host = new URL(r.url).hostname;
      return host !== '127.0.0.1' && host !== 'localhost';
    } catch {
      return true;
    }
  });
  const nonFontExternal = externalFailed.filter(
    (r) => !/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//.test(r.url),
  );
  expect(nonFontExternal, `${scenario}/${desk} non-font external requests failed`).toEqual([]);
  writeFileSync(
    new URL(`${shotName}.json`, EVIDENCE_DIR),
    JSON.stringify(
      {
        screenshot: shotName,
        commit: FULL_HEAD,
        commitShort: EVIDENCE_HEAD,
        ...(CAPTURE_IDENTITY.runId && CAPTURE_IDENTITY.sourceDigest
          ? { runId: CAPTURE_IDENTITY.runId, sourceDigest: CAPTURE_IDENTITY.sourceDigest }
          : {}),
        workflow,
        desk,
        scenario,
        deepLink,
        viewport: { name: ctx.viewport.name, width: ctx.viewport.width, height: ctx.viewport.height },
        mode: 'fixture',
        providerState,
        eventTime,
        fetchTime,
        capturedAt: new Date().toISOString(),
        live: false,
        checks: {
          horizontalOverflowPx: diagnostics.overflow,
          nonFiniteLeak: false,
          axeViolations: axe.violations.map((v) => v.id),
          failedRoutesSoFar: ctx.failedRoutes.length,
          pageErrorsSoFar: ctx.pageErrors.length,
          consoleErrorsSoFar: ctx.consoleErrors.length,
          unexpectedConsoleErrors: unexpectedConsole.length,
          externalFailedRequests: externalFailed.slice(-10),
        },
      },
      null,
      2,
    ),
  );
  expect(unexpectedConsole, `${scenario}/${desk} unexpected console errors`).toEqual([]);
}

function beginStep(ctx: StepContext) {
  (ctx as unknown as { __consoleBaseline?: number }).__consoleBaseline = ctx.consoleErrors.length;
}

function watch(ctx: StepContext) {
  ctx.page.on('pageerror', (error) => ctx.pageErrors.push(error.message));
  ctx.page.on('console', (message) => {
    if (message.type() === 'error') ctx.consoleErrors.push(message.text());
  });
  ctx.page.on('requestfailed', (req) => {
    ctx.requestFailed.push({ url: req.url(), error: req.failure()?.errorText ?? 'unknown' });
  });
  ctx.page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    // The scenario route itself is test infrastructure, not product surface.
    if (pathname.startsWith('/api/__test/')) return;
    if ((pathname.startsWith('/api/') || pathname.startsWith('/docs/')) && response.status() >= 400) {
      ctx.failedRoutes.push(`${response.status()} ${response.request().method()} ${pathname}`);
    }
  });
}

for (const viewport of VIEWPORTS) {
  test(`representative failure states render honestly at ${viewport.name}`, async ({
    page,
    request,
  }) => {
    test.slow();
    await page.setViewportSize(viewport);
    const ctx: StepContext = {
      page,
      request,
      viewport,
      failedRoutes: [],
      pageErrors: [],
      consoleErrors: [],
      requestFailed: [],
    };
    watch(ctx);
    const base = { ctx } as const;

    // 1. Home — partial (KSA down, everything else up).
    await test.step('home-partial', async () => {
      beginStep(ctx);
      await setScenario(request, { scenario: 'home-partial' });
      await page.goto('/?desk=home', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('home-briefing')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('home-feeds-aggregate')).toHaveText(/Partial/, { timeout: 15_000 });
      const probe = await request.get('/api/home/briefing?symbol=SPY');
      expect(probe.status()).toBe(200);
      const body = await probe.json();
      expect(body.freshness.state).toBe('partial');
      expect(body.desks.ksa.available).toBe(false);
      await captureShot({
        ...base,
        desk: 'home',
        workflow: 'home',
        scenario: 'home-partial',
        deepLink: '/?desk=home',
        providerState: 'sahmk 503 at boundary; finnhub/deribit/free-crypto/worker succeed',
        eventTime: body.asOf ?? null,
        fetchTime: new Date().toISOString(),
      });
    });

    // 2+3. Empty chain — Volatility and Positioning empty states (shared store chain).
    await test.step('vol-empty', async () => {
      beginStep(ctx);
      await setScenario(request, { scenario: 'chain-empty' });
      await page.goto('/?desk=vol&sec=vol-sub-surface', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('vol-structure-view')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('No live surface')).toBeVisible({ timeout: 15_000 });
      const probe = await request.get('/api/v1/market/options/SPY');
      const probed = probe.status() === 200 ? await probe.json().catch(() => null) : null;
      await captureShot({
        ...base,
        desk: 'volatility',
        workflow: 'vol-sub-surface',
        scenario: 'chain-empty',
        deepLink: '/?desk=vol&sec=vol-sub-surface',
        providerState: 'equity chain returns zero quotes; no rows fabricated',
        allowConsole: [/^Failed to load resource: the server responded with a status of 502/],
        eventTime: probed?.asOf ?? null,
        fetchTime: new Date().toISOString(),
      });
    });

    await test.step('pos-empty', async () => {
      beginStep(ctx);
      await setScenario(request, { scenario: 'chain-empty' });
      await page.goto('/?desk=positioning&sec=pos-sub-chain', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('positioning-view').first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('No dealer exposure')).toBeVisible({ timeout: 15_000 });
      await captureShot({
        ...base,
        desk: 'positioning',
        workflow: 'pos-sub-chain',
        scenario: 'chain-empty',
        deepLink: '/?desk=positioning&sec=pos-sub-chain',
        providerState: 'equity chain returns zero quotes; missing OI stays missing',
        allowConsole: [/^Failed to load resource: the server responded with a status of 502/],
        eventTime: null,
        fetchTime: new Date().toISOString(),
      });
    });

    // 4. Trade — loading (slow chain shows the loading skeleton first, then content).
    // renderDeskView paints the workflow-root testid around DeskLoading while
    // the chain is in flight, so the skeleton itself is the loading marker.
    await test.step('trade-loading', async () => {
      beginStep(ctx);
      await setScenario(request, { scenario: 'trade-loading' });
      await page.goto('/?desk=desk&sec=trade-sub-structure', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('trade-structure-workflow')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/Building chain surface/)).toBeVisible({ timeout: 15_000 });
      expect(await page.getByText('Blotter Σ').count()).toBe(0);
      await expect(page.getByText('Blotter Σ')).toBeVisible({ timeout: 30_000 });
      const probe = await request.get('/api/v1/market/options/SPY');
      const probed = probe.status() === 200 ? await probe.json().catch(() => null) : null;
      await captureShot({
        ...base,
        desk: 'trade',
        workflow: 'trade-sub-structure',
        scenario: 'trade-loading',
        deepLink: '/?desk=desk&sec=trade-sub-structure',
        providerState: 'equity chain delayed ~6s at boundary, then succeeds',
        // The gate runs without the Python rates worker: the post-chain Greeks
        // prefetch 502s (fail-closed, UI unaffected). Same environmental cause
        // as the documented worker-down evidence; not an app console error.
        allowConsole: [/^Failed to load resource: the server responded with a status of 502/],
        eventTime: probed?.asOf ?? null,
        fetchTime: new Date().toISOString(),
      });
    });

    // 5. Rates — malformed worker payload is rejected, fail-closed UI.
    await test.step('rates-malformed', async () => {
      beginStep(ctx);
      await setScenario(request, { scenario: 'rates-malformed' });
      await page.goto('/?desk=rates&sec=rates-mode-funding', { waitUntil: 'domcontentloaded' });
      // .first(): the shell wrapper duplicates the rates-view testid by design.
      await expect(page.getByTestId('rates-view').first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Rates API unavailable')).toBeVisible({ timeout: 15_000 });
      const probe = await request.get('/api/macrovol/rates/summary');
      expect(probe.status()).toBe(502);
      await captureShot({
        ...base,
        desk: 'rates',
        workflow: 'rates-mode-funding',
        scenario: 'rates-malformed',
        deepLink: '/?desk=rates&sec=rates-mode-funding',
        providerState: 'rates worker answers 200 text/html; rejected as invalid_payload, never cached',
        allowConsole: [/^Failed to load resource: the server responded with a status of 502/],
        eventTime: null,
        fetchTime: new Date().toISOString(),
      });
    });

    // 6. Crypto — one venue down stays Partial with the surviving venue.
    await test.step('crypto-partial', async () => {
      beginStep(ctx);
      await setScenario(request, { scenario: 'crypto-partial' });
      await page.goto('/?desk=crypto&view=overview', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('overview-workstation')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('free-market-snapshot')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Partial', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
      const probe = await request.get('/api/free-crypto/market/BTC');
      const probed = probe.status() === 200 ? await probe.json().catch(() => null) : null;
      await captureShot({
        ...base,
        desk: 'crypto',
        workflow: 'crypto-v2-overview',
        scenario: 'crypto-partial',
        deepLink: '/?desk=crypto&view=overview',
        providerState: 'Binance 500 at boundary; Bybit succeeds independently',
        eventTime: null,
        fetchTime: probed?.fetchedAt ? new Date(probed.fetchedAt).toISOString() : new Date().toISOString(),
      });
    });

    // 7. Crypto — Deribit down, free snapshot stays independent.
    await test.step('crypto-down', async () => {
      beginStep(ctx);
      await setScenario(request, { scenario: 'crypto-down' });
      await page.goto('/?desk=crypto&view=overview', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Deribit unavailable')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('free-market-snapshot')).toBeVisible({ timeout: 15_000 });
      const down = await request.get('/api/deribit/market/BTC');
      expect(down.status()).toBe(502);
      const free = await request.get('/api/free-crypto/market/BTC');
      const freed = free.status() === 200 ? await free.json().catch(() => null) : null;
      await captureShot({
        ...base,
        desk: 'crypto',
        workflow: 'crypto-v2-overview',
        scenario: 'crypto-down',
        deepLink: '/?desk=crypto&view=overview',
        providerState: 'Deribit 503 at boundary; Binance+Bybit succeed independently',
        allowConsole: [/^Failed to load resource: the server responded with a status of 502/],
        eventTime: null,
        fetchTime: freed?.fetchedAt ? new Date(freed.fetchedAt).toISOString() : new Date().toISOString(),
      });
    });

    // 8. KSA — stale serve: warm the board, fail upstream, expire the entry.
    await test.step('ksa-stale', async () => {
      beginStep(ctx);
      await setScenario(request, { scenario: 'success' });
      const warm = await request.get('/api/ksa/board');
      expect(warm.status()).toBe(200);
      expect(warm.json().tasi?.index_value).not.toBeNull();
      await setScenario(request, {
        scenario: 'sahmk-down',
        clearCache: false,
        expire: { 'ksa:board:v1': 3_600_000 },
      });
      await page.goto('/?desk=ksa&sec=ksa-sub-board', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('ksa-view').first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Showing last good board')).toBeVisible({ timeout: 15_000 });
      const probe = await request.get('/api/ksa/board');
      const probed = probe.status() === 200 ? await probe.json().catch(() => null) : null;
      expect(probed?.stale).toBe(true);
      await captureShot({
        ...base,
        desk: 'ksa',
        workflow: 'ksa-sub-board',
        scenario: 'ksa-stale',
        deepLink: '/?desk=ksa&sec=ksa-sub-board',
        providerState: 'board warmed, then SAHMK 503; last-good board served stale',
        eventTime: probed?.as_of ?? null,
        fetchTime: new Date().toISOString(),
      });
    });

    // 9. KSA — entitlement denied: gated desk without entitlement.
    // The shell paywall (DeskPaywall) renders instead of the desk: 'Unlock
    // this desk'. The view-level 'Subscription required' branch covers direct
    // renders and is unit-tested separately.
    await test.step('ksa-entitlement', async () => {
      beginStep(ctx);
      await setScenario(request, { scenario: 'ksa-entitlement', billingEnabled: true });
      const probe = await request.get('/api/ksa/board');
      expect(probe.status()).toBe(402);
      await page.goto('/?desk=ksa&sec=ksa-sub-board', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Unlock this desk')).toBeVisible({ timeout: 15_000 });
      expect(await page.getByTestId('ksa-view').count()).toBe(0);
      const bodyText = await page.evaluate(() => document.body.innerText);
      expect(bodyText, 'no account identifiers leak into denial UI').not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      expect(bodyText, 'no board numbers leak into denial UI').not.toMatch(/12,150/);
      await captureShot({
        ...base,
        desk: 'ksa',
        workflow: 'ksa-sub-board',
        scenario: 'ksa-entitlement',
        deepLink: '/?desk=ksa&sec=ksa-sub-board',
        providerState: 'billing gate enabled, no entitlement: HTTP 402 subscription_required',
        allowConsole: [/^Failed to load resource: the server responded with a status of 402/],
        eventTime: null,
        fetchTime: new Date().toISOString(),
      });
      await setScenario(request, { scenario: 'success' });
    });

    // 11. Vol — stale serve: warm the canonical chain fresh, fail upstream, expire that exact entry.
    // Transition proof is API-level (cache.state/ageMs on the same v1 route the
    // UI reads). The skew "Stale" badge is NOT transition evidence: fixture event
    // time is frozen (FIXED_NOW 2026-09-01) so the 96h snapshot-age rule marks even
    // the warm render stale. Likewise the envelope `freshness` field derives from
    // that frozen asOf and reads 'stale' on warm too — only `cache` (wall-clock
    // server metadata) proves the fresh→stale transition.
    await test.step('vol-stale', async () => {
      beginStep(ctx);
      await setScenario(request, { scenario: 'success' });
      const warm = await request.get('/api/v1/market/options/SPY');
      expect(warm.status()).toBe(200);
      const warmed = await warm.json().catch(() => null);
      expect(Array.isArray(warmed?.data?.quotes) && warmed.data.quotes.length > 0).toBe(true);
      expect(warmed?.cache?.stale).toBe(false);
      expect(warmed?.cache?.ageMs).toBeLessThan(120_000);
      await setScenario(request, {
        scenario: 'vol-stale',
        clearCache: false,
        expire: { 'options:SPY:full': 300_000 },
      });
      await page.goto('/?desk=vol&sec=vol-sub-surface', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('vol-structure-view')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('vol-surface-matrix')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('No live surface')).toHaveCount(0);
      const probe = await request.get('/api/v1/market/options/SPY');
      expect(probe.status()).toBe(200);
      const probed = await probe.json().catch(() => null);
      expect(probed?.cache?.stale).toBe(true);
      expect(probed?.cache?.state).toBe('stale');
      expect(probed?.cache?.ageMs).toBeGreaterThan(200_000);
      expect(probed?.cache?.ageMs).toBeLessThan(600_000);
      expect(Array.isArray(probed?.data?.quotes) && probed.data.quotes.length > 0).toBe(true);
      expect(probed?.data?.quotes.length).toBe(warmed?.data?.quotes.length);
      await captureShot({
        ...base,
        desk: 'volatility',
        workflow: 'vol-sub-surface',
        scenario: 'vol-stale',
        deepLink: '/?desk=vol&sec=vol-sub-surface',
        providerState: 'canonical v1 chain warmed fresh (cache.stale=false), then equity 503 with options:SPY:full backdated 300s; last-good chain served stale (cache.state=stale, ageMs bounded 200-600s); envelope asOf is frozen fixture event time, not transition evidence',
        eventTime: probed?.asOf ?? null,
        fetchTime: probed?.fetchedAt ?? new Date().toISOString(),
      });
      await setScenario(request, { scenario: 'success' });
    });

    // 12. Rates — stale serve: warm the summary fresh, fail the worker summary path, expire that exact entry.
    // Transition proof is API-level (cache.state/ageMs on the same macrovol route the
    // funding view reads) plus the workflow-specific pill: RatesPanel renders
    // `rates-stale` ONLY when `cache.stale === true` (strict server envelope;
    // frozen FRED `as_of` never implies stale). Only /rates/summary 503s under
    // rates-stale, so plumbing/curve/basis stay live and numerics stay populated.
    await test.step('rates-stale', async () => {
      beginStep(ctx);
      await setScenario(request, { scenario: 'success' });
      const warm = await request.get('/api/macrovol/rates/summary');
      expect(warm.status()).toBe(200);
      const warmed = await warm.json().catch(() => null);
      expect(warmed?.sofr).toBe(4.53);
      expect(warmed?.effr).toBe(4.32);
      expect(warmed?.cache?.stale).toBe(false);
      await setScenario(request, {
        scenario: 'rates-stale',
        clearCache: false,
        expire: { 'macrovol:/rates/summary': 300_000 },
      });
      await page.goto('/?desk=rates&sec=rates-mode-funding', { waitUntil: 'domcontentloaded' });
      // .first(): the shell wrapper duplicates the rates-view testid by design.
      await expect(page.getByTestId('rates-view').first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('rates-stale')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Rates API unavailable')).toHaveCount(0);
      const probe = await request.get('/api/macrovol/rates/summary');
      expect(probe.status()).toBe(200);
      const probed = await probe.json().catch(() => null);
      expect(probed?.cache?.stale).toBe(true);
      expect(probed?.cache?.state).toBe('stale');
      expect(probed?.cache?.ageMs).toBeGreaterThan(200_000);
      expect(probed?.cache?.ageMs).toBeLessThan(600_000);
      expect(probed?.sofr).toBe(4.53);
      expect(probed?.effr).toBe(4.32);
      await captureShot({
        ...base,
        desk: 'rates',
        workflow: 'rates-mode-funding',
        scenario: 'rates-stale',
        deepLink: '/?desk=rates&sec=rates-mode-funding',
        providerState: 'rates summary warmed fresh (cache.stale=false), then worker /rates/summary 503 with macrovol:/rates/summary backdated 300s; last-good summary served stale (cache.state=stale, ageMs bounded 200-600s); other worker paths stay live',
        eventTime: probed?.as_of ?? null,
        fetchTime: new Date().toISOString(),
      });
      await setScenario(request, { scenario: 'success' });
    });

    // 13. Positioning — stale chain serve: warm the canonical chain fresh, fail upstream, expire that exact entry.
    // Transition proof is API-level (cache.state/ageMs on the same v1 route the
    // positioning chain reads, quotes.length preserved). The `chain-stale` pill
    // derives from existing chain provenance stale/expired state with rows
    // present; the empty path (`No live option chain`) stays pill-free. The pill
    // itself is NOT transition evidence: fixture event time is frozen
    // (FIXED_NOW 2026-09-01) so envelope `freshness` reads stale on warm too —
    // only `cache` (wall-clock server metadata) proves the fresh→stale transition.
    await test.step('pos-stale', async () => {
      beginStep(ctx);
      await setScenario(request, { scenario: 'success' });
      const warm = await request.get('/api/v1/market/options/SPY');
      expect(warm.status()).toBe(200);
      const warmed = await warm.json().catch(() => null);
      expect(Array.isArray(warmed?.data?.quotes) && warmed.data.quotes.length > 0).toBe(true);
      expect(warmed?.cache?.stale).toBe(false);
      expect(warmed?.cache?.ageMs).toBeLessThan(120_000);
      await setScenario(request, {
        scenario: 'pos-stale',
        clearCache: false,
        expire: { 'options:SPY:full': 300_000 },
      });
      await page.goto('/?desk=positioning&sec=pos-sub-chain', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('positioning-view').first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('chain-stale')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('No live option chain')).toHaveCount(0);
      const probe = await request.get('/api/v1/market/options/SPY');
      expect(probe.status()).toBe(200);
      const probed = await probe.json().catch(() => null);
      expect(probed?.cache?.stale).toBe(true);
      expect(probed?.cache?.state).toBe('stale');
      expect(probed?.cache?.ageMs).toBeGreaterThan(200_000);
      expect(probed?.cache?.ageMs).toBeLessThan(600_000);
      expect(Array.isArray(probed?.data?.quotes) && probed.data.quotes.length > 0).toBe(true);
      expect(probed?.data?.quotes.length).toBe(warmed?.data?.quotes.length);
      await captureShot({
        ...base,
        desk: 'positioning',
        workflow: 'pos-sub-chain',
        scenario: 'pos-stale',
        deepLink: '/?desk=positioning&sec=pos-sub-chain',
        providerState: 'canonical v1 chain warmed fresh (cache.stale=false), then equity 503 with options:SPY:full backdated 300s; last-good chain served stale (cache.state=stale, ageMs bounded 200-600s); envelope asOf is frozen fixture event time, not transition evidence',
        eventTime: probed?.asOf ?? null,
        fetchTime: probed?.fetchedAt ?? new Date().toISOString(),
      });
      await setScenario(request, { scenario: 'success' });
    });

    // 10. Academy — empty search is an honest empty state, not breakage.
    await test.step('academy-empty', async () => {
      beginStep(ctx);
      await setScenario(request, { scenario: 'success' });
      await page.goto('/?desk=academy&sec=academy-sub-options', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('academy-root')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('academy-search').fill('zzz-no-such-essay-zzz');
      await expect(page.getByText('No essays yet.')).toBeVisible({ timeout: 15_000 });
      const probe = await request.get('/docs/index.json');
      expect(probe.status()).toBe(200);
      await captureShot({
        ...base,
        desk: 'academy',
        workflow: 'academy-sub-options',
        scenario: 'academy-empty',
        deepLink: '/?desk=academy&sec=academy-sub-options',
        providerState: 'local docs index healthy; query matches zero essays client-side',
        // Narrow teardown-race allowlist (academy-empty only): the dev
        // webServer can tear down its chunked response mid-stream on this final
        // step, surfacing as `net::ERR_INCOMPLETE_CHUNKED_ENCODING`. Observed
        // intermittently at 1280x800 with axe 0 / overflow 0 / `No essays yet.`
        // rendered. Scoped here only; externalFailedRequests, pageErrors, Axe,
        // overflow, nonfinite, and every other console error stay strict.
        allowConsole: [/^Failed to load resource: net::ERR_INCOMPLETE_CHUNKED_ENCODING/],
        eventTime: null,
        fetchTime: new Date().toISOString(),
      });
    });

    // Only unintended failures fail the gate. Each intended status below is
    // asserted with its corresponding unavailable UI inside its own step:
    // - 502 /api/macrovol/* (rates-malformed → 'Rates API unavailable')
    // - 502 /api/deribit/* (crypto-down → 'Deribit unavailable' + free fallback)
    // - 402 /api/ksa/* (ksa-entitlement → paywall 'Unlock this desk')
    // - 502 /api/v1/market/options/SPY (chain-empty → Vol/Positioning empty states)
    // - 502 /api/v1/market/crypto/BTC (crypto-down: canonical v1 is Deribit-backed
    //   and fails closed typed PROVIDER_UNAVAILABLE; the free-venue fallback is
    //   a separate route composed by the UI — both states asserted in-step)
    const intendedFailures = [
      /^502 GET \/api\/macrovol\//,
      /^502 GET \/api\/deribit\//,
      /^402 GET \/api\/ksa\//,
      /^502 GET \/api\/v1\/market\/options\/SPY/,
      /^502 GET \/api\/v1\/market\/crypto\/BTC/,
    ];
    const unintended = ctx.failedRoutes.filter(
      (route) => !intendedFailures.some((re) => re.test(route)),
    );
    expect(unintended).toEqual([]);
    expect(ctx.pageErrors).toEqual([]);
  });
}
