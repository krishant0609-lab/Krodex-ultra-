/**
 * KRODEX API — review service.
 *
 * Phase 2 surface: schedule a review, list due reviews, complete
 * a review (state transition + outcome), record an attempt
 * against a schedule.
 *
 * The schedule is created with state='scheduled' and due_at in
 * the future. The API auto-transitions to 'due' on read when the
 * due_at has passed — keeps the client logic trivial.
 *
 * Phase 3: emits `review.started` (state→in_progress) and
 * `review.outcome_recorded` (recordReviewAttempt) per
 * PHASE3_PLAN §4.2. Emissions are post-commit on the caller's
 * client; failures are logged and do not roll back the
 * user-facing mutation.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ReviewAttemptRow,
  ReviewOutcome,
  ReviewScheduleRow,
  ReviewState,
  ReviewStrategy,
} from '@krodex/shared';
import { InvalidStateError, NotFoundError } from '../errors';
import { assertOwned } from '../auth/ownership';
import { asRow, asRows } from './_row';
import { serviceEmit } from '../events/service-emitter';

export interface ScheduleReviewInput {
  error_id: string;
  strategy: ReviewStrategy;
  due_at: string;
  metadata?: Record<string, unknown>;
}

export async function scheduleReview(
  client: SupabaseClient,
  userId: string,
  input: ScheduleReviewInput,
): Promise<ReviewScheduleRow> {
  const { data, error } = await client
    .from('review_schedules')
    .insert({
      user_id: userId,
      error_id: input.error_id,
      state: 'scheduled',
      strategy: input.strategy,
      due_at: input.due_at,
      scheduled_at: new Date().toISOString(),
      completed_at: null,
      outcome: null,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`scheduleReview failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId);
  return asRow<ReviewScheduleRow>(data);
}

export async function getReviewSchedule(
  client: SupabaseClient,
  userId: string,
  scheduleId: string,
): Promise<ReviewScheduleRow> {
  const { data, error } = await client
    .from('review_schedules')
    .select('*')
    .eq('id', scheduleId)
    .maybeSingle();
  if (error) throw new Error(`getReviewSchedule failed: ${error.message}`);
  if (!data) throw new NotFoundError('review schedule not found');
  assertOwned(data, userId);
  return maybeMarkDue(asRow<ReviewScheduleRow>(data));
}

function maybeMarkDue(row: ReviewScheduleRow): ReviewScheduleRow {
  if (row.state === 'scheduled' && new Date(row.due_at).getTime() <= Date.now()) {
    return { ...row, state: 'due' };
  }
  return row;
}

export async function listReviewSchedules(
  client: SupabaseClient,
  userId: string,
  filter: { state?: ReviewState; due_before?: string; limit?: number } = {},
): Promise<readonly ReviewScheduleRow[]> {
  let q = client
    .from('review_schedules')
    .select('*')
    .eq('user_id', userId)
    .order('due_at', { ascending: true })
    .limit(Math.min(filter.limit ?? 25, 100));
  if (filter.state) q = q.eq('state', filter.state);
  if (filter.due_before) q = q.lte('due_at', filter.due_before);
  const { data, error } = await q;
  if (error) throw new Error(`listReviewSchedules failed: ${error.message}`);
  return asRows<ReviewScheduleRow>(data ?? []).map(maybeMarkDue);
}

export interface UpdateReviewScheduleInput {
  state?: ReviewState;
  due_at?: string;
  outcome?: ReviewOutcome | null;
  strategy?: ReviewStrategy;
  metadata?: Record<string, unknown>;
}

export async function updateReviewSchedule(
  client: SupabaseClient,
  userId: string,
  scheduleId: string,
  patch: UpdateReviewScheduleInput,
): Promise<ReviewScheduleRow> {
  const before = await getReviewSchedule(client, userId, scheduleId);
  // Terminal states cannot be reopened via the API.
  if (before.state === 'completed' || before.state === 'skipped') {
    throw new InvalidStateError('review already terminal', {
      context: { state: before.state },
    });
  }
  const next: Record<string, unknown> = { ...patch };
  if (patch.state === 'completed') {
    next.completed_at = new Date().toISOString();
  }
  const { data, error } = await client
    .from('review_schedules')
    .update(next)
    .eq('id', before.id)
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`updateReviewSchedule failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId);
  const updated = asRow<ReviewScheduleRow>(data);

  // Phase 3 §4.2: emit `review.started` when the user moves a
  // schedule into in_progress. The previous state is recorded so
  // consumers can tell "due → in_progress" from "scheduled →
  // in_progress" (both are valid start transitions).
  if (patch.state === 'in_progress' && before.state !== 'in_progress') {
    const result = await serviceEmit({
      client,
      userId,
      actorId: userId,
      eventType: 'review.started',
      aggregateType: 'review_schedule',
      aggregateId: updated.id,
      aggregateVersion: 1,
      payload: {
        schedule_id: updated.id,
        error_id: updated.error_id,
        previous_state: before.state,
      },
    });
    if (result.kind === 'error') {
      console.warn(`[krodex] review.started emit failed: ${result.error.message}`);
    }
  }

  return updated;
}

export interface RecordReviewAttemptInput {
  schedule_id: string;
  question_id: string;
  outcome: ReviewAttemptOutcome;
  selected_option_ids?: readonly string[];
  free_text?: string | null;
  duration_ms?: number | null;
}

export type ReviewAttemptOutcome = 'correct' | 'incorrect' | 'partial';

export async function recordReviewAttempt(
  client: SupabaseClient,
  userId: string,
  input: RecordReviewAttemptInput,
): Promise<ReviewAttemptRow> {
  const schedule = await getReviewSchedule(client, userId, input.schedule_id);
  const { data, error } = await client
    .from('review_attempts')
    .insert({
      user_id: userId,
      schedule_id: input.schedule_id,
      question_id: input.question_id,
      outcome: input.outcome,
      selected_option_ids: input.selected_option_ids ?? [],
      free_text: input.free_text ?? null,
      duration_ms: input.duration_ms ?? null,
    })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`recordReviewAttempt failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId);
  const attempt = asRow<ReviewAttemptRow>(data);

  // Phase 3 §4.2: emit `review.outcome_recorded` after the attempt
  // row is written. The event carries the schedule's error_id so
  // downstream consumers don't need to join to review_schedules.
  const result = await serviceEmit({
    client,
    userId,
    actorId: userId,
    eventType: 'review.outcome_recorded',
    aggregateType: 'review_attempt',
    aggregateId: attempt.id,
    aggregateVersion: 1,
    payload: {
      schedule_id: schedule.id,
      error_id: schedule.error_id,
      question_id: attempt.question_id,
      outcome: input.outcome,
    },
  });
  if (result.kind === 'error') {
    console.warn(
      `[krodex] review.outcome_recorded emit failed: ${result.error.message}`,
    );
  }

  return attempt;
}
