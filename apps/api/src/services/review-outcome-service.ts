/**
 * KRODEX API — ReviewOutcomeService (Phase 10, TRD §13).
 *
 * The dedicated outcome-recording service. It is the single entry
 * point for "the student answered the verification question" and
 * it orchestrates:
 *
 *   1. Validation: schedule is in_progress and not yet completed;
 *      schedule belongs to the same error the student is reviewing.
 *   2. Persist the immutable `review_attempts` row via the
 *      existing `review.recordReviewAttempt()` helper (which also
 *      emits `review.outcome_recorded`).
 *   3. Transition the `error_entries.status` via the Phase 9
 *      `ErrorLifecycleService` (which appends
 *      `error_lifecycle_events` and emits `error.lifecycle.*`).
 *   4. Schedule the next review via `ReviewSchedulingEngine.sm2()`
 *      using the pre-transition state counts; persist the new
 *      `review_schedules` row.
 *   5. Mark the current schedule `completed`.
 *   6. Emit `review.verification_question_used` so downstream
 *      consumers can tell which question was answered without
 *      joining review_attempts.
 *
 * Resolution policy (governing documents):
 *   - One qualifying correct review (outcome='correct') resolves
 *     the error, gated on the ReviewSchedulingEngine's confidence
 *     ≥ RESOLUTION_CONFIDENCE_THRESHOLD (the default policy
 *     threshold for the SM-2 default).
 *   - 'incorrect' returns the error to ACTIVE.
 *   - 'partial' returns the error to ACTIVE (and a new review is
 *     scheduled).
 *
 * State machine per the plan (§7):
 *   IN_REVIEW + correct + confident  → RESOLVED
 *   IN_REVIEW + correct + not yet    → IN_REVIEW (next review scheduled)
 *   IN_REVIEW + incorrect            → ACTIVE
 *   IN_REVIEW + partial              → ACTIVE
 *
 * Idempotency is handled at the route layer via `withIdempotency`
 * (apps/api/src/idempotency/helpers.ts). The service is pure with
 * respect to commandIds.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ErrorEntryStatus,
  ReviewAttemptOutcome,
  ReviewScheduleRow,
  ReviewStrategy,
} from '@krodex/shared';
import { InvalidStateError } from '../errors';
import { asRows } from './_row';
import { serviceEmit } from '../events/service-emitter';
import {
  sm2,
  type SchedulingDecision,
} from './review-scheduling-engine';
import {
  transitionStatus,
} from './error-lifecycle-service';
import * as review from './review';
import * as errorsService from './errors';

/**
 * Policy threshold gating resolution. Mirrors
 * ReviewSchedulingEngine's "stable" branch: the default SM-2 policy
 * returns confidence >= 0.85 for stable correct reviews, so 0.7
 * is comfortably below that and gates resolution only when the
 * scheduler is confident. Lower confidence correct reviews still
 * count but do not flip the error to RESOLVED.
 */
export const RESOLUTION_CONFIDENCE_THRESHOLD = 0.7;

export interface RecordReviewOutcomeInput {
  reviewId: string;
  /** The verification question the student actually answered. */
  questionId: string;
  outcome: ReviewAttemptOutcome;
  selectedOptionIds?: readonly string[];
  freeText?: string | null;
  durationMs?: number | null;
}

export interface ReviewOutcomeResult {
  outcomeId: string;
  /** The (from, to) ErrorEntryStatus transition that the outcome drove. */
  errorTransition: { fromStatus: ErrorEntryStatus; toStatus: ErrorEntryStatus };
  /** True if a new review_schedules row was created. */
  nextReviewScheduled: boolean;
  /** The next-review decision, if one was created. */
  nextReview: SchedulingDecision | null;
  /** The terminal attempt outcome (the one the student actually got). */
  terminalOutcome: ReviewAttemptOutcome;
}

/**
 * Record the outcome of an in-progress review. Throws:
 *   - `NotFoundError` (from the review service) if the schedule
 *     is missing.
 *   - `InvalidStateError` if the schedule is not in_progress.
 *   - Underlying `Error` for any database failure.
 *
 * Idempotency: this function is NOT idempotent on its own. The
 * route handler should wrap the call in `withIdempotency` so a
 * duplicate POST with the same `Idempotency-Key` returns the
 * prior response.
 */
