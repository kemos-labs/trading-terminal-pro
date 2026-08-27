const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // 1. Landing page
  await page.goto('http://127.0.0.1:3001/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/vid/landing.png' });

  // 2. Enter terminal → vol desk
  const enter = page.getByRole('button', { name: /enter terminal/i });
  if (await enter.count()) await enter.click();
  await page.waitForTimeout(9000);
  await page.screenshot({ path: '/tmp/vid/vol-desk.png' });

  // 3. Positioning desk (3)
  await page.keyboard.press('2');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/tmp/vid/positioning.png' });

  // 4. Crypto desk DM-style
  await page.keyboard.press('4');
  await page.waitForTimeout(9000);
  await page.screenshot({ path: '/tmp/vid/crypto-desk.png' });

  // 5. Rates desk (5)
  await page.keyboard.press('5');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/tmp/vid/rates-desk.png' });

  await browser.close();
  console.log('shots done');
})();
