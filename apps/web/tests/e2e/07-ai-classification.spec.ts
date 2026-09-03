/**
 * KRODEX e2e — Phase 8 AI classification suggestion.
 *
 * The error detail page renders a self-contained AI suggestion
 * card when the entry has no `mistake_type`. The card is
 * non-authoritative per the Phase 8 plan §6 invariant: the AI
 * never writes to the database. The student must click
 * "Accept suggestion" or "Set manually" to persist a category,
 * and the write goes through the existing PATCH /errors/:id
 * path — the same mutation a manual classification would use.
 *
 * The test exercises three end-to-end states against the
 * fixture API:
 *
 *   1. Card appears on the unclassified entry, fetches a
 *      suggestion, and the accept button writes the suggested
 *      category via the existing update endpoint.
 *   2. "Set manually" reveals the radio selector and a manual
 *      save writes the chosen category.
 *   3. When the AI is unavailable (503 DEPENDENCY_UNAVAILABLE),
 *      the card shows the manual selector immediately with an
 *      honest "unavailable" note — no crash, no spinner hang.
 *
 * The fixture exposes a test-only POST /__fixture/seed endpoint
 * that lets a Playwright test flip the active seed before each
 * scenario, so the same dev server serves all three flows.
 */

import { test, expect, type Page } from '@playwright/test';
import { ROUTES, login, clientGoto, expectMounted } from './helpers';

const FIXTURE_URL = 'http://localhost:4100';

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

async function loginAndOpenUnclassified(page: Page): Promise<void> {
  await login(page);
  await clientGoto(page, ROUTES.errorUnclassified);
  // Wait for the entry to load and the suggestion card to appear.
  await expectMounted(page, 'error-title');
  await expectMounted(page, 'classification-suggest-card');
}

test.describe('AI classification suggestion (Phase 8)', () => {
  test.afterEach(async () => {
    // Reset to the default seed so subsequent suites aren't
    // polluted by this one.
    await setSeed('empty');
  });

  test('card appears on an unclassified entry and renders the AI suggestion', async ({ page }) => {
    await setSeed('ai-classification');
    await loginAndOpenUnclassified(page);

    // The suggestion arrives from the fixture.
    await expectMounted(page, 'classification-suggestion');
    await expect(page.getByTestId('classification-suggestion-category')).toHaveText(
      /misread/i,
    );
    await expect(
      page.getByTestId('classification-suggestion-confidence'),
    ).toHaveText(/\d+%/);

    // Accept and "Set manually" actions are both available.
    await expect(page.getByTestId('classification-accept')).toBeVisible();
    await expect(page.getByTestId('classification-set-manually')).toBeVisible();
  });

  test('accepting the suggestion writes through the existing update endpoint', async ({ page }) => {
    await setSeed('ai-classification');
    await loginAndOpenUnclassified(page);

    // Capture the PATCH that accept fires.
    const patchPromise = page.waitForRequest(
      (req) =>
        req.method() === 'PATCH' &&
        /\/errors\/error-unclassified$/.test(req.url()),
      { timeout: 15_000 },
    );

    await page.getByTestId('classification-accept').click();
    const patch = await patchPromise;
    const body = JSON.parse(patch.postData() ?? '{}');
    // The card sends the AI's suggested category; the fixture
    // echoes it back. We don't pin the exact value (the AI is
    // non-authoritative) but the request must carry a valid
    // mistake_type from the enum.
    expect(typeof body.mistake_type).toBe('string');
    expect(['concept', 'calculation', 'misread', 'time_pressure', 'careless', 'method', 'unknown'])
      .toContain(body.mistake_type);

    // After the save resolves, the card shows its accepted band.
    await expectMounted(page, 'classification-accepted');
  });

  test('"Set manually" reveals the radio selector and writes the chosen category', async ({ page }) => {
    await setSeed('ai-classification');
    await loginAndOpenUnclassified(page);

    await page.getByTestId('classification-set-manually').click();
    await expectMounted(page, 'classification-manual-save');

    // Pick a category that is NOT the suggested one so the
    // override path is unambiguous.
    await page.getByTestId('classification-manual-careless').check();

    const patchPromise = page.waitForRequest(
      (req) =>
        req.method() === 'PATCH' &&
        /\/errors\/error-unclassified$/.test(req.url()),
      { timeout: 15_000 },
    );

    await page.getByTestId('classification-manual-save').click();
    const patch = await patchPromise;
    const body = JSON.parse(patch.postData() ?? '{}');
    expect(body).toEqual({ mistake_type: 'careless' });
  });

  test('AI unavailable: shows the manual selector immediately, no crash, no spinner hang', async ({ page }) => {
    await setSeed('ai-classification-unavailable');
    await loginAndOpenUnclassified(page);

    // The card shows its unavailable note and the manual form.
    await expectMounted(page, 'classification-unavailable');
    await expectMounted(page, 'classification-manual-save');

    // The suggestion branch is NOT rendered (no category / no
    // accept button to mislead the student).
    await expect(page.getByTestId('classification-suggestion')).toHaveCount(0);
    await expect(page.getByTestId('classification-accept')).toHaveCount(0);

    // The student can still classify manually.
    await page.getByTestId('classification-manual-method').check();
    const patchPromise = page.waitForRequest(
      (req) =>
        req.method() === 'PATCH' &&
        /\/errors\/error-unclassified$/.test(req.url()),
      { timeout: 15_000 },
    );
    await page.getByTestId('classification-manual-save').click();
    const patch = await patchPromise;
    const body = JSON.parse(patch.postData() ?? '{}');
    expect(body).toEqual({ mistake_type: 'method' });
  });
});
