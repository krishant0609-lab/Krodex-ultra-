/**
 * Playwright global setup.
 *
 * Pre-warms the Next dev server by hitting every Phase 7 route
 * once. The dev server compiles each route on first request;
 * doing all the compiles serially before the test suite starts
 * keeps the test suite from racing the SWC worker pool. This is
 * purely a harness concern — it never modifies the app or its
 * contracts.
 *
 * Strategy: POST /auth/dev-token first to mint a real token, then
 * GET every route, in order. Wait for each request to return
 * 200. Any 5xx here is a Next compile failure that we want to
 * surface loudly before the test run starts, not buried in
 * per-test failure logs.
 */

import { setTimeout as sleep } from 'node:timers/promises';

const WEB_BASE = process.env.WEB_BASE ?? 'http://localhost:3000';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4100';

const ROUTES = [
  '/login',
  '/dashboard',
  '/syllabus',
  '/tests',
  '/errors',
  '/reviews',
  '/planner',
  '/backlog',
  '/insights',
  '/student-model',
  '/notifications',
  '/settings',
  '/attempts/attempt-notfound',
  '/tests/test-notfound',
  '/errors/error-notfound',
  '/reviews/review-notfound',
  '/reviews/phase10-review-001',
  '/syllabus/no-such-node',
  '/syllabus/subject/subject-notfound',
  '/syllabus/topic/topic-notfound',
  '/syllabus/sub-topic/sub-topic-notfound',
];

export default async function globalSetup() {
  console.log(`[global-setup] minting dev token from ${API_BASE}`);
  const tokenRes = await fetch(`${API_BASE}/auth/dev-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: 'user-fixture' }),
  });
  if (!tokenRes.ok) {
    throw new Error(
      `[global-setup] dev-token POST returned HTTP ${tokenRes.status}`,
    );
  }
  const { data } = await tokenRes.json();
  const token = data?.token;
  if (!token) {
    throw new Error('[global-setup] dev-token response missing token');
  }
  console.log('[global-setup] token minted');

  for (const route of ROUTES) {
    const url = `${WEB_BASE}${route}`;
    process.stdout.write(`[global-setup] warmup ${route} ... `);
    const start = Date.now();
    let res;
    let attempt = 0;
    do {
      res = await fetch(url, { redirect: 'manual' });
      attempt++;
      if (res.status >= 500) {
        console.log(`retry (status ${res.status})`);
        await sleep(1500);
      }
    } while (res.status >= 500 && attempt < 3);
    const ms = Date.now() - start;
    const status = res.status;
    console.log(`HTTP ${status} in ${ms}ms (attempt ${attempt})`);
    if (status >= 500) {
      throw new Error(
        `[global-setup] route ${route} returned ${status} after ${attempt} attempts — Next dev compile is broken`,
      );
    }
  }

  console.log('[global-setup] all routes compiled; tests can start');
}
