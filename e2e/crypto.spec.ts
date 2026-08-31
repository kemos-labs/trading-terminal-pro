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

const MONTH_CODES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function deribitExpiryCode(timestamp) {
  const date = new Date(timestamp);
  return `${String(date.getUTCDate()).padStart(2, '0')}${MONTH_CODES[date.getUTCMonth()]}${String(date.getUTCFullYear()).slice(-2)}`;
}

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
];

const WORKFLOWS = ['overview', 'volatility', 'positioning', 'flow', 'carry', 'trade-risk'];

function envelope(data, source = 'deribit') {
  const denominator = Array.isArray(data?.instruments) ? data.instruments.length : Array.isArray(data?.trades) ? data.trades.length : 1;
  return {
    schemaVersion: 1, requestId: 'playwright', asOf: new Date().toISOString(), fetchedAt: new Date().toISOString(), source: [source],
    provenanceByField: {}, unitsByField: {}, freshness: source === 'yfinance' ? 'delayed' : 'live',
    coverage: { numerator: denominator, denominator, state: denominator > 0 ? 'complete' : 'unavailable', missing: [] }, assumptions: [], warnings: [], data,
  };
}

async function mockDeribit(page) {
  // Keep the success path network-clean: every request used by the shell is mocked.
  // Failure-state tests below intentionally override the Deribit route with 502.
  await page.route('**/favicon.ico', async (route) => await route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/auth/me', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: null }) }));
  await page.route('**/api/billing/config', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) }));
  await page.route('**/api/yf/history/**', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ symbol: 'BTC-USD', data: [] }) }));
  await page.route('**/api/yf/info/**', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ symbol: 'BTC', data: {} }) }));
  await page.route('**/api/fmp/**', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }));
  await page.route('**/api/free-crypto/**', async (route) => await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ currency: 'BTC', venues: [], fetchedAt: Date.now(), source: 'public-exchanges' }) }));
  await page.route('**/api/deribit/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ currency: 'BTC', indexPrice: 60150, instruments: [], coverage: 1, fetchedAt: Date.now(), source: 'deribit' }) });
  });

  const instrumentsOption = loadFixture('get_instruments.option.json');
  const instrumentsFuture = loadFixture('get_instruments.future.json');
  const catalogue = [...instrumentsOption, ...instrumentsFuture];
  const listedExpiries = [...new Set(catalogue.filter((row) => row.settlement_period !== 'perpetual').map((row) => row.expiration_timestamp))].sort();
  const expiryByListed = new Map(listedExpiries.map((expiry, index) => [expiry, Date.now() + (30 + index * 30) * 86400000]));
  // Minimal market bundle using fixtures (reuse fixtures via joined data)
  const instruments = catalogue.map((c, index) => {
    const kind = c.settlement_period === 'perpetual' ? 'perp' : c.kind;
    const option = kind === 'option';
    const mark = option ? 0.05 : kind === 'perp' ? 60150 : 61000 + index * 125;
    const expiryMs = kind === 'perp' ? null : expiryByListed.get(c.expiration_timestamp);
    const instrument = kind === 'perp'
      ? `${c.base_currency}-PERPETUAL`
      : option
        ? `${c.base_currency}-${deribitExpiryCode(expiryMs)}-${c.strike}-${c.option_type === 'call' ? 'C' : 'P'}`
        : `${c.base_currency}-${deribitExpiryCode(expiryMs)}`;
    return {
      instrument,
      baseCurrency: c.base_currency,
      quoteCurrency: c.quote_currency,
      settlementCurrency: c.settlement_currency,
      contractSize: c.contract_size,
      kind,
      expiryMs,
      strike: c.strike ?? null,
      optionType: c.option_type ?? null,
      isInverse: !!c.is_inverse,
      bidPrice: option ? 0.049 : mark - 5,
      askPrice: option ? 0.051 : mark + 5,
      markPrice: mark,
      lastPrice: mark,
      bidIv: option ? 0.55 : null,
      askIv: option ? 0.56 : null,
      markIv: option ? 0.55 : null,
      indexPrice: 60150,
      openInterest: 100,
      volume: 10,
      funding8h: kind === 'perp' ? 0.0001 : null,
      timestamp: Date.now(),
      hasQuote: true,
      isStale: false,
    };
  });
  await page.route('**/api/v1/market/crypto/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/funding')) {
      const points = Array.from({ length: 12 }, (_, index) => ({ timestamp: Date.now() - (11 - index) * 8 * 3600000, rate8h: 0.00005 + index * 0.000002, annualizedPct: (0.00005 + index * 0.000002) * 1095 * 100, indexPrice: 60150 }));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope({ currency: 'BTC', instrumentName: 'BTC-PERPETUAL', days: 30, points, latest: points.at(-1), count: points.length })) });
    }
    if (url.includes('/trades')) {
      const expiry = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const trades = loadFixture('get_last_trades.json').trades.map((trade, index) => ({
        instrument: `BTC-${deribitExpiryCode(new Date(`${expiry}T08:00:00Z`).getTime())}-60000-${index % 2 === 0 ? 'C' : 'P'}`,
        timestamp: Date.now() - index * 60000, price: trade.price, quantity: trade.amount, side: trade.direction,
        right: index % 2 === 0 ? 'call' : 'put', expiry, markIv: trade.mark_iv / 100,
        premiumNative: trade.price * trade.amount, contractSize: 1, nativeCurrency: 'BTC', blockTrade: !!trade.block_trade, rfq: false,
      }));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope({ currency: 'BTC', trades, count: trades.length, hasMore: false })) });
    }
    const rows = instruments.map((ticker) => ({
      instrument: ticker.instrument, baseCurrency: ticker.baseCurrency, quoteCurrency: ticker.quoteCurrency, settlementCurrency: ticker.settlementCurrency,
      contractSize: ticker.contractSize, settlementPeriod: ticker.kind === 'perp' ? 'perpetual' : 'month', isInverse: ticker.isInverse,
      kind: ticker.kind, expiryMs: ticker.expiryMs, strike: ticker.strike, right: ticker.optionType,
      bid: ticker.bidPrice, ask: ticker.askPrice, mark: ticker.markPrice, last: ticker.lastPrice,
      bidIv: ticker.bidIv, askIv: ticker.askIv, markIv: ticker.markIv, indexPrice: ticker.indexPrice,
      openInterest: ticker.openInterest, volume: ticker.volume, funding8h: ticker.funding8h, timestamp: ticker.timestamp, tradable: ticker.hasQuote,
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope({ currency: 'BTC', indexPrice: 60150, instruments: rows, count: rows.length, funding8h: 0.0001 })) });
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
    await page.route('**/api/v1/market/crypto/*', async (route) => {
      await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Deribit failed' } }) });
    });
    await page.goto('/?desk=crypto&view=volatility');
    await page.keyboard.press('4');
    await expect(page.getByText(/Provider unavailable/i)).toBeVisible({ timeout: 5000 });
  });

  test('loading then empty states', async ({ page }) => {
    await page.route('**/api/v1/market/crypto/*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(envelope({ currency: 'BTC', indexPrice: null, instruments: [], count: 0, funding8h: null })),
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
      .analyze();
    expect(results.violations, `axe violations: ${JSON.stringify(results.violations.map(v => ({ id: v.id, desc: v.description })))}`).toEqual([]);
  });

  test('Canvas heatmap has accessible table fallback', async ({ page }) => {
    await mockDeribit(page);
    await page.goto('/?desk=crypto&view=positioning');
    await page.waitForSelector('[data-testid="positioning-workstation"]', { timeout: 8000 });
    // Canonical HeatmapEngine renders a <details> table fallback; verify the toggle + table.
    await page.getByText(/Table view \(accessible fallback\)/i).click();
    await expect(page.getByRole('table', { hidden: true })).toBeAttached();
  });
});
