/**
 * KRODEX API — attempt-capture bridge (Phase 9, TRD §9).
 *
 * Connects the per-attempt grading flow to the per-wrong-answer
 * capture pipeline. After `submitTestAttempt` finishes grading
 * the attempt (writing test_attempts counters and upserting
 * error_entries for each incorrect answer), this bridge is what
 * calls `runCapture` once per wrong answer.
 *
 * Why a separate module:
 *   - Keeps `tests.ts` (the legacy service) untouched so the
 *     Phase 2 / 4 / 7 / 8 contract stays frozen.
 *   - The bridge is the only place the orchestrator is invoked
 *     from the API surface; the route handler just calls this.
 *
 * Per-stage isolation is the orchestrator's responsibility. The
 * bridge only does the read-side work — gather the inputs the
 * orchestrator needs, then fan out.
 *
 * Failure handling:
 *   - All errors are caught and logged at this level. A failure
 *     in any single capture never aborts the others, and never
 *     undoes the attempt grading that already committed. The
 *     student sees a normal submit response; the missing
 *     evidence rows are observable via the outbox / logs.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ErrorEntryRow,
  QuestionOptionRow,
  QuestionRow,
  TestAnswerRow,
} from '@krodex/shared';
import { asRow, asRows } from './_row';
import { runCapture, type CaptureResult } from './capture-orchestrator';
import type { AiProvider } from '../ai/provider';

export interface AttemptCaptureBridgeInput {
  /** Owning student. All queries are scoped through RLS. */
  userId: string;
  /** The just-submitted attempt. */
  attemptId: string;
  /** Storage bucket for snapshot binaries. */
  storageBucket: string;
  /** AI provider for the classification stage. */
  aiProvider: AiProvider | null;
  /** Wall clock seam for deterministic tests. */
  now?: Date;
}

export interface AttemptCaptureBridgeResult {
  /** Captures that ran, in the same order as the wrong answers. */
  captures: CaptureResult[];
  /** Number of incorrect answers the submit RPC flagged. */
  incorrectCount: number;
  /** Errors we couldn't capture (one entry per failed answer). */
  failures: Array<{ questionId: string; error: string }>;
}

/**
 * Run the capture pipeline for every incorrect answer in the
 * given attempt. Idempotent: a re-run on the same attempt
 * returns the same evidence ids (the orchestrator's
 * `createErrorEvidence` and `findActiveAssetForEvidence` checks
 * ensure no duplicate rows or duplicate storage uploads).
 */
