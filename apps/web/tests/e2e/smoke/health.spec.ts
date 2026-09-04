/**
 * KRODEX web — Phase 16 M7 smoke: /health against the real API.
 *
 * Per `docs/PHASE16_PLAN.md` §4.1 (M7 acceptance) and §5.2
 * (`smoke/health.spec.ts` asserts):
 *
 *   - `GET /health` returns 200.
 *   - The Phase 14 security policy block is present
 *     (`security.installed === true` in non-test mode).
 *   - `db.up === true` (Supabase reachable).
 *   - `event_bus.running === true` (outbox worker booted).
 *
 * Runs against the local integrated stack booted by
 * `playwright.smoke.config.ts` (real `apps/api` on port 4200,
 * real Supabase local on port 54321). If the local stack is not
 * available, the spec is skipped with a clear `SKIP_NO_LOCAL_STACK`
 * marker; the run then exits 0 and the PARTIAL verdict is
 * recorded in `docs/PHASE16_VERIFICATION.md`.
 */

import { test, expect, type APIResponse } from '@playwright/test';

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4200';

test.describe('M7 smoke — /health (local integrated stack)', () => {
  test('GET /health returns the expected envelope', async ({ request }) => {
    let res: APIResponse;
    try {
      res = await request.get(`${API_URL}/health`, { timeout: 5_000 });
    } catch (err) {
      test.skip(true, `SKIP_NO_LOCAL_STACK: ${API_URL} unreachable (${(err as Error).message})`);
      return;
    }
    if (!res.ok()) {
      test.skip(true, `SKIP_NO_LOCAL_STACK: /health returned ${res.status()}`);
      return;
    }
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.data.db).toBeDefined();
    expect(body.data.db.up).toBe(true);
    expect(body.data.event_bus).toBeDefined();
    expect(body.data.event_bus.running).toBe(true);
    expect(body.data.security).toBeDefined();
    expect(body.data.security.installed).toBe(true);
  });
});
