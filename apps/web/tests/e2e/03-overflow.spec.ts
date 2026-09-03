/**
 * KRODEX e2e — no-horizontal-overflow verification.
 *
 * At every viewport width the user can resize to, the page body
 * must not have any element that overflows the document's
 * client width. The Phase 7 brief is "no horizontal scroll at
 * any width, any route". A scrollbar in the body implies either
 * an oversized element, a fixed-width table, an unbreakable
 * string, or a missing responsive rule.
 *
 * Test grid: every Phase 7 route × {360, 768, 1024, 1440}.
 * 19 routes × 4 widths = 76 measurements.
 */

import { test, expect } from '@playwright/test';
import { ROUTES, WIDTHS, login, clientGoto, detectHorizontalOverflow } from './helpers';

const ROUTES_TO_CHECK = [
  ROUTES.dashboard,
  ROUTES.syllabus,
  ROUTES.tests,
  ROUTES.errors,
  ROUTES.reviews,
  ROUTES.planner,
  ROUTES.backlog,
  ROUTES.insights,
  ROUTES.studentModel,
  ROUTES.notifications,
  ROUTES.settings,
  ROUTES.attempt,
  ROUTES.testDetail,
  ROUTES.errorDetail,
  ROUTES.reviewDetail,
  ROUTES.syllabusSubject,
  ROUTES.syllabusTopic,
  ROUTES.syllabusSubTopic,
];

test.describe('no horizontal overflow', () => {
  // NOTE: not using `serial` mode. A single route's overflow
  // must not abort the remaining routes — the verification is
  // "every route, every width has no overflow" and the matrix
  // needs to run to completion even when one cell fails. With
  // workers:1 + fullyParallel:false, the tests still run in
  // declared order; a failure no longer halts the rest.

  for (const width of WIDTHS) {
    test(`login @ ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(ROUTES.login);
      await expect(page.getByTestId('login-form')).toBeVisible();
      const result = await detectHorizontalOverflow(page);
      // Allow sub-pixel rounding: <= 1px is not overflow.
      expect(result.scrollWidth, `overflow at ${width}px on ${result.selector ?? 'doc'}: ${result.scrollWidth} > ${result.clientWidth}`).toBeLessThanOrEqual(result.clientWidth + 1);
    });
  }

  // Log in once for the authed routes.
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    await context.storageState({ path: 'test-results/.auth/storageState.json' });
    await context.close();
  });

  for (const route of ROUTES_TO_CHECK) {
    for (const width of WIDTHS) {
      const slug = route.replace(/^\//, '').replace(/\//g, '-').replace(/\[|\]/g, '');
      test(`${slug} @ ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await login(page);
        await clientGoto(page, route);
        await page.waitForLoadState('networkidle');
        const result = await detectHorizontalOverflow(page);
        expect(
          result.scrollWidth,
          `overflow at ${width}px on ${slug}: scrollWidth=${result.scrollWidth}, clientWidth=${result.clientWidth}, selector=${result.selector}`,
        ).toBeLessThanOrEqual(result.clientWidth + 1);
      });
    }
  }
});
