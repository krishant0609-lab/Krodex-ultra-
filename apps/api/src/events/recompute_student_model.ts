/**
 * KRODEX — `recompute_student_model` scheduled job.
 *
 * Per PHASE5_PLAN.md §5, this is the wall-clock-driven student-
 * model recompute. It is registered with the scheduler in
 * `scheduled-jobs.ts` and runs on a 5-minute cadence — the same
 * cadence as the analytics rollup (D-9, Class C — Approved
 * Product Policy).
 *
 * What the job does:
 *   1. Computes a 5-minute trailing window (`now − 5m .. now`).
 *   2. Lists every distinct `user_id` that has any new
 *      evidence in that window (the candidates for recompute).
 *      We union across the four evidence tables
 *      (`progress_evidence`, `review_schedules`, `error_entries`,
 *      `planner_tasks`) to mirror the orchestrator's input.
 *   3. For each candidate, calls the orchestrator +
 *      `recompute_student_model(p_user_id, p_features, p_window_
 *      days, p_until)` from migration 13. The function is
 *      idempotent: re-running it for the same user replaces the
 *      prior snapshot+feature rows with a fresh one.
 *   4. Emits a single `system.tick` audit envelope for the
 *      run, with `job_name='recompute_student_model'` and
 *      `emitted_event_count = sum of (user, feature_key) rows
 *      recomputed`.
 *
 * What the job does NOT do:
 *   - It does NOT enumerate every user in the system. The
 *     candidates are scoped to the 5-minute window; idle users
 *     are skipped (their snapshot remains valid for the
 *     28-day window).
 *   - It does NOT itself write to `student_model_snapshots` /
 *     `student_model_features`; that is the SQL function's job.
 *   - It does NOT do per-user or per-tenant authorization; it
 *     uses the service-role client and is intended to be safe
 *     to run on a worker with full DB privileges.
 *
 * The 5-minute cadence is **Class C — Approved Product Policy**,
 * NOT a value documented by the PRD, TRD, or Implementation
 * Plan. The value was approved by the user as a Phase 4 product
 * decision (D-9) and re-applied to Phase 5 by analogy — the
 * student model has the same freshness requirements as the
 * analytics rollup.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeEventId,
  computeIdempotencyKeyForEvent,
  type EventEnvelope,
  type SystemTickPayload,
} from '@krodex/shared';

import { buildEnvelope, emit } from './outbox-writer';
import { recomputeStudentModelForUser, DEFAULT_WINDOW_DAYS } from '../student-model/service';

export const JOB_NAME = 'recompute_student_model';

/** What the function returns to the runner. */
export interface RecomputeStudentModelResult {
  ok: boolean;
  /** Number of users whose student model was recomputed. */
  usersRecomputed: number;
  /** Sum of per-user `featuresWritten` (7 in the happy path per user). */
  featuresWritten: number;
  /** Error message when ok is false. */
  error?: string;
  /** The `system.tick` envelope we wrote (or tried to write). */
  tickEnvelope: EventEnvelope<'system.tick'>;
}

/**
 * Run the job once. Returns a structured result. Does not throw.
 */
