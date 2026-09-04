/**
 * KRODEX web — Playwright config for the Phase 16 M7 smoke run.
 *
 * This is the **local integrated stack** smoke. Per
 * `docs/PHASE16_PLAN.md` §4.1 (M7 acceptance) + §11 Q1, the
 * smoke's acceptance surface is the local integrated stack
 * (`apps/api` + Supabase local + `apps/web` on the same host).
 * Deployed staging / production smoke is a host-target concern
 * and is NOT in M7.
 *
 * The local Supabase CLI is NOT on every developer's PATH, and
 * the M7 acceptance is *documentation-and-execution*: the suite
 * must (a) be discoverable, (b) execute against the real API
 * when the local stack is up, and (c) skip cleanly when the
 * local stack is not available. Per §4.3 sub-gate (b), a
 * skip-only run is the documented PARTIAL-verdict path.
 *
 * To support this without crashing Playwright's webServer
 * bootstrap on hosts without the supabase CLI, this config:
 *   1. Calls `tests/e2e/smoke/global-setup.mjs` which probes the
 *      supabase CLI and the real API, writing a JSON marker to
 *      `tests/e2e/smoke/.stack-state.json`.
 *   2. Does NOT put `supabase start` in the `webServer` block.
 *      Instead, the suite's specs read the marker and either
 *      run the real path or `test.skip()` with the marker text.
 *
 * The `webServer` block below boots only the parts that can
 * always start (the API + the dev server, when the real stack
 * is available). The smoke is fast-fail: if the API cannot be
 * started within 30s, the suite skips.
 *
 * This config is intentionally separate from
 * `playwright.config.ts` (the merge-blocking fixture-based
 * E2E in M1 stage 7). Run with: `npx playwright test
 * --config=playwright.smoke.config.ts`.
 */

import { defineConfig, devices } from '@playwright/test';

const API_PORT = 4200;
const WEB_PORT = 3100;
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './tests/e2e/smoke',
  // Single dev server; keep tests sequential.
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // 5 min per spec — the real API is slower than the fixture.
  timeout: 300_000,
  expect: { timeout: 15_000 },
  globalSetup: './tests/e2e/smoke/global-setup.mjs',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // The webServer block is intentionally minimal. It does NOT
  // boot Supabase (the globalSetup probes for it). When the
  // local stack is available, the developer is expected to have
  // `supabase start` and `npm --workspace @krodex/api run dev`
  // running already. The smoke spec's `local-stack-available`
  // probe decides whether each test runs or skips.
  //
  // We omit the `webServer` block entirely. Playwright treats
  // its absence as "no servers to manage"; the developer is
  // responsible for the local stack when the suite runs in
  // LOCAL_STACK_AVAILABLE mode. The marker written by
  // globalSetup is the single source of truth.
  webServer: [],
});

// Re-export so the globalSetup can read the same URL the suite uses.
export { API_URL, WEB_URL };
