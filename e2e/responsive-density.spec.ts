/**
 * Responsive STIR identifier-density gate (tranche-scoped).
 *
 * Runs against the real local Fastify server started by the Playwright
 * webServer harness. No `page.route()` interception anywhere in this file.
 *
 * This gate MUST be run with the deterministic server-side fixture scenario so
 * the SR3/SR1 strips are populated (the app itself never invents values):
 *
 *   NODE_ENV=test E2E_FIXTURE_SCENARIO=success \
 *     npx playwright test e2e/responsive-density.spec.ts --reporter=line
 *
 * Global diagnostics (distinct regions, focusability, touch affordance, root
 * overflow, finite text, console errors, scoped Axe) always run. Painted
 * identifier/scroll checks are data-dependent and fail closed when the fixture
 * is empty: the empty state is reported as a fixture error, never silently
 * skipped.
 */
import { test, expect, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const STIR_URL = '/?desk=rates&sec=rates-mode-stir';
const EPS = 1;
const SCROLL_EPS = 2;

type IdentMeasurement = {
  text: string;
  scrollWidth: number;
  clientWidth: number;
  textOverflow: string;
  whiteSpace: string;
  visible: boolean;
};

async function measureIdentCells(scope: Locator): Promise<IdentMeasurement[]> {
  return scope.locator('.stir-ident').evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        text: (el.textContent ?? '').trim(),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        textOverflow: cs.textOverflow,
        whiteSpace: cs.whiteSpace,
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          cs.display !== 'none' &&
          cs.visibility !== 'hidden' &&
          Number(cs.opacity) !== 0,
      };
    }),
  );
}

async function columnXs(row: Locator): Promise<number[]> {
  return row.evaluate((el) =>
    Array.from(el.children).map((c) => c.getBoundingClientRect().x),
  );
}

