/**
 * KRODEX — project_analytics_rollup handler.
 *
 * Per PHASE4_PLAN.md §13.1, this is the new handler that runs
 * inside the outbox worker fan-out. Where the Phase 3
 * `project_progress_evidence` handler turns domain events into
 * `progress_evidence` rows, this handler turns the same domain
 * events into fresh `analytics_daily_rollup` /
 * `analytics_weekly_rollup` rows for the affected user.
 *
 * The handler subscribes to every event type the
 * `project_progress_evidence` handler does (per §13.1) so a
 * student activity always triggers a rollup projection for the
 * affected user. The actual aggregation is performed by the
 * SECURITY DEFINER SQL function
 * `recompute_analytics_rollup(p_user_id, p_since, p_until)`;
 * this TS module is just the dispatcher.
 *
 * The function is idempotent — re-running it inside the same
 * window produces the same state. The window is the trailing
 * 5 minutes (D-9, Class C — Approved Product Policy); the
 * scheduled `recompute_analytics_rollup` job runs the same
 * SQL on a 5-minute wall-clock cadence, so this handler is
 * effectively the "low-latency" path that keeps the rollup
 * table fresh inside the worker loop too.
 *
 * Idempotency on the handler side:
 *   The handler does not write to event_outbox itself and does
 *   not insert into a deduplicated table. The unique-row
 *   enforcement is entirely the SQL function's
 *   `ON CONFLICT (user_id, dimension, rollup_date) DO UPDATE`
 *   clause. The worker records `wrote: 0` for the success case
 *   (this handler's "writes" are not first-class rows in
 *   event_outbox or in a unique-indexed source table; they are
 *   an idempotent projection).
 *
 * Handler contract:
 *   - Receives the service-role Supabase client and the full
 *     envelope.
 *   - Awaits the SQL call; throws on unexpected errors so the
 *     worker can mark the attempt as 'failed' and retry per
 *     the backoff schedule.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventEnvelope } from '@krodex/shared';

import { HandlerOutcome } from './handler-outcome';
import { recomputeRollupForUser, fiveMinuteRecomputeWindow } from '../analytics/rollup';

export const HANDLER_NAME = 'project_analytics_rollup';

/**
 * The set of event types this handler is interested in. It
 * mirrors the `project_progress_evidence` subscription so that
 * a rollup projection runs alongside every measurable student
 * activity. Per §13.1, the SQL function is idempotent so a
 * duplicate event (e.g. an outbox replay) is a no-op.
 */
const INTERESTED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'attempt.submitted',
  'attempt.analyzed',
  'error.recorded',
  'error.classified',
  'error.resolved',
  'error.reopened',
  'review.scheduled',
  'review.outcome_recorded',
  'task.completed',
  'task.missed',
  'syllabus.node_archived',
  'notification.created',
  'system.tick',
]);

/**
 * Pure predicate: does this envelope type produce a rollup
 * projection? Exported for unit tests.
 */
export function isRollupTriggeringEvent(envelope: EventEnvelope): boolean {
  return INTERESTED_EVENT_TYPES.has(envelope.eventType);
}

/**
 * Plan the rollup call for an envelope. Pure / deterministic.
 * Returns the userId + the window to recompute, or `null` for
 * event types the handler ignores.
 */
export function planRollupForEvent(
  envelope: EventEnvelope,
  now: Date = new Date(),
): { userId: string; since: Date; until: Date } | null {
  if (!isRollupTriggeringEvent(envelope)) return null;
  // The synthetic `system.tick` envelopes emitted by the
  // scheduler have accountId=0; skip those — the scheduler
  // job already invokes the SQL function directly for every
  // active user.
  if (envelope.eventType === 'system.tick') return null;
  const window = fiveMinuteRecomputeWindow(now);
  return { userId: envelope.accountId, ...window };
}

/**
 * Execute the handler. Returns the outcome the worker should
 * record in event_log. Throws on unexpected errors.
 */
export async function handle(
  client: SupabaseClient,
  envelope: EventEnvelope,
): Promise<HandlerOutcome> {
  const plan = planRollupForEvent(envelope);
  if (!plan) {
    return { kind: 'succeeded', wrote: 0, skipped: 'not_a_rollup_triggering_event' };
  }
  const r = await recomputeRollupForUser(client, plan);
  return { kind: 'succeeded', wrote: r.rowsRecomputed, skipped: undefined };
}
