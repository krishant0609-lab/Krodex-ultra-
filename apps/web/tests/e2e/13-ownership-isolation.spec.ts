/**
 * KRODEX e2e — Phase 13 ownership isolation.
 *
 * The fixture is a single-user stub — it does not enforce
 * cross-student access. But the UI's owner-scoped query keys
 * must still produce the right shape: the same student sees
 * only their own reviews and errors.
 *
 * This spec verifies the detail pages surface a "not found"
 * state for ids the fixture hasn't seeded. The API-level
 * ownership guards (assertOwned + RLS) are covered exhaustively
 * by the API tests; the E2E here proves the client doesn't
 * crash on a 404.
 *
 * The fixture is flipped to seed=`empty` for the duration of
 * this suite; we only assert the "not found" path.
 */

import { test, expect } from '@playwright/test';
import { ROUTES, login, clientGoto } from './helpers';

test.describe('Ownership isolation (Phase 13)', () => {
  test('GET /errors/<unknown> renders a not-found page without crashing', async ({
    page,
  }) => {
    await login(page);
    await clientGoto(page, ROUTES.errorDetail);
    // The fixture returns 404 for unknown ids; the page
    // surfaces a not-found card or a controlled error state.
    await expect(page.getByText(/not found|not_found/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('GET /reviews/<unknown> renders a not-found page without crashing', async ({
    page,
  }) => {
    await login(page);
    await clientGoto(page, ROUTES.reviewDetail);
    await expect(page.getByText(/not found|not_found/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
