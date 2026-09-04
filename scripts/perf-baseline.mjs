#!/usr/bin/env node
/**
 * KRODEX — Phase 15 performance baseline.
 *
 * Measures end-to-end latency of a handful of representative GET
 * endpoints against a running API instance. Reports p50 / p95 / p99
 * per endpoint and writes a JSON snapshot to
 * `docs/perf-baseline.json` so the numbers can be diffed over
 * time.
 *
 * IMPORTANT — what this script is NOT:
 *   - It does NOT set pass / fail thresholds. The TRD performance
 *     targets are engineering goals, not gates (per the Phase 15
 *     plan §3 "Performance Baseline Script"). The plan explicitly
 *     says: "Phase 15 does not set targets (TRD targets are goals,
 *     not gates). Baseline is a measurement, not a pass/fail
 *     criterion."
 *   - It does NOT mutate production data. All endpoints are GETs
 *     and the script authenticates with a service-role token if
 *     one is configured (so it can hit authenticated routes
 *     against a Supabase dev project); otherwise it falls back to
 *     401-expected calls and reports those separately.
 *
 * Usage:
 *   API_BASE=http://127.0.0.1:4000 \
 *   KRODEX_TEST_USER_ID=<uuid> \
 *   KRODEX_TEST_USER_TOKEN=<jwt> \
 *   node scripts/perf-baseline.mjs [iterations]
 *
 *   - `iterations` defaults to 20 (matches the plan: "20
 *     iterations"). The first call to each endpoint is treated as
 *     a warmup and excluded from the percentile set.
 *
 * Endpoints measured (representative Phase 0–13 surface):
 *   GET /health                                 (unauthenticated)
 *   GET /syllabus/subjects                      (global tree, authed)
 *   GET /syllabus/topics                        (global tree, authed)
 *   GET /syllabus/progress                      (per-user, authed)
 *   GET /errors                                 (per-user, authed)
 *   GET /notifications                          (per-user, authed)
 *   GET /analytics/dimensions                   (global catalog, authed)
 *   GET /analytics/dashboards/overview          (per-user rollup, authed)
 *
 * Output:
 *   - Human-readable summary to stdout (per-endpoint: count, p50,
 *     p95, p99, max, status code distribution).
 *   - JSON dump to docs/perf-baseline.json.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const ITERATIONS = Number.parseInt(process.argv[2] ?? '20', 10);
const API_BASE = process.env.API_BASE ?? 'http://127.0.0.1:4000';
const TOKEN = process.env.KRODEX_TEST_USER_TOKEN ?? '';
const USER_ID = process.env.KRODEX_TEST_USER_ID ?? '';
const OUT_PATH = resolve(process.cwd(), 'docs/perf-baseline.json');

const ENDPOINTS = [
  { method: 'GET', path: '/health', authed: false, label: 'health' },
  { method: 'GET', path: '/syllabus/subjects', authed: true, label: 'syllabus_subjects' },
  { method: 'GET', path: '/syllabus/topics', authed: true, label: 'syllabus_topics' },
  { method: 'GET', path: '/syllabus/progress', authed: true, label: 'syllabus_progress' },
  { method: 'GET', path: '/errors', authed: true, label: 'errors_list' },
  { method: 'GET', path: '/notifications', authed: true, label: 'notifications_list' },
  { method: 'GET', path: '/analytics/dimensions', authed: true, label: 'analytics_dimensions' },
  { method: 'GET', path: '/analytics/dashboards/overview', authed: true, label: 'analytics_overview' },
];

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function callEndpoint(ep) {
  const url = `${API_BASE}${ep.path}`;
  const headers = { 'content-type': 'application/json' };
  if (ep.authed && TOKEN) {
    headers['authorization'] = `Bearer ${TOKEN}`;
  }
  if (ep.authed && USER_ID) {
    // Some test harnesses key off an x-user-id header.
    headers['x-user-id'] = USER_ID;
  }
  const start = performance.now();
  let status = 0;
  let ok = false;
  try {
    const res = await fetch(url, { method: ep.method, headers });
    status = res.status;
    // Drain the body so the connection can be reused.
    await res.text();
    ok = res.ok;
  } catch (err) {
    // Network/connection error. The latency is still recorded as
    // the time until the throw, but status stays 0.
    status = 0;
    ok = false;
  }
  const end = performance.now();
  return { latencyMs: end - start, status, ok };
}

async function measureEndpoint(ep, iterations) {
  // Warmup: 1 request excluded from the percentile set.
  await callEndpoint(ep);
  const samples = [];
  const statusCounts = new Map();
  for (let i = 0; i < iterations; i++) {
    const r = await callEndpoint(ep);
    samples.push(r.latencyMs);
    const key = String(r.status);
    statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    label: ep.label,
    method: ep.method,
    path: ep.path,
    iterations,
    p50_ms: Number(percentile(sorted, 50).toFixed(2)),
    p95_ms: Number(percentile(sorted, 95).toFixed(2)),
    p99_ms: Number(percentile(sorted, 99).toFixed(2)),
    max_ms: Number(sorted[sorted.length - 1].toFixed(2)),
    avg_ms: Number((samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2)),
    status_counts: Object.fromEntries(statusCounts.entries()),
    authed_request: ep.authed,
    token_provided: Boolean(TOKEN),
  };
}

async function main() {
  const stamp = new Date().toISOString();
  console.log(`perf-baseline: target ${API_BASE}, ${ITERATIONS} iterations per endpoint`);
  if (!TOKEN) {
    console.log('perf-baseline: no KRODEX_TEST_USER_TOKEN set; authed endpoints will return 401.');
  }
  const results = [];
  for (const ep of ENDPOINTS) {
    process.stdout.write(`  measuring ${ep.label} (${ep.path}) ... `);
    const r = await measureEndpoint(ep, ITERATIONS);
    results.push(r);
    process.stdout.write(`p50=${r.p50_ms}ms p95=${r.p95_ms}ms p99=${r.p99_ms}ms\n`);
  }
  const out = {
    captured_at: stamp,
    api_base: API_BASE,
    iterations_per_endpoint: ITERATIONS,
    note: 'Baseline snapshot. Phase 15 does not set pass/fail thresholds; this is a measurement.',
    endpoints: results,
  };
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`\nperf-baseline: wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('perf-baseline failed:', err);
  process.exit(1);
});
