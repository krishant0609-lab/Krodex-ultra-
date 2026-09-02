/**
 * KRODEX — emit_attempt_analyzed handler.
 *
 * Per PHASE3_PLAN.md §6.2, this handler runs on every
 * `attempt.submitted` event and derives a new `attempt.analyzed`
 * event whose payload carries the per-question outcomes.
 *
 * Why the derived event exists:
 *   - `attempt.submitted` is emitted inside submit_test_attempt
 *     and only carries aggregate-level counts. The per-question
 *     outcomes (the `test_answers` rows) live in a different
 *     table and are read in a separate SELECT.
 *   - Downstream analytics (per-question weakness detection,
 *     error_attribution, future review prioritization) wants the
 *     question-level view as a first-class event so they don't
 *     all have to re-query test_answers.
 *
 * Worker-emitted events use a different idempotency key formula
 * (sha256(source_event_id|handler_name)) so the same upstream
 * event can fan out to multiple derived handlers without
 * colliding on the dedup index. See shared/events/idempotency.ts.
 *
 * Idempotency of the handler itself:
 *   - The (event_id, handler_name) unique index on event_log
 *     makes handler delivery exactly-once.
 *   - The (user_id, event_type, idempotency_key) unique index on
 *     event_outbox dedups the derived event across handlers
 *     running in parallel.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeEventId,
  computeWorkerIdempotencyKey,
  type AttemptAnalyzedPayload,
  type EventEnvelope,
} from '@krodex/shared';

import { HandlerOutcome } from './handler-outcome';
import { buildEnvelope, emit } from './outbox-writer';

export const HANDLER_NAME = 'emit_attempt_analyzed';

interface TestAnswerRow {
  question_id: string;
  outcome: string | null;
}

export async function handle(
  client: SupabaseClient,
  envelope: EventEnvelope<'attempt.submitted'>,
): Promise<HandlerOutcome> {
  // 1. Read the per-question outcomes for this attempt.
  const { data, error } = await client
    .from('test_answers')
    .select('question_id, outcome')
    .eq('attempt_id', envelope.payload.attempt_id)
    .eq('user_id', envelope.accountId);
  if (error) {
    throw new Error(
      `emit_attempt_analyzed: read test_answers failed (${error.code}): ${error.message}`,
    );
  }
  const rows = (data ?? []) as TestAnswerRow[];

  // 2. Build the derived envelope.
  const derivedPayload: AttemptAnalyzedPayload = {
    attempt_id: envelope.payload.attempt_id,
    test_id: envelope.payload.test_id,
    answers: rows
      .filter((r) => r.outcome !== null)
      .map((r) => ({ question_id: r.question_id, outcome: r.outcome as string })),
  };

  // 3. eventId is derived from the attempt_id; idempotencyKey uses
  //    the worker formula so the same attempt submitted twice
  //    (e.g. retried after a transient failure) collapses.
  const eventId = computeEventId({
    event_type: 'attempt.analyzed',
    aggregate_type: 'attempt',
    aggregate_id: envelope.payload.attempt_id,
    aggregate_version: 1,
  });
  const idempotencyKey = computeWorkerIdempotencyKey(
    envelope.eventId,
    HANDLER_NAME,
  );
  const derived = buildEnvelope({
    eventType: 'attempt.analyzed',
    accountId: envelope.accountId,
    actorId: null,
    aggregateType: 'attempt',
    aggregateId: envelope.payload.attempt_id,
    aggregateVersion: 1,
    eventId,
    idempotencyKey,
    payload: derivedPayload,
  });

  const result = await emit(client, derived);
  if (result.kind === 'inserted' || result.kind === 'duplicate') {
    return { kind: 'succeeded', wrote: result.kind === 'inserted' ? 1 : 0 };
  }
  throw new Error(
    `emit_attempt_analyzed: emit failed (${result.error.code}): ${result.error.message}`,
  );
}
