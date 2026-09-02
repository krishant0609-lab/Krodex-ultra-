/**
 * KRODEX — recompute_analytics_rollup scheduled job.
 *
 * Per PHASE4_PLAN.md §13.1 (Decision Point D-9), this is the
 * wall-clock-driven analytics recompute. It is registered with
 * the scheduler in `scheduled-jobs.ts` and runs on a 5-minute
 * cadence.
 *
 * The 5-minute cadence is **Class C — Approved Product Policy**,
 * NOT a value documented by the PRD, TRD, or Implementation
 * Plan. The value was approved by the user as a Phase 4 product
 * decision (D-9).
 *
 * What the job does:
 *   1. Computes a 5-minute trailing window (`now − 5m .. now`).
 *   2. Lists every distinct `user_id` that has any
 *      `progress_evidence` row in that window (the candidates
 *      for recompute).
 *   3. For each candidate, calls the SECURITY DEFINER Postgres
 *      function `recompute_analytics_rollup(p_user_id,
 *      p_since, p_until)` from migration 12. The function is
 *      idempotent: re-running it inside the same window produces
 *      the same state with the same row count.
 *   4. Emits a single `system.tick` audit envelope for the
 *      run, with `job_name='recompute_analytics_rollup'` and
 *      `emitted_event_count = sum of rows recomputed`.
 *
 * What the job does NOT do:
 *   - It does NOT enumerate every user in the system. The
 *     candidates are scoped to the 5-minute window; idle users
 *     are skipped.
 *   - It does NOT itself write to `analytics_daily_rollup` /
 *     `analytics_weekly_rollup`; that is the SQL function's
 *     job.
 *   - It does NOT do per-user or per-tenant authorization; it
 *     uses the service-role client and is intended to be safe
 *     to run on a worker with full DB privileges.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeEventId,
  computeIdempotencyKeyForEvent,
  type EventEnvelope,
  type SystemTickPayload,
} from '@krodex/shared';

import { buildEnvelope, emit } from './outbox-writer';
import { recomputeRollupForUser, fiveMinuteRecomputeWindow } from '../analytics/rollup';

export const JOB_NAME = 'recompute_analytics_rollup';

/** What the function returns to the runner. */
export interface RecomputeAnalyticsRollupResult {
  ok: boolean;
  /** Number of users whose rollups were recomputed. */
  usersRecomputed: number;
  /** Sum of (user, dimension, day) rows updated across all users. */
  rowsRecomputed: number;
  /** Error message when ok is false. */
  error?: string;
  /** The `system.tick` envelope we wrote (or tried to write). */
  tickEnvelope: EventEnvelope<'system.tick'>;
}

/**
 * Run the job once. Returns a structured result. Does not throw.
 */
export async function runRecomputeAnalyticsRollup(
  client: SupabaseClient,
  now: () => Date = () => new Date(),
): Promise<RecomputeAnalyticsRollupResult> {
  const ts = now();
  const { since, until } = fiveMinuteRecomputeWindow(ts);

  // Always need a tick envelope (success or failure) to return to
  // the runner. The aggregate_id and idempotency key are pinned
  // by the job name + bucket.
  const tickEnvelope = buildTickEnvelope(ts, 0);

  // 1. List the candidate users: any user with at least one
  //    progress_evidence row in the window.
  const { data: candidateRows, error: candidatesErr } = await client
    .from('progress_evidence')
    .select('user_id')
    .gte('created_at', since.toISOString())
    .lte('created_at', until.toISOString());

  if (candidatesErr) {
    return {
      ok: false,
      usersRecomputed: 0,
      rowsRecomputed: 0,
      error: `candidate scan failed: ${candidatesErr.code ?? 'unknown'}: ${candidatesErr.message}`,
      tickEnvelope,
    };
  }

  const userIds = new Set<string>();
  for (const r of candidateRows ?? []) {
    if (typeof r.user_id === 'string' && r.user_id.length > 0) {
      userIds.add(r.user_id);
    }
  }

  // 2. Recompute per candidate user. Sequential to keep the
  //    per-run log lines readable; the SQL function is the
  //    workhorse, and there's no observable cross-user race.
  let usersRecomputed = 0;
  let rowsRecomputed = 0;
  for (const userId of userIds) {
    try {
      const r = await recomputeRollupForUser(client, { userId, since, until });
      usersRecomputed += 1;
      rowsRecomputed += r.rowsRecomputed;
    } catch (err) {
      // A single-user failure should not abort the whole run.
      // The next 5-minute tick will retry that user.
      return {
        ok: false,
        usersRecomputed,
        rowsRecomputed,
        error: `recompute_analytics_rollup: ${err instanceof Error ? err.message : String(err)}`,
        tickEnvelope: buildTickEnvelope(ts, rowsRecomputed),
      };
    }
  }

  // 3. Emit the system.tick audit envelope.
  const finalTick = buildTickEnvelope(ts, rowsRecomputed);
  const result = await emit(client, finalTick);
  if (result.kind === 'error') {
    return {
      ok: false,
      usersRecomputed,
      rowsRecomputed,
      error: `tick emit failed: ${result.error.code}: ${result.error.message}`,
      tickEnvelope: finalTick,
    };
  }
  return {
    ok: true,
    usersRecomputed,
    rowsRecomputed,
    tickEnvelope: finalTick,
  };
}

/**
 * Build the system.tick envelope. Pure / deterministic given a
 * `now` clock. Identical to the `mark_review_due` job's pattern
 * (see apps/api/src/events/mark_review_due.ts).
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
    accountId: '00000000-0000-0000-0000-000000000000', // synthetic
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