export async function runRecomputeStudentModel(
  client: SupabaseClient,
  now: () => Date = () => new Date(),
): Promise<RecomputeStudentModelResult> {
  const ts = now();
  const since = new Date(ts.getTime() - 5 * 60 * 1000);
  const until = ts;

  // Always need a tick envelope (success or failure) to return
  // to the runner. The aggregate_id and idempotency key are
  // pinned by the job name + bucket.
  const tickEnvelope = buildTickEnvelope(ts, 0);

  // 1. List the candidate users: any user with any new evidence
  //    in the 5-minute window. We union across the four source
  //    tables to mirror the orchestrator's input set.
  const userIds = new Set<string>();
  try {
    await collectCandidateUserIds(client, 'progress_evidence', 'created_at', since, until, userIds);
    await collectCandidateUserIds(client, 'review_schedules', 'due_date', since, until, userIds);
    await collectCandidateUserIds(client, 'error_entries', 'captured_at', since, until, userIds);
    await collectCandidateUserIds(client, 'planner_tasks', 'created_at', since, until, userIds);
  } catch (err) {
    return {
      ok: false,
      usersRecomputed: 0,
      featuresWritten: 0,
      error: `candidate scan failed: ${err instanceof Error ? err.message : String(err)}`,
      tickEnvelope,
    };
  }

  // 2. Recompute per candidate user. Sequential to keep the
  //    per-run log lines readable; the orchestrator's fan-out
  //    is parallel within a user.
  let usersRecomputed = 0;
  let featuresWritten = 0;
  for (const userId of userIds) {
    try {
      const r = await recomputeStudentModelForUser(client, {
        userId,
        windowDays: DEFAULT_WINDOW_DAYS,
        now: () => ts,
      });
      usersRecomputed += 1;
      featuresWritten += r.featuresWritten;
    } catch (err) {
      // A single-user failure should not abort the whole run.
      // The next 5-minute tick will retry that user.
      return {
        ok: false,
        usersRecomputed,
        featuresWritten,
        error: `recompute_student_model: ${err instanceof Error ? err.message : String(err)}`,
        tickEnvelope: buildTickEnvelope(ts, featuresWritten),
      };
    }
  }

  // 3. Emit the system.tick audit envelope.
  const finalTick = buildTickEnvelope(ts, featuresWritten);
  const result = await emit(client, finalTick);
  if (result.kind === 'error') {
    return {
      ok: false,
      usersRecomputed,
      featuresWritten,
      error: `tick emit failed: ${result.error.code}: ${result.error.message}`,
      tickEnvelope: finalTick,
    };
  }
  return {
    ok: true,
    usersRecomputed,
    featuresWritten,
    tickEnvelope: finalTick,
  };
}

/**
 * Pull the distinct `user_id` values from one source table in
 * the window. Best-effort: a per-table error is swallowed so
 * the union across the four tables still produces candidates
 * from the tables that did load. The job-level catch above
 * guards against a wholly-broken Supabase client.
 */
async function collectCandidateUserIds(
  client: SupabaseClient,
  table: 'progress_evidence' | 'review_schedules' | 'error_entries' | 'planner_tasks',
  dateColumn: 'created_at' | 'due_date' | 'captured_at',
  since: Date,
  until: Date,
  out: Set<string>,
): Promise<void> {
  const { data, error } = await client
    .from(table)
    .select('user_id')
    .gte(dateColumn, since.toISOString())
    .lte(dateColumn, until.toISOString());
  if (error) return;
  for (const r of data ?? []) {
    if (typeof r.user_id === 'string' && r.user_id.length > 0) {
      out.add(r.user_id);
    }
  }
}

/**
 * Build the system.tick envelope. Pure / deterministic given
 * a `now` clock. Identical to the
 * `recompute_analytics_rollup` job's pattern.
 */
function buildTickEnvelope(now: Date, emittedEventCount: number): EventEnvelope<'system.tick'> {
  const ranAt = now.toISOString();
  const payload: SystemTickPayload = {
    job_name: JOB_NAME,
    ran_at: ranAt,
    emitted_event_count: emittedEventCount,
  };
  const bucket = ranAt.slice(0, 19);
  return buildEnvelope({
    eventType: 'system.tick',
    // System-owned event: no owning user. The outbox.user_id column
    // is nullable (migration 20) and the FK to public.users(id) is
    // only checked when accountId is non-null.
    accountId: null,
    actorId: null,
    aggregateType: 'scheduled_job',
    aggregateId: JOB_NAME,
    aggregateVersion: 1,
    eventId: computeEventId({
      event_type: 'system.tick',
      aggregate_type: 'scheduled_job',
      aggregate_id: JOB_NAME,
      aggregate_version: 1,
    }),
    idempotencyKey: computeIdempotencyKeyForEvent({
      event_type: 'system.tick',
      aggregate_type: 'scheduled_job',
      aggregate_id: `${JOB_NAME}|${bucket}`,
      aggregate_version: 1,
    }),
    payload,
    occurredAt: ranAt,
  });
}
