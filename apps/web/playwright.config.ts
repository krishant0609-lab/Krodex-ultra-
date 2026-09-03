/**
 * KRODEX web — Playwright config (Phase 7 Verification #3).
 *
 * Boots two servers in order:
 *   1. The fixture API (tests/e2e/fixture-server.mjs) on port 4100.
 *      It returns truthful envelopes for every endpoint the app
 *      calls; we never hit apps/api or supabase.
 *   2. The Next dev server (apps/web) on port 3000, with
 *      NEXT_PUBLIC_API_BASE_URL pointing at the fixture.
 *
 * We use `next dev` (not `next start`) because Phase 7 still
 * needs to verify the App Router pages, middleware, and
 * server-rendered HTML — the development server is the
 * faithful target. `fullyParallel: false, workers: 1` keeps
 * the dev server's first-pass compile from being swamped by
 * simultaneous requests to 19 different routes; we serialize
 * tests so the SWC compiler is asked to compile one route at
 * a time.
 *
 * Single project: chromium. Firefox and WebKit would just add
 * "verified on another browser" rows to the matrix; the visual
 * contract under test is the same code in all browsers.
 *
 * The webServer block starts each service once; Playwright will
 * reuse it across all tests and tear it down at the end.
 */

import { defineConfig, devices } from '@playwright/test';

const FIXTURE_PORT = 4100;
const WEB_PORT = 3000;
const FIXTURE_URL = `http://localhost:${FIXTURE_PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Single dev server; keep tests sequential.
  workers: 1,
  reporter: [['list']],
  timeout: 120_000, // First-time compile of a route can take 30–60s.
  expect: { timeout: 15_000 },
  globalSetup: './tests/e2e/global-setup.mjs',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
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
  webServer: [
    {
      command: `node tests/e2e/fixture-server.mjs ${FIXTURE_PORT}`,
      url: `${FIXTURE_URL}/health`,
      reuseExistingServer: true,
      timeout: 30_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `next dev -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_BASE_URL: FIXTURE_URL,
        NODE_ENV: 'development',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
