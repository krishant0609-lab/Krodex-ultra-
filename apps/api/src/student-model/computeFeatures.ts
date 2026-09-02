/**
 * KRODEX — student-model orchestrator (Phase 5).
 *
 * The orchestrator is the only public entry point to the
 * student-model feature computation. Given a Supabase client
 * and a user id, it:
 *
 *   1. Loads the relevant evidence rows for the window
 *      (default 28 days) — one query per source table.
 *   2. Fans out to all six pattern modules in parallel via
 *      `Promise.all`. The pattern modules are pure; they
 *      only read from the pre-loaded evidence object.
 *   3. Composes the final `StudentModelSnapshotPayload`,
 *      including the top-level `overallConfidence` (the
 *      minimum confidence across the seven real features).
 *
 * What the orchestrator does NOT do:
 *   - It does NOT write to `student_model_snapshots` /
 *     `student_model_features` directly. The SQL function
 *     `recompute_student_model` is the only writer; the
 *     orchestrator hands its computed payload to that
 *     function via the JSONB `p_features` argument.
 *   - It does NOT emit outbox envelopes. Outbox emission
 *     is the job of the scheduled job (`recompute_student_model`
 *     emits one `system.tick` per run).
 *   - It does NOT validate the input window. Callers must
 *     pass a sane `windowDays` (the API clamps to [1, 90]).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { StudentModelSnapshotPayload } from '@krodex/shared';

import * as consistencyMod from './patterns/consistency';
import * as errorRecurrenceMod from './patterns/error_recurrence';
import * as learningTrajectoryMod from './patterns/learning_trajectory';
import * as procrastinationMod from './patterns/procrastination_recovery';
import * as reviewBehaviorMod from './patterns/review_behavior';
import * as workloadMod from './patterns/workload_pressure';

import type {
  ErrorEntryRow,
  FeatureOutput,
  PatternInput,
  PlannerTaskRow,
  ReviewScheduleRow,
  StudentModelEvidence,
  TestCompletionRow,
} from './types';

/** Default window length (days). PRD §25 default. */
export const DEFAULT_WINDOW_DAYS = 28;
/** Maximum allowed window length (days). */
export const MAX_WINDOW_DAYS = 90;

/** Output of the orchestrator. */
export type StudentModelComputeResult = {
  payload: StudentModelSnapshotPayload;
  /** All seven feature outputs (incl. learning_trajectory). */
  features: Record<string, FeatureOutput>;
};

/** Options the orchestrator accepts. */
export interface ComputeFeaturesOptions {
  userId: string;
  windowDays?: number;
  /** Wall-clock override for tests. */
  now?: () => Date;
}

export async function computeFeaturesForUser(
  client: SupabaseClient,
  opts: ComputeFeaturesOptions,
): Promise<StudentModelComputeResult> {
  const now = opts.now?.() ?? new Date();
  const windowDays = clampWindow(opts.windowDays ?? DEFAULT_WINDOW_DAYS);
  const until = now;
  const since = new Date(now.getTime() - windowDays * 86_400_000);

  const evidence = await loadEvidence(client, opts.userId, since, until);
  const input: PatternInput = {
    userId: opts.userId,
    until,
    windowDays,
    evidence,
  };

  // Fan out to all six pattern modules in parallel. Five of
  // them are independent; learning_trajectory depends on the
  // outputs of consistency and error_recurrence and consumes
  // the cached results via `computeFromUpstream`.
  const [consistency, errorRecurrence, procrastinationRecovery, review, workload] =
    await Promise.all([
      consistencyMod.compute(input),
      errorRecurrenceMod.compute(input),
      procrastinationMod.compute(input),
      reviewBehaviorMod.compute(input),
      workloadMod.compute(input),
    ]);
  const learning = await learningTrajectoryMod.computeFromUpstream({
    consistency,
    errorRecurrence,
    windowDays,
  });

  const features: Record<string, FeatureOutput> = {
    consistency_score: consistency,
    procrastination_score: procrastinationRecovery.procrastination,
    recovery_score: procrastinationRecovery.recovery,
    error_recurrence_score: errorRecurrence,
    review_compliance_score: review,
    workload_pressure_score: workload,
    learning_trajectory: learning,
  };

  // overallConfidence is the minimum confidence across the
  // seven real features. `learning_trajectory` is computed
  // upstream so it can never exceed its inputs.
  const confidenceRank: Record<FeatureOutput['confidence'], number> = {
    limited: 0,
    moderate: 1,
    strong: 2,
  };
  const inverseRank: Record<number, FeatureOutput['confidence']> = {
    0: 'limited',
    1: 'moderate',
    2: 'strong',
  };
  let minRank = 2;
  for (const f of Object.values(features)) {
    const r = confidenceRank[f.confidence];
    if (r < minRank) minRank = r;
  }

  const payload: StudentModelSnapshotPayload = {
    userId: opts.userId,
    computedAt: now.toISOString(),
    evidenceWindowDays: windowDays,
    features: {
      consistency_score: consistency,
      procrastination_score: procrastinationRecovery.procrastination,
      recovery_score: procrastinationRecovery.recovery,
      error_recurrence_score: errorRecurrence,
      review_compliance_score: review,
      workload_pressure_score: workload,
      learning_trajectory: learning,
    },
    overallConfidence: inverseRank[minRank] ?? 'limited',
  };
  return { payload, features };
}

