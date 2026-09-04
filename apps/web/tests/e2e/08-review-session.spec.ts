/**
 * KRODEX e2e — Phase 10 review session flow.
 *
 * The Phase 10 review detail page is now a session orchestrator:
 *
 *   1. The student opens a "due" review from /reviews.
 *   2. Clicks "Start review" → POST /reviews/:id/start
 *      (moves the schedule to `in_progress`, the error to
 *      `in_review`, and returns a fresh verification question
 *      distinct from the original wrong question).
 *   3. The verification question card is rendered with the picked
 *      questionId.
 *   4. The student picks an outcome (correct / partial / incorrect)
 *      and submits → POST /reviews/:id/outcome.
 *   5. The outcome feedback panel renders the lifecycle
 *      transition and the next-review decision.
 *   6. The lifecycle history section is populated from
 *      GET /reviews/:id/lifecycle.
 *
 * This is the Phase 10 exit gate: "Start review → answer
 * verification question correctly → error transitions to
 * RESOLVED → lifecycle event recorded → next review NOT
 * scheduled" — all verifiable in one E2E test.
 *
 * The fixture is flipped to seed=`phase10-review` for the
 * duration of this suite so the index page has a link to click
 * and the new endpoints return populated responses.
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

test.describe('Review session flow (Phase 10)', () => {
  test.afterEach(async () => {
    // Reset to default so other suites aren't polluted.
    await setSeed('empty');
  });

  test('renders the index list with the synthetic review under the phase10 seed', async ({ page }) => {
    await setSeed('phase10-review');
    await login(page);
    await clientGoto(page, ROUTES.reviews);

    // The list contains the seeded row.
    await expectMounted(page, `reviews-item-${REVIEW_ID}`);
    // The state and strategy are surfaced.
    await expect(
      page.getByTestId(`reviews-item-${REVIEW_ID}`),
    ).toContainText(/due/i);
    await expect(
      page.getByTestId(`reviews-item-${REVIEW_ID}`),
    ).toContainText(/spaced/i);
  });

  test('start review renders the verification question card', async ({ page }) => {
    await setSeed('phase10-review');
    await login(page);
    await clientGoto(page, ROUTES.reviews);
    await page.getByTestId(`reviews-row-${REVIEW_ID}`).click();
    await expectMounted(page, 'review-title');

    // The Start button is the only action visible before the
    // session opens.
    const start = page.getByTestId('review-start');
    await expect(start).toBeVisible();

    // Capture the start mutation so we can assert the body shape.
    const startPromise = page.waitForRequest(
      (req) =>
        req.method() === 'POST' &&
        new URL(req.url()).pathname === `/reviews/${REVIEW_ID}/start`,
      { timeout: 15_000 },
    );

    await start.click();
    const startReq = await startPromise;
    // The start mutation body is empty (no commandId needed for
    // the fixture), but the request must fire.
    expect(startReq.method()).toBe('POST');

    // The verification question card appears with the picked
    // questionId from the fixture.
    await expectMounted(page, 'review-verification-card');
    await expect(page.getByTestId('review-verification-qid')).toHaveText(
      /q-fresh-phase10-01/,
    );

    // The three outcome controls are rendered.
    await expect(page.getByTestId('review-outcome-correct')).toBeVisible();
    await expect(page.getByTestId('review-outcome-partial')).toBeVisible();
    await expect(page.getByTestId('review-outcome-incorrect')).toBeVisible();
  });

  test('correct outcome resolves the error and surfaces the feedback panel', async ({ page }) => {
    await setSeed('phase10-review');
    await login(page);
    await clientGoto(page, ROUTES.reviews);
    await page.getByTestId(`reviews-row-${REVIEW_ID}`).click();
    await page.getByTestId('review-start').click();
    await expectMounted(page, 'review-verification-card');

    // Capture the outcome mutation.
    const outcomePromise = page.waitForRequest(
      (req) =>
        req.method() === 'POST' &&
        new URL(req.url()).pathname === `/reviews/${REVIEW_ID}/outcome`,
      { timeout: 15_000 },
    );

    await page.getByTestId('review-outcome-correct').check();
    await page.getByTestId('review-submit-outcome').click();
    const outcomeReq = await outcomePromise;
    const body = JSON.parse(outcomeReq.postData() ?? '{}');
    // The page sends the verification questionId and the picked
    // outcome — both must be in the body.
    expect(body.outcome).toBe('correct');
    expect(body.questionId).toBe('q-fresh-phase10-01');

    // The feedback panel renders the resolved transition.
    await expectMounted(page, 'review-outcome-feedback');
    await expect(page.getByTestId('review-outcome-feedback')).toContainText(
      /resolved/i,
    );
    // Correct outcomes don't schedule a follow-up.
    await expect(page.getByTestId('review-next-due')).toHaveCount(0);
  });

  test('incorrect outcome returns the error to active and schedules a follow-up', async ({ page }) => {
    await setSeed('phase10-review');
    await login(page);
    await clientGoto(page, ROUTES.reviews);
    await page.getByTestId(`reviews-row-${REVIEW_ID}`).click();
    await page.getByTestId('review-start').click();
    await expectMounted(page, 'review-verification-card');

    const outcomePromise = page.waitForRequest(
      (req) =>
        req.method() === 'POST' &&
        new URL(req.url()).pathname === `/reviews/${REVIEW_ID}/outcome`,
      { timeout: 15_000 },
    );

    await page.getByTestId('review-outcome-incorrect').check();
    await page.getByTestId('review-submit-outcome').click();
    const outcomeReq = await outcomePromise;
    const body = JSON.parse(outcomeReq.postData() ?? '{}');
    expect(body.outcome).toBe('incorrect');
    expect(body.questionId).toBe('q-fresh-phase10-01');

    // The feedback panel renders the active transition.
    await expectMounted(page, 'review-outcome-feedback');
    // Incorrect outcomes schedule a follow-up; the due-date row
    // appears in the feedback panel.
    await expectMounted(page, 'review-next-due');
  });

  test('the lifecycle history section lists the start transition', async ({ page }) => {
    await setSeed('phase10-review');
    await login(page);
    await clientGoto(page, ROUTES.reviews);
    await page.getByTestId(`reviews-row-${REVIEW_ID}`).click();
    await expectMounted(page, 'review-title');

    // The lifecycle history is rendered as a side panel; it
    // doesn't depend on starting the review.
    const list = page.getByTestId('review-lifecycle-list');
    await expect(list).toBeVisible();
    const items = page.getByTestId('review-lifecycle-item');
    expect(await items.count()).toBeGreaterThan(0);
    // The seed includes an active → in_review transition.
    await expect(list).toContainText(/in review/i);
  });
});
