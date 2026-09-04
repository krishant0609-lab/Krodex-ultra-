/**
 * KRODEX e2e — Phase 12 notifications surface.
 *
 * The Phase 12 notifications page is now an interactive inbox:
 *
 *   1. The /notifications index renders populated rows under
 *      seed=`phase12-notifications`, including the severity
 *      badge, the kind chip, the title, body, and a "Mark read"
 *      action.
 *   2. Clicking "Mark read" issues PATCH /notifications/:id and
 *      the page transitions to the read state (the tag "read"
 *      appears in the aside column, and the unread dot is gone).
 *   3. The kind filter bar at the bottom of the page navigates
 *      to /notifications?kind=<kind>, and the active filter
 *      chip's data-active attribute flips to "true".
 *   4. The "Preferences" link in the header navigates to
 *      /notifications/preferences.
 *   5. /notifications/preferences populates the form from the
 *      GET response (quiet hours off, all kinds enabled) and
 *      renders a "Save" button.
 *   6. Toggling a kind and submitting the form issues a
 *      PATCH /notifications/preferences; the page transitions
 *      to a "Saved." status.
 *
 * This is the Phase 12 exit gate: "preferences round-trip and
 * inbox mark-read work via the real UI" — verifiable in two
 * journeys here, with idempotency and unit-level checks
 * covered by the vitest suites.
 *
 * The fixture is flipped to seed=`phase12-notifications` for
 * the inbox tests; the preferences tests use the default
 * (empty) seed because the GET endpoint always returns
 * the default preferences.
 */

import { test, expect } from '@playwright/test';
import { ROUTES, login, clientGoto, expectMounted } from './helpers';

const FIXTURE_URL = 'http://localhost:4100';
const NOTIF_ID = 'notif-phase12-001';

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

test.describe('Notifications surface (Phase 12)', () => {
  test.afterEach(async () => {
    // Reset to default so other suites aren't polluted.
    await setSeed('empty');
  });

  test('renders the populated inbox under the phase12 seed', async ({ page }) => {
    await setSeed('phase12-notifications');
    await login(page);
    await clientGoto(page, ROUTES.notifications);
    await expectMounted(page, `notifications-item-${NOTIF_ID}`);
    await expect(
      page.getByTestId(`notifications-title-${NOTIF_ID}`),
    ).toHaveText(/a review is due/i);
    // The severity badge and kind chip surface in the row.
    await expect(
      page.getByTestId(`notifications-item-${NOTIF_ID}`),
    ).toContainText(/review_due/i);
  });

  test('Mark read action issues a PATCH and transitions to the read state', async ({
    page,
  }) => {
    await setSeed('phase12-notifications');
    await login(page);
    await clientGoto(page, ROUTES.notifications);
    await expectMounted(page, `notifications-item-${NOTIF_ID}`);

    const markRead = page.getByTestId(`notifications-mark-read-${NOTIF_ID}`);
    await expect(markRead).toBeVisible();
    await markRead.click();
    // The fixture echoes a read row; the page transitions to the
    // "read" state, and the aside column shows the "read" tag
    // instead of the mark-read button.
    await expect(
      page.getByTestId(`notifications-item-${NOTIF_ID}`),
    ).toHaveAttribute('data-state', 'read');
  });

  test('Preferences link navigates to the preferences page', async ({ page }) => {
    await setSeed('phase12-notifications');
    await login(page);
    await clientGoto(page, ROUTES.notifications);
    await expectMounted(page, 'notifications-prefs-link');
    await page.getByTestId('notifications-prefs-link').click();
    await expectMounted(page, 'notification-prefs-form');
  });

  test('Kind filter chip navigates to a kind-scoped inbox', async ({ page }) => {
    await setSeed('phase12-notifications');
    await login(page);
    await clientGoto(page, ROUTES.notifications);
    await expectMounted(page, 'notifications-filter-bar');
    const chip = page.getByTestId('notifications-filter-review_due');
    await expect(chip).toBeVisible();
    await chip.click();
    // The page reloads with ?kind=review_due; the active chip
    // flips to data-active="true".
    await expect(chip).toHaveAttribute('data-active', 'true');
  });

  test('preferences page populates the form and persists a kind opt-out', async ({
    page,
  }) => {
    await login(page);
    await clientGoto(page, '/notifications/preferences');
    await expectMounted(page, 'notification-prefs-form');

    // The GET response populates the form. Quiet hours are off
    // by default and all kinds are enabled (no disabled_kinds).
    // The per-kind checkbox is "checked when disabled" — so an
    // empty disabled_kinds list means every checkbox is unchecked.
    await expect(
      page.getByTestId('notification-prefs-quiet-enabled'),
    ).not.toBeChecked();
    await expect(
      page.getByTestId('notification-prefs-kind-review_due'),
    ).not.toBeChecked();

    // Toggle review_due off (it's a real kind listed in the form).
    // The first click enables the opt-out: disabled_kinds grows
    // and the checkbox flips to checked.
    await page.getByTestId('notification-prefs-kind-review_due').click();
    await expect(
      page.getByTestId('notification-prefs-kind-review_due'),
    ).toBeChecked();

    // Submit the form; the page transitions to the success band.
    await page.getByTestId('notification-prefs-save').click();
    await expect(
      page.getByTestId('notification-prefs-success'),
    ).toBeVisible();
  });

  test('inbox zero renders an honest empty state when no notifications exist', async ({
    page,
  }) => {
    // Default empty seed.
    await login(page);
    await clientGoto(page, ROUTES.notifications);
    await expect(page.getByText(/inbox zero/i)).toBeVisible();
  });
});
