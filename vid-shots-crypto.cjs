const { chromium } = require('playwright');

// Visual verification for the Crypto desk rebuild (handoff DoD #1, #8).
// Deep-links every page via ?crypto=BTC&page=… (BTC/ETH desk sections).
const PAGES = [
  ['overview', 'overview'],
  ['heatmaps', 'heatmaps'],
  ['levels', 'levels'],
  ['flow', 'flow'],
  ['oi', 'oi'],
  ['volskew', 'volskew'],
  ['tail', 'tail'],
  ['scanner', 'scanner'],
  ['fbasis', 'fbasis'],
  ['fterm', 'fterm'],
  ['ffund', 'ffund'],
  ['options', 'options'],
  ['calc', 'calc'],
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const [pageId] of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 960 } });
    const page = await ctx.newPage();
    try {
      await page.goto(`http://127.0.0.1:3204/?crypto=BTC&page=${pageId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      // Enter terminal if the boot gate is showing
      const enter = page.getByRole('button', { name: /enter/i }).first();
      if (await enter.count()) await enter.click().catch(() => {});
      await page.waitForTimeout(4000);
      await page.keyboard.press('4'); // CRYPTO desk — BtcView then reads ?crypto & ?page
      await page.waitForTimeout(5000);
      await page.screenshot({ path: `/tmp/vid/crypto-${pageId}.png`, fullPage: false });
      // Overflow check (DoD #5 — no horizontal body overflow)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      results.push({ page: pageId, overflowPx: overflow });
      console.log(`ok ${pageId} overflow=${overflow}px`);
    } catch (err) {
      results.push({ page: pageId, error: String(err).slice(0, 120) });
      console.log(`FAIL ${pageId}: ${String(err).slice(0, 120)}`);
    }
    await ctx.close();
  }
  // Mobile spot-check on overview + basis
  for (const [name, pageId] of [['overview', 'overview'], ['fbasis', 'fbasis']]) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    try {
      await page.goto(`http://127.0.0.1:3204/?crypto=BTC&page=${pageId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      const enter = page.getByRole('button', { name: /enter/i }).first();
      if (await enter.count()) await enter.click().catch(() => {});
      await page.waitForTimeout(4000);
      await page.keyboard.press('4');
      await page.waitForTimeout(5000);
      await page.screenshot({ path: `/tmp/vid/mobile-${name}.png`, fullPage: false });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      console.log(`mobile ${name} overflow=${overflow}px`);
    } catch (err) {
      console.log(`mobile FAIL ${name}: ${String(err).slice(0, 120)}`);
    }
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(results.filter((r) => r.overflowPx > 0 || r.error), null, 2));
  console.log('shots done');
})();
