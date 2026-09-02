/**
 * KRODEX API — test definitions, attempts, and grading.
 *
 * The grading logic itself lives in Postgres
 * (public.submit_test_attempt) so the answers table, the attempt
 * counters, the error_entries upsert, and the progress_evidence
 * append are all done atomically. This service is the API-side
 * boundary: it picks the right client, validates the input
 * shapes, and shapes the response.
 *
 * Why a stored procedure: a single attempt grading call touches
 * 4-5 tables. Without a transaction we'd need at least four
 * round trips, plus a way to keep the counters consistent if one
 * of them failed mid-flight. The RPC keeps the test_attempts
 * counters and the error_entries writes on the same transaction.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  TestAnswerInsert,
  TestAnswerRow,
  TestAttemptRow,
  TestDefinitionRow,
  TestDefinitionState,
  TestQuestionRow,
} from '@krodex/shared';
import { InvalidStateError, NotFoundError } from '../errors';
import { assertOwned } from '../auth/ownership';
import { asRow, asRows } from './_row';

export interface CreateTestDefinitionInput {
  title: string;
  source_kind: string;
  source_payload: Record<string, unknown>;
  intended_count: number;
  duration_minutes?: number | null;
  metadata?: Record<string, unknown>;
}

export async function createTestDefinition(
  client: SupabaseClient,
  userId: string,
  input: CreateTestDefinitionInput,
): Promise<TestDefinitionRow> {
  const { data, error } = await client
    .from('test_definitions')
    .insert({
      user_id: userId,
      title: input.title,
      source_kind: input.source_kind,
      source_payload: input.source_payload,
      intended_count: input.intended_count,
      duration_minutes: input.duration_minutes ?? null,
      metadata: input.metadata ?? {},
      state: 'created',
    })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`createTestDefinition failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId);
  return asRow<TestDefinitionRow>(data);
}

export async function getTestDefinition(
  client: SupabaseClient,
  userId: string,
  testId: string,
): Promise<TestDefinitionRow> {
  const { data, error } = await client
    .from('test_definitions')
    .select('*')
    .eq('id', testId)
    .maybeSingle();
  if (error) throw new Error(`getTestDefinition failed: ${error.message}`);
  if (!data) throw new NotFoundError('test definition not found');
  assertOwned(data, userId);
  return asRow<TestDefinitionRow>(data);
}

export async function listTestDefinitions(
  client: SupabaseClient,
  userId: string,
  filter: { state?: TestDefinitionState; source_kind?: string } = {},
): Promise<readonly TestDefinitionRow[]> {
  let q = client
    .from('test_definitions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (filter.state) q = q.eq('state', filter.state);
  if (filter.source_kind) q = q.eq('source_kind', filter.source_kind);
  const { data, error } = await q;
  if (error) throw new Error(`listTestDefinitions failed: ${error.message}`);
  return asRows<TestDefinitionRow>(data ?? []);
}

export async function updateTestDefinition(
  client: SupabaseClient,
  userId: string,
  testId: string,
  patch: { title?: string; duration_minutes?: number | null; state?: TestDefinitionState; metadata?: Record<string, unknown> },
): Promise<TestDefinitionRow> {
  // Re-read first so we can assert ownership before mutating.
  const before = await getTestDefinition(client, userId, testId);
  const { data, error } = await client
    .from('test_definitions')
    .update(patch)
    .eq('id', before.id)
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`updateTestDefinition failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId);
  return asRow<TestDefinitionRow>(data);
}

export async function attachTestQuestion(
  client: SupabaseClient,
  userId: string,
  testId: string,
  questionId: string,
  displayOrder: number,
): Promise<TestQuestionRow> {
  await getTestDefinition(client, userId, testId);
  const { data, error } = await client
    .from('test_questions')
    .insert({
      user_id: userId,
      test_id: testId,
      question_id: questionId,
      display_order: displayOrder,
    })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`attachTestQuestion failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId);
  return asRow<TestQuestionRow>(data);
}

export async function listTestQuestions(
  client: SupabaseClient,
  userId: string,
  testId: string,
): Promise<readonly TestQuestionRow[]> {
  await getTestDefinition(client, userId, testId);
  const { data, error } = await client
    .from('test_questions')
    .select('*')
    .eq('test_id', testId)
    .order('display_order', { ascending: true });
  if (error) throw new Error(`listTestQuestions failed: ${error.message}`);
  return asRows<TestQuestionRow>(data ?? []);
}

export async function startTestAttempt(
  client: SupabaseClient,
  userId: string,
  testId: string,
): Promise<TestAttemptRow> {
  await getTestDefinition(client, userId, testId);
  // Count the questions the test holds so the counters are
  // correct from the start (we never want a 'submitted' attempt
  // with total_questions=0).
  const questions = await listTestQuestions(client, userId, testId);
  const { data, error } = await client
    .from('test_attempts')
    .insert({
      user_id: userId,
      test_id: testId,
      state: 'in_progress',
      started_at: new Date().toISOString(),
      total_questions: questions.length,
      correct_count: 0,
      incorrect_count: 0,
      partial_count: 0,
      skipped_count: 0,
      accuracy: '0',
      metadata: {},
    })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`startTestAttempt failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId);
  return asRow<TestAttemptRow>(data);
}

export async function listTestAttempts(
  client: SupabaseClient,
  userId: string,
  filter: { test_id?: string; state?: string; limit?: number } = {},
): Promise<readonly TestAttemptRow[]> {
  let q = client
    .from('test_attempts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(Math.min(filter.limit ?? 25, 100));
  if (filter.test_id) q = q.eq('test_id', filter.test_id);
  if (filter.state) q = q.eq('state', filter.state);
  const { data, error } = await q;
  if (error) throw new Error(`listTestAttempts failed: ${error.message}`);
  return asRows<TestAttemptRow>(data ?? []);
}

export async function getTestAttempt(
  client: SupabaseClient,
  userId: string,
  attemptId: string,
): Promise<TestAttemptRow> {
  const { data, error } = await client
    .from('test_attempts')
    .select('*')
    .eq('id', attemptId)
    .maybeSingle();
  if (error) throw new Error(`getTestAttempt failed: ${error.message}`);
  if (!data) throw new NotFoundError('test attempt not found');
  assertOwned(data, userId);
  return asRow<TestAttemptRow>(data);
}

export async function listTestAnswers(
  client: SupabaseClient,
  userId: string,
  attemptId: string,
): Promise<readonly TestAnswerRow[]> {
  await getTestAttempt(client, userId, attemptId);
  const { data, error } = await client
    .from('test_answers')
    .select('*')
    .eq('attempt_id', attemptId)
    .order('answered_at', { ascending: true });
  if (error) throw new Error(`listTestAnswers failed: ${error.message}`);
  return asRows<TestAnswerRow>(data ?? []);
}

export interface RecordAnswerInput {
  question_id: string;
  selected_option_ids: readonly string[];
  free_text?: string | null;
  duration_ms?: number | null;
}

export async function recordAnswer(
  client: SupabaseClient,
  userId: string,
  attemptId: string,
  input: RecordAnswerInput,
): Promise<TestAnswerRow> {
  const attempt = await getTestAttempt(client, userId, attemptId);
  if (attempt.state !== 'in_progress') {
    throw new InvalidStateError('attempt is not in progress', {
      context: { state: attempt.state },
    });
  }
  const insert: TestAnswerInsert = {
    user_id: userId,
    attempt_id: attemptId,
    question_id: input.question_id,
    selected_option_ids: input.selected_option_ids,
    free_text: input.free_text ?? null,
    duration_ms: input.duration_ms ?? null,
    // Outcome is null until submit_test_attempt runs.
    outcome: null,
    answered_at: new Date().toISOString(),
  };
  // Upsert so a retake on the same question inside the same
  // attempt replaces the previous answer. The unique key in the
  // schema is (attempt_id, question_id).
  const { data, error } = await client
    .from('test_answers')
    .upsert(insert, { onConflict: 'attempt_id,question_id' })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`recordAnswer failed: ${error?.message ?? 'no row returned'}`);
  }
  assertOwned(data, userId);
  return asRow<TestAnswerRow>(data);
}

/**
 * Submit (grade) a test attempt.
 *
 * The grading itself runs in Postgres so the counters, the
 * error_entries writes, and the progress_evidence append are
 * atomic. The RPC returns a jsonb payload with the final
 * counters; the API returns that payload as the data field.
 */