export async function runCaptureForAttempt(
  client: SupabaseClient,
  input: AttemptCaptureBridgeInput,
): Promise<AttemptCaptureBridgeResult> {
  const now = input.now ?? new Date();

  // 0. Resolve the attempt row so we can carry the actual test_id
  //    into each capture call. The orchestrator's CaptureInput
  //    requires both the attempt id and the test_id; the test_id
  //    is the parent test definition the attempt belongs to.
  const attemptRow = await fetchAttemptForCapture(
    client,
    input.userId,
    input.attemptId,
  );
  const testId = attemptRow?.test_id ?? 'unknown';

  // 1. Find the error entries the submit RPC just upserted for
  //    this attempt. One error_entry per (user, question), so
  //    the count matches the number of incorrect answers.
  const { data: errorRows, error: errorsError } = await client
    .from('error_entries')
    .select('*')
    .eq('user_id', input.userId)
    .eq('source_attempt_id', input.attemptId);
  if (errorsError) {
    console.warn(
      `[krodex] capture bridge: error_entries lookup failed: ${errorsError.message}`,
    );
    return { captures: [], incorrectCount: 0, failures: [] };
  }
  const errorEntries = asRows<ErrorEntryRow>(errorRows ?? []);
  if (errorEntries.length === 0) {
    return { captures: [], incorrectCount: 0, failures: [] };
  }

  // 2. Find the matching test_answers (one per question_id).
  const questionIds = errorEntries
    .map((e) => e.question_id)
    .filter((q): q is string => q != null);
  if (questionIds.length === 0) {
    return {
      captures: [],
      incorrectCount: errorEntries.length,
      failures: [],
    };
  }
  const { data: answerRows, error: answersError } = await client
    .from('test_answers')
    .select('*')
    .eq('attempt_id', input.attemptId)
    .in('question_id', questionIds)
    .eq('outcome', 'incorrect');
  if (answersError) {
    console.warn(
      `[krodex] capture bridge: test_answers lookup failed: ${answersError.message}`,
    );
    return {
      captures: [],
      incorrectCount: errorEntries.length,
      failures: errorEntries.map((e) => ({
        questionId: e.question_id ?? '(unknown)',
        error: 'test_answers lookup failed',
      })),
    };
  }
  const answers = asRows<TestAnswerRow>(answerRows ?? []);
  const answersByQ = new Map(answers.map((a) => [a.question_id, a]));

  // 3. Load the questions + their options + their topic names.
  const { data: questionRows, error: questionsError } = await client
    .from('questions')
    .select('*')
    .in('id', questionIds);
  if (questionsError) {
    console.warn(
      `[krodex] capture bridge: questions lookup failed: ${questionsError.message}`,
    );
  }
  const questions = asRows<QuestionRow>(questionRows ?? []);
  const questionsById = new Map(questions.map((q) => [q.id, q]));

  // Topic names: load all topic ids referenced in the wrong-answer
  // set in a single round trip.
  const topicIds = Array.from(
    new Set(
      questions
        .map((q) => q.topic_id)
        .filter((t): t is string => t != null),
    ),
  );
  const topicNames = new Map<string, string>();
  if (topicIds.length > 0) {
    const { data: topicRows, error: topicsError } = await client
      .from('topics')
      .select('id, name')
      .in('id', topicIds);
    if (topicsError) {
      console.warn(
        `[krodex] capture bridge: topics lookup failed: ${topicsError.message}`,
      );
    }
    for (const t of (topicRows ?? []) as Array<{ id: string; name: string }>) {
      topicNames.set(t.id, t.name);
    }
  }

  // 4. Load every option for every wrong-answer question in one
  //    query. Phase 9 needs the correct-answer labels to render
  //    the expected-answer column on the snapshot.
  const { data: optionRows, error: optionsError } = await client
    .from('question_options')
    .select('*')
    .in('question_id', questionIds);
  if (optionsError) {
    console.warn(
      `[krodex] capture bridge: question_options lookup failed: ${optionsError.message}`,
    );
  }
  const optionsByQ = new Map<string, QuestionOptionRow[]>();
  for (const opt of asRows<QuestionOptionRow>(optionRows ?? [])) {
    const list = optionsByQ.get(opt.question_id) ?? [];
    list.push(opt);
    optionsByQ.set(opt.question_id, list);
  }

  // 5. Fan out: one orchestrator call per wrong answer. Per-stage
  //    try/catch is inside the orchestrator; here we only guard
  //    against unexpected throws so a single failure can't
  //    abort the whole batch.
  const captures: CaptureResult[] = [];
  const failures: AttemptCaptureBridgeResult['failures'] = [];
  await Promise.all(
    errorEntries.map(async (errorEntry) => {
      const qid = errorEntry.question_id;
      if (!qid) return;
      const answer = answersByQ.get(qid);
      const question = questionsById.get(qid) ?? null;
      const options = optionsByQ.get(qid) ?? [];
      const topicName = question?.topic_id
        ? (topicNames.get(question.topic_id) ?? null)
        : null;
      if (!answer) {
        // Mismatched ids: the error_entry points at a question
        // that isn't in the test_answers. This shouldn't happen
        // (the submit RPC joins them), but log and skip rather
        // than throw.
        console.warn(
          `[krodex] capture bridge: no test_answer for error_entry ${errorEntry.id} (question ${qid})`,
        );
        failures.push({ questionId: qid, error: 'test_answer missing' });
        return;
      }
      try {
        const result = await runCapture(client, {
          userId: input.userId,
          attempt: { id: input.attemptId, test_id: testId },
          answer,
          errorEntry,
          question,
          questionOptions: options,
          topicName,
          aiProvider: input.aiProvider,
          storageBucket: input.storageBucket,
          now,
        });
        captures.push(result);
      } catch (err) {
        // Defensive: runCapture is failure-tolerant per stage and
        // should not throw. If it does, log + record a failure
        // for this question and let the batch finish.
        const msg = (err as Error).message;
        console.warn(
          `[krodex] capture bridge: runCapture threw for question ${qid}: ${msg}`,
        );
        failures.push({ questionId: qid, error: msg });
      }
    }),
  );

  return {
    captures,
    incorrectCount: errorEntries.length,
    failures,
  };
}

/** Convenience: read the (typed) attempt row again. */
export async function fetchAttemptForCapture(
  client: SupabaseClient,
  _userId: string,
  attemptId: string,
): Promise<{ id: string; test_id: string } | null> {
  const { data, error } = await client
    .from('test_attempts')
    .select('id, test_id')
    .eq('id', attemptId)
    .maybeSingle();
  if (error || !data) return null;
  return asRow<{ id: string; test_id: string }>(data);
}