export async function recordReviewOutcome(
  client: SupabaseClient,
  userId: string,
  input: RecordReviewOutcomeInput,
): Promise<ReviewOutcomeResult> {
  // 1. Load + validate the schedule and its error.
  const schedule = await review.getReviewSchedule(client, userId, input.reviewId);
  if (schedule.state !== 'in_progress') {
    throw new InvalidStateError(
      `cannot record outcome: review is ${schedule.state}, not in_progress`,
      { context: { reviewId: input.reviewId, state: schedule.state } },
    );
  }
  const errorEntry = await errorsService.getErrorEntry(client, userId, schedule.error_id);

  // 2. Persist the immutable attempt. The underlying helper
  //    emits `review.outcome_recorded` (Phase 3 §4.2).
  const attempt = await review.recordReviewAttempt(client, userId, {
    schedule_id: input.reviewId,
    question_id: input.questionId,
    outcome: input.outcome,
    ...(input.selectedOptionIds ? { selected_option_ids: input.selectedOptionIds } : {}),
    free_text: input.freeText ?? null,
    duration_ms: input.durationMs ?? null,
  });

  // 3. Transition the error's lifecycle state. The Phase 9
  //    service validates the edge and appends history. It also
  //    emits the typed `error.lifecycle.*` event.
  const transition = await transitionForOutcome(
    client,
    userId,
    errorEntry,
    input.outcome,
    input.reviewId,
  );

  // 4. Schedule the next review, unless the error just resolved
  //    or was archived.
  let nextReviewScheduled = false;
  let nextReview: SchedulingDecision | null = null;
  if (transition.toStatus !== 'resolved' && transition.toStatus !== 'archived') {
    const scheduled = await scheduleNextReview(
      client,
      userId,
      errorEntry,
      input.outcome,
    );
    if (scheduled) {
      nextReview = scheduled.decision;
      nextReviewScheduled = true;
    }
  }

  // 5. Mark the schedule completed.
  await review.updateReviewSchedule(client, userId, input.reviewId, {
    state: 'completed',
    outcome: input.outcome,
  });

  // 6. Emit the dedicated `review.verification_question_used`
  //    event. This is a thin convenience event so consumers
  //    (analytics, notifications) can find the question id
  //    without joining review_attempts.
  const emitResult = await serviceEmit({
    client,
    userId,
    actorId: userId,
    eventType: 'review.verification_question_used',
    aggregateType: 'review_schedule',
    aggregateId: input.reviewId,
    aggregateVersion: 1,
    payload: {
      schedule_id: input.reviewId,
      error_id: schedule.error_id,
      question_id: input.questionId,
    },
  });
  if (emitResult.kind === 'error') {
    console.warn(
      `[krodex] review.verification_question_used emit failed: ${emitResult.error.message}`,
    );
  }

  return {
    outcomeId: attempt.id,
    errorTransition: transition,
    nextReviewScheduled,
    nextReview,
    terminalOutcome: input.outcome,
  };
}

// ---------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------

/**
 * Map an attempt outcome to the next ErrorEntry status. Returns
 * `{ fromStatus, toStatus }` describing the transition the
 * outcome drove.
 */
async function transitionForOutcome(
  client: SupabaseClient,
  userId: string,
  errorEntry: { id: string; status: ErrorEntryStatus },
  outcome: ReviewAttemptOutcome,
  reviewId: string,
): Promise<{ fromStatus: ErrorEntryStatus; toStatus: ErrorEntryStatus }> {
  const fromStatus = errorEntry.status;

  if (outcome === 'correct') {
    // Resolution is gated on confidence. Compute the decision
    // first; if confidence >= threshold, flip to RESOLVED,
    // otherwise stay in IN_REVIEW (the schedule is still being
    // iterated).
    const { reviewCount, priorSuccesses, priorFailures } = await countOutcomesForError(
      client,
      userId,
      errorEntry.id,
    );
    const decision = sm2(
      {
        errorState: fromStatus,
        lastReviewOutcome: 'correct',
        reviewCount,
        priorSuccesses,
        priorFailures,
        recurrenceEvidence: false,
      },
      new Date(),
    );
    if (decision.confidence >= RESOLUTION_CONFIDENCE_THRESHOLD) {
      await transitionStatus(
        client,
        userId,
        errorEntry.id,
        {
          to_status: 'resolved',
          trigger: 'student_review',
          reason: 'qualifying correct review',
          review_id: reviewId,
        },
        userId,
      );
      return { fromStatus, toStatus: 'resolved' };
    }
    // Confident enough to record, not confident enough to resolve.
    // Stay IN_REVIEW (no transition; the schedule will surface
    // another review). We do not call transitionStatus for a
    // same-state no-op (it returns a synthetic event) — the
    // schedule is already IN_REVIEW.
    return { fromStatus, toStatus: fromStatus };
  }
  if (outcome === 'incorrect') {
    await transitionStatus(
      client,
      userId,
      errorEntry.id,
      {
        to_status: 'active',
        trigger: 'student_review',
        reason: 'incorrect review outcome',
        review_id: reviewId,
      },
      userId,
    );
    return { fromStatus, toStatus: 'active' };
  }
  // partial → ACTIVE (work continues).
  await transitionStatus(
    client,
    userId,
    errorEntry.id,
    {
      to_status: 'active',
      trigger: 'student_review',
      reason: 'partial review outcome',
      review_id: reviewId,
    },
    userId,
  );
  return { fromStatus, toStatus: 'active' };
}

