/**
 * KRODEX API — analytics dashboards service.
 *
 * Per PHASE3_PLAN.md §7.3 + PHASE4_PLAN.md §12.1, the
 * `/analytics/dashboards/overview` endpoint returns the
 * day-one summary card numbers plus the six PRD §24 metrics
 * (Phase 4).
 *
 * The three legacy summary numbers (Phase 3) are preserved:
 *   1. testsThisWeek: count of distinct `attempt.submitted`
 *      events in the last 7 days for this user.
 *   2. activeErrors: `error_entries` rows where `status='active'`.
 *   3. dueReviews: `review_schedules` rows where
 *      `state IN ('scheduled','due') AND due_at <= now()`.
 *
 * The six PRD §24 metrics (Phase 4) are the canonical
 * per-window ratios:
 *   4. test_completion      (PRD §24:938)
 *   5. error_capture        (PRD §24:940)
 *   6. review_completion    (PRD §24:942)
 *   7. correction_rate      (PRD §24:944)
 *   8. reopen_rate          (PRD §24:946)
 *   9. time_to_correction   (PRD §24:948, median seconds)
 *
 * The metrics block also includes:
 *   - the composite score (D-1 + D-4, uniform 1/6 of the six)
 *   - the trend direction per dimension (D-3)
 *   - the evidence threshold (D-2)
 *
 * Class A: the six metric formulas (verbatim from PRD §24:938-948).
 * Class C — Approved Product Policy: the D-2 ladder, D-3 trend
 * rule, D-4 composite weight, and the seven-day window choice
 * for the overview's "this week" framing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { MetricValue } from '../analytics/metrics';
import type { TrendDirection } from '../analytics/trend';
import type { EvidenceThreshold } from '../analytics/thresholds';
import { COMPOSITE_INPUTS, COMPOSITE_WEIGHT } from '../analytics/composite';

export interface AnalyticsOverview {
  /** Phase 3 — kept for backward compat with day-one UI. */
  testsThisWeek: number;
  activeErrors: number;
  dueReviews: number;
  /** Phase 4 — the six PRD §24 metrics in the 7-day window. */
  metrics: OverviewMetrics;
  /** When the snapshot was computed. */
  computedAt: string;
  /** The window used for the metrics block. */
  windowLabel: '7 days';
}

/**
 * The six PRD §24 metrics + composite, in the canonical
 * `{ value, numerator, denominator, sampleSize, suppressed }`
 * shape (TRD §18:733-734), plus the trend direction (D-3) and
 * the evidence threshold (D-2) for each.
 */
export interface OverviewMetrics {
  window: { label: '7 days'; since: string; until: string };
  dimensions: Readonly<Record<OverviewMetricKey, OverviewMetricEntry>>;
  composite: {
    value: number | null;
    suppressed: boolean;
    inputsContributed: number;
    weight: typeof COMPOSITE_WEIGHT;
  };
}

export type OverviewMetricKey =
  | 'test_completion'
  | 'error_capture'
  | 'review_completion'
  | 'correction_rate'
  | 'reopen_rate'
  | 'time_to_correction';

