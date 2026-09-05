/**
 * KRODEX — project_progress_evidence handler.
 *
 * Per PHASE3_PLAN.md §6.2, this handler runs in the worker on every
 * event_outbox row whose event_type is recognized. It translates the
 * envelope into one or more progress_evidence inserts.
 *
 * Idempotency:
 *   The handler uses INSERT ... ON CONFLICT DO NOTHING keyed on the
 *   (user_id, dimension, ref_kind, ref_id) unique index added in
 *   migration 10. So:
 *     - events whose source mutation already produced evidence
 *       (e.g. attempt.submitted already writes 'test_accuracy' in
 *       the RPC) are harmless no-ops when the handler tries again
 *     - events with no source-side writer (e.g. error.resolved,
 *       task.completed) are the handler's primary contribution
 *
 * Handler contract:
 *   - Receives the service-role Supabase client and the full envelope
 *   - Awaits all writes; throws on unexpected errors so the worker
 *     can mark this attempt as 'failed' and retry per the backoff
 *     schedule
 *   - Does not emit any new outbox events
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  EventEnvelope,
  EventReviewOutcome,
  ProgressDimension,
} from '@krodex/shared';

import { HandlerOutcome } from './handler-outcome';

export const HANDLER_NAME = 'project_progress_evidence';

/** One row to insert into progress_evidence. */
interface EvidenceWrite {
  dimension: ProgressDimension;
  delta: string;
  ref_kind: string;
  ref_id: string;
  metadata: Record<string, unknown>;
}

/**
 * Translate an envelope into the list of evidence rows it should
 * produce. Pure function — no I/O. Exported so unit tests can pin
 * the mapping down.
 */