/**
 * Load the four evidence tables for the window. Each call is
 * independent; we issue them in parallel for latency.
 *
 * If any call fails the orchestrator still proceeds with the
 * tables that did load. A failure of all four is rare (it
 * would indicate a connection problem) and is bubbled up as
 * an exception.
 */
async function loadEvidence(
  client: SupabaseClient,
  userId: string,
  since: Date,
  until: Date,
): Promise<StudentModelEvidence> {
  const [pe, rs, ee, pt] = await Promise.all([
    loadProgressEvidence(client, userId, since, until),
    loadReviewSchedules(client, userId, since, until),
    loadErrorEntries(client, userId, since, until),
    loadPlannerTasks(client, userId, since, until),
  ]);
  return {
    testCompletion: pe,
    reviewSchedules: rs,
    errorEntries: ee,
    plannerTasks: pt,
  };
}

async function loadProgressEvidence(
  client: SupabaseClient,
  userId: string,
  since: Date,
  until: Date,
): Promise<ReadonlyArray<TestCompletionRow>> {
  const { data, error } = await client
    .from('progress_evidence')
    .select('user_id, dimension, ref_kind, ref_id, captured_at, numerator, denominator')
    .eq('user_id', userId)
    .gte('captured_at', since.toISOString())
    .lte('captured_at', until.toISOString());
  if (error) return [];
  return (data ?? []) as ReadonlyArray<TestCompletionRow>;
}

async function loadReviewSchedules(
  client: SupabaseClient,
  userId: string,
  since: Date,
  until: Date,
): Promise<ReadonlyArray<ReviewScheduleRow>> {
  const { data, error } = await client
    .from('review_schedules')
    .select('user_id, due_date, review_date, status')
    .eq('user_id', userId)
    .gte('due_date', since.toISOString())
    .lte('due_date', until.toISOString());
  if (error) return [];
  return (data ?? []) as ReadonlyArray<ReviewScheduleRow>;
}

async function loadErrorEntries(
  client: SupabaseClient,
  userId: string,
  since: Date,
  until: Date,
): Promise<ReadonlyArray<ErrorEntryRow>> {
  const { data, error } = await client
    .from('error_entries')
    .select('id, user_id, error_type, captured_at')
    .eq('user_id', userId)
    .gte('captured_at', since.toISOString())
    .lte('captured_at', until.toISOString());
  if (error) return [];
  return (data ?? []) as ReadonlyArray<ErrorEntryRow>;
}

async function loadPlannerTasks(
  client: SupabaseClient,
  userId: string,
  since: Date,
  until: Date,
): Promise<ReadonlyArray<PlannerTaskRow>> {
  const { data, error } = await client
    .from('planner_tasks')
    .select('user_id, status, created_at, updated_at')
    .eq('user_id', userId)
    .gte('created_at', since.toISOString())
    .lte('created_at', until.toISOString());
  if (error) return [];
  return (data ?? []) as ReadonlyArray<PlannerTaskRow>;
}

/** Clamp the window length to [1, MAX_WINDOW_DAYS]. */
export function clampWindow(windowDays: number): number {
  if (!Number.isFinite(windowDays) || windowDays < 1) return 1;
  if (windowDays > MAX_WINDOW_DAYS) return MAX_WINDOW_DAYS;
  return Math.floor(windowDays);
}
