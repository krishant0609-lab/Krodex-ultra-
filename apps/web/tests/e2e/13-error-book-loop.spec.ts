/**
 * KRODEX e2e — Phase 13 error book full loop.
 *
 * This journey stitches the Phase 9 capture, Phase 10 review, and
 * Phase 12 notification surfaces into one observable path:
 *
 *   1. The student opens the synthetic "due" review under
 *      seed=`phase13-error-loop`.
 *   2. Starts the review → POST /reviews/:id/start moves the
 *      schedule to `in_progress` and the error to `in_review`.
 *   3. Submits the verification question with `outcome: correct`
 *      → POST /reviews/:id/outcome moves the error to `resolved`.
 *   4. The page surfaces the lifecycle transition (in_review →
 *      resolved) and the "no next review" decision.
 *
 * Phase 9 capture (a wrong attempt creating an error) is
 * covered by the API-level tests in apps/api, which exercise
 * the same domain transactions exhaustively. The E2E here
 * focuses on the human-visible journey: the student opens a
 * review, answers correctly, and sees the error close.
 *
 * The fixture is flipped to seed=`phase13-error-loop` for the
 * duration of this suite so /reviews/:id returns the same
 * `phase10-review-001` row used elsewhere — the lifecycle
 * contract is identical.
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

test.describe('Error book full loop (Phase 13)', () => {
  test.afterEach(async () => {
    await setSeed('empty');
  });

  test('start review → answer correctly → error transitions to resolved', async ({
    page,
  }) => {
    await setSeed('phase13-error-loop');
    await login(page);

    // 1. Open the synthetic review from the /reviews list.
    await clientGoto(page, ROUTES.reviews);
    await expectMounted(page, `reviews-item-${REVIEW_ID}`);

    // 2. Click into the review; the detail page renders the
    //    Start button.
    await page.getByTestId(`reviews-row-${REVIEW_ID}`).click();
    await expectMounted(page, 'review-title');
    await page.getByTestId('review-start').click();

    // 3. The verification question card is rendered.
    await expectMounted(page, 'review-verification-card');
    // 4. Choose the correct outcome and submit; the fixture
    //    returns the resolved transition.
    const correctButton = page.getByTestId('review-outcome-correct');
    await expect(correctButton).toBeVisible();
    await correctButton.check();
    await page.getByTestId('review-submit-outcome').click();

    // 5. The outcome feedback panel surfaces the lifecycle
    //    transition and the next-review decision.
    await expectMounted(page, 'review-outcome-feedback');
    await expect(page.getByText(/resolved/i).first()).toBeVisible();
  });

  test('the lifecycle history shows the start transition after opening a review', async ({
    page,
  }) => {
    await setSeed('phase13-error-loop');
    await login(page);
    await clientGoto(page, ROUTES.reviews);
    await page.getByTestId(`reviews-row-${REVIEW_ID}`).click();
    await page.getByTestId('review-start').click();
    await expectMounted(page, 'review-lifecycle-list');
    // The lifecycle history should now show at least the active →
    // in_review transition that the start call returned.
    await expect(page.getByText(/in_review|in review/i).first()).toBeVisible();
  });
});