/**
 * Run SM-2 and create a new `review_schedules` row for the next
 * review. Returns the decision so the caller can surface the
 * reason text in the response.
 */
async function scheduleNextReview(
  client: SupabaseClient,
  userId: string,
  errorEntry: { id: string; status: ErrorEntryStatus },
  outcome: ReviewAttemptOutcome,
): Promise<{ decision: SchedulingDecision; schedule: ReviewScheduleRow } | null> {
  const { reviewCount, priorSuccesses, priorFailures } = await countOutcomesForError(
    client,
    userId,
    errorEntry.id,
  );
  const decision = sm2(
    {
      errorState: errorEntry.status,
      lastReviewOutcome: outcome,
      reviewCount,
      priorSuccesses,
      priorFailures,
      recurrenceEvidence: false,
    },
    new Date(),
  );
  if (decision.reasonCode === 'archive_terminal') {
    return null; // Don't schedule a review for an archived error.
  }
  const strategy: ReviewStrategy = pickStrategyForOutcome(outcome);
  const schedule = await review.scheduleReview(client, userId, {
    error_id: errorEntry.id,
    strategy,
    due_at: decision.dueAt,
    metadata: {
      previousOutcome: outcome,
      reasonCode: decision.reasonCode,
      reasonText: decision.reasonText,
      confidence: decision.confidence,
      requiresConfirmation: decision.requiresConfirmation,
    },
  });
  return { decision, schedule };
}

/** Choose a review strategy from the outcome. */
function pickStrategyForOutcome(outcome: ReviewAttemptOutcome): ReviewStrategy {
  if (outcome === 'incorrect') return 'focused';
  if (outcome === 'partial') return 'spaced';
  return 'standard';
}

/**
 * Count review outcomes for an error entry. Used as inputs to the
 * SM-2 engine.
 *
 * The two-step approach (schedules by error → attempts by schedule
 * ids) keeps the query simple and the fake-supabase test fixture
 * compatible. The plans forbid a schema change here, so the join
 * cannot be promoted to a view; doing it client-side costs at most
 * one extra round-trip per outcome and keeps the service easy to
 * reason about.
 */
async function countOutcomesForError(
  client: SupabaseClient,
  userId: string,
  errorId: string,
): Promise<{ reviewCount: number; priorSuccesses: number; priorFailures: number }> {
  const { data: schedules, error: schedErr } = await client
    .from('review_schedules')
    .select('id')
    .eq('user_id', userId)
    .eq('error_id', errorId);
  if (schedErr) {
    console.warn(`[krodex] countOutcomesForError schedules failed: ${schedErr.message}`);
    return { reviewCount: 0, priorSuccesses: 0, priorFailures: 0 };
  }
  const scheduleRows = asRows<{ id: string }>(schedules ?? []);
  if (scheduleRows.length === 0) {
    return { reviewCount: 0, priorSuccesses: 0, priorFailures: 0 };
  }
  const scheduleIds = scheduleRows.map((r) => String(r.id));
  const { data: attempts, error: attErr } = await client
    .from('review_attempts')
    .select('id, outcome')
    .in('schedule_id', scheduleIds);
  if (attErr) {
    console.warn(`[krodex] countOutcomesForError attempts failed: ${attErr.message}`);
    return { reviewCount: 0, priorSuccesses: 0, priorFailures: 0 };
  }
  const rows = asRows<{ outcome: string }>(attempts ?? []);
  const reviewCount = rows.length;
  const priorSuccesses = rows.filter((r) => r.outcome === 'correct').length;
  const priorFailures = rows.filter((r) => r.outcome === 'incorrect').length;
  return { reviewCount, priorSuccesses, priorFailures };
}