export function planEvidenceForEvent(envelope: EventEnvelope): readonly EvidenceWrite[] {
  // System-owned events (accountId === null) cannot produce per-user
  // evidence rows. Return early with an empty plan; the worker's
  // writes.length === 0 branch will record a no-op success.
  if (envelope.accountId === null) return [];
  const writes: EvidenceWrite[] = [];
  const t = envelope.eventType;
  const userId = envelope.accountId;

  // Per-case narrow: the wide EventEnvelope has payload typed as
  // EventPayloadMap[EventType] (the union of every payload). After
  // a `case 'X':` block, TypeScript would normally narrow via the
  // discriminant on eventType, but because the discriminant and the
  // payload key off the same property the inference does not
  // propagate. We cast through the specific EventEnvelope<'X'> for
  // each case so the per-field access typechecks.
  switch (t) {
    case 'attempt.submitted': {
      // The submit_test_attempt RPC already wrote the 'test_attempts'
      // and 'test_accuracy' evidence rows. Re-issuing them here is
      // a no-op via the unique index, but doing it explicitly keeps
      // the handler self-describing for future RPC refactors.
      const p = (envelope as EventEnvelope<'attempt.submitted'>).payload;
      writes.push({
        dimension: 'test_attempts',
        delta: '1',
        ref_kind: 'test_attempt',
        ref_id: p.attempt_id,
        metadata: { source_event_id: envelope.eventId },
      });
      writes.push({
        dimension: 'test_accuracy',
        delta: p.accuracy,
        ref_kind: 'test_attempt',
        ref_id: p.attempt_id,
        metadata: {
          correct: p.correct_count,
          incorrect: p.incorrect_count,
          partial: p.partial_count,
          skipped: p.skipped_count,
        },
      });
      break;
    }

    case 'error.recorded': {
      const p = (envelope as EventEnvelope<'error.recorded'>).payload;
      writes.push({
        dimension: 'errors_created',
        delta: '1',
        ref_kind: 'error_entry',
        ref_id: p.error_id,
        metadata: {
          source_attempt_id: p.source_attempt_id,
          recurrence_count: p.recurrence_count,
          user_id: userId,
        },
      });
      break;
    }

    case 'error.classified':
      // No evidence row. Classification changes the mistake_type
      // on the existing error_entry; it does not introduce a new
      // measurable event.
      break;

    case 'review.scheduled': {
      // The schedule_review_for_error RPC could not write evidence
      // because the schedule_id is only known after the INSERT. The
      // handler is the canonical place to record 'practice_volume'
      // / 'review_completed' deltas at the per-schedule level.
      // For now: no evidence on schedule; the review_completed
      // dimension is incremented at outcome_recorded time below.
      break;
    }

    case 'review.outcome_recorded': {
      const p = (envelope as EventEnvelope<'review.outcome_recorded'>).payload;
      writes.push({
        dimension: 'review_completed',
        delta: '1',
        ref_kind: 'review_schedule',
        ref_id: p.schedule_id,
        metadata: {
          error_id: p.error_id,
          outcome: p.outcome,
        },
      });
      break;
    }

    case 'error.resolved': {
      const p = (envelope as EventEnvelope<'error.resolved'>).payload;
      writes.push({
        dimension: 'errors_resolved',
        delta: '1',
        ref_kind: 'error_entry',
        ref_id: p.error_id,
        metadata: {
          trigger: p.trigger,
          review_schedule_id: p.review_schedule_id,
        },
      });
      break;
    }

    case 'error.reopened': {
      const p = (envelope as EventEnvelope<'error.reopened'>).payload;
      writes.push({
        dimension: 'errors_reopened',
        delta: '1',
        ref_kind: 'error_entry',
        ref_id: p.error_id,
        metadata: {
          source_attempt_id: p.source_attempt_id,
        },
      });
      break;
    }

    case 'task.completed': {
      const p = (envelope as EventEnvelope<'task.completed'>).payload;
      writes.push({
        dimension: 'planner_completion',
        delta: '1',
        ref_kind: 'planner_task',
        ref_id: p.task_id,
        metadata: {
          plan_date: p.plan_date,
          subject_id: p.subject_id,
        },
      });
      break;
    }

    case 'task.missed': {
      const p = (envelope as EventEnvelope<'task.missed'>).payload;
      writes.push({
        dimension: 'planner_completion',
        delta: '-1',
        ref_kind: 'planner_task',
        ref_id: p.task_id,
        metadata: {
          plan_date: p.plan_date,
          subject_id: p.subject_id,
          missed: true,
        },
      });
      break;
    }

    case 'syllabus.node_archived':
    case 'notification.created':
    case 'attempt.analyzed':
    case 'system.tick':
      // Not a measurable student-activity event.
      break;
  }

  // Ensure all user_ids in metadata match the envelope. The schema's
  // RLS-immutable user_id is enforced at the DB layer; the handler
  // cannot mutate it on a later row.
  for (const w of writes) {
    if (!w.metadata.user_id) w.metadata.user_id = userId;
  }
  return writes;
}

/**
 * Execute the handler. Returns the outcome the worker should record
 * in event_log. Throws only on truly unexpected errors (network,
 * PostgREST 5xx, etc.) — not on uniqueness conflicts.
 */
export async function handle(
  client: SupabaseClient,
  envelope: EventEnvelope,
): Promise<HandlerOutcome> {
  const writes = planEvidenceForEvent(envelope);
  if (writes.length === 0) {
    return { kind: 'succeeded', wrote: 0, skipped: 'no_evidence_for_event_type' };
  }

  let wrote = 0;
  for (const w of writes) {
    const { error } = await client.from('progress_evidence').insert({
      user_id: envelope.accountId,
      dimension: w.dimension,
      delta: w.delta,
      ref_kind: w.ref_kind,
      ref_id: w.ref_id,
      metadata: w.metadata,
    });
    if (error) {
      // Unique violation is the "already there" case; treat as ok.
      if (error.code === '23505') {
        continue;
      }
      throw new Error(
        `project_progress_evidence: insert failed (${error.code}): ${error.message}`,
      );
    }
    wrote += 1;
  }
  return { kind: 'succeeded', wrote };
}
