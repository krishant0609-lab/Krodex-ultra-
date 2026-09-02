/**
 * KRODEX API — error bank service.
 *
 * Phase 2 covers the CRUD surface: list, create, update, archive,
 * link a question. The submit_test_attempt RPC is the writer that
 * creates an error_entry when a question is graded "incorrect";
 * this service is the manual editor that the user uses after
 * reviewing their mistakes.
 *
 * Phase 3: emits `error.classified` (mistake_type null→value) and
 * `error.resolved` (status→resolved) per PHASE3_PLAN §4.2. The
 * emission is post-commit on the caller's client; failures are
 * logged and do not roll back the user-facing mutation.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ErrorEntryRow,
  ErrorEntryStatus,
  ErrorQuestionLinkRow,
  MistakeType,
} from '@krodex/shared';
import { NotFoundError } from '../errors';
import { assertOwned } from '../auth/ownership';
import { asRow, asRows } from './_row';
import { serviceEmit } from '../events/service-emitter';

export interface CreateErrorEntryInput {
  question_id?: string | null;
  mistake_type?: MistakeType | null;
  remark?: string | null;
  source_attempt_id?: string | null;
  metadata?: Record<string, unknown>;
}

export async function createErrorEntry(
  client: SupabaseClient,
  userId: string,
  input: CreateErrorEntryInput,
): Promise<ErrorEntryRow> {
  const { data, error } = await client
    .from('error_entries')
    .insert({
      user_id: userId,
      question_id: input.question_id ?? null,
      status: 'active',
      mistake_type: input.mistake_type ?? null,
      remark: input.remark ?? null,
      source_attempt_id: input.source_attempt_id ?? null,
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      recurrence_count: 0,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`createErrorEntry failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId);
  return asRow<ErrorEntryRow>(data);
}

export async function getErrorEntry(
  client: SupabaseClient,
  userId: string,
  errorId: string,
): Promise<ErrorEntryRow> {
  const { data, error } = await client
    .from('error_entries')
    .select('*')
    .eq('id', errorId)
    .maybeSingle();
  if (error) throw new Error(`getErrorEntry failed: ${error.message}`);
  if (!data) throw new NotFoundError('error entry not found');
  assertOwned(data, userId);
  return asRow<ErrorEntryRow>(data);
}

export async function listErrorEntries(
  client: SupabaseClient,
  userId: string,
  filter: { status?: ErrorEntryStatus; question_id?: string } = {},
  limit = 25,
): Promise<readonly ErrorEntryRow[]> {
  let q = client
    .from('error_entries')
    .select('*')
    .eq('user_id', userId)
    .order('last_seen_at', { ascending: false })
    .limit(limit);
  if (filter.status) q = q.eq('status', filter.status);
  if (filter.question_id) q = q.eq('question_id', filter.question_id);
  const { data, error } = await q;
  if (error) throw new Error(`listErrorEntries failed: ${error.message}`);
  return asRows<ErrorEntryRow>(data ?? []);
}

export interface UpdateErrorEntryInput {
  status?: ErrorEntryStatus;
  mistake_type?: MistakeType | null;
  remark?: string | null;
  recurrence_count?: number;
  metadata?: Record<string, unknown>;
}

export async function updateErrorEntry(
  client: SupabaseClient,
  userId: string,
  errorId: string,
  patch: UpdateErrorEntryInput,
): Promise<ErrorEntryRow> {
  const before = await getErrorEntry(client, userId, errorId);
  const { data, error } = await client
    .from('error_entries')
    .update(patch)
    .eq('id', errorId)
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`updateErrorEntry failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId);
  const updated = asRow<ErrorEntryRow>(data);

  // Phase 3 §4.2: emit `error.classified` when the user assigns a
  // mistake_type for the first time (null → value). The state
  // transition is the domain-meaningful event; subsequent edits
  // to the same mistake_type do not re-emit.
  if (
    patch.mistake_type !== undefined &&
    patch.mistake_type !== null &&
    before.mistake_type === null
  ) {
    const result = await serviceEmit({
      client,
      userId,
      actorId: userId,
      eventType: 'error.classified',
      aggregateType: 'error_entry',
      aggregateId: updated.id,
      aggregateVersion: 1,
      payload: {
        error_id: updated.id,
        mistake_type: patch.mistake_type,
        previous_mistake_type: before.mistake_type,
      },
    });
    if (result.kind === 'error') {
      // Log and continue — the source mutation is the user-facing
      // success; projection work can rebuild later.
      console.warn(
        `[krodex] error.classified emit failed: ${result.error.message}`,
      );
    }
  }

  return updated;
}

export async function linkErrorQuestion(
  client: SupabaseClient,
  userId: string,
  errorId: string,
  questionId: string,
): Promise<ErrorQuestionLinkRow> {
  await getErrorEntry(client, userId, errorId);
  const { data, error } = await client
    .from('error_question_links')
    .insert({ user_id: userId, error_id: errorId, question_id: questionId })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`linkErrorQuestion failed: ${error?.message ?? 'no row returned'}`);
  }
  return asRow<ErrorQuestionLinkRow>(data);
}

export interface ResolveErrorInput {
  /**
   * Why the error is being resolved. Defaults to 'manual' (the user
   * clicked the "resolved" button in the UI). 'review' is used when
   * a qualifying correct review answer drives the resolution.
   */
  trigger?: 'review' | 'manual';
  /** Required when trigger='review' — the schedule that drove it. */
  review_schedule_id?: string | null;
}

/**
 * Mark an error entry as resolved.
 *
 * Phase 3 §4.2: emits `error.resolved`. The trigger distinguishes
 * "user manually resolved" from "resolved by a qualifying correct
 * review answer" — both write the same row state but the
 * notification handler and analytics differentiate them.
 */
export async function resolveError(
  client: SupabaseClient,
  userId: string,
  errorId: string,
  input: ResolveErrorInput = {},
): Promise<ErrorEntryRow> {
  const trigger: 'review' | 'manual' = input.trigger ?? 'manual';
  const before = await getErrorEntry(client, userId, errorId);
  if (before.status === 'resolved' || before.status === 'archived') {
    // Idempotent: a re-resolve is a no-op on the source row, and
    // we deliberately do not re-emit the event. The outbox unique
    // index would dedup anyway, but returning the row unchanged
    // keeps the call cheap.
    return before;
  }
  const { data, error } = await client
    .from('error_entries')
    .update({ status: 'resolved' })
    .eq('id', errorId)
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`resolveError failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId);
  const updated = asRow<ErrorEntryRow>(data);

  const result = await serviceEmit({
    client,
    userId,
    actorId: userId,
    eventType: 'error.resolved',
    aggregateType: 'error_entry',
    aggregateId: updated.id,
    aggregateVersion: 1,
    payload: {
      error_id: updated.id,
      trigger,
      review_schedule_id: input.review_schedule_id ?? null,
    },
  });
  if (result.kind === 'error') {
    console.warn(`[krodex] error.resolved emit failed: ${result.error.message}`);
  }
  return updated;
}