test.describe('responsive STIR identifier readability', () => {
  for (const viewport of [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'desktop', width: 1440, height: 900 },
  ] as const) {
    test(`${viewport.name} ${viewport.width}x${viewport.height}: identifiers readable, board-local scroll, no page overflow`, async ({
      page,
    }) => {
      const consoleErrors: string[] = [];
      page.on('pageerror', (err) => consoleErrors.push(String(err)));
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(STIR_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

      const sr3 = page.getByRole('region', { name: 'SR3 SOFR futures board data' });
      const sr1 = page.getByRole('region', { name: 'SR1 SOFR futures board data' });

      // Structural: distinct accessible board regions exist and are keyboard-focusable.
      await expect(sr3).toBeVisible({ timeout: 20_000 });
      await expect(sr1).toBeVisible({ timeout: 20_000 });
      await sr3.focus();
      await expect(sr3).toBeFocused();
      await sr1.focus();
      await expect(sr1).toBeFocused();

      // Touch panning affordance: regions allow touch-driven panning.
      for (const region of [sr3, sr1]) {
        const touchAction = await region.evaluate((el) => getComputedStyle(el).touchAction);
        expect(touchAction).toMatch(/pan-x|auto|manipulation/);
      }

      const sr3Rows = page.locator('[data-board="stir-sr3-row"]');
      const rowCount = await sr3Rows.count();
      const sr1BodyRows = sr1.locator('[data-track="stir-sr1-track"]:has(.stir-num)');
      const sr1RowCount = await sr1BodyRows.count();

      // ---- Global diagnostics: always run, even when the fixture is empty ----
      const rootOverflow = await page.evaluate(() => {
        const doc = document.scrollingElement ?? document.documentElement;
        return { scrollW: doc.scrollWidth, innerW: window.innerWidth };
      });
      expect(rootOverflow.scrollW).toBeLessThanOrEqual(rootOverflow.innerW + EPS);

      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toMatch(/NaN|Infinity/);

      const axe = await new AxeBuilder({ page })
        .include('[data-board-scroll="stir-sr3"]')
        .include('[data-board-scroll="stir-sr1"]')
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      expect(
        axe.violations.map((v) => `${v.id}:${v.nodes.length}`).join(', '),
        JSON.stringify(axe.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2),
      ).toEqual('');

      expect(consoleErrors).toEqual([]);

      // Empty fixture is reported and then fails closed — diagnostics above ran.
      if (rowCount === 0 || sr1RowCount === 0) {
        const detail = `SR3 rows=${rowCount}, SR1 rows=${sr1RowCount}; run with NODE_ENV=test E2E_FIXTURE_SCENARIO=success to populate the deterministic strips`;
        test.info().annotations.push({ type: 'fixture-empty', description: detail });
        console.warn(`[responsive-density] ${viewport.name} empty fixture: ${detail}`);
      }
      expect(
        rowCount,
        'SR3 strip must be populated by the deterministic fixture (fail-closed)',
      ).toBeGreaterThan(0);
      expect(
        sr1RowCount,
        'SR1 strip must be populated by the deterministic fixture (fail-closed)',
      ).toBeGreaterThan(0);

      // ---- Painted identifiers: measure rendering, not just DOM text ----
      const identMeasurements = [
        ...(await measureIdentCells(sr3)),
        ...(await measureIdentCells(sr1)),
      ];
      expect(identMeasurements.length).toBeGreaterThan(0);
      for (const m of identMeasurements) {
        expect(m.visible, `identifier "${m.text}" must be painted/visible`).toBe(true);
        if (viewport.name === 'mobile') {
          expect(m.textOverflow, `identifier "${m.text}" must not be ellipsized`).not.toBe(
            'ellipsis',
          );
          expect(m.whiteSpace, `identifier "${m.text}" must wrap, not nowrap`).not.toBe('nowrap');
          expect(
            m.scrollWidth,
            `identifier "${m.text}" must not be clipped inside its cell`,
          ).toBeLessThanOrEqual(m.clientWidth + EPS);
        }
      }

      // Mobile numerals keep the numeric nowrap rule so long values stay
      // discoverable by board-local horizontal scrolling (never ellipsized).
      if (viewport.name === 'mobile') {
        const numeric = await page
          .locator('[data-board-scroll="stir-sr3"] .stir-num, [data-board-scroll="stir-sr1"] .stir-num')
          .evaluateAll((els) =>
            els.map((el) => ({
              text: (el.textContent ?? '').trim(),
              textOverflow: getComputedStyle(el).textOverflow,
              whiteSpace: getComputedStyle(el).whiteSpace,
            })),
          );
        expect(numeric.length).toBeGreaterThan(0);
        for (const n of numeric) {
          expect(n.textOverflow, `numeric "${n.text}" must not be ellipsized`).not.toBe('ellipsis');
          expect(n.whiteSpace, `numeric "${n.text}" must stay nowrap`).toBe('nowrap');
        }
      }

      // ---- Board-local horizontal scroll: start → near-maximum + last-column ----
      for (const { region, header } of [
        { region: sr3, header: page.locator('[data-board="stir-sr3-head"]') },
        { region: sr1, header: sr1.locator('[data-track="stir-sr1-track"]').first() },
      ]) {
        const scrollable = await region.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        if (viewport.name === 'mobile') {
          expect(scrollable, 'board must scroll horizontally on mobile').toBe(true);
        }
        if (!scrollable) continue;

        await region.evaluate((el) => {
          el.scrollLeft = 0;
        });
        expect(await region.evaluate((el) => el.scrollLeft)).toBe(0);

        const maxLeft = await region.evaluate((el) => el.scrollWidth - el.clientWidth);
        await region.evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
        });
        const endLeft = await region.evaluate((el) => el.scrollLeft);
        expect(endLeft, 'end scroll must reach the maximum').toBeGreaterThanOrEqual(
          Math.max(0, maxLeft - SCROLL_EPS),
        );
        expect(endLeft).toBeLessThanOrEqual(maxLeft + SCROLL_EPS);

        // Last-column header content is painted inside the scroller after end scroll.
        const lastDiag = await header.locator('xpath=./*[last()]').evaluate((el) => {
          const r = el.getBoundingClientRect();
          const scroller = el.closest('[data-board-scroll]') as HTMLElement | null;
          if (!scroller) return { ok: false, reason: 'no-scroller', text: '' };
          const s = scroller.getBoundingClientRect();
          return {
            ok:
              r.width > 0 &&
              r.height > 0 &&
              r.left >= s.left - 2 &&
              r.right <= s.right + 2 &&
              (el.textContent ?? '').trim().length > 0,
            cell: { left: r.left, right: r.right, width: r.width, height: r.height },
            scroller: { left: s.left, right: s.right },
            text: (el.textContent ?? '').trim(),
          };
        });
        if (!lastDiag.ok) console.warn('[responsive-density] last-column diag', JSON.stringify(lastDiag));
        expect(
          lastDiag.ok,
          `last-column content must be visible after scrolling to end: ${JSON.stringify(lastDiag)}`,
        ).toBe(true);

        await region.evaluate((el) => {
          el.scrollLeft = 0;
        });
      }

      // ---- Shared header/body track alignment for SR3 and SR1 ----
      const sr3HeaderXs = await columnXs(page.locator('[data-board="stir-sr3-head"]'));
      const sr3RowXs = await columnXs(sr3Rows.first());
      expect(sr3RowXs.length).toBe(sr3HeaderXs.length);
      sr3HeaderXs.forEach((x, i) => {
        expect(Math.abs(x - sr3RowXs[i]), `SR3 column ${i} header/body x`).toBeLessThanOrEqual(
          SCROLL_EPS,
        );
      });

      const sr1Header = sr1.locator('[data-track="stir-sr1-track"]').first();
      const sr1HeaderXs = await columnXs(sr1Header);
      const sr1RowXs = await columnXs(sr1BodyRows.first());
      expect(sr1RowXs.length).toBe(sr1HeaderXs.length);
      sr1HeaderXs.forEach((x, i) => {
        expect(Math.abs(x - sr1RowXs[i]), `SR1 column ${i} header/body x`).toBeLessThanOrEqual(
          SCROLL_EPS,
        );
      });
    });
  }
});
