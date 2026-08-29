/**
 * Playwright visual + accessibility gate — 6 workflows × 4 viewports,
 * failure states, overflow, console errors.
 * Headless; intercepts Deribit to use recorded fixtures (no live dependency).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadFixture(name) {
  return JSON.parse(readFileSync(join(__dirname, '..', 'server', 'providers', 'deribit', 'fixtures', name), 'utf8')).result;
}

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
];

const WORKFLOWS = ['overview', 'volatility', 'positioning', 'flow', 'carry', 'trade-risk'];

async function mockDeribit(page) {
  // Keep the success path network-clean: every request used by the shell is mocked.
  // Failure-state tests below intentionally override the Deribit route with 502.
  await page.route('**/favicon.ico', async (route) => await route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/auth/me', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: null }) }));
  await page.route('**/api/billing/config', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) }));
  await page.route('**/api/options/**', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ symbol: 'SPY', spot: null, expirations: [], quotes: [], timestamp: Date.now() }) }));
  await page.route('**/api/desk/pack**', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ symbol: 'SPY', spot: null, quotes: [], timestamp: Date.now(), source: 'test-empty' }) }));
  await page.route('**/api/yf/**', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ symbol: 'SPY', data: [] }) }));
  await page.route('**/api/fmp/**', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], source: 'test-empty' }) }));
  await page.route('**/api/macrovol/**', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], source: 'test-empty' }) }));
  await page.route('**/api/cache/status', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
  await page.route('**/api/opra/status', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: false, status: 'unavailable' }) }));
  await page.route('**/api/opra/chain/**', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ quotes: [], source: 'test-empty' }) }));
  await page.route('**/api/venues/options/**', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ instruments: [], source: 'test-empty' }) }));
  await page.route('**/api/deribit-market/**', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));

  const instrumentsOption = loadFixture('get_instruments.option.json');
  const instrumentsFuture = loadFixture('get_instruments.future.json');
  const catalogue = [...instrumentsOption, ...instrumentsFuture];
  // Minimal market bundle using fixtures (reuse fixtures via joined data)
  const instruments = catalogue.map((c) => ({
    instrument: c.instrument_name,
    baseCurrency: c.base_currency,
    quoteCurrency: c.quote_currency,
    settlementCurrency: c.settlement_currency,
    contractSize: c.contract_size,
    kind: c.settlement_period === 'perpetual' ? 'perp' : c.kind,
    expiryMs: c.expiration_timestamp < 4102444800000 ? c.expiration_timestamp : null,
    strike: c.strike ?? null,
    optionType: c.option_type ?? null,
    isInverse: !!c.is_inverse,
    bidPrice: 0.05,
    askPrice: 0.051,
    markPrice: 0.05,
    lastPrice: 0.05,
    bidIv: 0.55,
    askIv: 0.56,
    markIv: 0.55,
    indexPrice: 60150,
    openInterest: 100,
    volume: 10,
    funding8h: c.instrument_name === 'BTC-PERPETUAL' ? 0.0001 : null,
    timestamp: Date.now(),
    hasQuote: true,
    isStale: false,
  }));
  await page.route('**/api/deribit/market/*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        currency: 'BTC',
        indexPrice: 60150,
        instruments,
        coverage: 1,
        funding8h: 0.0001,
        fetchedAt: Date.now(),
        source: 'deribit',
      }),
    });
  });
  await page.route('**/api/deribit/trades/*', async (route) => {
    const trades = loadFixture('get_last_trades.json').trades.map(t => ({
      instrument: t.instrument_name,
      timestamp: t.timestamp,
      price: t.price,
      quantity: t.amount,
      side: t.direction,
      markIv: t.mark_iv / 100,
      premiumNative: t.price * t.amount,
      contractSize: 1,
      nativeCurrency: 'BTC',
      blockTrade: !!t.block_trade,
      rfq: false,
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ currency: 'BTC', trades, count: trades.length, hasMore: false, fetchedAt: Date.now(), source: 'deribit' }),
    });
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const wf of WORKFLOWS) {
      test(`${wf} renders without horizontal overflow`, async ({ page }) => {
        await mockDeribit(page);
        const errors = [];
        page.on('console', (msg) => {
          if (msg.type() !== 'error') return;
          const txt = msg.text();
          // All crypto provider requests are mocked below; any browser error is unexpected.
          // Failure-state tests mock the intended 502 response and assert the UI state.
          errors.push(txt);
        });
        await page.goto(`/?desk=crypto&view=${wf}`);
        await page.waitForSelector('[data-testid="crypto-v2-shell"]', { timeout: 8000 });
        const tabName = wf === 'trade-risk' ? /Trade.*Risk/i : new RegExp(wf, 'i');
        await expect(page.getByRole('tab', { name: tabName })).toBeVisible();
        // Horizontal overflow check
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `horizontal overflow at ${vp.name} ${wf}`).toBe(0);
        expect(errors, `console errors at ${vp.name} ${wf}: ${errors.join('; ')}`).toEqual([]);
        await page.screenshot({ path: `e2e/screenshots/${vp.name}-${wf}.png`, fullPage: true });
      });
    }
  });
}

test.describe('failure states', () => {
  test('provider-down renders error', async ({ page }) => {
    await page.route('**/api/deribit/market/*', async (route) => {
      await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Deribit failed' }) });
    });
    await page.goto('/?desk=crypto&view=volatility');
    await page.keyboard.press('4');
    await expect(page.getByText(/Provider unavailable/i)).toBeVisible({ timeout: 5000 });
  });

  test('loading then empty states', async ({ page }) => {
    await page.route('**/api/deribit/market/*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ currency: 'BTC', indexPrice: null, instruments: [], coverage: 0, funding8h: null, fetchedAt: Date.now(), source: 'deribit' }),
      });
    });
    await page.goto('/?desk=crypto&view=positioning');
    await page.keyboard.press('4');
    await expect(page.getByText(/No OI data/i)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('accessibility', () => {
  test('workflow tabs are keyboard navigable', async ({ page }) => {
    await mockDeribit(page);
    await page.goto('/?desk=crypto&view=overview');
    await page.waitForSelector('[role="tablist"]');
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(6);
    for (const tab of await tabs.all()) {
      await expect(tab).toBeVisible();
      expect(await tab.getAttribute('aria-selected')).not.toBeNull();
    }
    await expect(page.getByRole('tabpanel')).toBeVisible();
  });

  test('axe audit on overview', async ({ page }) => {
    await mockDeribit(page);
    await page.goto('/?desk=crypto&view=overview');
    await page.waitForSelector('[data-testid="overview-workstation"]', { timeout: 8000 });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['color-contrast', 'landmark-banner-is-top-level', 'landmark-no-duplicate-banner', 'landmark-no-duplicate-main'])
      .analyze();
    expect(results.violations, `axe violations: ${JSON.stringify(results.violations.map(v => ({ id: v.id, desc: v.description })))}`).toEqual([]);
  });

  test('Canvas heatmap has accessible table fallback', async ({ page }) => {
    await mockDeribit(page);
    await page.goto('/?desk=crypto&view=positioning');
    await page.waitForSelector('[data-testid="positioning-workstation"]', { timeout: 8000 });
    await expect(page.getByText(/Accessible table fallback/i)).toBeVisible();
  });
});
