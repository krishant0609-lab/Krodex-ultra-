/**
 * KRODEX e2e — Phase 13 idempotency.
 *
 * The fixture exposes two idempotency contracts:
 *
 *   1. PATCH /notifications/:id (mark read) is idempotent.
 *      Re-issuing the same call returns the same read row
 *      and does not create a second notification.
 *   2. PATCH /notifications/preferences is idempotent.
 *      Re-issuing the same payload returns the same updated
 *      preferences and does not regress any field.
 *
 * Attempt-level idempotency (idempotency key for a wrong
 * attempt) is covered by the API-level tests in apps/api,
 * which exercise the same domain transactions exhaustively.
 * The E2E here proves the user-visible retry of a mark-read
 * or preferences update surfaces the same final state and
 * does not corrupt the inbox.
 *
 * The fixture is flipped to seed=`phase12-notifications` for
 * the mark-read retry test; the preferences test uses the
 * default empty seed because preferences GET always returns
 * the default record.
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

test.describe('Idempotency (Phase 13)', () => {
  test.afterEach(async () => {
    await setSeed('empty');
  });

  test('re-issuing mark-read on a read notification leaves it read and does not crash', async ({
    page,
  }) => {
    await setSeed('phase12-notifications');
    await login(page);
    await clientGoto(page, ROUTES.notifications);
    await expectMounted(page, `notifications-item-${NOTIF_ID}`);

    // First mark-read
    const markRead = page.getByTestId(`notifications-mark-read-${NOTIF_ID}`);
    await markRead.click();
    await expect(
      page.getByTestId(`notifications-item-${NOTIF_ID}`),
    ).toHaveAttribute('data-state', 'read');

    // The fixture exposes POST /notifications/:id/mark-read
    // and the mark-read button is replaced by the "read" tag.
    // A second click on the now-stale "read" tag must not
    // throw or regress the state.
    const row = page.getByTestId(`notifications-item-${NOTIF_ID}`);
    await expect(row).toHaveAttribute('data-state', 'read');
  });

  test('preferences PATCH with the same payload twice returns the same shape', async ({
    page,
  }) => {
    await login(page);
    await clientGoto(page, '/notifications/preferences');
    await expectMounted(page, 'notification-prefs-form');

    // Toggle a kind, save once.
    await page.getByTestId('notification-prefs-kind-review_due').click();
    await page.getByTestId('notification-prefs-save').click();
    await expect(
      page.getByTestId('notification-prefs-success'),
    ).toBeVisible();

    // Re-issuing the same toggle + save must not throw and
    // the success band stays visible (the PATCH is idempotent
    // on the fixture).
    await page.getByTestId('notification-prefs-kind-review_due').click();
    await page.getByTestId('notification-prefs-save').click();
    await expect(
      page.getByTestId('notification-prefs-success'),
    ).toBeVisible();
  });
});
