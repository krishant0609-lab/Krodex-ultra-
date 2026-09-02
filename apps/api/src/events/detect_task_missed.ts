/**
 * KRODEX — detect_task_missed scheduled job.
 *
 * Per PHASE3_PLAN.md §6.3 #5, this is the second scheduled-only
 * job in Phase 3. The worker fan-out is *not* involved: the
 * runner in scheduled-jobs.ts calls this function on a timer.
 *
 *   1. Calls the SECURITY DEFINER Postgres function
 *      `public.detect_missed_tasks()` (added in migration 11).
 *      For every `planner_tasks` row whose `state='planned'` and
 *      whose `plan_date` falls inside the 7-day lookback
 *      (today-7d <= plan_date < today UTC), that function:
 *        - transitions state to 'missed'
 *        - creates a matching `backlog_items` row (reason='missed',
 *          state='open')
 *        - atomically inserts a `task.missed` row into
 *          `event_outbox`.
 *      The function is idempotent: subsequent calls inside the
 *      same window find no rows in state='planned'.
 *
 *   2. Emits a `system.tick` audit event into `event_outbox` so
 *      the existing event_log table records the run, with the
 *      same shape as `mark_review_due` (per §6.4: each scheduled
 *      job is its own handler with a stable handler name and a
 *      synthetic `system.tick` envelope).
 *
 * The function returns a JobRunResult so the runner can report
 * what happened without throwing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeEventId,
  computeIdempotencyKeyForEvent,
  type EventEnvelope,
  type SystemTickPayload,
} from '@krodex/shared';

import { buildEnvelope, emit } from './outbox-writer';

export const JOB_NAME = 'detect_task_missed';

/** What the SQL function returns. */
interface DetectMissedTaskRow {
  task_id: string;
  backlog_item_id: string;
  event_id: string;
}

/** What the function returns to the runner. */
export interface DetectTaskMissedResult {
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
export async function runDetectTaskMissed(
  client: SupabaseClient,
  now: () => Date = () => new Date(),
): Promise<DetectTaskMissedResult> {
  const ts = now();

  // 1. Call the SQL function. SECURITY DEFINER + FOR UPDATE SKIP
  //    LOCKED make concurrent in-process workers safe.
  const { data, error } = await client.rpc('detect_missed_tasks', {});
  if (error) {
    const tickEnvelope = buildTickEnvelope(ts, 0);
    return {
      ok: false,
      transitionedCount: 0,
      error: `${error.code ?? 'unknown'}: ${error.message}`,
      tickEnvelope,
    };
  }
  const rows = (data ?? []) as DetectMissedTaskRow[];

  // 2. Emit the system.tick audit event. The aggregate id is
  //    `<JOB_NAME>|<bucket>` where bucket is the run's second-
  //    truncated ISO, so two ticks inside the same second collapse
  //    and a re-run after a minute produces a fresh key.
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

function buildTickEnvelope(now: Date, emittedEventCount: number): EventEnvelope<'system.tick'> {
  const ranAt = now.toISOString();
  const payload: SystemTickPayload = {
    job_name: JOB_NAME,
    ran_at: ranAt,
    emitted_event_count: emittedEventCount,
  };
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
