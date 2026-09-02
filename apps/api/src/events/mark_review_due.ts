/**
 * KRODEX — mark_review_due scheduled job.
 *
 * Per PHASE3_PLAN.md §6.3 #4, this is one of the two scheduled-only
 * jobs in Phase 3. The worker fan-out is *not* involved: the runner
 * in scheduled-jobs.ts calls this function on a timer. The function:
 *
 *   1. Calls the SECURITY DEFINER Postgres function
 *      `public.mark_due_reviews()` (added in migration 11). That
 *      function transitions `review_schedules.state` from
 *      'scheduled' to 'due' for every row whose `due_at <= now()`,
 *      and atomically inserts a matching `review.started` row into
 *      `event_outbox`. The function is idempotent: a second call
 *      inside the same state window finds no rows to transition.
 *
 *   2. Emits a `system.tick` audit event into `event_outbox` so
 *      the existing event_log table records the run. The aggregate
 *      is the job itself (`aggregate_type='scheduled_job'`,
 *      `aggregate_id='mark_review_due'`) and the idempotency key
 *      uses the worker formula sha256(job_name|ran_at_bucket)
 *      where the bucket is a coarse-grained window (the run's
 *      tick). Two ticks inside the same bucket collapse to one
 *      event, which is the right semantics for an audit log.
 *
 * The function returns a JobRunResult so the runner can report
 * what happened without throwing — a transient SQL failure
 * surfaces as `{ ok: false, error }` and the runner logs it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeEventId,
  computeIdempotencyKeyForEvent,
  type EventEnvelope,
  type SystemTickPayload,
} from '@krodex/shared';

import { buildEnvelope, emit } from './outbox-writer';

export const JOB_NAME = 'mark_review_due';

/** What the SQL function returns. */
interface MarkDueReviewRow {
  schedule_id: string;
  event_id: string;
}

/** What the function returns to the runner. */
export interface MarkReviewDueResult {
  ok: boolean;
  transitionedCount: number;
  /** Error message when ok is false. */
  error?: string;
  /** The `system.tick` envelope we wrote (or tried to write). */
  tickEnvelope: EventEnvelope<'system.tick'>;
}

/**
 * Run the job once. Returns a structured result. Does not throw.
 *
 * @param client  Supabase client (service-role) bound to no transaction.
 * @param now     Caller-supplied clock; defaults to `new Date()`. Tests
 *                pin this to make eventId / idempotencyKey deterministic.
 */
export async function runMarkReviewDue(
  client: SupabaseClient,
  now: () => Date = () => new Date(),
): Promise<MarkReviewDueResult> {
  const ts = now();

  // 1. Call the SQL function. The function is SECURITY DEFINER and
  //    uses FOR UPDATE SKIP LOCKED, so multiple in-process workers
  //    can call it concurrently without double-transitioning.
  const { data, error } = await client.rpc('mark_due_reviews', {});
  if (error) {
    // We still need a tick envelope to return so the runner can log
    // it; the runner will not write it on the failure path.
    const tickEnvelope = buildTickEnvelope(ts, 0);
    return {
      ok: false,
      transitionedCount: 0,
      error: `${error.code ?? 'unknown'}: ${error.message}`,
      tickEnvelope,
    };
  }
  const rows = (data ?? []) as MarkDueReviewRow[];

  // 2. Emit the system.tick audit event. Use the job's stable name
  //    as the aggregate so each tick is addressable in the log
  //    without colliding across jobs.
  const tickEnvelope = buildTickEnvelope(ts, rows.length);
  const result = await emit(client, tickEnvelope);
  if (result.kind === 'error') {
    return {
      ok: false,
      transitionedCount: rows.length,
      error: `tick emit failed: ${result.error.code}: ${result.error.message}`,
      tickEnvelope,
    };
  }
  return {
    ok: true,
    transitionedCount: rows.length,
    tickEnvelope,
  };
}

/**
 * Build the system.tick envelope. Pure / deterministic given a
 * `now` clock. Idempotency is at the per-tick granularity: a
 * caller-supplied bucket (here, the millisecond-rounded ISO) means
 * the same `now` always produces the same idempotency key, so
 * replays inside the same instant collapse. Different ticks
 * (different `now` calls) get different keys.
 */
function buildTickEnvelope(now: Date, emittedEventCount: number): EventEnvelope<'system.tick'> {
  const ranAt = now.toISOString();
  const payload: SystemTickPayload = {
    job_name: JOB_NAME,
    ran_at: ranAt,
    emitted_event_count: emittedEventCount,
  };
  // Use the ran_at truncated to the second as a coarse bucket so
  // truly-replayed ticks inside the same second dedup. Real
  // scheduler ticks are minutes apart, so the bucket is large
  // enough to be unique per real run.
  const bucket = ranAt.slice(0, 19); // YYYY-MM-DDTHH:MM:SS
  return buildEnvelope({
    eventType: 'system.tick',
    accountId: '00000000-0000-0000-0000-000000000000', // synthetic; outbox.user_id is NOT NULL
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
