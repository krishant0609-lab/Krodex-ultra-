/**
 * KRODEX API — Phase 15 perf baseline (vitest / app.inject).
 *
 * Same endpoints and same iteration count as `scripts/perf-baseline.mjs`,
 * but driven through `app.inject()` so the measurement does not need
 * a running HTTP server and does not depend on the shared-package
 * dist exports (the runtime tsx path is currently broken for
 * ESM-directory imports; a fix is out of scope for Phase 15).
 *
 * Output: writes a JSON baseline to `docs/perf-baseline.json` that
 * can be diffed across runs. Phase 15 does not set pass/fail
 * thresholds — this is a measurement, not a gate.
 *
 * Run with:
 *   npx vitest run --reporter=basic src/__tests__/phase15-perf-baseline.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server';

interface Sample {
  latencyMs: number;
  status: number;
  ok: boolean;
}

interface EndpointSpec {
  label: string;
  method: 'GET';
  path: string;
  /** Should the request carry an Authorization: Bearer header? */
  authed: boolean;
}

const ENDPOINTS: readonly EndpointSpec[] = [
  { label: 'health', method: 'GET', path: '/health', authed: false },
  { label: 'syllabus_subjects', method: 'GET', path: '/syllabus/subjects', authed: true },
  { label: 'syllabus_topics', method: 'GET', path: '/syllabus/topics', authed: true },
  { label: 'syllabus_progress', method: 'GET', path: '/syllabus/progress', authed: true },
  { label: 'errors_list', method: 'GET', path: '/errors', authed: true },
  { label: 'notifications_list', method: 'GET', path: '/notifications', authed: true },
  { label: 'analytics_dimensions', method: 'GET', path: '/analytics/dimensions', authed: true },
  { label: 'analytics_overview', method: 'GET', path: '/analytics/dashboards/overview', authed: true },
];

const ITERATIONS = 20;

let app: FastifyInstance | null = null;
let devToken: string | null = null;

beforeAll(async () => {
  app = await buildServer();
  // Try to mint a dev token. The smoke test does the same — if the
  // issuer is disabled in this profile the authed endpoints will
  // legitimately return 401, which we still record in the baseline
  // (the 401 path is the actual path in the no-Supabase profile).
  const tokenRes = await app.inject({
    method: 'POST',
    url: '/auth/dev-token',
    payload: { user_id: '00000000-0000-0000-0000-000000000001' },
  });
  if (tokenRes.statusCode === 200) {
    const body = tokenRes.json() as { success: boolean; data: { token: string } };
    if (body.success) devToken = body.data.token;
  }
});

afterAll(async () => {
  if (app) {
    await app.close();
    app = null;
  }
});

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  // sorted[idx] is `number | undefined` under noUncheckedIndexedAccess;
  // idx is clamped to [0, sorted.length - 1] above so the access is
  // always defined. Coalesce to 0 to keep the : number return type.
  return sorted[idx] ?? 0;
}

async function callOnce(ep: EndpointSpec): Promise<Sample> {
  if (!app) throw new Error('app is not built');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (ep.authed && devToken) headers['authorization'] = `Bearer ${devToken}`;
  const start = performance.now();
  let status = 0;
  let ok = false;
  try {
    const res = await app.inject({ method: ep.method, url: ep.path, headers });
    status = res.statusCode;
    ok = res.statusCode >= 200 && res.statusCode < 300;
  } catch {
    status = 0;
    ok = false;
  }
  const end = performance.now();
  return { latencyMs: end - start, status, ok };
}

async function measure(ep: EndpointSpec): Promise<{
  label: string;
  method: string;
  path: string;
  iterations: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  avg_ms: number;
  status_counts: Record<string, number>;
  authed_request: boolean;
  token_provided: boolean;
}> {
  // Warmup: 1 request excluded from the percentile set.
  await callOnce(ep);
  const samples: number[] = [];
  const statusCounts = new Map<string, number>();
  for (let i = 0; i < ITERATIONS; i++) {
    const r = await callOnce(ep);
    samples.push(r.latencyMs);
    const key = String(r.status);
    statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const avg = samples.reduce((s, n) => s + n, 0) / samples.length;
  return {
    label: ep.label,
    method: ep.method,
    path: ep.path,
    iterations: ITERATIONS,
    p50_ms: Number(percentile(sorted, 50).toFixed(2)),
    p95_ms: Number(percentile(sorted, 95).toFixed(2)),
    p99_ms: Number(percentile(sorted, 99).toFixed(2)),
    max_ms: Number(Math.max(...samples).toFixed(2)),
    avg_ms: Number(avg.toFixed(2)),
    status_counts: Object.fromEntries(statusCounts.entries()),
    authed_request: ep.authed,
    token_provided: Boolean(devToken),
  };
}

describe('Phase 15 perf baseline (in-process app.inject)', () => {
  it('measures all endpoints and writes docs/perf-baseline.json', async () => {
    expect(app).not.toBeNull();
    const results: Awaited<ReturnType<typeof measure>>[] = [];
    for (const ep of ENDPOINTS) {
      const r = await measure(ep);
      results.push(r);
      // Light-touch assertion: at least 19/20 samples returned a
      // real HTTP status (not a thrown error inside inject).
      const okCount = Object.entries(r.status_counts)
        .filter(([s]) => s !== '0')
        .reduce((sum, [, n]) => sum + n, 0);
      expect(okCount).toBeGreaterThanOrEqual(ITERATIONS - 1);
    }

    // Write JSON to repo-root docs/perf-baseline.json. The test
    // lives at apps/api/src/__tests__/, so we go up four levels to
    // reach the repo root and then into docs/.
    const outPath = resolve(__dirname, '..', '..', '..', '..', 'docs', 'perf-baseline.json');
    mkdirSync(dirname(outPath), { recursive: true });
    const payload = {
      captured_at: new Date().toISOString(),
      method: 'app.inject (in-process, no network)',
      iterations_per_endpoint: ITERATIONS,
      note:
        'Baseline snapshot. Phase 15 does not set pass/fail thresholds; ' +
        'this is a measurement. Authed endpoints may return 401 in the ' +
        'no-Supabase test profile; the 401 path is recorded as the ' +
        'realistic response under that profile.',
      dev_token_minted: Boolean(devToken),
      endpoints: results,
    };
    writeFileSync(outPath, JSON.stringify(payload, null, 2));
  });
});
