/**
 * KRODEX — `project_student_model` handler.
 *
 * Per PHASE5_PLAN.md §5, this is the new Phase 5 fan-out handler
 * that projects domain events into the `student_model_snapshots`
 * and `student_model_features` tables. Where the Phase 4
 * `project_analytics_rollup` handler subscribes to the same
 * 12 event types and re-aggregates metrics, this handler
 * subscribes to the same set and re-runs the seven-feature
 * student model for the affected user.
 *
 * The handler subscribes to every event type the
 * `project_progress_evidence` handler does (per §13.1) so a
 * student activity always triggers a student-model projection
 * for the affected user. The actual computation is performed
 * by the orchestrator (`computeFeaturesForUser`) and the
 * SECURITY DEFINER SQL function `recompute_student_model`
 * (migration 13); this TS module is just the dispatcher.
 *
 * Idempotency on the handler side:
 *   The handler does not write to event_outbox itself and does
 *   not insert into a deduplicated table. The unique-row
 *   enforcement is entirely the SQL function's "delete prior,
 *   insert fresh" pattern on `(user_id)` for `student_model_
 *   snapshots` and on `(user_id, feature_key, computed_at)` for
 *   `student_model_features`. The worker records `wrote: 0`
 *   for the success case (this handler's "writes" are not
 *   first-class rows in event_outbox or in a unique-indexed
 *   source table; they are an idempotent projection).
 *
 * Handler contract:
 *   - Receives the service-role Supabase client and the full
 *     envelope.
 *   - Awaits the recompute call; throws on unexpected errors so
 *     the worker can mark the attempt as 'failed' and retry
 *     per the backoff schedule.
 *
 * Why 28 days (not 5 minutes like the analytics rollup):
 *   The student model is a long-window construct (PRD §25).
 *   The 5-minute cadence is a freshness check, not a window
 *   choice — the orchestrator always re-aggregates the most
 *   recent 28 days of evidence for the user, even when the
 *   trigger event is a single `error.recorded`. This is by
 *   design: the model is meant to summarize a sustained
 *   behavior pattern, not react to a single event.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventEnvelope, EventType } from '@krodex/shared';

import { HandlerOutcome } from './handler-outcome';
import {
  recomputeStudentModelForUser,
  DEFAULT_WINDOW_DAYS,
} from '../student-model/service';

export const HANDLER_NAME = 'project_student_model';

/**
 * The set of event types this handler is interested in. It
 * mirrors the `project_progress_evidence` subscription so a
 * student-model projection runs alongside every measurable
 * student activity. The recompute is idempotent (the SQL
 * function replaces the prior snapshot+features for the user
 * with a fresh one), so a duplicate event (e.g. an outbox
 * replay) is a no-op write-wise.
 */
const INTERESTED_EVENT_TYPES: ReadonlySet<EventType> = new Set([
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
 * Pure predicate: does this envelope type produce a student-model
 * projection? Exported for unit tests.
 */
export function isStudentModelTriggeringEvent(envelope: EventEnvelope): boolean {
  return INTERESTED_EVENT_TYPES.has(envelope.eventType as EventType);
}

/**
 * Plan the recompute for an envelope. Pure / deterministic.
 * Returns the userId + the window to recompute, or `null` for
 * event types the handler ignores.
 *
 * We always use the orchestrator's 28-day default window
 * (DEFAULT_WINDOW_DAYS), regardless of the trigger event. The
 * `system.tick` envelopes are skipped here — the scheduled
 * `recompute_student_model` job (separate) handles the
 * per-active-user recompute on a 5-minute wall-clock cadence
 * via the service-role path.
 */
export function planStudentModelForEvent(
  envelope: EventEnvelope,
): { userId: string; windowDays: number } | null {
  if (!isStudentModelTriggeringEvent(envelope)) return null;
  if (envelope.eventType === 'system.tick') return null;
  return { userId: envelope.accountId, windowDays: DEFAULT_WINDOW_DAYS };
}

/**
 * Execute the handler. Returns the outcome the worker should
 * record in event_log. Throws on unexpected errors.
 */
export async function handle(
  client: SupabaseClient,
  envelope: EventEnvelope,
): Promise<HandlerOutcome> {
  const plan = planStudentModelForEvent(envelope);
  if (!plan) {
    return { kind: 'succeeded', wrote: 0, skipped: 'not_a_student_model_triggering_event' };
  }
  const r = await recomputeStudentModelForUser(client, plan);
  return { kind: 'succeeded', wrote: r.featuresWritten, skipped: undefined };
}