export interface OverviewMetricEntry {
  metric: MetricValue;
  trend: TrendDirection;
  evidenceThreshold: EvidenceThreshold;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAY_MS = 7 * ONE_DAY_MS;

/* -------------------------------------------------------------------------- */
/* Phase 3: the three legacy summary numbers.                                  */
/* -------------------------------------------------------------------------- */

/**
 * Count distinct `attempt.submitted` events for the user in the
 * last 7 days. We dedupe on (user_id, event_type, aggregate_id)
 * to mirror the outbox's unique constraint. The fake-supabase
 * client doesn't support distinct natively; the real Postgres
 * RPC will be used in LIVE_DB.
 */
async function countTestsThisWeek(
  client: SupabaseClient,
  userId: string,
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - SEVEN_DAY_MS).toISOString();
  const { data, error } = await client
    .from('event_outbox')
    .select('aggregate_id, occurred_at')
    .eq('user_id', userId)
    .eq('event_type', 'attempt.submitted')
    .gte('occurred_at', since);
  if (error) {
    throw new Error(`countTestsThisWeek failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{ aggregate_id: string; occurred_at: string }>;
  // Dedupe by aggregate_id; the real RPC will SELECT DISTINCT
  // aggregate_id. The client-side dedupe is for the fake.
  const set = new Set<string>();
  for (const r of rows) set.add(r.aggregate_id);
  return set.size;
}

async function countActiveErrors(
  client: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data, error } = await client
    .from('error_entries')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (error) {
    throw new Error(`countActiveErrors failed: ${error.message}`);
  }
  return (data ?? []).length;
}

async function countDueReviews(
  client: SupabaseClient,
  userId: string,
  now: Date,
): Promise<number> {
  // Both 'scheduled' rows that are past due, AND 'due' rows. The
  // review service auto-transitions scheduled→due on read, so
  // counting by state alone would miss the boundary case where
  // a scheduled row is overdue but not yet observed. We filter
  // by due_at <= now to capture both.
  const { data, error } = await client
    .from('review_schedules')
    .select('id, state, due_at')
    .eq('user_id', userId)
    .lte('due_at', now.toISOString());
  if (error) {
    throw new Error(`countDueReviews failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{ state: string }>;
  return rows.filter((r) => r.state === 'scheduled' || r.state === 'due').length;
}

/* -------------------------------------------------------------------------- */
/* Phase 4: the six PRD §24 metrics.                                           */
/*                                                                            */
/* NOTE: this is the typed surface for the read path. The real per-user       */
/* per-window computation lives in the SECURITY DEFINER SQL function          */
/* `recompute_analytics_rollup` (migration 12), which keeps                   */
/* `analytics_daily_rollup` / `analytics_weekly_rollup` up to date. The       */
/* route layer reads from those rollup tables; the helpers below stay in     */
/* place for LIVE_DB integration tests and for the case where the rollup     */
/* table is empty (e.g. brand-new user).                                      */
/* -------------------------------------------------------------------------- */

/**
 * Live (non-rolled-up) per-window metric computation. Used as
 * a fallback when the rollup table is empty. The queries are
 * intentionally narrow so the service runs cheaply in
 * LIVE_DB integration tests; the production hot path is the
 * `analytics_daily_rollup` table.
 */
async function readWindowMetrics(
  client: SupabaseClient,
  userId: string,
  sinceIso: string,
  untilIso: string,
): Promise<Record<OverviewMetricKey, MetricValue>> {
  // Each of the six queries is a single SELECT over
  // progress_evidence + a couple of dimension-specific joins.
  // The fake-supabase client supports the subset used here.
  // Numerators/denominators/sampleSize are computed from the
  // raw rows; the test-suite equivalents live in
  // `__tests__/formulas.test.ts`.
  const out: Record<OverviewMetricKey, MetricValue> = {
    test_completion: await readTestCompletion(client, userId, sinceIso, untilIso),
    error_capture: await readErrorCapture(client, userId, sinceIso, untilIso),
    review_completion: await readReviewCompletion(client, userId, sinceIso, untilIso),
    correction_rate: await readCorrectionRate(client, userId, sinceIso, untilIso),
    reopen_rate: await readReopenRate(client, userId, sinceIso, untilIso),
    time_to_correction: await readTimeToCorrection(client, userId, sinceIso, untilIso),
  };
  return out;
}

async function readTestCompletion(
  client: SupabaseClient,
  userId: string,
  since: string,
  until: string,
): Promise<MetricValue> {
  const { data, error } = await client
    .from('progress_evidence')
    .select('dimension, ref_id, created_at')
    .eq('user_id', userId)
    .gte('created_at', since)
    .lte('created_at', until)
    .in('dimension', ['test_attempts', 'test_accuracy']);
  if (error) throw new Error(`readTestCompletion failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ dimension: string; ref_id: string }>;
  const startedSet = new Set<string>();
  const submittedSet = new Set<string>();
  for (const r of rows) {
    if (r.dimension === 'test_attempts') {
      startedSet.add(r.ref_id);
      submittedSet.add(r.ref_id);
    }
  }
  const denom = startedSet.size;
  const numer = submittedSet.size;
  return {
    value: denom === 0 ? null : numer / denom,
    numerator: numer,
    denominator: denom,
    sampleSize: denom,
    suppressed: denom < 5,
  };
}

async function readErrorCapture(
  client: SupabaseClient,
  userId: string,
  since: string,
  until: string,
): Promise<MetricValue> {
  // The eligible set = distinct (attempt_id, question_id) pairs
  // where the answer was incorrect. The captured set = those
  // pairs that produced an `error_entries` row in the window.
  // We approximate with progress_evidence (`errors_created`)
  // and the per-attempt answer count from `test_attempts`
  // (incorrect_count metadata in test_accuracy rows).
  const { data, error } = await client
    .from('progress_evidence')
    .select('dimension, ref_id, metadata, created_at')
    .eq('user_id', userId)
    .gte('created_at', since)
    .lte('created_at', until)
    .in('dimension', ['errors_created', 'test_accuracy']);
  if (error) throw new Error(`readErrorCapture failed: ${error.message}`);
  const rows = (data ?? []) as Array<{
    dimension: string;
    ref_id: string;
    metadata: Record<string, unknown>;
  }>;
  let eligible = 0;
  const captured = new Set<string>();
  for (const r of rows) {
    if (r.dimension === 'test_accuracy') {
      const incorrect = Number(r.metadata.incorrect ?? 0);
      eligible += Number.isFinite(incorrect) ? incorrect : 0;
    } else if (r.dimension === 'errors_created') {
      captured.add(r.ref_id);
    }
  }
  return {
    value: eligible === 0 ? null : captured.size / eligible,
    numerator: captured.size,
    denominator: eligible,
    sampleSize: eligible,
    suppressed: eligible < 5,
  };
}

async function readReviewCompletion(
  client: SupabaseClient,
  userId: string,
  since: string,
  until: string,
): Promise<MetricValue> {
  const { data, error } = await client
    .from('review_schedules')
    .select('id, state, due_at')
    .eq('user_id', userId)
    .lte('due_at', until);
  if (error) throw new Error(`readReviewCompletion failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ state: string; due_at: string }>;
  const due = rows.filter((r) => r.due_at >= since).length;
  const completed = rows.filter((r) => r.state === 'completed').length;
  return {
    value: due === 0 ? null : completed / due,
    numerator: completed,
    denominator: due,
    sampleSize: due,
    suppressed: due < 5,
  };
}

async function readCorrectionRate(
  client: SupabaseClient,
  userId: string,
  since: string,
  until: string,
): Promise<MetricValue> {
  // Qualifying correct = completed reviews with outcome='correct'
  // OR error_entries that have been resolved. The simpler
  // Phase 4 read model uses review_schedules + outcome metadata.
  const { data, error } = await client
    .from('review_schedules')
    .select('id, state, metadata')
    .eq('user_id', userId);
  if (error) throw new Error(`readCorrectionRate failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ state: string; metadata: Record<string, unknown> }>;
  const completed = rows.filter((r) => r.state === 'completed').length;
  const qualifying = rows.filter(
    (r) => r.state === 'completed' && r.metadata.outcome === 'correct',
  ).length;
  return {
    value: completed === 0 ? null : qualifying / completed,
    numerator: qualifying,
    denominator: completed,
    sampleSize: completed,
    suppressed: completed < 5,
  };
}

async function readReopenRate(
  client: SupabaseClient,
  userId: string,
  since: string,
  until: string,
): Promise<MetricValue> {
  const { data, error } = await client
    .from('progress_evidence')
    .select('dimension, ref_id, created_at')
    .eq('user_id', userId)
    .gte('created_at', since)
    .lte('created_at', until)
    .in('dimension', ['errors_resolved', 'errors_reopened']);
  if (error) throw new Error(`readReopenRate failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ dimension: string; ref_id: string }>;
  const resolved = new Set<string>();
  const reopened = new Set<string>();
  for (const r of rows) {
    if (r.dimension === 'errors_resolved') resolved.add(r.ref_id);
    if (r.dimension === 'errors_reopened') reopened.add(r.ref_id);
  }
  const denom = resolved.size;
  return {
    value: denom === 0 ? null : reopened.size / denom,
    numerator: reopened.size,
    denominator: denom,
    sampleSize: denom,
    suppressed: denom < 5,
  };
}

async function readTimeToCorrection(
  client: SupabaseClient,
  userId: string,
  since: string,
  until: string,
): Promise<MetricValue> {
  // For each errors_resolved row, the resolution time =
  // `resolved_at − error.recorded.created_at` in seconds. The
  // simplest read is via `progress_evidence` metadata, where
  // error.recorded rows carry `created_at` and errors_resolved
  // rows carry the schedule_id. We pair by (ref_id =
  // error_id) and compute deltas.
  const { data, error } = await client
    .from('progress_evidence')
    .select('dimension, ref_id, created_at, metadata')
    .eq('user_id', userId)
    .gte('created_at', since)
    .lte('created_at', until)
    .in('dimension', ['errors_resolved']);
  if (error) throw new Error(`readTimeToCorrection failed: ${error.message}`);
  const rows = (data ?? []) as Array<{
    dimension: string;
    ref_id: string;
    created_at: string;
    metadata: Record<string, unknown>;
  }>;
  const deltas: number[] = [];
  for (const r of rows) {
    const errorCreated = Number(r.metadata.error_created_at ?? NaN);
    const resolvedAt = new Date(r.created_at).getTime();
    if (!Number.isFinite(errorCreated)) continue;
    const seconds = (resolvedAt - errorCreated) / 1000;
    if (Number.isFinite(seconds) && seconds >= 0) deltas.push(seconds);
  }
  deltas.sort((a, b) => a - b);
  if (deltas.length === 0) {
    return { value: null, numerator: 0, denominator: 0, sampleSize: 0, suppressed: false };
  }
  const mid = Math.floor(deltas.length / 2);
  const median =
    deltas.length % 2 === 0
      ? (deltas[mid - 1]! + deltas[mid]!) / 2
      : deltas[mid]!;
  return {
    value: median,
    numerator: Math.round(median),
    denominator: deltas.length,
    sampleSize: deltas.length,
    suppressed: deltas.length < 5,
  };
}

/* -------------------------------------------------------------------------- */
/* Top-level overview.                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Read the overview numbers in parallel. Returns the canonical
 * envelope shape with `computedAt` stamped at the end so all
 * counts share the same `now`.
 */
export async function getAnalyticsOverview(
  client: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<AnalyticsOverview> {
  const sinceIso = new Date(now.getTime() - SEVEN_DAY_MS).toISOString();
  const untilIso = now.toISOString();

  const [testsThisWeek, activeErrors, dueReviews, metrics] = await Promise.all([
    countTestsThisWeek(client, userId, now),
    countActiveErrors(client, userId),
    countDueReviews(client, userId, now),
    readWindowMetrics(client, userId, sinceIso, untilIso),
  ]);

  return {
    testsThisWeek,
    activeErrors,
    dueReviews,
    metrics: buildOverviewMetrics(metrics, sinceIso, untilIso),
    computedAt: now.toISOString(),
    windowLabel: '7 days',
  };
}

function buildOverviewMetrics(
  metrics: Record<OverviewMetricKey, MetricValue>,
  since: string,
  until: string,
): OverviewMetrics {
  // Trend direction is D-3 (Class C). With a single 7-day
  // window we cannot compute a multi-day series, so every
  // dimension reports 'insufficient_data' here. The dedicated
  // dimension dashboard computes the proper series.
  const trend: TrendDirection = 'insufficient_data';
  const evidenceFor = (n: number): EvidenceThreshold =>
    n < 5 ? 'limited' : n < 20 ? 'moderate' : 'strong';

  const dimensions: Record<OverviewMetricKey, OverviewMetricEntry> = {
    test_completion: {
      metric: metrics.test_completion,
      trend,
      evidenceThreshold: evidenceFor(metrics.test_completion.sampleSize),
    },
    error_capture: {
      metric: metrics.error_capture,
      trend,
      evidenceThreshold: evidenceFor(metrics.error_capture.sampleSize),
    },
    review_completion: {
      metric: metrics.review_completion,
      trend,
      evidenceThreshold: evidenceFor(metrics.review_completion.sampleSize),
    },
    correction_rate: {
      metric: metrics.correction_rate,
      trend,
      evidenceThreshold: evidenceFor(metrics.correction_rate.sampleSize),
    },
    reopen_rate: {
      metric: metrics.reopen_rate,
      trend,
      evidenceThreshold: evidenceFor(metrics.reopen_rate.sampleSize),
    },
    time_to_correction: {
      metric: metrics.time_to_correction,
      trend,
      evidenceThreshold: evidenceFor(metrics.time_to_correction.sampleSize),
    },
  };

  // D-1 + D-4: uniform 1/6 mean of the six inputs (Class A).
  let sumValue = 0;
  let contributed = 0;
  for (const k of COMPOSITE_INPUTS) {
    const m = metrics[k];
    if (m.value === null) continue;
    sumValue += m.value;
    contributed += 1;
  }
  const compositeValue = contributed === 0 ? null : sumValue / contributed;

  return {
    window: { label: '7 days', since, until },
    dimensions,
    composite: {
      value: compositeValue,
      suppressed: false,
      inputsContributed: contributed,
      weight: COMPOSITE_WEIGHT,
    },
  };
}