export interface SubmitTestAttemptResult {
  attempt: TestAttemptRow;
  correct_count: number;
  incorrect_count: number;
  partial_count: number;
  skipped_count: number;
  accuracy: string;
  duration_ms: number | null;
}

export async function submitTestAttempt(
  client: SupabaseClient,
  userId: string,
  attemptId: string,
): Promise<SubmitTestAttemptResult> {
  const before = await getTestAttempt(client, userId, attemptId);
  if (before.state !== 'in_progress') {
    throw new InvalidStateError('attempt is not in progress', {
      context: { state: before.state },
    });
  }
  // Use the service client to invoke the RPC so RLS does not
  // block the cross-table writes the function performs.
  const { data, error } = await client.rpc('submit_test_attempt', {
    p_attempt_id: attemptId,
  } as never);
  if (error) {
    throw new Error(`submit_test_attempt failed: ${error.message}`);
  }
  // Re-read the attempt so the response reflects the post-RPC
  // row exactly. The RPC updates the row in place; a follow-up
  // read gives us the typed TestAttemptRow to return.
  const after = await getTestAttempt(client, userId, attemptId);
  const payload = (data ?? {}) as Record<string, unknown>;
  return {
    attempt: after,
    correct_count: Number(payload.correct_count ?? after.correct_count),
    incorrect_count: Number(payload.incorrect_count ?? after.incorrect_count),
    partial_count: Number(payload.partial_count ?? after.partial_count),
    skipped_count: Number(payload.skipped_count ?? after.skipped_count),
    accuracy: String(payload.accuracy ?? after.accuracy),
    duration_ms:
      payload.duration_ms == null ? after.duration_ms : Number(payload.duration_ms),
  };
}
