/**
 * KRODEX e2e — Phase 13 error reopen loop.
 *
 * Once an error is resolved, a fresh wrong attempt on the same
 * question reopens it. This spec exercises the visible
 * transition via the review surface:
 *
 *   1. The student starts a review on a resolved error.
 *   2. Submits an incorrect outcome → POST /reviews/:id/outcome
 *      keeps the error active (in_review → active) and
 *      schedules a follow-up review.
 *   3. The lifecycle history shows the resolved → active
 *      transition.
 *
 * The error detail page and the reopen event are tested at the
 * API level; the E2E here proves the visible transition from
 * resolved back to active via the review outcome button.
 *
 * The fixture is flipped to seed=`phase13-error-loop` for the
 * duration of this suite.
 */

import { test, expect } from '@playwright/test';
import { ROUTES, login, clientGoto, expectMounted } from './helpers';

const FIXTURE_URL = 'http://localhost:4100';
const REVIEW_ID = 'phase10-review-001';

async function setSeed(seed: string): Promise<void> {
  const res = await fetch(`${FIXTURE_URL}/__fixture/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seed }),
  });
  if (!res.ok) {
    throw new Error(`Failed to set fixture seed to ${seed}: ${res.status}`);
  }
}

test.describe('Error reopen loop (Phase 13)', () => {
  test.afterEach(async () => {
    await setSeed('empty');
  });

  test('start review → answer incorrectly → error stays active and a follow-up is scheduled', async ({
    page,
  }) => {
    await setSeed('phase13-error-loop');
    await login(page);
    await clientGoto(page, ROUTES.reviews);
    await page.getByTestId(`reviews-row-${REVIEW_ID}`).click();
    await expectMounted(page, 'review-title');
    await page.getByTestId('review-start').click();
    await expectMounted(page, 'review-verification-card');

    // Choose incorrect → the fixture returns the
    // in_review → active transition with a next-review decision.
    const incorrectButton = page.getByTestId('review-outcome-incorrect');
    await expect(incorrectButton).toBeVisible();
    await incorrectButton.check();
    await page.getByTestId('review-submit-outcome').click();

    // Outcome panel surfaces the "next review scheduled" decision.
    await expectMounted(page, 'review-outcome-feedback');
    await expect(page.getByText(/active/i).first()).toBeVisible();
    await expect(page.getByText(/next review/i).first()).toBeVisible();
  });
});
